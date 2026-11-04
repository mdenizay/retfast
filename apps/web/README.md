# Retfast web (`apps/web`)

One React SPA for the public site (`retfast.com`) and the operations app (`app.retfast.com` / `/app`).
Contract: `docs/architecture/api-contract.md`. Design: `docs/product/design-system.md`, screens: `docs/product/screens.md`.

Stack: React 19 · TypeScript (strict) · Vite 8 · Tailwind CSS v4 · shadcn/ui (Radix, restyled to Aero tokens) ·
TanStack Query · React Router 7 (data router) · MapLibre GL (OpenFreeMap) · Recharts · Vitest + Testing Library + MSW.

## Requirements

- Node 22, pnpm 12 (`corepack enable` picks the version from `packageManager`).
- For real data: the Go API on `http://localhost:8080` (see `services/api/README.md`).

## Commands

```sh
cd apps/web
pnpm install
pnpm dev          # http://localhost:5173 — proxies /api (incl. WebSocket /api/v1/realtime) to http://localhost:8080
pnpm typecheck    # tsc -b (strict)
pnpm lint         # eslint (typescript-eslint, react-hooks)
pnpm test         # vitest run (jsdom + MSW)
pnpm build        # typecheck + production build → dist/
pnpm preview      # serve dist/ locally
```

## Configuration (build-time)

| Variable | Default | Meaning |
|---|---|---|
| `VITE_API_URL` | dev: empty (same origin → Vite proxy); prod: `https://api.retfast.com` (`.env.production`) | API origin; the client calls `${VITE_API_URL}/api/v1/...` and `ws(s)://…/api/v1/realtime`. |
| `VITE_APP_STORE_URL` | empty | If set, the landing page links to the App Store; otherwise shows "iOS uygulaması yakında". |

Design tokens are imported from `packages/design-tokens/dist/tokens.css` (alias `@tokens`). To change a token edit
`packages/design-tokens/tokens.json` and run `node packages/design-tokens/build.mjs` (fails on WCAG contrast).

## Local end-to-end with the backend

```sh
# terminal 1 (backend, per services/api/README.md)
cd services/api
export DATABASE_URL='postgres:///retfast_dev?host=/tmp' REDIS_URL=redis://localhost:6379 \
       JWT_SECRET=dev-only-secret-at-least-32-characters APP_ENV=development
go run ./cmd/api migrate up && go run ./cmd/api seed && go run ./cmd/api serve

# terminal 2
cd apps/web && pnpm dev
# open http://localhost:5173/login — seeded accounts must change their password on first login
```

The refresh cookie is `Path=/api/v1/auth; SameSite=Strict; Secure`. Through the Vite proxy everything is same-origin
(`localhost:5173`), so the cookie works in dev (browsers treat `localhost` as a secure context).

## Docker

```sh
# from the repository root
docker build -f infrastructure/docker/web.Dockerfile --build-arg VITE_API_URL=https://api.retfast.com -t retfast-web .
docker run --rm -p 8080:8080 retfast-web     # http://localhost:8080, health: /healthz
```

`nginxinc/nginx-unprivileged` (non-root) on port 8080: SPA history fallback, gzip, immutable caching for `/assets/*`,
`no-cache` for `index.html`, security headers incl. a CSP that allows only self, the API origin (https + wss) and
`tiles.openfreemap.org`. No inline scripts (the pre-paint theme script is `public/theme-init.js`).

## Layout

```
src/
  app/            providers, route tree (createRoutes — shared by the browser router and tests)
  layouts/        public + operations shells, guards (auth, forced password change, roles)
  lib/            config, api client (+ single-flight refresh), contract types, endpoints, auth session, i18n, theme, formatting
  features/live/  live tracking: reducer/store, freshness, WebSocket client, map layers, LiveView
  features/…      events (form, point picker), flights (route, charts, GPS quality), incidents (stream, map)
  components/     shared UI (status badges, common states, map canvas) and ui/ (shadcn)
  pages/          route components (public/, auth/, app/)
  test/           MSW server, fixtures, fake WebSocket, render helper
```

## Notes

- Access token is kept in memory only; `POST /auth/refresh` with `credentials: "include"` runs on boot, 60 s before
  expiry and on `401 token_expired` — one request at a time (refresh tokens rotate; parallel refreshes would trip reuse
  detection).
- Maps use GeoJSON sources with symbol/circle/line layers (no DOM markers) and a windowed pilot list for 2000+ pilots.
  WebSocket messages are batched into one store update per animation frame.
- Tests replace the MapLibre canvas with a stub (no WebGL in jsdom); map rendering is verified manually in a browser.
