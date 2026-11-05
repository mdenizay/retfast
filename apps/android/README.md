# Retfast Android (4.1.0)

Native Android app (Kotlin, Jetpack Compose, Material 3 restyled with the shared Retfast Aero tokens) for event
live tracking and landed-pilot retrieval. Same product as `apps/ios`; design and background-location rules are in
`docs/architecture/android.md`. API contract: `docs/architecture/api-contract.md`.

- applicationId `com.mizibu.retfast`, versionName `4.1.0` (code 41000), minSdk 26, target/compile 36
- Location: FusedLocationProviderClient (Play Services) with a `GPS_PROVIDER` fallback; foreground service type `location`
- Storage: Room (SQLite, WAL); sync: in-process loop while recording + WorkManager retry
- Maps: MapLibre Native + OpenFreeMap (`liberty`, `dark`)

## Toolchain

```sh
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools   # also written to local.properties (git-ignored)
```

Gradle 8.14.3 (wrapper), AGP 8.13.2, Kotlin 2.3.10, Compose BOM 2026.06.01. Versions live in `gradle/libs.versions.toml`.

## Commands (run in `apps/android`)

```sh
./gradlew :app:testDebugUnitTest          # JVM unit tests (Robolectric + MockWebServer)
./gradlew :app:assembleDebug              # app/build/outputs/apk/debug/app-debug.apk (applicationId com.mizibu.retfast.debug)
./gradlew :app:assembleRelease            # minified (R8) + signed release APK
./gradlew :app:lintDebug :app:lintRelease # lint (errors fail the build)
mkdir -p dist && cp app/build/outputs/apk/release/app-release.apk dist/retfast-4.1.0.apk
adb install -r dist/retfast-4.1.0.apk
```

Emulator against the local backend (`services/api`, port 8080): `./gradlew :app:assembleDebug -PlocalBackend=true`
(base URL `http://10.0.2.2:8080`, cleartext allowed for that host in debug builds only).

## Signing

The release build reads `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD` from the environment or from
`infrastructure/secrets/android-signing.local.env`, with the keystore at `infrastructure/secrets/android-release.jks`
(both git-ignored; never commit them). If any is missing the release build falls back to the debug key, which is fine
for local tests but not for distribution. The upload/signing key must be kept: apps signed with a different key cannot
update an installed copy.

Verify: `$ANDROID_HOME/build-tools/36.0.0/apksigner verify --print-certs dist/retfast-4.1.0.apk` and
`$ANDROID_HOME/build-tools/36.0.0/aapt2 dump badging dist/retfast-4.1.0.apk`.

## Generated files

- `app/src/main/java/.../ui/theme/AeroTokens.kt` from `packages/design-tokens/tokens.json`: `node tools/gen-tokens.mjs`
- `app/src/main/res/values{,-en}/strings.xml` from one table: `python3 tools/strings.py` (edit the table, not the XML)

## Layout

```
app/src/main/java/com/mizibu/retfast
  net/        ApiClient (OkHttp, single-flight refresh), models, Keystore token store, RealtimeClient (WebSocket)
  data/       Room entities + DAOs (flights, samples, retrievals outbox, position-share outbox, kv)
  tracking/   TrackingPolicy, TelemetryProcessor, TrackingEngine, TrackingService (FGS), LocationSource, notifications, BootReceiver
  sync/       SyncEngine (batches, backoff), SyncWorker (WorkManager)
  retrieval/  RetrievalManager (outbox, 409 adoption), stages, sharing mode
  domain/     role -> sheet mapping, auth gate, password policy
  app/        AppGraph (manual DI), SessionManager, Prefs
  ui/         Compose screens: onboarding, auth, events, event (map + sheets), flight computer, retrieval waiting, flights, profile, diagnostics
```
