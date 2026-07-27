# RETFAST API

The API is the operational data boundary for the RETFAST web and mobile apps. Firebase Authentication remains the identity provider; every `/v1` request sends a Firebase ID token as a bearer token. Events, memberships, tracking, retrieval, messages and device registrations are stored in PostgreSQL.

## Local development

Requirements: Node.js 22 and PostgreSQL 16 or newer.

```bash
cp .env.example .env
npm ci
npm run migrate
npm run dev
```

Health endpoints do not require authentication:

- `GET /healthz`: process health
- `GET /readyz`: process and database readiness

All other routes require `Authorization: Bearer <firebase-id-token>`.

## API areas

- `/v1/session`: account bootstrap, current profile and push devices
- `/v1/events`: event CRUD, applications and memberships
- `/v1/events/:eventId/tracking`: tracking session start, live locations and session history
- `/v1/tracking/sessions/:sessionId`: idempotent location batches, stop and replay
- `/v1/events/:eventId/retrieval`: retriever state, nearby vehicles, requests, dispatch and transfers
- `/v1/events/:eventId/messages`: event messaging
- `/v1/ws`: authenticated event updates over WebSocket; authenticate and subscribe messages are sent after connection

Location batches are idempotent by batch ID and point sequence. PostgreSQL transactions and partial unique indexes prevent two open offers from reserving the same retriever concurrently.

## Existing Firebase data

After applying migrations, existing Firebase Auth users and core Firestore data can be imported safely:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/service-account.json npm run import:firebase
```

The import is upsert-based and may be run again. It imports Auth users, profiles, events, memberships, tracking sessions/chunks/points, retriever states, retrieval jobs and push devices. Realtime live locations are intentionally not imported because they are ephemeral; devices will repopulate them when tracking resumes.

## Production

The production image is built by [Dockerfile](./Dockerfile). The complete Ubuntu and Cloudflare procedure is documented in [Ubuntu deployment](../docs/ubuntu-24-cloudflare-deployment.md).
