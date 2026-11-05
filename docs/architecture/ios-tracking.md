# iOS tracking engine

Status: implemented in `apps/ios/RetfastCore` (local Swift package, Swift 6 strict concurrency, iOS 17+). Decision record: ADR-009 in `decisions.md`. API rules: `api-contract.md`.

The engine records every accepted GPS sample to SQLite before any network use, uploads in idempotent batches when it can, and recovers after the OS or the user ends the process. The same rules apply to a pilot's **retrieval request** (persisted outbox, idempotent client id, retries) and the same location engine shares positions while a pilot waits for a retrieve or a retriever is on duty (ADR-012). It never claims more than it knows: "synced" only means the server acknowledged every stored sample, and the retrieve ladder only ticks a step the server reported. Retfast is not an emergency service; there is no SOS.

> **Scope of validation.** Everything below marked **[tested]** is covered by `swift test` on the host (no simulator). Anything about real background delivery, battery, locked-screen behaviour or relaunch after termination **has not been verified on a physical iPhone yet**. See "What only a physical iPhone can verify".

---

## 1. Component map

```
CLLocationManager ──▶ LocationEngine ──▶ LocationArbiter ──.flight──▶ FlightSessionManager (@MainActor, @Observable, app-lifetime)
                                              │                          │  state machine: FlightSessionStateMachine
                                              │                          ▼
                                              │                      FlightRecorder → TelemetryProcessor → TrackingPolicy
                                              │                          │ (synchronous write)        └─▶ LandingPromptDetector
                                              └──.sharing──▶ PositionSharingManager (retrieveWaiting / retrieverDriving)
                                                                         │
                                          LocalTelemetryStore (GRDB, WAL) ◀── RetrievalManager (request outbox, poll, cancel)
                                                  ▲                      │
                     NetworkMonitor ──▶ TelemetrySyncEngine    RetrieverBoard (retriever: open requests, my pickups)
                     (NWPathMonitor)         │                      │
                                             └──── APIClient ───────┘  (URLSession, single-flight refresh, Keychain)
                                                  RealtimeClient (WebSocket, foreground only: event:<id>, retrievals:<id>)
```

| Component | File | Responsibility |
|---|---|---|
| `LocationArbiter` | `Tracking/LocationArbiter.swift` | One engine, two consumers. Gives `.flight` and `.sharing` proxies (each a full `LocationProviding`). Runs the engine while either wants it; the flight profile wins (most demanding), sharing piggybacks; fixes fan out to every active consumer. Ending a flight while sharing only re-applies the sharing profile (background sessions are kept). [tested] |
| `PositionSharingManager` | `Tracking/PositionSharing.swift` | `SharingMode` = off / `pilotWaiting(retrieval)` (`POST /retrievals/{id}/position` ≈ 30 s, profile `retrieve_waiting`) / `retriever(event)` (`POST /events/{id}/retrievers/me/position` ≈ 15 s, profile `retriever_driving`). Mode is a pure function of the active retrieval stage and the persisted `RetrieverDutyState`. Sends the latest fix when the interval elapsed and the fix is newer than the last one sent (never re-sends a fix); one request in flight; 403/404/409 → the target is re-read. Positions are **not** stored (only the latest matters). [tested] |
| `RetrievalManager` | `Retrieval/RetrievalManager.swift`, `RetrievalTypes.swift` | Pilot's retrieval requests: persisted first, sent with the client id, retried, polled, cancelled ("Kendim döndüm"), 409 open-exists adoption. Section 7. [tested] |
| `RetrieverBoard` | `Retrieval/RetrieverBoard.swift` | Retriever side: open requests (oldest first) and my pickups, duty toggle, accept (409 = taken by someone else, shown as a normal notice), release, picked up, delivered; polled every 20 s + realtime. Publishes `RetrieverDutyState` (persisted in `kv`). [tested] |
| `LandingPromptDetector` | `Tracking/LandingPrompt.swift` | "İndin mi? Retrieve iste": once per landing episode of a recording event flight (`landing_prompt`), snooze 120 s. [tested] |
| `LocationEngine` | `Tracking/LocationEngine.swift` | Only production `LocationProviding`. Owns `CLLocationManager` (`activityType` per profile — `.airborne` for flight profiles, `pausesLocationUpdatesAutomatically = false`, `showsBackgroundLocationIndicator = true`, `allowsBackgroundLocationUpdates = true` only if `UIBackgroundModes` contains `location`). Holds `CLBackgroundActivitySession` (iOS 17) and `CLServiceSession(authorization: .always)` (iOS 18+, `#available`) while recording. Starts significant-location-change monitoring as a relaunch hook. Converts `CLLocation` → `RawLocation` (incl. `ellipsoidalAltitude`, floor, `sourceInformation.isSimulatedBySoftware`). Delegate callbacks arrive on main and are handled with `MainActor.assumeIsolated`. |
| `FlightSessionManager` | `Tracking/FlightSessionManager.swift` | Owns the active flight for the whole process lifetime; views only observe it, so leaving the flight screen never stops recording. Commands: `start`, `pause`, `resume`, `end`, `reset`, `restore`. Publishes state, presentation values, profile, track (thinned to ≤ 5000 points), engine events (ring of 100), `interruptedSince`, authorization. |
| `FlightSessionStateMachine` | `Tracking/FlightSessionStateMachine.swift` | Pure transition table (section 2). Invalid transitions throw. |
| `FlightRecorder` | `Tracking/FlightRecorder.swift` | Per flight: validate → filter → **persist** → evaluate policy. Also `DeviceStatus` (battery level/state, Low Power Mode). |
| `TelemetryProcessor` | `Tracking/TelemetryProcessor.swift` | Validation, quality flag, throttling per profile, presentation values (Kalman altitude/vertical speed, turn rate) and running stats (distance, max alt, max speed, total ascent/descent). Pure value type. |
| `TrackingPolicy` | `Tracking/TrackingPolicy.swift` | Chooses the profile from processed telemetry with dwell-time hysteresis. Pure value type. |
| `LocalTelemetryStore` | `Storage/LocalTelemetryStore.swift`, `StoreRecords.swift` | SQLite schema, migrations, sample/batch/retrieval persistence, pruning, corruption recovery. |
| `TelemetrySyncEngine` | `Sync/TelemetrySyncEngine.swift` | Upload loop (actor). Status exposed as `SyncSnapshot` via `Broadcaster`. |
| `NetworkMonitor` | `Sync/NetworkMonitor.swift` | `NWPathMonitor` → `NetworkStatus` (connected, expensive, constrained, interface). The app forwards changes to `TelemetrySyncEngine.networkChanged(isConnected:)`. |
| `APIClient` | `Networking/APIClient.swift`, `APIModels.swift`, `KeychainTokenStore.swift` | URLSession + async/await. Access token in memory only; refresh token in Keychain (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`). Single-flight refresh. snake_case + RFC 3339 ms dates. |
| `RealtimeClient` | `Networking/RealtimeClient.swift` | `URLSessionWebSocketTask` for the event map and retrievals (`event:<id>`, `retrievals:<id>`: `retrieval`, `retriever_position`, `pilot_position`). Auth message, subscribe with `since` cursor per channel, pong on ping, 60 s silence watchdog, reconnect 1 s → 30 s with jitter. **Foreground only**: the app disconnects on leaving the foreground, and it never carries the pilot's own telemetry. |
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

Flight profiles (raw values sent as `meta.profile`): `pre_flight, active_flight, thermal, cruise, landing`. Sharing profiles (never recorded as samples): `retrieve_waiting, retriever_driving`.

| Profile | desiredAccuracy | distanceFilter | Min stored interval |
|---|---|---|---|
| pre_flight | `kCLLocationAccuracyBest` | none (a stationary pilot must still get fresh fixes; the cached start-up fix is rejected as stale) | 5 s |
| active_flight | `kCLLocationAccuracyBestForNavigation` | none | 1 s |
| thermal | BestForNavigation | none | 1 s |
| cruise | BestForNavigation | 10 m | 3 s |
| landing | BestForNavigation | none | 2 s |
| retrieve_waiting | `kCLLocationAccuracyNearestTenMeters`, `activityType .fitness` | none | shared ≈ 30 s |
| retriever_driving | `kCLLocationAccuracyBest`, `activityType .automotiveNavigation` | none | shared ≈ 15 s |

Flight profiles use `activityType .airborne`. The sharing profiles have no distance filter on purpose: a filter does not idle the GPS (power is driven by the accuracy target), and without it a pilot standing still keeps fresh fix timestamps instead of looking "lost" to the retriever.

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

- Once the flight is airborne it never returns to `pre_flight`. A relaunch from the landing field returns to `active_flight`.
- Missing speed and vario keeps the current profile.
- "Near ground" cannot be known without terrain data. Landing is detected only from low speed plus a low altitude change. Landing does **not** end the flight automatically; the pilot ends it. Entering `landing` triggers the landing prompt (section 7).

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
  - `v2_incidents_kv`: `incident` (dropped in v3), `kv`
  - `v3_retrievals`: drops `incident` (SOS removed, ADR-012), creates `retrieval`

| Table | Key contents |
|---|---|
| `flight` | id (client UUID), eventId/name, visibility (legacy column, not sent; ADR-012 shares event flights by role), isSimulated, startedAt/endedAt, state, serverCreated, serverEnded, **nextSeq**, lastSampleAt, profile, interruptionCount, lastError |
| `sample` | id (UUID), flightId, seq, t (GPS), deviceT, lat, lon, altitude, ellipsoidalAltitude, hAcc, vAcc, speed, course, floor, profile, battery, lowPower, lowQuality, isSimulatedBySoftware, **syncState** (0 pending / 1 synced / 2 rejected), rejectReason, batchId |
| `outbox_batch` | id (= `batch_id` on the wire), flightId, createdAt, attemptCount, lastAttemptAt, lastError (retry metadata) |
| `retrieval` | client id (= server id), eventId/name, flightId, pickup (lat, lon, alt, h_acc, t), note, createdAt, **outbox** (pending/sent/refused/merged), attemptCount, lastAttemptAt, lastError, serverStatus, serverJSON (last server copy: retriever name/phone/position), cancelRequested/Reason/Synced, mergedInto |
| `kv` | `lastServerAck`, `recoveryEvents` (JSON, last 10), `me` (cached profile), `retrieverDuty` (event, on duty, active pickups) |

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

## 7. Retrieval (`RetrievalManager`, `RetrieverBoard`, `PositionSharingManager`)

Server state machine (api-contract.md "Retrievals"): `requested → accepted → picked_up → delivered`, `accepted → requested` on release, any open → `cancelled`.

**Pilot request (outbox).**
1. `request` writes the `retrieval` row synchronously (`outbox = pending`) before any network use; pickup = the latest flight/sharing fix (< 2 min) or a one-shot fix, with accuracy and fix time shown.
2. A per-request loop sends `POST /events/{id}/retrievals {id, flight_id?, pickup, note?}` with the **same client id** on every retry (idempotent). Backoff `min(60, 2·2^n) × [0.5, 1]`, `Retry-After` on 429.
3. 2xx → `sent`; then `GET /retrievals/{id}` every 15 s (realtime `retrieval` messages are applied immediately but never relied on).
4. 409 *open retrieval exists*: the open one is found via `error.details.retrieval_id` (or a `details.retrieval` object, or the open list) and adopted: if it is our own id (lost response) → `sent`; otherwise the local row becomes `merged` (`mergedInto`) and the server's request is stored and followed. A pending cancel carries over.
5. 400/403/404/422 before receipt → `refused` (kept, shown with the code, never retried).
6. Cancel ("Kendim döndüm"): if nothing was ever sent it is local; otherwise `cancelRequested` is persisted and `POST /retrievals/{id}/cancel` is retried until confirmed (409 = already closed → re-read). Every write after a network await re-reads the row, so a cancel issued while a create is in flight is never overwritten. [tested]

**UI stage** (`RetrievalStage`, pure, tested): saved locally → sending → requested → accepted → picked up → delivered, plus cancelling / cancelled / refused / merged. The ladder ticks a step only when the server reported it. Wording is logistics ("Retriever bekleniyor", "Kabul edildi"), never "help is coming".

**Pilot position sharing**: while the stage is `requested` or `accepted` and the request is known to the server; stops at picked up / delivered / cancelled / refused.

**Retriever**: `RetrieverBoard` per event (kept by the app so duty survives leaving the screen). Accept is first-one-wins; a 409 removes the request, shows "başka bir retriever senden önce kabul etti" and re-reads the list. Picked up / delivered (optional note) / release wait for the server; nothing is optimistic. Position sharing runs while **on duty or holding an accepted/picked-up retrieval** (`RetrieverDutyState.needsSharing`). The pilot's phone and live position are shown only as returned by the server (accepted retrievals).

**Landing prompt**: `LandingPromptDetector` fires once per landing episode of a recording event flight when the event has `landing_prompt`; options *bitir ve retrieve iste* / *bitir* / *hâlâ uçuyorum* (snooze 120 s). In the background a local notification is posted only if the user already allowed notifications (pre-flight offers the permission). It never ends the flight.

## 8. Restoration

- The active session is simply the `flight` row in an active state. `FlightSessionManager.restore()` runs on **every** launch, including background relaunch for location events (`UIApplication.LaunchOptionsKey.location`).
- **Retrieval and duty restoration**: at launch `AppModel` loads the `retrieval` rows and `kv.retrieverDuty`, decides the `SharingMode` and restarts sharing *before any UI* (same `didFinishLaunching` path), and `RetrievalManager.resumeAll()` resumes delivery/polling. When the app becomes active with an open request, the waiting screen is presented again. Duty is dropped if the user is no longer a retriever of that event.
- On restore, the manager replays the stored samples into the processor (stats and track survive). For a `recording`/`preparing` flight it:
  1. sets `interruptedSince` = last sample time
  2. increments `interruptionCount`
  3. recreates `CLBackgroundActivitySession` / `CLServiceSession`
  4. restarts updates with the last profile
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
| Waiting for a retrieve, screen locked | Same background engine (`retrieve_waiting`), position posted ≈ every 30 s while iOS keeps the process running; request polling continues. | Logic [tested]; delivery: device |
| Retriever driving, app in background (e.g. Apple Maps navigation in front) | `retriever_driving` profile, posts ≈ every 15 s while the process runs. | Logic [tested]; delivery: device |
| Retrieve requested offline | Request kept in SQLite (`pending`), sent with the same id when connected; waiting screen says "telefonda kayıtlı, henüz sunucuya ulaşmadı". | [tested] |
| Force-quit while waiting / on duty | Location stops (as for flights); retriever sees the position age grow. Reopening restores sharing and the waiting screen. | Restore logic: simulator; OS behaviour: device |

## 10. Automated tests (`apps/ios/RetfastCore/Tests/RetfastCoreTests`, run with `swift test` in `apps/ios/RetfastCore`, or as part of `xcodebuild test -scheme Retfast`; plus `RetfastUITests` — launch/onboarding test and the opt-in E2E test)

| Suite | Covers |
|---|---|
| Flight session state machine (`TrackingTests.swift`) | Valid path, invalid transitions, restore, error recovery |
| Flight session manager (`TrackingTests.swift`) | Start → preparing → recording on first good fix, persistence, end, pause stops GPS, denied permission, **restore after simulated process death with monotonic seq** (fake `LocationProviding`) |
| Tracking policy | Takeoff dwell, noise resistance, thermal/cruise/landing, missing data, per-profile targets incl. sharing profiles |
| Telemetry processor | All rejection reasons, low quality kept but excluded from stats, per-profile throttling, Kalman vertical speed on noisy 2 m/s climb, replay |
| Local telemetry store (`StoreTests.swift`) | Seq across reopen, WAL, raw values, batch reuse, synced only for acked seqs in the batch, prune never deletes unsynced, v1 → v2 migration, garbage-file quarantine, GPX export |
| Telemetry sync engine (`SyncTests.swift`, URLProtocol stub, injected clock) | Flight create then 500/500/200 batches, same batch_id after 503, backoff sequence with fixed jitter, 429 Retry-After, 401 → refresh → same batch_id, duplicate/rejected, offline → online, auth required, end only after all acked |
| API client | Single-flight refresh under 8 concurrent requests and rotation without reuse, `password_change_required`, date formats |
| Retrieval outbox (`RetrievalTests.swift`) | Persist before network, send with client id then poll, same id across offline/503 retries, relaunch resume, 409 adoption via details and via the open list, refused, local cancel, server cancel, cancel during an in-flight create, realtime apply; stage mapping, ladder and sharing rules; contract decoding (live snapshot with retrievals/retrievers, event `me`, object-valued error details); applications carry no role |
| Sharing / arbiter / prompt / roles / retriever (`SharingTests.swift`) | `SharingMode` per retrieval stage and duty, due rules, manager start → send → throttle → stop, target-gone; arbiter precedence, fan-out, sharing survives flight end; `FlightSessionManager` through the arbiter; landing prompt once per episode, disabled/paused, snooze, driven by the policy dwell; role → sheet mode incl. application states; retriever board lists, accept, **accept race 409**, realtime takeover, picked up → delivered, duty |
| UI (`RetfastUITests`) | Launch/onboarding; **`RetrieveFlowUITests`**: event sheet → acknowledge sharing → start flight → end → retrieve request → waiting screen shows acceptance → resume bar, against the in-app stub backend (`-stubAPI`, DEBUG only) and synthetic fixes (`-stubLocation`); opt-in `EndToEndTests` (pilot + retriever) against a real backend |

## 11. What only a physical iPhone can verify

- Actual fix delivery rate per profile in foreground, background and locked states, and with `distanceFilter`.
- Background continuity with the screen locked for a full flight (1–4 h).
- Low Power Mode effect on rate and accuracy.
- Real GPS altitude and v_acc noise in flight, and whether the Kalman settings give a usable "tahmini" vertical speed.
- Relaunch after jetsam via significant-location-change (Always vs When In Use).
- Force-quit behaviour and the resulting gap; device restart behaviour.
- Battery drain per profile; thermal state on a sunny launch.
- Background networking while locked (cellular in the mountains), and Keychain/DB access while locked.
- Position sharing while **waiting for a retrieve** with the phone locked in a pocket (≈ 30 s cadence actually reaching the server), and while **driving as a retriever** with Apple Maps navigation in the foreground (≈ 15 s cadence, `automotiveNavigation`).
- Battery cost of the two sharing profiles; landing prompt timing on a real landing; the local landing notification in the background.

## 12. Real-device test protocol

Preconditions: Release-like build signed with team `JHW499P7S3`, bundle `com.mizibu.retfast`, a backend reachable from the phone, two phones (pilot + retriever accounts of the same event). Record results in a table: date, device model, iOS version, app build, scenario, duration, samples stored, expected samples (duration / min interval), gaps > 10 s, battery start/end, notes.

1. **Permissions.** On a fresh install, run onboarding and grant When In Use, then Always. Check that Diagnostics shows `always` and full accuracy. Repeat with Approximate location and check the pre-flight warning.
2. **Foreground baseline (15 min, walking or driving).** Start a flight and keep the screen on. Check that samples/minute roughly matches the profile, the sync status reaches "synced", and `GET /api/v1/flights/{id}/positions` returns the same count.
3. **Locked screen (30 min).** Start, lock the phone and keep it in a pocket while moving. Unlock and check there are no gaps beyond the profile interval and that the blue indicator was shown.
4. **Background with other apps (15 min).** Use Maps or the camera while recording; verify continuity.
5. **No connectivity (15 min).** Turn on airplane mode with Wi-Fi off (GPS still works), record, then turn connectivity back on. Pending count should grow, then drain to 0, with no duplicates on the server.
6. **Low Power Mode (30 min).** Repeat scenario 3 with Low Power on. Compare rate and accuracy; check that `low_power=true` is in the sample meta.
7. **Force quit.** While recording, swipe the app away, wait 5 min, then reopen. Expect a gap of about 5 min, an interruption banner, recording resumed, and `interruptionCount` = 1.
8. **System termination.** While recording in the background, run memory-heavy apps (or use Xcode "Simulate memory warning" / terminate from the debugger, noting that the debugger alters behaviour). Check whether the app is relaunched by a significant-change event, with Always and with When In Use.
9. **Device restart.** Restart mid-flight, wait without unlocking, then unlock and move about 1 km. Note when recording resumes (relaunch vs manual open).
10. **Retrieve.** Pilot phone: land (walk), accept the landing prompt or end the flight, request a retrieve in airplane mode (expect "telefonda kayıtlı"), reconnect (expect "Retriever bekleniyor"), lock the phone for 15 min. Retriever phone: go on duty, accept, open Navigasyon (Apple Maps in front) and drive 15 min, mark picked up and delivered. Check server-side: retrieval timeline, pilot position cadence ≈ 30 s while locked, retriever position cadence ≈ 15 s while navigating, sharing stopped after picked up / delivered. Repeat with a force-quit on each phone (expect a gap until reopen, then restored waiting screen / duty).
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

End-to-end (simulator + local backend): `RetfastUITests/EndToEndTests` is skipped unless `TEST_RUNNER_RETFAST_E2E_BASE_URL`, `…_EMAIL`, `…_PASSWORD` (optionally `…_NEW_PASSWORD`, `…_RECORD_SECONDS`) and, for the retriever half, `…_RETRIEVER_EMAIL`, `…_RETRIEVER_PASSWORD` are set. `testA` (pilot): onboarding, login, forced password change, demo event, acknowledge sharing, start flight, minimise (recording must continue), end, retrieve request with a quick note, waits until the server confirmed it. `testB` (retriever): login, demo event, accept the open request (skipped if already held), wait for the pilot position, picked up, delivered. Verify server-side with `GET /api/v1/events/{id}/retrievals` (as an organizer) and `GET /api/v1/flights/{id}/positions`.

UI test against a stub (no backend): `RetrieveFlowUITests` launches with `-uiTesting -stubAPI -stubLocation` (DEBUG-only `StubBackend` URLProtocol + `SimulatedLocationProvider`, `App/DebugSupport.swift`; neither exists in Release builds). The app reads `RETFAST_API_BASE_URL` from the launch environment as a debug override of the Info.plist value.

Simulator location has no realistic altitude or vertical accuracy. Expect the vertical-speed estimate and the altitude-based policy heuristics (thermal/landing) to be unrepresentative there.
