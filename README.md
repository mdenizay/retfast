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
- Event creation, publication, visibility, and lifecycle management.
- Public applications plus manager-driven pilot, retriever, and observer roles.
- Event manager assignment and direct participant enrollment.
- Transactional second-generation callable Functions for every privileged command.
- A rate-limited Cloud Tasks queue for automatic event activation/completion.
- Event discovery and application status on the native mobile application.

Run the complete local quality gate with:

```bash
npm run check
npm run build
```

Production Functions run in `europe-west1` with 256 MiB memory, zero minimum
instances, and a maximum of three instances. The event lifecycle task worker is
limited to one concurrent dispatch. Artifact Registry images older than one day
are automatically deleted to keep storage costs bounded.

The development Firebase project remains on the Spark plan, so its callable
Functions are used through the local Emulator Suite. Production Functions and
Cloud Tasks are deployed to the Blaze-enabled `retfast-ab7ca` project.
