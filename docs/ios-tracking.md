# iOS background tracking & offline sync

Reliability order: never lose a point → keep tracking in background → sync
eventually → save battery. The design assumes flights of 1–6 hours in areas
with patchy cellular coverage.

## Permissions & modes

- `NSLocationWhenInUseUsageDescription` + `NSLocationAlwaysAndWhenInUseUsageDescription`
  in Info.plist; **Always** authorization is requested progressively (first
  When-In-Use at onboarding, upgrade prompt when the first task starts).
- `UIBackgroundModes: [location]` and
  `CLLocationManager.allowsBackgroundLocationUpdates = true`,
  `pausesLocationUpdatesAutomatically = false` while a task or duty session is
  open. The blue background-activity indicator is the deal — tracking
  continues with the screen locked as long as iOS policy allows.
- `showsBackgroundLocationIndicator = true` for transparency.
- Recovery after termination: the app enables
  `CLLocationManager.significantLocationChanges` alongside precise updates;
  if iOS kills the process, an SLC event relaunches the app, and
  `TrackingEngine` restores the open task/session from local state and resumes
  precise tracking. (Full fidelity may drop to SLC granularity until relaunch —
  documented, unavoidable.)

## Adaptive frequency (battery)

`TrackingEngine` picks a profile from flight phase + battery:

| Profile | Trigger | desiredAccuracy | distanceFilter |
|---|---|---|---|
| `performance` | in flight (speed > 3 m/s), battery > 30% | `kCLLocationAccuracyBest` | 10 m |
| `balanced` | in flight, battery 15–30% | `kCLLocationAccuracyNearestTenMeters` | 25 m |
| `low_power` | battery < 15% or `landed` waiting for pickup | `kCLLocationAccuracyHundredMeters` | 100 m |
| `retriever` | on duty, driving | `kCLLocationAccuracyNearestTenMeters` | 50 m |

Every point records `battery_pct` and `tracking_state`, so the ops dashboard
can see *why* a track went sparse.

## Local buffering (offline-first)

Every CLLocation is synchronously appended to a local **SQLite** queue
(`points.sqlite`, WAL mode) before any network attempt:

```
pending_points(id TEXT PK,          -- UUID generated on device
               payload TEXT,        -- JSON matching ingest_location_points
               created_at INTEGER,
               sync_state INTEGER)  -- 0 pending, 1 in-flight
```

- The UUID is generated **once, at capture time** — retries and reconnects
  can never duplicate a point (`location_points.id` PK + `on conflict do
  nothing` server-side).
- The queue survives app termination and device reboot; on launch,
  `SyncEngine` resets in-flight rows to pending and resumes.

## Batched synchronization

`SyncEngine` drains the queue via the `ingest_location_points` RPC:

- Timer flush every **15 s** in `performance`, 30 s in `balanced`, 60 s in
  `low_power`; immediate flush on `landed`, SOS, task finish, and app
  backgrounding.
- Batch size 25–100 points (500 hard server cap); oldest first.
- On success, delete the batch; on failure, exponential backoff
  (2 s → 4 s → … → 5 min cap) and points stay queued. HTTP 401 pauses sync
  until the Supabase session refreshes.
- Connectivity is observed with `NWPathMonitor`; regaining a path triggers an
  immediate drain.
- The server RPC silently drops points whose task/session is closed or not
  owned — the client treats "accepted count < sent count" as success (the
  authoritative record decided).

## Status surface

The tracking HUD always shows: GPS fix quality, queue depth ("12 points
buffered"), last successful sync age, battery profile, and a hard
red/amber/green tracking state, so a pilot always knows whether they are
visible to the operation.

## SOS

SOS button: 3-second hold → `raise_emergency` RPC with the freshest fix
(queued point if offline — the emergency row itself is retried by
`SyncEngine` as a priority item), then invokes the `notify-emergency` Edge
Function. While offline, the app keeps retrying and shows an explicit
"SOS NOT yet delivered" banner — silence is never implied success.
