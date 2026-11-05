# Retfast Screens

Screen inventory per client. Data sources refer to `docs/architecture/api-contract.md` (v1).

## Web

One SPA (`apps/web`) served on two hosts (ADR-008). `retfast.com` serves the public routes; on `app.retfast.com`
`/` redirects to `/app`. `/app/*` also works on `retfast.com`. Default language Turkish, English via toggle; theme
follows the system with a Light/Dark override. Product model: ADR-012 — users have **no role of their own**; roles
exist per event (organizer, pilot, observer, retriever); the only global privilege is platform admin.

### Global behaviour

- **Session**: access token in memory only. On boot `POST /auth/refresh` (cookie `rf_refresh`, `credentials: include`);
  refreshed again 60 s before expiry and on any `401 token_expired` (single-flight, shared by concurrent requests).
- **Forced password change**: if `user.must_change_password` (from login/refresh, or any `403 password_change_required`)
  every route except `/change-password` and `/privacy` redirects to `/change-password?next=…`.
- **Role-aware navigation**: built from `GET /events?mine=true` (`event.me`): *Alımlarım* appears only for users who are
  a retriever somewhere; *Şu an canlı* lists active events where the user is organizer/observer (one click into the
  operations room); the admin section only for platform admins. Event pages show tabs by event role. Items the user
  can't use are hidden; the API stays the security boundary (403 → "Bu işlem için yetkiniz yok.").
- **Roles are badges per event**, never a profile label (platform admin only appears inside the admin area).
- **Notifications**: bell in the shell, `GET /notifications` every 60 s, mark one / all read.
- **Errors**: server `error.message` shown inline; error boxes include `status · code · X-Request-Id`. Every mutation
  waits for the server; the UI updates from the response (never optimistically). 409 conflicts are explained and the
  current state is re-fetched.

### Public (retfast.com)

| Route | Purpose | Data |
|---|---|---|
| `/` | Live event tracking + landed-pilot retrieval: the event-day flow, the roles, a state legend (freshness, SIM, retrieval states), **honest limits** (phone GPS + mobile data, live ≠ instant, not an emergency service — call 112, battery/iOS limits, not a certified log), current events. | `GET /events?status=active,published&limit=5` |
| `/events` | Public events; search + status filter; my role badges when signed in. | `GET /events` |
| `/events/:slug` | Detail + participation panel. Guest: sign in to apply / applications closed. Non-member: **Apply** with an optional message only — no role choice; the panel explains the three roles and that the organizer decides. Pending: status + withdraw (confirm). Rejected/withdrawn: apply again. Member: role badges, next step (organizer/observer → operations room; retriever → *Alımlarım*; pilot → start in the iOS app + what is shared), leave (confirm). *Canlı haritayı aç* only when `live_tracking && public_live_map`. | `GET /events/{slug}`, launch sites, `POST …/applications`, `…/withdraw`, `…/leave` |
| `/events/:slug/live` | Public live map (full screen): exactly what `/live` returns for a guest (names + positions); no retrieval data. | see *Live operations* |
| `/pilots/:publicId`, `/flights/:publicId` | Public pilot profile; public flight (only for public-live-map events). | `GET /pilots/{id}`, `/flights/{id}` |
| `/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email`, `/change-password` | Auth flows (unchanged; 429 countdown on login, policy errors on fields). | `/auth/*` |
| `/privacy` | Data processed, who sees positions, phone/emergency-contact visibility (user, organizers, admins, the retriever holding the retrieval), not an emergency service, retention, rights, third parties. | — |

### Operations (`/app`)

| Route | Who | Content | Data |
|---|---|---|---|
| `/app` | all | **Needs attention** (real data only): pending applications (organizers), open retrieval requests with longest wait and pilots in the air (organizer/observer active events), open requests / my active retrievals (retrievers). My events (role badges), my recent flights. Admins also get platform counters. | `GET /events?mine=true`, `/events/{id}/live` (≤ 6 active events), `/events/{id}/retrievals`, `/flights`, `/admin/stats` |
| `/app/events` | all | My events, current/past filter, search, pending-applications chip for organizers; link to open events. | `GET /events?mine=true` |
| `/app/events/new` | platform admin | Event form; created as draft, then redirected to *Ayarlar › Organizatörler* to assign organizers. | `POST /events` |
| `/app/events/:id` | members, admin | **Overview**: role-specific panel (organizer checklist + pending count; observer → operations room; retriever → *Alımlarım*; pilot → iOS instructions, what is shared, my flights in this event), description, launch sites, details, settings summary (icon + on/off text). | `GET /events/{id}`, launch sites, `/flights?event_id=` |
| `…/applications` | organizer, admin | **Inbox**: Pending (oldest first) / Approved / Rejected / All with counts. Pending row: applicant, email, age, message; **role selector with no default** (approve button disabled until a role is chosen, label "Alıcı olarak onayla"); optional note; reject → dialog with optional reason. 409 → "another organizer decided" + refresh. Decided rows: status, granted role, by whom/when, note. | `GET/POST /events/{id}/applications…` |
| `…/members` | organizer, admin | Add directly (user search ≥ 2 chars + role chooser). Members grouped by role (Pilotlar / Gözlemciler / Alıcılar) with phone (`tel:`) or "Telefon yok", joined date, role select, remove (confirm, not self). Organizers without a member role listed separately; removed members collapsed. | `/events/{id}/members`, `/users/search` |
| `…/settings` | organizer, admin | **Organizers** (admins add via user search / remove; others read-only; warning when none), event form (incl. status), settings toggles (applications open, live tracking, public live map — disabled unless public + live, pilots see each other, landing prompt), launch sites (map click, verify), archive (confirm). | `PATCH /events/{id}`, `/organizers`, launch-site CRUD |
| `…/report` | organizer, admin | Only numbers present in the report: members by role, flights/telemetry, **retrievals** (count, by status, median request→accept, accept→pickup, pickup→delivery), flight time per pilot chart, per-flight table, raw JSON. | `GET /events/{id}/report` |
| `…/retrievals` | retriever (organizer/admin may look) | **Alımlarım** — see below. | |
| `/app/events/:id/live` | organizer, observer, admin → operations room; pilot → pilot map (no board); retriever → redirected to *Alımlarım*; others → no access | **Live operations** — see below. | |
| `/app/retrievals` | retrievers | One active retriever event → straight to its page; otherwise a picker. | `GET /events?mine=true` |
| `/app/flights`, `/app/flights/:id` | all | Own flights (organizers may filter `?pilot_id=` / `?event_id=`); flight detail (route, stats, GPS quality, charts, GPX). No per-flight visibility (removed). | `/flights…` |
| `/app/settings` | all | Profile, pilot profile, **phone** and emergency contact with the visibility sentence, preferences (theme, language, units, public profile), password, data export, account deletion. | `/me`, `/me/pilot`, … |
| `/app/admin` · `/events` · `/users` · `/audit` | platform admin | System counters/checks (only returned fields); all events with organizers (warning when none) → assign; users (platform-admin switch, disable — both confirmed, not self; reset email); audit log. | `/admin/*`, `/events` |

### Event form

Name (required), slug (optional, `[a-z0-9-]`), location, start/end (`datetime-local`, end > start), description,
visibility (public / restricted), status (edit only), map center (lat/lon or map click; "approximate" flag), settings:
applications open, live tracking, public live map (only for public events with live tracking), pilots see each other,
landing prompt. Client validation + server `details` mapped to fields.

### Live operations (most important screen)

Full screen. Desktop ≥ 1280 px: header · pilot rail (320 px) · map · side panel (352 px). 1024–1279 px: rail + map;
the side panel becomes a bottom sheet. < 1024 px: full-screen map with a bottom sheet (tabs *Pilotlar* / *Alım
kuyruğu* / *Detay*). Panels are mounted once by media query (not duplicated and hidden with CSS).

- **Header**: back, event name, DEMO, mode chip (*Organizatör* / *Gözlemci · salt okunur*), KPIs with icons (Havada,
  Alım bekliyor, Görevde alıcı), **view switch Harita | Alım panosu (n open)** (`?view=board`), connection indicator,
  last snapshot time.
- **Pilot rail** (organizers/observers): one row per pilot, grouped by phase — *Alım bekliyor* (open retrieval, oldest
  first) · *Havada* · *İndi* · *Teslim edildi* · *Başlamadı* (approved pilots without a flight, from members). Filter
  chips with counts (phases, *Sinyal sorunu* = stale + lost recording flights, SIM). Row: phase glyph or heading
  chevron (solid/hollow/dashed), name, SIM, phase line (altitude + speed / "12 dk bekliyor · retriever · 2,3 km" /
  landed time / delivered time), freshness + ticking age for recording flights. Variable-height windowing (32 px group
  headers, 60 px rows) for 2000+ pilots. Public and pilot maps show a flat list (no phases).
- **Map**: pilot chevrons/dots (freshness styling only while recording; neutral dot once landed; hidden under a pickup
  pin while the pilot has an open retrieval), selected trail + accuracy circle, **pickup pins** (filled = requested,
  hollow = accepted, label with status + age), pilot's latest ground position (ringed dot), **retriever vehicles**
  (rounded squares, freshness-styled), dashed **retriever → pilot line** for accepted retrievals. Click selects pilot,
  retrieval or retriever.
- **Side panel**: nothing selected → **Alım kuyruğu** (open requests grouped by status, longest waiting first).
  Retrieval selected → status, age phrase, request time, pilot phone (if returned) or "Telefon görünmüyor", pilot
  position + age + accuracy, pickup point, note, retriever + distance + position age, *Ortala*; organizers/admins:
  **assign / reassign** (retrievers sorted on-duty → distance, with active count), **add note**, **cancel** (dialog,
  optional reason); observers: read-only notice; timeline (updates). 409 → "updated by someone else" + fresh GET.
  Pilot selected → retrieval summary (link to the request), freshness, age, GPS altitude, ground speed, vario
  (*tahmini*), heading, accuracy, seq, coordinates, follow/center/open flight. Retriever selected → duty, position age,
  held retrievals.
- **Retrieval board** (`?view=board`): five columns — Talep · Kabul · Alındı · Teslim (son 2 sa) · İptal — with counts;
  open columns oldest first, closed newest first; cards as in the design system (≥ 15 min wait → "uzun bekleme" chip).
  The rail is hidden in board view; the side panel appears when a card is selected.
- **Data**: `GET /events/{id}/live` (pilots + retrievals + retrievers as visible to the caller; every 60 s, 15 s while
  the socket is down) + one WebSocket: `auth` → `subscribe event:<id>` (with `since` cursor) and `retrievals:<id>`.
  `subscribed.snapshot` replaces state; `position` / `flight` / `retrieval` / `retriever_position` / `pilot_position`
  are batched per animation frame. Retrieval copies are merged by last change time (a late REST snapshot never
  regresses a pushed status; items streamed after the snapshot are kept); positions by `seq`/time. Ping/pong, 60 s
  silence, backoff 1 s → 30 s with jitter, close 4001 → refresh then reconnect. Ages use a server/client clock offset.
- **States**: reconnect banner "Bağlantı koptu – yeniden bağlanılıyor (n)", snapshot error with retry, honest empty
  states per mode.

### Alımlarım (retriever on the web — the phone app is primary)

Header card: duty toggle (*Görevdeyim* / *Görev dışı*, `PUT …/retrievers/me/duty`; there is no GET, so it says "not set
from this page yet" until used), **share my location** (browser geolocation while the tab is open, posted at most every
15 s; permission / failure states in words), connection indicator. Map (pickup pins, my held pilots, my position)
beside two lists:
- **Üzerimdeki alımlar**: pilot, SIM, status, age, pilot position + position age (stale/lost tinted) + accuracy,
  distance from me (when sharing), note, **Ara** (`tel:` — only when the API returns the phone), directions link,
  *Bırak* (confirm) and *Pilotu aldım* (accepted), *Teslim ettim* with optional note (picked up).
- **Açık talepler**: oldest first, waiting age, coordinates, distance from me, note, **Kabul et**. Losing a race
  (409) shows "Bu talebi az önce başka bir alıcı kabul etti." and the request disappears.
Data: `GET /events/{id}/retrievals?status=requested,accepted,picked_up` + `retrievals:<id>` (no general map for
retrievers); the list is filtered client-side to *requested + mine* as defence in depth.

### Flight detail

Header (status, SIM, public id, pilot, start → end, device), which event it belongs to and who can see it, GPX
download; six stat tiles; route map (start hollow, end filled, poor fixes > ±50 m as orange dots); GPS quality; GPS
altitude and ground-speed charts; note that altitude is GPS-derived and the GPX is not a certified log. Recording
flights refresh every 15 s.

## iOS

Native SwiftUI app in `apps/ios` (iOS 17+, Turkish primary, English via `Localizable.xcstrings`), version 4.1.0. Event-centric: the app is organised around the events you belong to and your role in each (ADR-012). Design "Retfast Aero — technical minimalism": SF Pro / SF Mono digits, Dynamic Type, state always icon + text (never colour alone), haptics on start/end/accept/picked-up/delivered, Reduce Motion respected (no spring on the sheet), light/dark plus a high-contrast outdoor flight-computer theme. Components in `Retfast/DesignSystem` (`AeroCard`, `InstrumentTile`, `StatusPill`, `PrimaryButtonStyle` 48/56 pt, `SyncBadge`, `FreshnessBadge`, `SimBadge`), colours from the generated `AeroTokens.swift`. Engine details: `docs/architecture/ios-tracking.md`. Retfast is not an emergency service; no SOS/incident/rescue screens exist.

| Screen | Where | Contents / rules |
|---|---|---|
| Splash | system `UILaunchScreen` | Token background; spinner only while the session restores. |
| Onboarding | first launch, re-openable from Profile | 7 pages: what Retfast is (event tracking + retrieval), roles, how tracking works, retrieve, background location ("Her Zaman"; force-quit stops location), connectivity/GPS limits, **not an emergency service — use 112 / normal emergency channels** (acknowledgement toggle required). |
| Login / Register / Forgot / Forced password change | `Features/Auth` | Contract error mapping; forced change blocks everything else. |
| Tab bar | Etkinlikler · Uçuşlarım · Profil | A persistent **activity bar** sits above the tab bar: "Kaydediliyor 0:12:34 · Uçuş ekranı" while a flight records, "Retriever bekleniyor / Kabul edildi · Kübra" while a retrieve is open, "Retrieve görevi · n alım · Konum paylaşılıyor" while retriever duty shares the position. Tapping resumes the activity. |
| Etkinlikler (home) | `Features/Events/EventsListView` | "Etkinliklerim" first (role badge pilot/gözlemci/retriever + organizer badge, status, pending-application count for organizers), then "Keşfet ve başvur" (application state badge). Search, pull to refresh, offline and DB-recovery warnings. |
| Event screen | `Features/Events/EventScreen` | **Map-first**: full-bleed MapKit with event centre ("yaklaşık" when approximate), launch sites (unverified ones labelled "doğrulanmamış"; sites without coordinates are never placed), other pilots when the role allows (freshness markers, 15-min trails, SIM), retrieval pins (status icon), retrievers (car), my position, my own track while recording. Connection pill, "centre event" / "my location". Custom 3-detent bottom sheet (peek/half/full) whose content depends on the role (`EventSheetMode`, unit-tested). Data: `GET /events/{id}`, launch sites, `GET /events/{id}/live` (poll 30 s, 10 s while the socket is down) + WS `event:<id>` and `retrievals:<id>`. |
| — Not a member | sheet | Event info + **Başvur** (no role choice — the organizer picks the role on approval; optional message). Pending → status + withdraw; rejected/withdrawn → re-apply if open; closed → notice. |
| — Pilot | sheet | Readiness summary (location permission incl. Always, precise location, GPS fix, battery/Low Power, network — offline recording allowed, storage, background/force-quit note, notification permission for the landing reminder, unsent points, simulator notice); **sharing notice** "Bu etkinlikte uçuşların organizatör ve gözlemcilerle paylaşılır" (acknowledged once per event before the first flight); big **Uçuşa başla**; "Uçuş kaydı olmadan retrieve iste". During a flight: compact state/sync/duration/GPS altitude/ground speed + "Uçuş bilgisayarı" + "Uçuşu bitir" (with "bitir ve retrieve iste"). With an open retrieve: its status card. |
| — Retriever | sheet | **Görevdeyim** toggle (`PUT …/retrievers/me/duty`) + honest sharing state; notice when a request was taken by someone else (409); **Aktif alımlarım**: pilot, straight-line distance, pilot position age + accuracy, note, **Ara** (tel:, phone revealed only after acceptance), **Navigasyon** (Apple Maps driving directions to the latest pilot position), **Aldım**, **Teslim ettim** (optional note), **Bırak** (confirm); **Açık talepler** oldest first with waiting time, distance, note, **Kabul et**. Polls every 20 s + realtime. |
| — Observer / organizer-only | sheet | Read-only counters (live/stale/lost pilots, open retrieves, retrievers on duty), pilot list with freshness, retrieve list; "detailed operations are on the web". |
| — Organizer tools | card in any sheet | **Başvurular** inbox (approve with a *required* role picker — no default — or reject) and **Üyeler** (by role; tap-to-call where the API returns a phone). Full management is on the web. |
| Flight computer | full-screen cover | GPS irtifa, Yer hızı, Dikey hız "tahmini", duration, accuracy, heading; secondary stats; state/sync/battery pills; **İndim** button; pause/resume; end (confirmed). Banners: interruption gap, permission revoked, storage failure, stale fix, low-quality GPS, landing detected. Instruments ⇄ live map. Minimising never stops recording. |
| Landing prompt | alert (root or over the flight computer) | When `landing_prompt` is on and the `TrackingPolicy` landing profile is reached (once per landing, snoozable): "İndin mi?" → *Uçuşu bitir ve retrieve iste* / *Uçuşu bitir, retrieve gerekmez* / *Hâlâ uçuyorum*. In the background: a local notification if the user allowed notifications. Never ends a flight by itself. |
| Flight summary | after End | **Retrieve iste** (event flights) / "Retrieve gerekmez, kapat"; stats; synced/pending/rejected counts. |
| Retrieve iste | sheet | Pickup = current position (map, coordinates, accuracy, fix age, refresh; low-accuracy warning), quick chips "Yol kenarındayım", "Kanat toplandı", "Yürüyorum" + free note; "saved on the phone first, sent when connected"; not an emergency service. Ends a still-running recording when sent. |
| Retrieve waiting | full-screen cover (restored on relaunch) | Status pill + delivery banner (saved locally / sending with attempt count / refused / cancelling); ladder **Talep iletildi → Retriever kabul etti → Alındın → Teslim edildin** (a step is ticked only when the server reported it, with times); map with my position, pickup point, retriever's live position + dashed line + straight-line distance; retriever name + **Retriever'ı ara**; position-sharing status; **Kendim döndüm** (confirmed cancel). Logistics language only. |
| Uçuşlarım / Flight detail | `Features/Flights` | Local flights (sync status) + server-only flights. Detail: route map, Swift Charts GPS altitude & ground speed, stats, GPS quality, GPX share labelled "sertifikalı uçuş kaydı değildir / not a certified flight log". |
| Profil | `Features/Profile` | Pilot details incl. **phone** ("only event organizers and your accepted retriever see it"), emergency contact, public profile toggle, units, app appearance, flight-computer theme, data export, account deletion request/cancel, diagnostics, change password, onboarding again, version, logout (disabled while recording or while a retrieve is open). |
| Diagnostics | Profile → Tanılama | Permission/precision, tracking state/profile, last fix, sync, battery, background/service session, engine events, DB size/recoveries, network, realtime, **position sharing** (mode, engine profile, last send, sent/failed, last error, retriever duty) and **retrieve outbox** (last 5: stage, outbox state, attempts, last error). Shareable text report without coordinates. |
