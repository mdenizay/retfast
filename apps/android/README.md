# RETFAST Android

Native Kotlin + Jetpack Compose app for Pilots and Retrievers, talking to the
same Supabase RPC surface as the iOS and web clients. Application id:
`com.mizibu.retfast`.

## Build

Requires JDK 21 and the Android SDK (`compileSdk 36`). The Supabase URL and
anon key are build inputs — the anon key is public by design, RLS is the
actual authorization boundary (see [docs/rls.md](../../docs/rls.md)).

```sh
cd apps/android
echo "sdk.dir=$HOME/android-sdk" > local.properties

./gradlew :app:assembleRelease \
  -Pretfast.supabaseUrl=https://supa.retfast.com \
  -Pretfast.supabaseAnonKey=<anon key>
```

Output: `app/build/outputs/apk/release/app-release.apk` (~2.3 MB).

`assembleDebug` also works but produces a ~64 MB APK — R8 is only enabled for
the release variant. Release is currently **debug-signed** so the APK is
directly installable; wire a real keystore before store distribution.

## Toolchain notes

| | |
|---|---|
| JDK | 21 (AGP 8.x does not support JDK 26) |
| Gradle | 8.13 (AGP 8.x is incompatible with Gradle ≥ 9.6) |
| AGP | 8.13.2 |
| Kotlin | 2.1.21 |
| Supabase | **3.1.4** — 3.8.0 ships Kotlin 2.4 metadata this compiler cannot read |

## Architecture

- `core/` — Supabase client and the `@Serializable` row models.
- `tracking/`
  - `TrackingService` — `foregroundServiceType="location"` service. This is
    Android's counterpart to iOS's location background mode: it is the only
    way to keep receiving fixes once the screen locks, and the ongoing
    notification is what stops the system reclaiming the process mid-flight.
    `START_STICKY` brings it back if Android does kill it.
  - `PointBuffer` — SQLite WAL queue. Every fix is persisted with a
    client-generated UUID *before* upload, so `ingest_location_points` upserts
    idempotently across retries and process death. Capped at 50 000 points.
  - `SyncEngine` — batched uploads that reuse the iOS engine's rules: backoff
    is a recorded **deadline**, never a sleep held across the drain lock, and
    each wake-up does bounded work (5 batches).
- `auth/`, `events/` — session handling and event list/detail.
- `pilot/` — flight lifecycle (start / landed / finish / cancel + reason), SOS
  with two-stage arming, nearby-retriever picker, and a telemetry HUD showing
  altitude, ground speed, heading, GPS accuracy, battery and queue depth.
- `retriever/` — duty toggle, the 60 s incoming offer with countdown, the
  job workflow (en route → picked up → delivered → completed), and hand-off to
  whichever navigation app is installed via a `geo:` intent.
- `ui/Common.kt` — `Hit` touch-target tiers (48/52/60 dp) mirroring the iOS
  `ControlStyles.swift`, because these screens are used outdoors with gloves.

## Not yet done

- **No map view.** The pilot HUD is text-only; MapLibre is not wired in yet.
- No flight replay screen (iOS and web have one).
- Release signing uses the debug keystore.
