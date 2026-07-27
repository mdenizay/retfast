# RETFAST

RETFAST coordinates live tracking and retrieval operations for paragliding,
hang-gliding, and cycling events.

## Applications

- `mobile`: standalone Expo application for pilots and retrievers.
- `web`: standalone React application for managers and observers.
- `functions`: standalone trusted Firebase command handlers.

Each project has its own `package.json`, `package-lock.json`, dependencies, and
quality commands. There are no npm workspaces or cross-project package links.
Firebase configuration, rules, and deployment orchestration remain at the
repository root.

## Firebase environments

- `development`: `retfast-3279f`
- `production`: `retfast-ab7ca`

Production deployment is always explicit. The default Firebase alias points to
development.

## Local development

Install each project independently:

```bash
cd web && npm ci
cd ../mobile && npm ci
cd ../functions && npm ci
```

Then start the application you are working on from its own directory:

```bash
cd web && npm run dev
cd mobile && npm run start
```

Expo Go is not a supported runtime for RETFAST because background location and
native authentication require a development build.

Use `APP_ENV=production` only for explicit production mobile builds. EAS profiles
already set the correct environment:

```bash
cd mobile
npx eas build --profile development --platform ios
npx eas build --profile development --platform android
```

## Implemented foundation

- Firebase email/password and Google authentication on web.
- Native Firebase authentication, Google Sign-In, and Apple Sign-In on mobile.
- Registration, password reset, and authenticated password change flows.
- Turkish and English localization with system-aware light/dark themes.
- Validated user profiles and deny-by-default Firestore security rules.
- Separate development and production Firebase configuration.
- Firebase Hosting targets for the React operations console.
- Event creation, publication, visibility, and lifecycle management.
- Public applications plus manager-driven pilot, retriever, and observer roles.
- Event manager assignment and direct participant enrollment.
- Transactional second-generation callable Functions for every privileged command.
- A rate-limited Cloud Tasks queue for automatic event activation/completion.
- Event discovery and application status on the native mobile application.
- `europe-west1` Realtime Database instances for development and production.
- Approved-event access mirroring from Firestore to deny-by-default RTDB rules.
- Live pilot/retriever telemetry with heading, altitude, speed, battery, charging,
  connectivity, and server-received timestamps.
- Idempotent tracking sessions and Firestore route chunks for later replay/scoring.
- Expo SDK 57 background tracking with Android foreground service and iOS location
  background mode.
- A persistent SQLite/WAL queue that survives restarts and retries route uploads.
- A role-aware mobile mission map and bilingual mission controls.
- A lazy-loaded Leaflet operations map with street/topographic layers and a live
  telemetry panel for event managers.
- Transactional retrieval offers with a 45-second Cloud Tasks timeout.
- Capacity-safe retriever assignment, vehicle availability, pickup, delivery,
  cancellation, and manager-driven vehicle transfers.
- Distance-ranked retriever discovery from fresh Realtime Database locations.
- Pilot and retriever mobile operation cards with external map directions.
- Expo push-token registration and offer/status notifications from Functions.
- A web dispatch desk for direct assignment and retrieval intervention.
- Observer operator access for retrieval intervention, mission termination, and
  historical route inspection without event/member administration privileges.
- Flight replay with session selection, route reconstruction, telemetry,
  playback controls, and a draggable timeline.

Run the complete local quality gate with:

```bash
npm run check
npm run build
```

The root commands are convenience orchestrators only. They invoke the scripts
inside the independent projects with `npm --prefix`; the projects do not share
dependency installation or build state.

Production Functions run in `europe-west1` with 256 MiB memory, zero minimum
instances, and a maximum of three instances. The event lifecycle task worker is
limited to one concurrent dispatch. Artifact Registry images older than one day
are automatically deleted to keep storage costs bounded.

## Tracking profile and cost controls

- Pilots request a high-accuracy fix every 10 seconds or 8 metres.
- Retrievers request a high-accuracy fix every 15 seconds or 15 metres.
- Background delivery is deferred by 30–45 seconds where the operating system
  supports batching, reducing wake-ups without losing the underlying points.
- The latest point is written to RTDB for the live map. Historical points remain
  in SQLite and are uploaded in chunks of up to 50 points, normally every five
  minutes. This avoids a callable and Firestore document write for every GPS fix.
- Batch IDs are deterministic and server ingestion is idempotent, so reconnects
  cannot duplicate a route chunk.
- Normal backgrounding and screen locking are supported. Platform rules still
  prevent continuous collection after a user explicitly force-quits the app;
  points already collected remain queued safely.

The mobile mission map currently uses `react-native-maps`. iOS uses MapKit. A
Google Maps Android SDK key is intentionally not committed or enabled because it
is a billable Google Maps Platform resource; configure it only when Android store
builds are approved. Web maps use OpenStreetMap/OpenTopoMap raster tiles and do
not require an API key.

The development Firebase project remains on the Spark plan, so its callable
Functions are used through the local Emulator Suite. Production Functions and
Cloud Tasks are deployed to the Blaze-enabled `retfast-ab7ca` project.

## Retrieval consistency and cost controls

- A seat is reserved only when an offer is accepted or a manager dispatches a
  vehicle. The Firestore transaction serializes concurrent pilot requests and
  prevents capacity overflow.
- Declines and expired offers do not reserve capacity. Delivery, cancellation,
  and vehicle transfer release the prior reservation in the same transaction.
- Offer expiry runs with one concurrent Cloud Tasks dispatch, zero minimum
  instances, and at most two dispatches per second.
- Nearby matching reads the event's live RTDB snapshot and at most 100
  configured retriever states, then returns the closest eight available teams.
- Push delivery uses the Expo Push Service and stores at most 20 registered
  devices per user for a single notification fan-out.
