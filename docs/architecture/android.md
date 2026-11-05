# Android app

Status: implemented in `apps/android` (Kotlin, Jetpack Compose, minSdk 26, target/compile 36, version 4.1.0, `com.mizibu.retfast`).
Same product and reliability rules as iOS (`ios-tracking.md`, `docs/product/screens.md` "iOS"); adapted to Android idioms.
Contract: `api-contract.md`. Build/sign/install: `apps/android/README.md`.

> **Scope of validation.** JVM tests (`./gradlew :app:testDebugUnitTest`) cover the tracking policy, telemetry processor, sync
> engine, Room DAOs, retrieval outbox, API client and role/gate logic. Everything about real background delivery, Doze,
> OEM battery killers, locked-screen GPS, swipe/force-stop and reboot **has not been verified on a physical phone yet**.
> See "What only a real device can verify" and the test protocol at the end.

## 1. Architecture

```
FusedLocationProviderClient ─┐  (fallback: LocationManager GPS_PROVIDER when Play Services is unavailable)
                             ▼
                      TrackingEngine (process singleton, StateFlow<TrackingStatus>)
   fix ─▶ unbounded Channel ─▶ single consumer:
          TelemetryProcessor (validate / quality / stats)  ─▶ **Room insert (samples)**  ─▶ TrackingPolicy (profile) ─▶ LocationSource.start(new profile)
                                                                           │                                      └▶ LandingPromptDetector ─▶ prompt / notification
                                                                           └▶ SyncEngine.kick()
          sharing modes (pilot waiting / retriever duty): fix ─▶ share_outbox (latest per target) ─▶ POST position
TrackingService (foreground, type=location) ─ keeps the process alive + ongoing notification; owns no state
SyncEngine ── in-process loop (≤500/batch, ~5 s, backoff+jitter) ─── SyncWorker (WorkManager, network-constrained retry)
RetrievalManager ── outbox loop per request (create → poll → cancel) ── idempotent client UUID, 409 adoption
```

- **UI**: single `MainActivity`, Compose, Material 3 restyled with tokens generated from `packages/design-tokens/tokens.json`
  (`tools/gen-tokens.mjs` → `AeroTokens.kt`). No default purple Material look; light/dark and a high-contrast dark flight-computer theme.
  State is always icon + text (`StatusPill`), never colour alone. Turkish primary (`values/`), English `values-en/`
  (both generated from `tools/strings.py`).
- **State**: ViewModels with `StateFlow` for screens that fetch (`EventViewModel`, `WaitingViewModel`, …); the engine, sync and
  retrieval manager are process-lifetime objects in a manual DI graph (`AppGraph`) — no Hilt, to keep startup and tests trivial.
- **Networking**: OkHttp + kotlinx.serialization (snake_case naming strategy). `ApiClient` keeps the access token in memory,
  the refresh token encrypted at rest (Android Keystore AES-256-GCM key, ciphertext in a private SharedPreferences file,
  excluded from backup), single-flight refresh on `401 token_expired` (mutex + generation counter: concurrent callers share one
  `/auth/refresh`; the failed request, including a telemetry batch, is retried with the **same body/batch_id**).
- **Maps**: MapLibre Native Android, OpenFreeMap `liberty` (light) and `dark` (dark; both verified to exist). Pins and lines are
  pushed into two GeoJSON sources. Sites without coordinates are never placed; unverified sites are labelled.
- **Auth gate**: `AuthGate.of(me)` — `must_change_password` shows only the password screen (logout allowed) until it succeeds.
- **Contract assumption**: `POST /auth/login|register` accepts `client` ∈ {`web`,`ios`} only. The Android app sends `"ios"`
  (it selects the body-token flow: refresh token in the response/body, no cookie). Flights are created with
  `device.platform = "android"` (free text on the server). `POST /me/devices` is **not** called (server requires `platform: "ios"`
  and an APNs token; Android has no push in this version). A backend change allowing `client: "android"` would be the clean fix.

## 2. Tracking engine design

### Location source — decision
`FusedLocationProviderClient` (Play Services) is the primary source: faster first fix, better indoor/outdoor handover, and it
duty-cycles the GPS for the long-interval profiles (important for the 30 s waiting profile). If Play Services is unavailable
(`GoogleApiAvailability`), `LocationManager.GPS_PROVIDER` is used with the same profiles. The chosen source is shown in
Diagnostics. Altitude is whatever the platform reports in `Location.altitude` (labelled **GPS altitude**; vertical speed is a
Kalman estimate, labelled as such).

### Profiles (`TrackingProfile`)
| Profile | Provider request | Stored / shared spacing |
|---|---|---|
| `pre_flight` | HIGH_ACCURACY, 2 s | 5 s |
| `active_flight` | HIGH_ACCURACY, 1 s | 1 s |
| `thermal` | HIGH_ACCURACY, 1 s | 1 s |
| `cruise` | HIGH_ACCURACY, 1 s | 3 s |
| `landing` | HIGH_ACCURACY, 1 s | 2 s |
| `retrieve_waiting` | HIGH_ACCURACY, 15 s | 30 s |
| `retriever_driving` | HIGH_ACCURACY, 10 s | 15 s |

Switching uses `TrackingPolicy` (thresholds and dwell times identical to iOS: take-off ≥ 4 m/s or |vario| ≥ 1.5 m/s for 5 s; thermal
climb ≥ 0.3 m/s & turn ≥ 8 °/s for 10 s; cruise ≥ 5 m/s & turn < 5 °/s for 20 s; landing < 2.5 m/s & |vario| < 0.4 m/s for 30 s).
The landing profile arms the "İndin mi?" prompt (once per landing episode, snoozable, never ends the flight by itself; a heads-up
notification when the app is in the background).

### Persist before network
Every accepted fix goes: validate (`TelemetryProcessor`: invalid accuracy, NaN, (0,0), out of range, not newer, stale cached start-up fix → rejected and never
stored; accuracy > 50 m or > 120 m/s jump → stored but `low_quality`) → `INSERT` into `samples` (unique `(flight_id, seq)`) → only then profile
update and `sync.kick()`. Nothing in the network path can block or drop a stored sample. Unsynced samples are never deleted (the only
delete in the DAO layer is `deleteIfFullySynced`, a guarded SQL statement; covered by a test).

### Sync
`SyncEngine`: create unknown flights → send one batch → end finished flights once every sample is acknowledged.
- A batch (`batch_id` = UUID) is attached to its samples in SQLite until the server answers; any retry (lost response, 401 refresh, process
  restart) re-sends the **same batch_id with the same samples**. Batches ≤ 500, in `seq` order, oldest flight first.
- Only seqs in `accepted` or `duplicate` become `synced`; `rejected` become `rejected` (kept, never retried); any seq the response did not
  classify returns to the pool. A 400/422 for a whole batch rejects it locally (kept). A 404 on a batch re-creates the flight. A 403/409/422
  on flight creation marks the flight `create_refused` (samples stay on the phone, other flights continue).
- Loop interval 5 s while there is work; failures back off `min(120, 2·2ⁿ)` s with 50–100 % jitter; `429` honours `Retry-After`; `401` with a
  failed refresh blocks (`AUTH_REQUIRED`) until sign-in. The loop runs while recording, while the app is visible, or while samples are pending;
  `SyncWorker` (WorkManager, `NetworkType.CONNECTED`, exponential backoff) is scheduled whenever pending samples exist and after boot.

### Retrieval outbox & position sharing
`RetrievalManager` mirrors iOS: the request (client UUID, pickup, note) is inserted first; a per-request loop retries `POST /events/{id}/retrievals`
with the same id, then polls `GET /retrievals/{id}` every 15 s (WebSocket `apply()` only speeds this up). `409` → adopt the open retrieval from
`details.retrieval_id` (else from the event's open list); the local row becomes `merged`. Cancel ("Kendim döndüm") is local if nothing was ever sent,
otherwise delivered and retried. The waiting screen's ladder ticks a step only when the server reported it.
Position sharing (`SharingMode`): waiting pilot → `POST /retrievals/{id}/position` ≈ 30 s while `requested|accepted`; retriever on duty or holding
pickups → `POST /events/{id}/retrievers/me/position` ≈ 15 s. The latest position is written to `share_outbox` (replace-in-place) before the request.

## 3. Android background rules (what is true)

- **Foreground service, type `location`.** Required (Android 10+ for background location, Android 14 enforces `foregroundServiceType` + the
  `FOREGROUND_SERVICE_LOCATION` permission). The ongoing notification ("Retfast uçuş kaydediyor", with a *Durdur* action) is not optional.
  Notification permission (13+) denied → the service still runs; the notification is only hidden from the shade (visible in the system "active apps" list).
- **Starting the service.** Android 12+ forbids starting a foreground service from the background, with exceptions (a visible activity; user-visible notification
  action; **while-in-use location permission is not enough once backgrounded, a location FGS needs the app to be visible OR hold background location**).
  Retfast only starts the service from the UI (start flight / request retrieve / duty switch) or from a service restart. It never tries from `BOOT_COMPLETED`.
- **Permissions.** `ACCESS_FINE_LOCATION` first, then `ACCESS_BACKGROUND_LOCATION` on its own (Android 10: same dialog flow; Android 11+: system settings page,
  the user must choose "Allow all the time"), then `POST_NOTIFICATIONS`, then the battery-optimisation exemption. The permission screen explains each step and never blocks:
  without background location the foreground-service session keeps working while the service is alive, but Android may refuse a restart after the process is killed.
- **Doze / App Standby.** A running location foreground service is not stopped by Doze, but network access is restricted while idle and in Doze maintenance windows —
  uploads can lag; the app keeps everything in SQLite and `SyncWorker` retries. Battery-optimisation exemption (`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`) reduces App Standby
  buckets effects and the chance the process is killed in the background. This permission is policy-sensitive on Google Play (acceptable for apps whose core function
  needs it; justify in the Play declaration); we use the system dialog and fall back to the settings list.
- **OEM battery killers** (Xiaomi MIUI/HyperOS, Huawei, Oppo/Realme/ColorOS, Vivo, Samsung "sleeping apps", OnePlus, etc.) can kill foreground services regardless of the above.
  Mitigation is user-side (autostart, "no restrictions"/"unrestricted" battery, lock the app in recents); the app tells the user in onboarding, the permission screen and the
  readiness list, and Diagnostics lets them see the last fix and sync age. See dontkillmyapp.com for per-vendor steps.
- **Swipe from recents vs force stop.** Swiping the task away normally keeps the foreground service (and process) alive; some OEMs kill it on swipe. `START_STICKY` asks the
  system to restart the service, and `TrackingEngine.restore()` rebuilds the session from SQLite (open flight, processor statistics replayed from stored samples, last
  profile, next `seq`). **Force stop** (Settings > Apps > Force stop) kills everything and Android does not restart it until the user opens the app: there will be a gap in
  the track. Open → `MainActivity.onStart` resumes the recording.
- **Reboot.** Nothing can legally resume a location session by itself. `BootReceiver` (BOOT_COMPLETED / MY_PACKAGE_REPLACED) only (a) posts a high-importance
  notification "Retfast kaydı yarım kaldı — uygulamayı aç" when a flight/retrieve/duty is persisted, and (b) schedules the sync worker. Tapping the notification opens the app
  which resumes (flights recorded before the reboot stay in SQLite and are uploaded).
- **Storage.** Room with WAL; no destructive migration fallback.
- **No push.** Retrieval state while the app is not visible comes from the retry loop/WorkManager and the next foreground; there are no FCM notifications in this version.

## 4. Permission flow (as shipped)
1. Onboarding (7 pages, acknowledgement of "not an emergency service" required) → login.
2. Pilot sheet readiness list (location, background, GPS on, notifications, battery exemption, network, battery saver, unsent points) with a "İzinleri ayarla" button → Permissions screen.
3. "Uçuşa başla" is enabled with precise location; missing background location shows a warning in the readiness list and during recording.
4. Retriever duty switch requires precise location (opens the permission screen otherwise).

## 5. What only a real device can verify
Locked-screen GPS cadence; FGS survival over 30+ minutes with the screen off; Doze behaviour; OEM-specific kills; swipe-from-recents on each OEM; force-stop; reboot notification;
background-location permission UX per Android version/OEM; real-sky GPS accuracy/altitude behaviour (including `Location.altitude` reference); battery drain; call/navigation intents on installed apps;
notification permission on Android 13+/14; behaviour on devices without Google Play services (fallback provider).

### Real-device test protocol
Prereqs: a phone with a SIM and the release APK (`adb install -r apps/android/dist/retfast-4.1.0.apk`), a test event where your account is `pilot` (and a second account as `retriever`), local backend or production QA event.
1. Fresh install → onboarding → login → Profile → Permissions: grant all four steps. Check Diagnostics shows all `true`.
2. Event → Uçuşa başla. Lock the screen, put the phone in a pocket and walk/drive 20 min. Expect: ongoing notification, Diagnostics "last fix" < 5 s, track continuous on the event map on another device.
3. Airplane mode for 5 min while moving, then off. Expect: pending counter rises, then drops to 0 and badge "Senkronize" within ~30 s; no gaps in the stored track.
4. Swipe the app from recents during recording; wait 2 min. Expect the notification to stay and the track to continue (note which OEMs fail). Reopen: the flight screen resumes.
5. Kill via `adb shell am kill com.mizibu.retfast` (process death, not force stop): expect the service to restart (sticky) and recording to resume (needs background location). Note the gap.
6. Settings > Force stop: expect recording to stop; reopening the app resumes the open flight; check that the gap exists and unsent samples upload.
7. Reboot during a flight: expect the "kaydı yarım kaldı" notification; tap → recording resumes.
8. Landing: stand still for 40+ s after moving at flight-like speeds (or fly): expect "İndin mi?" in-app and as a notification when backgrounded; "Hâlâ uçuyorum" snoozes.
9. Retrieve: request with weak signal (or airplane mode) → "Telefonda kayıtlı"; restore network → "Talep iletildi". Accept it from the retriever account → ladder step 2, retriever name/phone, distance. Retriever marks *Aldım*/*Teslim ettim* → steps 3 and 4 tick only after the server confirms.
10. Retriever device: duty on, lock screen, drive 15 min: position age on the organizer map stays ≲ 30 s; accept race: two retrievers accept the same request → the second sees the "başka bir retriever aldı" notice.
11. Battery: record 60 min screen-off and compare the drop (target document: < 10–12 %/h on a modern phone; record the real figure).
12. Repeat 2 and 4 with battery-optimisation exemption on and off, on at least one aggressive OEM.

## 6. Known gaps (this version)
- No push notifications (FCM) and no `POST /me/devices` for Android.
- No instrumented (on-device) tests; the engine/service are untested on JVM beyond their pure parts.
- Organizer tools are limited to applications and members (like iOS); full management is on the web.
- GPS altitude reference (ellipsoid vs MSL) depends on the device/provider.
