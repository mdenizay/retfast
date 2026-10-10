//! Etkinlik raporu ve iz dışa aktarma (GPX / IGC).
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::{HeaderValue, header},
    response::{IntoResponse, Response},
    routing::get,
};
use serde::Deserialize;
use serde_json::Value;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{
    auth::AuthUser,
    authz::Access,
    error::{AppError, AppResult, invalid},
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new().route("/events/{id}/report", get(report)).route("/events/{id}/tracks/{user_id}/export", get(export))
}

/// Operasyon özeti: katılım, uçuşlar, retrieve süreleri, SOS ve takip hacmi. Yalnızca yetkililere.
async fn report(State(state): State<AppState>, user: AuthUser, Path(event_id): Path<Uuid>) -> AppResult<Json<Value>> {
    Access::load(&state.db, user, event_id).await?.staff()?;
    let v: Value = sqlx::query_scalar(
        "select jsonb_build_object(
            'members', coalesce((select jsonb_object_agg(role, n) from (
                select role, count(*) n from event_members where event_id = $1 and status = 'active' group by role) r), '{}'::jsonb),
            'flights', jsonb_build_object(
                'total', (select count(*) from flights where event_id = $1 and status <> 'cancelled'),
                'completed', (select count(*) from flights where event_id = $1 and status = 'completed'),
                'pilots', (select count(distinct pilot_id) from flights where event_id = $1 and status <> 'cancelled'),
                'avg_airtime_min', (select round((avg(extract(epoch from landed_at - takeoff_at)) / 60)::numeric, 1)
                    from flights where event_id = $1 and takeoff_at is not null and landed_at is not null)),
            'retrieves', jsonb_build_object(
                'total', (select count(*) from retrieve_requests where event_id = $1),
                'completed', (select count(*) from retrieve_requests where event_id = $1 and status = 'completed'),
                'cancelled', (select count(*) from retrieve_requests where event_id = $1 and status = 'cancelled'),
                'avg_assign_min', (select round((avg(extract(epoch from assigned_at - requested_at)) / 60)::numeric, 1)
                    from retrieve_requests where event_id = $1 and assigned_at is not null),
                'avg_pickup_min', (select round((avg(extract(epoch from picked_up_at - requested_at)) / 60)::numeric, 1)
                    from retrieve_requests where event_id = $1 and picked_up_at is not null),
                'avg_total_min', (select round((avg(extract(epoch from completed_at - requested_at)) / 60)::numeric, 1)
                    from retrieve_requests where event_id = $1 and completed_at is not null)),
            'sos', jsonb_build_object(
                'total', (select count(*) from sos_alerts where event_id = $1),
                'resolved', (select count(*) from sos_alerts where event_id = $1 and status = 'resolved')),
            'tracking', jsonb_build_object(
                'points', (select count(*) from location_points where event_id = $1),
                'users', (select count(distinct user_id) from location_points where event_id = $1)),
            'by_day', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'flights', n) order by d) from (
                select (f.takeoff_at at time zone e.timezone)::date d, count(*) n
                from flights f join events e on e.id = f.event_id
                where f.event_id = $1 and f.takeoff_at is not null group by 1) x), '[]'::jsonb))",
    )
    .bind(event_id)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(v))
}

#[derive(Deserialize)]
struct ExportQuery {
    #[serde(default)]
    format: Option<String>,
    #[serde(default, with = "time::serde::rfc3339::option")]
    from: Option<OffsetDateTime>,
    #[serde(default, with = "time::serde::rfc3339::option")]
    to: Option<OffsetDateTime>,
}

struct Fix {
    at: OffsetDateTime,
    lat: f64,
    lon: f64,
    alt: Option<f32>,
}

async fn export(
    State(state): State<AppState>,
    user: AuthUser,
    Path((event_id, target)): Path<(Uuid, Uuid)>,
    Query(q): Query<ExportQuery>,
) -> AppResult<Response> {
    let access = Access::load(&state.db, user, event_id).await?.member()?;
    if target != user.id && !access.is_staff() {
        return Err(AppError::Forbidden);
    }
    let format = q.format.as_deref().unwrap_or("gpx");
    if format != "gpx" && format != "igc" {
        return Err(invalid("format must be gpx or igc"));
    }
    let rows: Vec<(OffsetDateTime, f64, f64, Option<f32>)> = sqlx::query_as(
        "select recorded_at, lat, lon, altitude_m from location_points
         where event_id = $1 and user_id = $2 and ($3::timestamptz is null or recorded_at >= $3)
           and ($4::timestamptz is null or recorded_at <= $4)
         order by recorded_at limit 100000",
    )
    .bind(event_id)
    .bind(target)
    .bind(q.from)
    .bind(q.to)
    .fetch_all(&state.db)
    .await?;
    if rows.is_empty() {
        return Err(AppError::NotFound);
    }
    let (name, event_name): (String, String) =
        sqlx::query_as("select u.first_name || ' ' || u.last_name, e.name from users u, events e where u.id = $1 and e.id = $2")
            .bind(target)
            .bind(event_id)
            .fetch_one(&state.db)
            .await?;
    let fixes: Vec<Fix> = rows.into_iter().map(|(at, lat, lon, alt)| Fix { at, lat, lon, alt }).collect();
    let (body, mime, ext) = if format == "igc" {
        (igc(&name, &event_name, &fixes), "text/plain; charset=utf-8", "igc")
    } else {
        (gpx(&name, &event_name, &fixes), "application/gpx+xml; charset=utf-8", "gpx")
    };
    let date = fixes[0].at.date();
    let file = format!("retfast-{}-{date}.{ext}", slug(&name));
    let mut res = body.into_response();
    res.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static(mime));
    res.headers_mut().insert(header::CONTENT_DISPOSITION, HeaderValue::from_str(&format!("attachment; filename=\"{file}\"")).unwrap());
    Ok(res)
}

fn slug(s: &str) -> String {
    let mut out = String::new();
    for c in s.to_lowercase().chars() {
        let c = match c {
            'ç' => 'c',
            'ğ' => 'g',
            'ı' => 'i',
            'ö' => 'o',
            'ş' => 's',
            'ü' => 'u',
            c => c,
        };
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    out.trim_end_matches('-').to_string()
}

/// IGC başlıkları ASCII olmalıdır: Türkçe harfler sadeleştirilir, diğerleri `?` olur.
fn ascii(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'ç' => 'c',
            'Ç' => 'C',
            'ğ' => 'g',
            'Ğ' => 'G',
            'ı' => 'i',
            'İ' => 'I',
            'ö' => 'o',
            'Ö' => 'O',
            'ş' => 's',
            'Ş' => 'S',
            'ü' => 'u',
            'Ü' => 'U',
            c if c.is_ascii() && !c.is_control() => c,
            _ => '?',
        })
        .collect()
}

fn xml(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn iso(t: OffsetDateTime) -> String {
    t.to_offset(time::UtcOffset::UTC).format(&time::format_description::well_known::Rfc3339).unwrap_or_default()
}

fn gpx(pilot: &str, event: &str, fixes: &[Fix]) -> String {
    let mut out = String::with_capacity(fixes.len() * 90 + 400);
    out.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    out.push_str("<gpx version=\"1.1\" creator=\"Retfast\" xmlns=\"http://www.topografix.com/GPX/1/1\">\n");
    out.push_str(&format!("<metadata><name>{}</name></metadata>\n<trk><name>{}</name><trkseg>\n", xml(event), xml(pilot)));
    for f in fixes {
        out.push_str(&format!("<trkpt lat=\"{:.6}\" lon=\"{:.6}\">", f.lat, f.lon));
        if let Some(a) = f.alt {
            out.push_str(&format!("<ele>{a:.1}</ele>"));
        }
        out.push_str(&format!("<time>{}</time></trkpt>\n", iso(f.at)));
    }
    out.push_str("</trkseg></trk>\n</gpx>\n");
    out
}

/// IGC: B kayıtları GPS irtifasıyla yazılır; basınç irtifası alanı 00000 bırakılır (cihazda barometre yok).
fn igc(pilot: &str, event: &str, fixes: &[Fix]) -> String {
    let t0 = fixes[0].at.to_offset(time::UtcOffset::UTC);
    let mut out = String::with_capacity(fixes.len() * 40 + 400);
    out.push_str("AXRF Retfast\r\n");
    out.push_str(&format!("HFDTE{:02}{:02}{:02}\r\n", t0.day(), t0.month() as u8, t0.year() % 100));
    out.push_str("HFFXA035\r\n");
    out.push_str(&format!("HFPLTPILOTINCHARGE:{}\r\n", ascii(pilot)));
    out.push_str(&format!("HFCIDCOMPETITIONID:{}\r\n", ascii(event)));
    out.push_str("HFGTYGLIDERTYPE:Paraglider\r\nHFDTM100GPSDATUM:WGS-1984\r\nHFRFWFIRMWAREVERSION:Retfast\r\n");
    for f in fixes {
        let t = f.at.to_offset(time::UtcOffset::UTC);
        let (lat_h, lat_v) = (if f.lat >= 0.0 { 'N' } else { 'S' }, f.lat.abs());
        let (lon_h, lon_v) = (if f.lon >= 0.0 { 'E' } else { 'W' }, f.lon.abs());
        let (lat_d, lon_d) = (lat_v.floor(), lon_v.floor());
        let lat_m = ((lat_v - lat_d) * 60_000.0).round() as u32;
        let lon_m = ((lon_v - lon_d) * 60_000.0).round() as u32;
        let alt = f.alt.map(|a| a.round() as i32).unwrap_or(0).max(0);
        out.push_str(&format!(
            "B{:02}{:02}{:02}{:02}{:05}{lat_h}{:03}{:05}{lon_h}A00000{:05}\r\n",
            t.hour(),
            t.minute(),
            t.second(),
            lat_d as u32,
            lat_m,
            lon_d as u32,
            lon_m,
            alt
        ));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn igc_headers_are_ascii() {
        let fixes = [Fix { at: OffsetDateTime::from_unix_timestamp(1_791_000_000).unwrap(), lat: 1.0, lon: 1.0, alt: None }];
        assert!(igc("Ahmet Yılmaz", "Çameli Açık", &fixes).is_ascii());
    }

    #[test]
    fn igc_b_record_is_fixed_width() {
        let fixes =
            [Fix { at: OffsetDateTime::from_unix_timestamp(1_791_000_000).unwrap(), lat: 37.0567, lon: -29.3622, alt: Some(1850.4) }];
        let out = igc("Ada Test", "Open", &fixes);
        let b = out.lines().find(|l| l.starts_with('B')).unwrap();
        assert_eq!(b.len(), 35, "B record is 35 chars: {b}");
        assert!(b.contains("N") && b.contains("W") && b.ends_with("A0000001850"), "{b}");
    }
}
