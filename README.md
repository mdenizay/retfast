# RETFAST

RETFAST coordinates live tracking and retrieval operations for paragliding,
hang-gliding, and cycling events.

## Applications

- `apps/mobile`: Expo application for pilots and retrievers.
- `apps/web`: React operations console for managers and observers.
- `functions`: trusted Firebase command handlers.
- `packages/domain`: shared roles, states, and validation schemas.

## Firebase environments

- `development`: `retfast-3279f`
- `production`: `retfast-ab7ca`

Production deployment is always explicit. The default Firebase alias points to
development.

## Local development

```bash
npm install
npm run dev:web
npm run dev:mobile
```

Expo Go is not a supported runtime for RETFAST because background location and
native authentication require a development build.
