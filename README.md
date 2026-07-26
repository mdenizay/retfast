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

Use `APP_ENV=production` only for explicit production mobile builds. EAS profiles
already set the correct environment:

```bash
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

Run the complete local quality gate with:

```bash
npm run check
npm run build
```

Cloud Functions are intentionally not deployed yet. This keeps the foundation
free of server-side runtime costs until the event and dispatch command model is
implemented.
