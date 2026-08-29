# RETFAST iOS

Native SwiftUI app for Pilots and Retrievers. Bundle id: `com.mizibu.retfast`.

## Setup

```sh
brew install xcodegen
cd apps/ios
cp Retfast/Resources/Secrets.example.plist Retfast/Resources/Secrets.plist
# fill in SUPABASE_URL + SUPABASE_ANON_KEY (Secrets.plist is gitignored)
xcodegen generate
open Retfast.xcodeproj
```

The Xcode project is generated from [`project.yml`](project.yml) — edit that,
not the `.xcodeproj`.

## Architecture

- `Core/` — Supabase client (`supabase-swift`), Codable models, config.
- `Tracking/` — the reliability core (see [docs/ios-tracking.md](../../docs/ios-tracking.md)):
  - `TrackingEngine` — CoreLocation with adaptive battery profiles and
    background updates (`UIBackgroundModes: location`), significant-change
    relaunch insurance.
  - `PointBuffer` — SQLite WAL queue; every point is persisted with a
    client UUID *before* upload → idempotent, offline-safe.
  - `SyncEngine` — batched `ingest_location_points` RPC uploads with
    exponential backoff and `NWPathMonitor`-triggered drains.
- `Pilot/` — full-screen operational map, HUD (altitude/speed/heading/queue),
  flight lifecycle (start / landed / finish / cancel+reason), SOS (3 s arm),
  nearby-retriever picker with the 60 s offer flow.
- `Retriever/` — duty toggle (continuous breadcrumbs), incoming request
  countdown, job workflow (en route → picked up → delivered → completed),
  capacity editor, hand-off to Apple/Google/Yandex Maps.
- `History/` — track replay with timeline scrubbing (`task_track` RPC).
- `Resources/` — `en`/`tr` localizations; add a language by adding an
  `.lproj` folder.

iOS polls the small state tables every 5 s instead of holding Realtime
sockets — simpler and more robust on flaky cellular; the web dashboard uses
Supabase Realtime (docs/realtime.md).
