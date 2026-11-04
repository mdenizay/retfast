# Retfast Screens

Screen inventory per client. Data sources refer to `docs/architecture/api-contract.md` (v1).

## Web

One SPA (`apps/web`) served on two hosts (ADR-008). `retfast.com` serves the public routes; on `app.retfast.com`
`/` redirects to `/app`. `/app/*` also works on `retfast.com`. Default language Turkish, English via toggle; theme
follows the system with a Light/Dark override.

### Global behaviour

- **Session**: access token in memory only. On boot `POST /auth/refresh` (cookie `rf_refresh`, `credentials: include`);
  refreshed again 60 s before expiry and on any `401 token_expired` (single-flight, shared by concurrent requests).
- **Forced password change**: if `user.must_change_password` (from login/refresh, or any `403 password_change_required`)
  every route except `/change-password` and `/privacy` redirects to `/change-password?next=…`.
- **Role-aware navigation**: items the user can't use are hidden; the API stays the security boundary (403s are shown
  as "Bu işlem için yetkiniz yok.").
- **Errors**: server `error.message` shown inline; error boxes include `status · code · X-Request-Id`.
- **Open SOS banner**: responders/organizers see a red banner on every `/app` page while a non-test SOS is open
  (`GET /incidents?status=open`, 15 s poll); test-only incidents show an amber "TEST" banner.

### Public (retfast.com)

| Route | Purpose | Data |
|---|---|---|
| `/` | What Retfast is, how it works, visual-state legend, **honest limitations** (GPS/connectivity, live ≠ instant, SOS does not contact authorities, battery limits, not a certified log), current events. "iOS uygulaması yakında" unless `VITE_APP_STORE_URL` is set. | `GET /events?status=active,published&limit=5` |
| `/events` | Public events; search + status filter. | `GET /events?status=&q=` |
| `/events/:slug` | Event detail: status/demo/restricted badges, description, launch sites (unverified flag), details; actions *Canlı haritayı aç* (if `live_tracking` and `public_live_map` or member), *Katıl/Ayrıl*, *Yönet* (organizers). | `GET /events/{slug}`, `GET /events/{id}/launch-sites`, `POST /events/{id}/join|leave` |
| `/events/:slug/live` | Public live map (full screen) — only what the API returns for the caller (guests: public flights only). | see *Live tracking* |
| `/pilots/:publicId` | Public pilot profile (display name, bio, wing, nationality). | `GET /pilots/{public_id}` |
| `/flights/:publicId` | Public flight: stats, route map, GPS-quality panel, altitude & ground-speed charts, GPX. | `GET /flights/{id}`, `/positions`, `/track.gpx` |
| `/login` | Email + password; 401 → "E-posta veya şifre hatalı."; 429 → countdown from `Retry-After`, submit disabled. | `POST /auth/login` (`client:"web"`) |
| `/register` | Name, email, password (policy hint). | `POST /auth/register` |
| `/forgot-password` | Always shows the neutral "if an account exists…" message. | `POST /auth/password/forgot` |
| `/reset-password?token=` | New password + confirm. | `POST /auth/password/reset` |
| `/verify-email?token=` | Auto-submits once. | `POST /auth/email/verify` |
| `/change-password` | Forced first-login flow (also voluntary). Blocks reuse of the current password; shows server policy errors on the field; success replaces the session and continues to `next`. | `POST /auth/password/change` |
| `/privacy` | Data processed, who sees positions, emergency info handling, SOS limits, retention, rights, third parties. | — |

### Operations (`/app`)

| Route | Roles (nav) | Content | Data |
|---|---|---|---|
| `/app` | all | Admin: platform counters (active events, tracking pilots, stale sessions, open incidents, recent flights, system checks). Others: counters derived from what they can see; lists of incidents (responders), events (with *Canlı*), recent own flights. | `GET /admin/stats` (admin) · `GET /events`, `GET /flights`, `GET /incidents` |
| `/app/events` | all | Events the user can see, with `my_role`; filters incl. draft/archived. | `GET /events` |
| `/app/events/new` | event_organizer, platform_admin | Event form (see below). Created as draft. | `POST /events` |
| `/app/events/:id` | members (edit: organizer/admin) | Edit form, launch sites (list, add with optional map-click coordinates, verify/unverify, delete), archive (confirm dialog). | `PATCH /events/{id}`, `POST /events/{id}/archive`, launch-site CRUD |
| `/app/events/:id/participants` | organizer/admin manage; members view | Search pilots (≥ 2 chars) and add with a role; change role inline; remove (not yourself). Removed members shown muted. | `GET /pilots?q=`, participants CRUD |
| `/app/events/:id/live` | members | Operations live map (full screen) incl. SOS markers for responders. | see *Live tracking* |
| `/app/pilots` | event_organizer, platform_admin | Pilot search with roles; link to their flights. | `GET /pilots?q=` |
| `/app/flights` | all | Own flights (or `?pilot_id=` for organizers); status filter; table with duration/distance/max altitude. | `GET /flights` |
| `/app/flights/:id` | owner / authorized | Flight detail (route, stats, GPS quality, charts, GPX); owner can change visibility. | `GET/PATCH /flights/{id}`, `/positions`, `/track.gpx` |
| `/app/incidents` | all (pilots: own) | Status filter (active/open/resolved/cancelled/all); TEST label; age ticking; live updates via `incidents` channel. | `GET /incidents`, WS `incidents` |
| `/app/incidents/:id` | owner / responders | See *Emergency operations*. | |
| `/app/rescue` | rescue_operator, platform_admin | My availability (available/unavailable), my assignments with status select, team table (availability, active assignment, last position + age). | `/rescue/team`, `/rescue/assignments`, `PUT /rescue/me/status` |
| `/app/reports` | event_organizer, platform_admin | Pick an organized event → counters (participants, flights, simulated, durations, distance, completeness, gaps, interruptions), per-pilot duration bar chart and table (only when the report contains per-pilot rows), raw JSON. | `GET /events/{id}/report` |
| `/app/settings` | all | Profile (name, email verification resend), pilot profile, emergency contact, preferences (theme, language, units, default flight visibility, public profile), password change, data export (JSON download), account deletion request / cancel. | `PATCH /me`, `PATCH /me/pilot`, `/me/export`, `/me/deletion-request` |
| `/app/admin/users` | platform_admin | Search; edit roles, disable account (not self), send password reset. | `/admin/users` |
| `/app/admin/audit` | platform_admin | Audit log filtered by action; metadata expandable. | `GET /admin/audit` |

### Event form

Name (required), slug (optional, `[a-z0-9-]`), location, start/end (`datetime-local`, end > start), description,
visibility (public / restricted), status (edit only), map center (lat/lon text fields or map click; "approximate" flag),
settings toggles: registration open, live tracking, flight recording, observers allowed, public live map, emergency
testing. Client validation + server `details` mapped to fields; server message shown above the submit button.

### Live tracking (most important screen)

Layout (desktop ≥ 1280 px): header · left pilot list (320 px) · map · right pilot detail (320 px).
1024–1279 px: list + map; the detail opens in a bottom sheet. < 1024 px: full-screen map with a bottom sheet
(tabs *Pilotlar* / *Pilot detayı*) opened by a "Pilotlar · n" button or by tapping a marker.

- **Header**: back, event name, DEMO badge, location · status, counts (live / stale / lost), connection indicator
  (*Canlı bağlantı* / *Bağlanıyor…* / *Yeniden bağlanılıyor (n)*), time of the last REST snapshot.
- **Pilot list**: search (name / public id), filter chips with counts (Tümü, Canlı, Gecikmeli, Sinyal yok, SIM, SOS for
  responders); rows sorted SOS → live → stale → lost → name; row = heading glyph (solid/hollow/dashed), name, SIM, SOS,
  GPS altitude, ground speed, freshness text and ticking age. Windowed rendering (60 px rows) for 2000+ pilots.
- **Map**: GeoJSON sources + symbol/circle/line layers. Markers: chevron rotated to `course_deg` when moving (dot when
  stationary/no course), solid = live, hollow amber = stale, dashed grey = lost; labels include "SIM" and, for non-live,
  the state + age. Selected pilot: ring, 3 px trail, dashed accuracy circle (`h_acc_m`). Others: faint 15-min trails.
  Red ring for pilots with an open incident. Initial fit to all pilots, else event center.
- **Detail**: freshness badge, SIM, ended, open-SOS pill; large ticking position age + GPS time; GPS irtifa, yer hızı,
  dikey hız (*tahmini*), yön, konum doğruluğu (±m), sample seq, coordinates (selectable); actions *Takip et* (map follows
  updates), *Ortala*, *Uçuşu aç*.
- **Data**: `GET /events/{id}/live` snapshot (re-fetched every 60 s, every 15 s while the socket is down) +
  WebSocket `/api/v1/realtime`: `auth` (if signed in) → `subscribe event:<id>` with `since` = last cursor;
  `subscribed.snapshot` replaces state; `position` / `flight` deltas are batched per animation frame; `ping` → `pong`;
  60 s silence → reconnect; backoff 1 s → 30 s with jitter; close 4001 → refresh token, then reconnect. Out-of-order or
  duplicate positions (by `seq`) are ignored; a REST snapshot never moves the cursor backwards or replaces a newer
  streamed position. Ages use a server/client clock offset.
- **States**: reconnect banner "Bağlantı koptu – yeniden bağlanılıyor (n)"; snapshot error box with retry;
  empty state explaining visibility (public: only publicly shared flights).

### Emergency operations

- **List**: see table above. Open real SOS rows get a red left rule; TEST rows a TEST badge.
- **Detail**: header (SOS + TEST + status, pilot, server-received and device times, pilot message, TEST notice,
  acknowledgement line — "Henüz kimse onaylamadı." until the server sets `acknowledged_at`), permanent disclaimer
  (no automatic contact with authorities), responder actions, last-known position map (red point, accuracy circle,
  last 30 min of the flight trail), age (ticking, with freshness badge), accuracy, GPS altitude, coordinates,
  pilot info + emergency contact (tap-to-call; "access is audited"), assignments, timeline (newest first).
- **Actions** (responders, not on own incident; only while open/acknowledged/responding): *Bildirimi onayla*
  (open only, 56 px emergency button), *Müdahale başladı*, *Çözüldü olarak kapat* (dialog with closing note),
  *Not ekle*, *Görevli ata* (from `/rescue/team`). Every action waits for the server; errors are shown next to the action;
  UI is updated from the server response / refetch, never optimistically.
- **Live**: subscribes to the `incidents` channel; incident pushes update the cache; detail also polls every 10 s
  while active.

### Flight detail

Header (status, SIM, public id, pilot, start → end, device), visibility (owner can change), GPX download;
six stat tiles; route map (start hollow, end filled, poor fixes > ±50 m as orange dots); GPS quality (samples vs
expected, completeness meter, gaps, median and p95 accuracy, share of poor fixes); GPS altitude and ground-speed line
charts (single series each, shared time axis, crosshair tooltip, no dual axis); note that altitude is GPS-derived and
the GPX is not a certified log. Recording flights refresh every 15 s.

## iOS

Native SwiftUI app in `apps/ios` (iOS 17+, Turkish primary, English via `Localizable.xcstrings`). Components: `AeroCard`, `InstrumentTile`, `StatusPill` (icon + text, never colour alone), `PrimaryButtonStyle` (48/56 pt), `SyncBadge`, `FreshnessBadge`, `SimBadge`, `TestBadge` — `Retfast/DesignSystem`, colours/spacing from the generated `AeroTokens.swift`. Engine details: `docs/architecture/ios-tracking.md`.

| Screen | Where | Contents / rules |
|---|---|---|
| Splash | system `UILaunchScreen` | Token background colour; no artificial delay (the root shows a spinner only while the session restores). |
| Onboarding | first launch, re-openable from Profile | 7 pages: what Retfast does, how tracking works, background location ("Her Zaman", swiping the app away stops iOS location), battery, privacy & sharing, connectivity limits, emergency limitations. Cannot finish without acknowledging that Retfast does not replace emergency services / 112. |
| Login / Register / Forgot password | `Features/Auth` | Contract error mapping (wrong credentials, rate limit with Retry-After, validation details). Forgot password never reveals whether the account exists. |
| Forced password change | replaces the whole app while `must_change_password` | Blocks every other screen; policy hints (≥10 chars, ≠ email, ≠ current); logout available. |
| Tab bar | Home · Explore · Flights · (Rescue) · Profile | Rescue tab only for `rescue_operator`, `platform_admin` or organizers of an event. A banner "Kaydediliyor · 0:12:34 · Uçuş ekranı" sits above every screen while a flight records and the flight computer is closed. |
| Home | `Features/Home` | Greeting, tracking status + SyncBadge + last server ack, Start flight / Back to flight, active event, last flight + recent flights with per-flight sync status, notifications, SOS button. Offline-session and DB-recovery warnings. |
| Explore | `Features/Explore` | Events list/map toggle, search, filters (Aktif/Yaklaşan/Tümü), nearby launch sites when location permission exists; launch sites with null coordinates shown as "konum doğrulanmadı" and never placed on the map; approximate event centers labelled "yaklaşık". |
| Event detail | `Features/Explore/EventDetailView` | All contract fields incl. settings (live tracking, emergency testing…), DEMO badge, launch sites, join/leave, public live map (snapshot + WebSocket, SIM + freshness badges). |
| Pre-flight check | sheet from Home | Event + visibility pickers; actionable checks: permission (incl. Always), precise accuracy, current GPS accuracy, battery %, Low Power Mode, network (offline recording allowed and explained), free storage, background readiness, unsent points from earlier flights, simulator notice. |
| Flight computer | full-screen cover over everything | GPS irtifa, Yer hızı, Dikey hız "tahmini" (filtered GPS, not a variometer), duration, GPS accuracy, heading; secondary: distance, max alt, max speed, total ascent/descent, stored points, profile. State/sync/battery pills, SOS button, pause/resume, end (confirmed). Banners: interrupted-recording gap, permission revoked, storage failure, stale fix, low-quality GPS, SOS open. SF Mono digits, Dynamic Type, adaptive grid for landscape. Themes auto/dark/light/high-contrast outdoor. Minimising never stops recording. |
| Live map (in flight computer) | toggle | Own position + heading + accuracy circle + path, last server-acknowledged position, other pilots the server authorises (realtime + snapshot) with freshness, connection pill, recenter, north-up/heading-up. |
| Flight summary | after End | Stats, synced/pending/rejected counts, honest note that pending points upload later. |
| Flights / Flight detail | `Features/Flights` | Local flights (with sync status) + server-only flights. Detail: route map, Swift Charts altitude & speed, stats, start/end coordinates, GPS quality (avg accuracy, >50 m count, longest gap), GPX export via share sheet labelled "sertifikalı uçuş kaydı değildir". |
| SOS | sheet from flight computer / Home | Press-and-hold 3 s (progress + haptics; VoiceOver uses an explicit action). Shows coordinates, last GPS time, accuracy, network. Ladder: Telefona kaydedildi → Gönderiliyor → Sunucu aldı → Ekip onayladı; nothing implies help is coming before "acknowledged", nothing implies authorities are contacted; "112'yi ara" button. Cancel with confirmation (retried until the server confirms). TEST toggle only when the flight's event has `emergency_testing`. History list. |
| Rescue | `Features/Rescue` | Dashboard (open/acknowledged/responding + my assignments, urgency order, TEST badge, freshness), incident detail (timeline, notes, assignments, contact if returned, acknowledge/responding/resolved, assign, Apple Maps directions, last route), rescue map (incidents + team, stale/offline), team status (availability, assignment status steps). Server enforces authorization; 403 shows a clear message. |
| Profile | `Features/Profile` | Pilot details + emergency contact, privacy (public profile, default visibility), units, app appearance, flight-computer theme, data export (JSON share), account deletion request/cancel, diagnostics, SOS history, change password, version, logout (disabled while recording). |
| Diagnostics | Profile → Tanılama | Permission + precise accuracy, tracking state, profile, last GPS time & accuracy, last server ack, pending count, sync status/failures/next retry, battery & Low Power, background & service session, engine events/errors, DB size and recovery events, network, realtime, app/OS version. Shareable text report without coordinates. |
