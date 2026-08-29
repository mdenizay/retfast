# RETFAST Web

React + TypeScript + Vite + Tailwind CSS + shadcn/ui dashboard for Observers,
Event Admins and System Admins.

```sh
cp .env.example .env   # fill VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

## Structure

- `src/lib/` — Supabase client, row types, WKB point parser, formatting,
  `map/provider.ts` (map style abstraction — set `VITE_MAP_STYLE_URL` for a
  vector style; falls back to OSM raster).
- `src/i18n/` — typed catalogs (`en`, `tr`); `useI18n().m` gives compile-time
  checked message access.
- `src/pages/EventsPage` — discover public events, join by invitation code,
  request participation, create events (system admin).
- `src/pages/event/*` — per-event tabs:
  - **Operations** — live map (Supabase Realtime), pilot/retriever markers,
    emergency monitor with acknowledge/resolve, manual retrieval dispatch,
    assignment progression.
  - **Flights** — task history with **Replay** (route + timeline scrubbing).
  - **Zones** — GeoJSON editor (terra-draw): areas, lines, points, typed and
    colored.
  - **Members / Requests / Audit / Settings** — roster & role management,
    approvals, audit trail, event settings + invitation code (RPC-guarded).
- `src/pages/ReplayPage` — `task_track` RPC → simplified line + full points +
  play/pause/scrub timeline.
