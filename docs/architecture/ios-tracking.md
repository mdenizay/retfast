# iOS tracking engine

Status: implemented in `apps/ios/RetfastCore` (local Swift package, Swift 6 strict concurrency, iOS 17+). Decision record: ADR-009 in `decisions.md`. API rules: `api-contract.md`.

The engine records every accepted GPS sample to SQLite before any network use, uploads in idempotent batches when it can, and recovers after the OS or the user ends the process. It never claims more than it knows: "synced" only means the server acknowledged every stored sample, and the SOS screen never says help is coming before a responder has acknowledged.

> **Scope of validation.** Everything below marked **[tested]** is covered by `swift test` on the host (no simulator). Anything about real background delivery, battery, locked-screen behaviour or relaunch after termination **has not been verified on a physical iPhone yet**. See "What only a physical iPhone can verify".

---

## 1. Component map

```
CLLocationManager ──▶ LocationEngine ──fixes──▶ FlightSessionManager (@MainActor, @Observable, app-lifetime)
                                                  │  state machine: FlightSessionStateMachine
                                                  ▼
                                              FlightRecorder
                                       TelemetryProcessor → TrackingPolicy
                                                  │ (synchronous write)
                                                  ▼
                                          LocalTelemetryStore (GRDB, WAL)
                                                  ▲            ▲
                     NetworkMonitor ──▶ TelemetrySyncEngine    EmergencyManager
                     (NWPathMonitor)         │                      │
                                             └──── APIClient ───────┘  (URLSession, single-flight refresh, Keychain)
                                                  RealtimeClient (WebSocket, foreground only: live map / rescue)
```

| Component | File | Responsibility |
|---|---|---|
| `LocationEngine` | `Tracking/LocationEngine.swift` | Only production `LocationProviding`. Owns `CLLocationManager` (`activityType = .airborne`, `pausesLocationUpdatesAutomatically = false`, `showsBackgroundLocationIndicator = true`, `allowsBackgroundLocationUpdates = true` only if `UIBackgroundModes` contains `location`). Holds `CLBackgroundActivitySession` (iOS 17) and `CLServiceSession(authorization: .always)` (iOS 18+, `#available`) while recording. Starts significant-location-change monitoring as a relaunch hook. Converts `CLLocation` → `RawLocation` (incl. `ellipsoidalAltitude`, floor, `sourceInformation.isSimulatedBySoftware`). Delegate callbacks arrive on main and are handled with `MainActor.assumeIsolated`. |
| `FlightSessionManager` | `Tracking/FlightSessionManager.swift` | Owns the active flight for the whole process lifetime; views only observe it, so leaving the flight screen never stops recording. Commands: `start`, `pause`, `resume`, `end`, `reset`, `restore`, `setEmergency`. Publishes state, presentation values, profile, track (thinned to ≤ 5000 points), engine events (ring of 100), `interruptedSince`, authorization. |
| `FlightSessionStateMachine` | `Tracking/FlightSessionStateMachine.swift` | Pure transition table (section 2). Invalid transitions throw. |
| `FlightRecorder` | `Tracking/FlightRecorder.swift` | Per flight: validate → filter → **persist** → evaluate policy. Also `DeviceStatus` (battery level/state, Low Power Mode). |
| `TelemetryProcessor` | `Tracking/TelemetryProcessor.swift` | Validation, quality flag, throttling per profile, presentation values (Kalman altitude/vertical speed, turn rate) and running stats (distance, max alt, max speed, total ascent/descent). Pure value type. |
| `TrackingPolicy` | `Tracking/TrackingPolicy.swift` | Chooses the profile from processed telemetry with dwell-time hysteresis. Pure value type. |
| `LocalTelemetryStore` | `Storage/LocalTelemetryStore.swift`, `StoreRecords.swift` | SQLite schema, migrations, sample/batch/incident persistence, pruning, corruption recovery. |
| `TelemetrySyncEngine` | `Sync/TelemetrySyncEngine.swift` | Upload loop (actor). Status exposed as `SyncSnapshot` via `Broadcaster`. |
| `NetworkMonitor` | `Sync/NetworkMonitor.swift` | `NWPathMonitor` → `NetworkStatus` (connected, expensive, constrained, interface). The app forwards changes to `TelemetrySyncEngine.networkChanged(isConnected:)`. |
| `EmergencyManager` | `Emergency/EmergencyManager.swift` | SOS persistence, delivery ladder, polling, cancel. Publishes `activeEmergency` which drives the emergency profile. |
| `APIClient` | `Networking/APIClient.swift`, `APIModels.swift`, `KeychainTokenStore.swift` | URLSession + async/await. Access token in memory only; refresh token in Keychain (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`). Single-flight refresh. snake_case + RFC 3339 ms dates. |
| `RealtimeClient` | `Networking/RealtimeClient.swift` | `URLSessionWebSocketTask` for live map / rescue. Auth message, subscribe with `since` cursor per channel, pong on ping, 60 s silence watchdog, reconnect 1 s → 30 s with jitter. **Foreground only**: the app disconnects on leaving the foreground, and it never carries the pilot's own telemetry. |
| Diagnostics | app layer (Profile → Diagnostics) | Shows the permission state (incl. accuracy authorization), tracking state, profile, last GPS timestamp, last server ack, pending count, GPS accuracy, battery state, Low Power, engine events/errors, background/service session active, DB size, store recovery history, app version. Coordinates are logged only with `privacy: .private`; `os_log` at default level never contains precise positions. |

## 2. Lifecycle states

`idle, preparing, recording, paused, ending, completed, error` (`FlightSessionState`). `preparing/recording/paused/ending` are *active* and are restored after a relaunch.

| From | Event | To |
|---|---|---|
| idle, completed, error | `start` | preparing |
| idle | `restore(s)` (s active) | s |
| preparing, recording | `firstFix` | recording |
| recording | `pause` | paused |
| paused, error | `resume` | recording |
| preparing, recording, paused, error | `end` | ending |
| ending | `ended` | completed |
| preparing, recording, paused, ending | `fail` | error |
| completed, error, idle | `reset` | idle |

Notes:
- `start` creates the flight row (state `preparing`) and starts location updates in the `pre_flight` profile. The first stored fix that is **not** low quality moves to `recording`.
- `start` is refused (`permissionDenied`) when authorization is denied/restricted or Location Services are off. Offline start is allowed — no network is needed to record.
- **Paused stops GPS** and invalidates the background sessions (saves battery; nothing is recorded; resume is a foreground action).
- `end` persists `ending`, stops updates, writes `completed` + `ended_at = max(last sample time, now)`, then nudges sync. If the process dies between the two writes, `restore()` sees `ending` and finishes it. Server-side `POST /flights/{id}/end` is done later by the sync engine.
- Permission revoked mid-flight does not change the state; it sets `lastError = location_permission_revoked` and an engine event so the UI shows a blocking warning (the flight stays restorable).

## 3. Profiles

Raw values (sent as `meta.profile`): `pre_flight, active_flight, thermal, cruise, landing, emergency`.

| Profile | desiredAccuracy | distanceFilter | Min stored interval |
|---|---|---|---|
| pre_flight | `kCLLocationAccuracyBest` | none (a stationary pilot must still get fresh fixes; the cached start-up fix is rejected as stale) | 5 s |
| active_flight | `kCLLocationAccuracyBestForNavigation` | none | 1 s |
| thermal | BestForNavigation | none | 1 s |
| cruise | BestForNavigation | 10 m | 3 s |
| landing | BestForNavigation | none | 2 s |
| emergency | BestForNavigation | none | 1 s |

Fixes arriving sooner than the minimum interval still update the flight computer but are not stored (`presentationOnly`).

**These are targets, not guarantees.** iOS decides the actual delivery rate (typically about 1 Hz with GPS). It may deliver less often with poor sky view, in Low Power Mode, under thermal pressure, or when the device is stationary. Gaps are recorded honestly; nothing interpolates them.

### Switching heuristics (`TrackingPolicy`)
A target profile must hold continuously for its dwell time before the switch happens. A single noisy fix resets the candidate.

| Transition | Condition (filtered values) | Dwell |
|---|---|---|
| pre_flight → active_flight (takeoff) | ground speed ≥ 4 m/s **or** \|vario\| ≥ 1.5 m/s | 5 s |
| → thermal | climb ≥ 0.3 m/s **and** \|turn rate\| ≥ 8 °/s | 10 s |
| → cruise | ground speed ≥ 5 m/s **and** \|turn rate\| < 5 °/s | 20 s |
| → landing | ground speed < 2.5 m/s **and** \|vario\| < 0.4 m/s | 30 s |
| → active_flight (otherwise) | none of the above | 10 s |
| → emergency | an SOS is open | immediate |

- Once the flight is airborne it never returns to `pre_flight`. A relaunch from the landing field returns to `active_flight`.
- When the SOS closes, the profile drops to `active_flight` (or `pre_flight` if not yet airborne) and is classified again.
- Missing speed and vario keeps the current profile.
- "Near ground" cannot be known without terrain data. Landing is detected only from low speed plus a low altitude change. Landing does **not** end the flight automatically; the pilot ends it.

## 4. Validation, quality and presentation values

**Rejected (never stored):** `invalid_accuracy` (h_acc < 0), `non_finite` (NaN/inf lat, lon or h_acc), `zero_coordinates` (0,0), `out_of_range` (\|lat\| > 90, \|lon\| > 180), `not_newer` (timestamp ≤ last accepted fix), `stale_cached_fix` (older than 30 s at arrival).

**Low quality (stored, flagged `lowQuality`):** h_acc > 50 m, or an implied speed > 120 m/s from the last good fix (a teleport). Raw values are always kept. Low-quality fixes are excluded from distance, ascent/descent, max altitude/speed and the vertical-speed filter, which matches the server (its stats skip h_acc > 50).

**Raw vs presentation:** stored samples hold Core Location values unchanged:
- `altitude`, which is nil when v_acc ≤ 0
- `ellipsoidalAltitude`, `hAcc`, `vAcc`
- `speed` and `course`, nil when negative
- `floor`, plus device conditions

Filtered values exist only for display:
- `VerticalKalmanFilter`: constant-velocity model with acceleration variance 0.6 (m/s²)² and measurement noise v_acc² (15 m when unknown). It produces smoothed altitude and **estimated vertical speed**. The filter resets after a gap longer than 60 s.
- Turn rate is an EMA (α 0.3) of course deltas, computed only when speed > 2 m/s.
- Ascent/descent accumulate with 3 m hysteresis.
- The UI labels altitude "GPS irtifa" and vertical speed "tahmini". It is a filtered GPS estimate, not a barometric variometer.

On restore, `TelemetryProcessor.replay` rebuilds stats from the stored samples.

## 5. Persistence (`LocalTelemetryStore`)

- GRDB `DatabasePool` → WAL. `foreignKeysEnabled`, busy timeout 5 s. File: app support directory `retfast.sqlite`. The directory gets `FileProtectionType.completeUntilFirstUserAuthentication`, so writes keep working while the phone is locked mid-flight. (`.complete` would break background writes.)
- Migrations (`DatabaseMigrator`):
  - `v1_flights_samples`: `flight`, `sample` (unique `(flightId, seq)`, indexes on sync state and batch), `outbox_batch`
  - `v2_incidents_kv`: `incident`, `kv`

| Table | Key contents |
|---|---|
| `flight` | id (client UUID), eventId/name, visibility, isSimulated, startedAt/endedAt, state, serverCreated, serverEnded, **nextSeq**, lastSampleAt, profile, interruptionCount, lastError |
| `sample` | id (UUID), flightId, seq, t (GPS), deviceT, lat, lon, altitude, ellipsoidalAltitude, hAcc, vAcc, speed, course, floor, profile, battery, lowPower, lowQuality, isSimulatedBySoftware, **syncState** (0 pending / 1 synced / 2 rejected), rejectReason, batchId |
| `outbox_batch` | id (= `batch_id` on the wire), flightId, createdAt, attemptCount, lastAttemptAt, lastError (retry metadata) |
| `incident` | local SOS incl. position, deliveryState, serverStatus, receivedAt, acknowledgedAt/By, cancelRequested/Synced, attempt metadata |
| `kv` | `lastServerAck`, `recoveryEvents` (JSON, last 10) |

Invariants:
- `append` assigns `seq = flight.nextSeq` and increments it **in the same transaction** as the insert. Seq is therefore strictly monotonic per flight across crashes and relaunches.
- Every accepted sample is written synchronously on the main actor before anything else uses it. WAL inserts are sub-millisecond at 1 Hz.
- `prune(keepRecentFlights:)` deletes only `synced` samples that are in no batch and belong to `completed` + `serverEnded` flights outside the N most recent. **Pending and rejected samples are never deleted.**
- **Corruption:** on open, `PRAGMA quick_check` runs and migrations are applied. If opening, the check or migration fails, the file (plus `-wal`/`-shm`) is **moved** to `retfast.corrupt-<timestamp>.sqlite`, never deleted, and a fresh DB is created. A `StoreRecoveryEvent` (time, reason, quarantined path) is returned and persisted in `kv`, and the diagnostics screen shows it, so recovery is never silent. `quick_check` was chosen over `integrity_check` because the full check is too slow on every launch with large tracks.

## 6. Sync (`TelemetrySyncEngine`)

Loop: each pass first creates any unknown flights (`POST /flights`, idempotent on the client id). It then sends **one** batch, then ends completed flights whose samples are all acknowledged. After a successful batch the loop runs again immediately. When idle it waits ~5 s (`interval`). `kick()` (new sample, flight end, foreground) cancels the wait.

- **Batches:** ≤ 500 samples of one server-known flight, ordered by seq. A batch's samples are fixed when it is created (`sample.batchId`). A retry resends the **same `batch_id` with exactly the same samples**; new samples go into later batches.
- **Response:** only seqs that are both in `accepted ∪ duplicate` **and in this batch** become `synced`. `rejected` → `rejected` with its reason, kept locally and never retried. Seqs the server did not mention stay pending and are released into a later batch.
- **Errors:**

  | Condition | Action |
  |---|---|
  | 400/422 on the whole batch | Batch rejected (kept locally) so the queue cannot jam. |
  | 404 | Flight marked not server-created → re-created, batch retried. |
  | 401 `token_expired` | `APIClient` refreshes (single-flight) and retries the same request. |
  | Refresh refused, 401, or `password_change_required` | **auth required**: the loop stops sending until `authRestored()`; data is kept. |
  | 429 | Waits `Retry-After` (30 s default). |
  | 5xx / transport | Equal-jitter exponential backoff: `min(120, 2·2^n) × [0.5, 1]` (2, 4, 8 … s, cap 120 s). |
  | Offline (`URLError` not-connected etc.) or NWPathMonitor unsatisfied | Status **offline**; no traffic while the path is down. A path change to connected resets backoff and kicks the loop. |
  | Permanent flight-create failure (403 not a member / live tracking off, 409, 400/422) | Recorded on that flight (`lastError`). Its samples stay pending; other flights are not blocked. |

- `POST /flights/{id}/end` is sent only after `pendingCount(flight) == 0`, so server stats are final.
- **Foreground URLSession only.** While iOS keeps the app running for background location, the loop keeps going. Nothing assumes networking survives suspension: unsent samples stay pending until the next run.
- **Exposed status** (`SyncSnapshot`):
  - `status`: synced / syncing / pending / offline / authRequired / serverError(code)
  - `pendingCount`, `lastServerAck`, `lastAttemptAt`, `nextRetryAt`, `consecutiveFailures`, `lastError`

**APIClient refresh:** refresh tokens rotate on every use, and reusing a rotated token revokes the whole session family. All concurrent refreshes therefore share one in-flight `Task`, and the new tokens are applied inside it. A refresh also runs proactively when the access token expires within 30 s. If refresh returns 401/403, the session is cleared and `sessionExpired` is emitted. At launch, `restoreSession()` distinguishes `signedIn`, `passwordChangeRequired`, `signedOut`, `expired` and `offline`. `offline` keeps the stored token, so the app records offline instead of forcing a login.

## 7. SOS (`EmergencyManager`)

Ladder (`SOSDeliveryState`; state only moves forward by `rank`):

`created_locally` → `pending_transmission` → `received_by_server` → `acknowledged` → terminal (`resolved` | `cancelled` | `refused`)

| State | Meaning |
|---|---|
| created_locally | Written to SQLite synchronously in `trigger`, before any network use. |
| pending_transmission | Being sent. Retried with backoff 2 s → 30 s cap (≥ 5 s on 429). |
| received_by_server | HTTP 2xx from `POST /incidents` (idempotent on the client id). Stored on the server; **no person has seen it yet**. |
| acknowledged | `acknowledged_at` set (or status acknowledged/responding), learned by polling `GET /incidents/{id}` every 10 s. |
| resolved / cancelled | From the server, or a local cancel before anything was sent. |
| refused | 400/403/409/422 before receipt, e.g. `is_test` outside an event with `emergency_testing`. Delivery stops and `lastError` is shown. |

UI rules:
- Never show "help is coming", or anything like it, before `acknowledged`.
- Never imply automatic contact with authorities or emergency services. Retfast is not a replacement for 112.
- Always show coordinates, last GPS time, accuracy and network state.

Cancel:
- If **no attempt was ever made**, the SOS is cancelled locally and nothing is sent.
- Otherwise `cancelRequested` is set. If receipt is unconfirmed, the incident is still delivered (so no orphan stays open on the server) and `POST /incidents/{id}/cancel` follows. The state becomes `cancelled` only when the server confirms.

Test SOS (`is_test: true`) is offered only when the event allows `emergency_testing` and is labelled TEST. Unfinished incidents resume via `resumeAll()` at launch. While any incident is open, `activeEmergency` forces the `emergency` profile.

## 8. Restoration

- The active session is simply the `flight` row in an active state. `FlightSessionManager.restore()` runs on **every** launch, including background relaunch for location events (`UIApplication.LaunchOptionsKey.location`).
- On restore, the manager replays the stored samples into the processor (stats and track survive). For a `recording`/`preparing` flight it:
  1. sets `interruptedSince` = last sample time
  2. increments `interruptionCount`
  3. recreates `CLBackgroundActivitySession` / `CLServiceSession`
  4. restarts updates with the last profile (or `emergency`)
- A `paused` flight stays paused. An `ending` flight is finished.
- The flight computer shows the gap ("Kayıt <since> sonrasında kesildi … Aradaki süre izde boşluk olarak görünür.") and the cover is re-presented whenever the app becomes active with an active or just-completed session (`AppModel.scenePhaseChanged`). `AppModel` is built in `AppDelegate.didFinishLaunching`, so restore runs before any scene exists on a background relaunch.
- **Relaunch hook:** while recording, significant-location-change monitoring is active. Apple documents that this can relaunch an app that **the system** terminated, in the background, with the `.location` launch key. It requires Always authorization. With When In Use only, no relaunch is expected.

## 9. Behaviour matrix

| Situation | What happens | Verified |
|---|---|---|
| Foreground | ~1 Hz fixes, stored per profile interval, sync every ~5 s. | Logic [tested]; delivery rate: device |
| Background (app switched away) | Updates continue (background mode `location`, `allowsBackgroundLocationUpdates`, background activity session, blue indicator). Sync continues while the process runs. | Device |
| Screen locked | Same as background. DB and Keychain stay accessible after first unlock (`completeUntilFirstUserAuthentication`, `AfterFirstUnlockThisDeviceOnly`). | Device |
| Low Power Mode | Recording continues. iOS may lower delivery frequency/accuracy; `lowPower` is stored per sample and shown in pre-flight and diagnostics. | Device |
| No connectivity | Recording unaffected; samples stay pending; status "offline (N pending)". Resumes on path change with backoff reset. | [tested] |
| OS suspension | Should not happen while location updates are active. If it does, no samples arrive (gap), and nothing is lost that was stored. Sync resumes on next run. | Device |
| OS termination (jetsam / crash) | Process gone; delivery stops. The significant-change relaunch (Always only) or the next manual launch restores the session and resumes recording; the gap is counted and shown. | Restore logic [tested]; relaunch: device |
| **User force-quit (swipe up)** | **Apple stops delivering location to an app the user swiped away. There is no relaunch until the user opens the app again. The gap is permanent and visible in the track.** On the next open the session is restored and recording resumes. Onboarding and the flight screen tell pilots not to swipe the app away during a flight. | Restore logic [tested]; OS behaviour: device |
| Device restart | Nothing runs until the device boots and the user unlocks it once. Keychain and DB are unavailable before first unlock. Recording resumes only after first unlock plus a relaunch (significant-change or manual). | Device |
| Downgraded to When In Use | Recording continues while the background activity session (started in the foreground) is held. No significant-change relaunch after termination. Pre-flight warns. | Device |
| Approximate location (no full accuracy) | Fixes have large h_acc → flagged low quality and excluded from stats. Pre-flight warns and can request temporary full accuracy (`FlightRecording` purpose key). | Quality rule [tested]; prompt: device |
| Permission revoked mid-flight | No more fixes; `location_permission_revoked` warning; flight stays active and restorable; stored data still syncs. | Device |
| Paused | GPS off, background sessions invalidated, nothing recorded. | [tested] (fake location) |
| Database damaged | File quarantined, new DB, recovery event in diagnostics. | [tested] |

## 10. Automated tests (`apps/ios/RetfastCore/Tests/RetfastCoreTests`, run with `swift test` in `apps/ios/RetfastCore`, or as part of `xcodebuild test -scheme Retfast`; plus `RetfastUITests` — launch/onboarding test and the opt-in E2E test)

| Suite | Covers |
|---|---|
| Flight session state machine (`TrackingTests.swift`) | Valid path, invalid transitions, restore, error recovery |
| Flight session manager (`TrackingTests.swift`) | Start → preparing → recording on first good fix, persistence, end, pause stops GPS, emergency profile, denied permission, **restore after simulated process death with monotonic seq** (fake `LocationProviding`) |
| Tracking policy | Takeoff dwell, noise resistance, thermal/cruise/landing, emergency override and release, missing data |
| Telemetry processor | All rejection reasons, low quality kept but excluded from stats, per-profile throttling, Kalman vertical speed on noisy 2 m/s climb, replay |
| Local telemetry store (`StoreTests.swift`) | Seq across reopen, WAL, raw values, batch reuse, synced only for acked seqs in the batch, prune never deletes unsynced, v1 → v2 migration, garbage-file quarantine, GPX export |
| Telemetry sync engine (`SyncTests.swift`, URLProtocol stub, injected clock) | Flight create then 500/500/200 batches, same batch_id after 503, backoff sequence with fixed jitter, 429 Retry-After, 401 → refresh → same batch_id, duplicate/rejected, offline → online, auth required, end only after all acked |
| API client | Single-flight refresh under 8 concurrent requests and rotation without reuse, `password_change_required`, date formats |
| Emergency manager (`EmergencyTests.swift`) | Full ladder incl. no regression, local cancel, cancel after receipt, cancel while unconfirmed, refused test SOS, resume after relaunch |

## 11. What only a physical iPhone can verify

- Actual fix delivery rate per profile in foreground, background and locked states, and with `distanceFilter`.
- Background continuity with the screen locked for a full flight (1–4 h).
- Low Power Mode effect on rate and accuracy.
- Real GPS altitude and v_acc noise in flight, and whether the Kalman settings give a usable "tahmini" vertical speed.
- Relaunch after jetsam via significant-location-change (Always vs When In Use).
- Force-quit behaviour and the resulting gap; device restart behaviour.
- Battery drain per profile; thermal state on a sunny launch.
- Background networking while locked (cellular in the mountains), and Keychain/DB access while locked.

## 12. Real-device test protocol

Preconditions: Release-like build signed with team `JHW499P7S3`, bundle `com.mizibu.retfast`, a backend reachable from the phone, a test account, and a test event with `emergency_testing` on. Record results in a table: date, device model, iOS version, app build, scenario, duration, samples stored, expected samples (duration / min interval), gaps > 10 s, battery start/end, notes.

1. **Permissions.** On a fresh install, run onboarding and grant When In Use, then Always. Check that Diagnostics shows `always` and full accuracy. Repeat with Approximate location and check the pre-flight warning.
2. **Foreground baseline (15 min, walking or driving).** Start a flight and keep the screen on. Check that samples/minute roughly matches the profile, the sync status reaches "synced", and `GET /api/v1/flights/{id}/positions` returns the same count.
3. **Locked screen (30 min).** Start, lock the phone and keep it in a pocket while moving. Unlock and check there are no gaps beyond the profile interval and that the blue indicator was shown.
4. **Background with other apps (15 min).** Use Maps or the camera while recording; verify continuity.
5. **No connectivity (15 min).** Turn on airplane mode with Wi-Fi off (GPS still works), record, then turn connectivity back on. Pending count should grow, then drain to 0, with no duplicates on the server.
6. **Low Power Mode (30 min).** Repeat scenario 3 with Low Power on. Compare rate and accuracy; check that `low_power=true` is in the sample meta.
7. **Force quit.** While recording, swipe the app away, wait 5 min, then reopen. Expect a gap of about 5 min, an interruption banner, recording resumed, and `interruptionCount` = 1.
8. **System termination.** While recording in the background, run memory-heavy apps (or use Xcode "Simulate memory warning" / terminate from the debugger, noting that the debugger alters behaviour). Check whether the app is relaunched by a significant-change event, with Always and with When In Use.
9. **Device restart.** Restart mid-flight, wait without unlocking, then unlock and move about 1 km. Note when recording resumes (relaunch vs manual open).
10. **SOS (test event only).** Trigger a TEST SOS with a 3 s hold. Watch the ladder: created → pending (airplane mode) → received (reconnect) → acknowledged (responder acks on the web). Then cancel. Confirm no "help is coming" text appears before acknowledged.
11. **Battery measurement.**
    1. Charge to 100 %, unplug, and close other apps. Keep brightness fixed (or the screen off/locked as per the scenario), and keep cellular on.
    2. Record 60 min per scenario: foreground screen-on, locked, Low Power locked, and cruise-heavy (driving) vs thermal-like (walking circles).
    3. Note battery % at start and end from the Diagnostics screen (per-sample battery is stored too) and from Settings → Battery (per-app share). Optionally use the Xcode Organizer Energy reports or MetricKit.
    4. Report %/hour per scenario.
    5. Expected ranges are **TBD — to be filled in from measurements**; no numbers are assumed here.
12. **Thermal.** Record in direct sun for 30 min and check for thermal throttling (accuracy and rate changes).

## 13. Simulator

The simulator exercises UI, persistence, sync and restore logic. It does **not** faithfully reproduce background suspension, jetsam, force-quit semantics, battery or real GPS noise. Simulated fixes record `isSimulatedBySoftware = true` in the sample.

Route: `apps/ios/Tools/cameli-sim-route.gpx`. This is a **synthetic** route over Çameli, Denizli (~37.07 N, 29.34 E), not a real flight log.

Two ways to use it:
- **Xcode:** the generated `Retfast` scheme already sets "Allow Location Simulation" with `Tools/cameli-sim-route.gpx` as the default location (project.yml `run.simulateLocation`). While running you can also pick it under Debug → Simulate Location.
- **Command line** (`simctl location` takes waypoints, not GPX):
  - Fixed position: `xcrun simctl location booted set 37.07,29.34`
  - Play the route at 10 m/s, 1 update/s, using every 10th point after the 2-minute on-launch segment:
    ```sh
    python3 -c "import re,subprocess;p=re.findall(r'lat=\"([\d.]+)\" lon=\"([\d.]+)\"',open('apps/ios/Tools/cameli-sim-route.gpx').read());subprocess.run(['xcrun','simctl','location','booted','start','--speed=10','--interval=1']+[a+','+b for a,b in p[120::10]])"
    ```
  - Clear: `xcrun simctl location booted clear`
  - Grant permission without the prompt: `xcrun simctl privacy booted grant location-always com.mizibu.retfast`
- Regenerate the route: `python3 apps/ios/Tools/make-sim-route.py` (deterministic).

End-to-end (simulator + local backend): `RetfastUITests/EndToEndTests` is skipped unless `TEST_RUNNER_RETFAST_E2E_BASE_URL`, `…_EMAIL`, `…_PASSWORD` (and optionally `…_NEW_PASSWORD`, `…_RECORD_SECONDS`) are set. It walks onboarding, logs in, completes the forced password change, starts a flight in the suggested event, minimises the flight computer (recording must continue), ends the flight and waits for upload. Verify server-side with `GET /api/v1/flights/{id}/positions`. The app reads `RETFAST_API_BASE_URL` from the launch environment as a debug override of the Info.plist value.

Simulator location has no realistic altitude or vertical accuracy. Expect the vertical-speed estimate and the altitude-based policy heuristics (thermal/landing) to be unrepresentative there.
