# RETFAST

Event-based real-time athlete tracking and retrieval platform for free-flight (paragliding XC) events.

- **Pilots** fly tasks; their positions stream live, buffered offline and synced in batches.
- **Retrievers** pick pilots up after landing, with capacity tracking and a dispatch workflow.
- **Observers / Event Admins / System Admins** run operations from the web dashboard.

## Repository layout

| Path | Contents |
|---|---|
| [`/supabase`](supabase/) | Database migrations (schema, RLS, functions), seed scripts, Edge Functions |
| [`/apps/web`](apps/web/) | React + TypeScript + Vite + Tailwind + shadcn/ui dashboard |
| [`/apps/ios`](apps/ios/) | Native Swift / SwiftUI app for Pilots and Retrievers (`com.mizibu.retfast`) |
| [`/apps/android`](apps/android/) | Native Kotlin / Compose app for Pilots and Retrievers |
| [`/docs`](docs/) | Architecture, schema, RLS model, realtime strategy, iOS tracking & offline sync |

## Stack

- **Backend/BaaS:** self-hosted [Supabase](https://supabase.com/docs/guides/self-hosting) (Postgres + PostGIS, GoTrue Auth, Realtime, Storage, Edge Functions) deployed with Dokploy.
- **Web:** React 19, TypeScript, Vite, Tailwind CSS, shadcn/ui, MapLibre GL (behind a map-provider abstraction).
- **iOS:** SwiftUI, `supabase-swift`, CoreLocation background tracking, local SQLite buffer.
- **Android:** Kotlin, Jetpack Compose, `supabase-kt`, a `location` foreground service, same SQLite buffer contract.
- **Email:** Resend. **Domain:** `retfast.com`.

## Getting started

1. Copy env templates and fill in the values (never commit secrets):

   ```sh
   cp apps/web/.env.example apps/web/.env
   cp supabase/seed/.env.example supabase/seed/.env
   ```

2. Apply migrations to the Supabase Postgres (see [`supabase/README.md`](supabase/README.md)).
3. Seed the development scenario **Çameli XC-Open 2026**: `cd supabase/seed && npm install && npm run seed`.
4. Web: `cd apps/web && npm install && npm run dev`.
5. iOS: `cd apps/ios && xcodegen generate && open Retfast.xcodeproj` (requires [XcodeGen](https://github.com/yonaskolb/XcodeGen)).
6. Android: see [`apps/android/README.md`](apps/android/README.md).

## Documentation

- [Architecture overview](docs/architecture.md)
- [Database schema](docs/database.md)
- [RLS / authorization model](docs/rls.md)
- [Realtime strategy](docs/realtime.md)
- [iOS background tracking & offline sync](docs/ios-tracking.md)
