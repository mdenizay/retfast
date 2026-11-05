# Retfast Aero — Design System (web + iOS)

"Technical minimalism": Apple-like clarity plus aviation instrumentation. Calm, precise, readable outdoors in
direct sun and at night on a hillside. The interface is an instrument, not a marketing page.

Single source of truth: `packages/design-tokens/tokens.json`. `node packages/design-tokens/build.mjs` generates
`dist/tokens.css` (web CSS variables, light + dark) and `dist/AeroTokens.swift` (iOS) and **fails the build if any
WCAG contrast check fails**. Never edit `dist/` by hand.

## 1. Principles

1. **Truth over polish.** Every live value shows how old it is. Nothing is presented as live when it is not; no
   placeholder or fake data is ever shown as real. Empty states say plainly that there is no data.
2. **Never color alone.** Every state is icon + text label + color (see §6). Colorblind users, monochrome
   screens in sunlight, and screenshots in a WhatsApp group must all read the same meaning.
3. **Density with hierarchy.** Operators scan many pilots at once: compact rows, tabular numerals, hairline
   separators instead of cards-in-cards.
4. **Calm motion.** Motion explains state changes only (sheet open, map follow). No ambient animation.
   `prefers-reduced-motion` disables transitions and makes map moves jump instead of fly.
5. **Honest scope.** Retfast is event tracking and landed-pilot retrieval, not an emergency service: no copy implies
   authorities are contacted, and every status (accepted, picked up, delivered) appears only when the server says so —
   the UI never updates optimistically.
6. **Role-shaped, not menu-shaped.** People have no global role; what a screen offers follows their role in that event
   (organizer, pilot, observer, retriever). Role is always shown as a badge next to the event, never as a profile label
   (platform admin appears only inside the admin area).

Avoid: gradients, glassmorphism, neon, heavy shadows, oversized rounded cards everywhere, decorative charts,
constant animation.

## 2. Color

Tokens are RGB triplets on `--rf-*` (e.g. `--rf-primary: 12 116 105`) so alpha can be applied. On web they are mapped
to Tailwind colors (`bg-surface`, `text-fg-muted`, `text-live` …) in `apps/web/src/index.css`. Theme: system by default,
user override (Light / Dark / System) stored in `localStorage["rf-theme"]` and applied before first paint.

### Semantic roles and measured contrast (WCAG 2.x, output of `build.mjs`)

| Role | Light | Dark | Check | Light | Dark |
|---|---|---|---|---|---|
| background | `#F3F7F8` | `#101923` | textPrimary on background | 16.43 | 16.43 |
| surface | `#FFFFFF` | `#1B2835` | textPrimary on surface | 17.72 | 13.89 |
| surfaceElevated | `#FFFFFF` | `#243444` | textMuted on surfaceElevated | 5.61 | 4.78 |
| textSecondary | `#3B4E5F` | `#B6C5D1` | on surface | 8.60 | 8.49 |
| textMuted | `#566A7B` | `#8EA1B1` | on surface | 5.61 | 5.62 |
| primary (Aero teal) | `#0C7469` | `#36D6C4` | on surface / onPrimary on primary | 5.65 / 5.65 | 8.26 / 10.23 |
| secondary (sky) | `#2B6894` | `#82BFE8` | on surface | 5.98 | 7.54 |
| success | `#1C7A43` | `#5BD88A` | on surface | 5.37 | 8.30 |
| warning | `#8F5500` | `#F5B94A` | on surface | 6.06 | 8.51 |
| error | `#BE2B36` | `#F06464` | on surface | 5.85 | 4.79 |
| emergency (fill) | `#B3202C` | `#D92D3A` | onEmergency (white) on emergency | 6.65 | 4.79 |
| emergencyText | `#B3202C` | `#FF8A8A` | on surface | 6.65 | 6.60 |
| retrieval (pickup requests) | `#7440A8` | `#C7A4F5` | on surface / surfaceElevated / background (≥ 3) | 6.90 / 6.90 / 6.40 | 7.18 / 6.10 / 8.48 |
| trackingActive (live) | `#0C7469` | `#36D6C4` | on surface (≥ 3, non-text) | 5.65 | 8.26 |
| trackingStale | `#8F5500` | `#F5B94A` | on surface (≥ 3) | 6.06 | 8.51 |
| offline (lost) | `#566A7B` | `#8EA1B1` | on surface (≥ 3) | 5.61 | 5.62 |
| border (hairline) | `#D3DDE3` | `#34495C` | on surface (≥ 1.3, decorative) | 1.38 | 1.61 |
| focusRing | `#2B6894` | `#82BFE8` | on surface (≥ 3) | 5.98 | 7.54 |

All text pairs meet AA 4.5:1; state glyphs and focus rings meet 3:1. Primary teal is never used to mean "safe".

`retrieval` (added 2026-11-05, additive — iOS gets `AeroTokens.retrieval`) is the hue of open pickup requests. It exists
so a waiting pilot never shares amber with "stale" signal on the map. `emergency*` tokens stay in the token set for
compatibility but the web UI no longer uses them (there is no SOS in the product, ADR-012); generic errors use `error`.

## 3. Typography

Inter (variable, self-hosted via `@fontsource-variable/inter`) for UI; JetBrains Mono for telemetry
(`.telemetry` utility = mono + `tabular-nums slashed-zero`). All numbers in tables, counters and timers use
`font-variant-numeric: tabular-nums` (`.tnum`) so digits don't jitter as they tick. iOS: SF Pro / SF Mono with the same
scale.

| Token | Size / line (px) | Use |
|---|---|---|
| caption | 12 / 16 | labels under values, badges, axis ticks |
| footnote | 13 / 18 | secondary text, table cells |
| body | 15 / 22 | default text |
| callout | 16 / 22 | lead paragraphs |
| headline | 17 / 24 | row titles, panel values |
| title3 | 20 / 26 | metric values in detail panes |
| title2 | 24 / 30 | page titles |
| title1 | 30 / 36 | hero numbers (position age) |
| display | 40 / 44 | landing headline |
| instrument | 56 / 60 | single primary instrument reading (iOS flight screen) |

Section labels: footnote, semibold, uppercase, wide tracking, `textSecondary`.

## 4. Space, shape, elevation

- Spacing scale: **4 / 8 / 12 / 16 / 24 / 32** px. Page gutters 16 (mobile) → 32 (desktop).
- Radius: sm 8 (inputs, chips, buttons), md 12, lg 16 (panels), xl 20 (dialogs, bottom sheet). Badges use 6.
- Borders: 1 px hairline `border` token. Panels are separated by hairlines, not shadows.
- Elevation: only floating layers (dialogs, menus, map overlays) get a single soft shadow; nothing else.
- Controls: **48 px** default height, **56 px** large/primary (e.g. "Kabul et" on the retriever page), minimum touch target 44 px.
- Focus: 2 px `focusRing` outline, 2 px offset, on every interactive element (`:focus-visible`).

## 5. Components (web: `apps/web/src/components`, shadcn/ui restyled)

| Component | Notes |
|---|---|
| Button | variants `default` (primary fill), `emergency` (unused by web since ADR-012), `outline`, `secondary`, `ghost`, `destructive` (outline red, for irreversible non-emergency actions), `link`. Sizes 48/56/36 px. Always `type="button"` unless submitting. |
| Input / Textarea / Select | 48 px, hairline border, focus ring, `aria-invalid` → error border; field error text below in `error` color. |
| Switch / Checkbox | 24×40 / 20 px; labels are clickable. Settings toggles are rows: label + hint + switch. |
| Badge | 6 px radius, hairline + 10 % tint; variants `primary secondary retrieval success warning error muted sim`. Role badges (`RoleBadge`) and retrieval/application status badges always carry an icon. |
| RoleChooser | Segmented native radio group (pilot / observer / retriever). Used when an organizer approves an application (no default — the organizer must choose) and when adding members. |
| Retrieval card | Pilot, SIM, status icon, age phrase ("12 dk bekliyor"), retriever + distance, note. Waiting ≥ 15 min adds a "uzun bekleme" chip with an hourglass (text, not just a warning border). |
| Panel | Section with optional uppercase title bar; hairline border, radius 16. |
| Stat / Counter | caption label + mono value; counters grouped in a hairline grid (1 px gap on `border` background). |
| EmptyState / ErrorState / Loading | Dashed-border empty box with a plain sentence; error box shows message + `status · code · X-Request-Id`; loading is a quiet inline spinner + text. |
| Dialog / Sheet | Radix-based; radius 20; close button labelled "Kapat". Destructive confirmations always use a dialog. |
| Map | MapLibre GL + OpenFreeMap `liberty` (light) / `dark` style, switched with the theme. Data drawn as GeoJSON sources + circle/symbol/line layers (no DOM markers). |

## 6. States — "never color alone"

### Signal freshness (recording flights only)

| State | Icon | Label (TR / EN) | Color | Map marker |
|---|---|---|---|---|
| live (< 30 s) | filled dot / filled chevron | **Canlı** / Live | trackingActive | solid chevron rotated to course |
| stale (30 s – 5 min) | clock | **Gecikmeli** / Stale | trackingStale | **hollow** chevron + label "Gecikmeli 1 dk 20 sn" |
| lost (> 5 min) | signal-off | **Sinyal yok** / Lost | offline | **dashed** chevron/ring + age in label |
| landed (flight ended) | plane-landing | **İndi** / Landed | textSecondary | small neutral solid dot (freshness styling never applies to ended flights) |
| offline (client) | cloud-off | **Çevrimdışı** / Offline | offline | — |
| simulated | flask | **SIM** (mono, sky outline) | secondary | "SIM" appended to label |

### Retrieval

| Status | Icon | Label (TR / EN) | Color | Map |
|---|---|---|---|---|
| requested | map-pin | **Alım bekliyor** / Requested | retrieval | **filled** teardrop pin at the pickup point, label "Ad · Alım bekliyor 12 dk" |
| accepted | car | **Kabul edildi** / Accepted | secondary | **hollow** pin + dashed line retriever → pilot |
| picked up | user-check | **Alındı** / Picked up | primary | pin removed; only the retriever vehicle remains |
| delivered | check-circle | **Teslim edildi** / Delivered | success | — (board column, last 2 h) |
| cancelled | circle-slash | **İptal** / Cancelled | muted | — |

Other map shapes: pilot's latest on-ground position inside a retrieval = small ringed dot in `retrieval`;
retriever = **rounded square** in `secondary` (solid/hollow/dashed by position age, inner arrow when moving) — a
different shape from the pilot chevron so the two never get confused in grayscale.

### Roles and applications

Role badges: organizer (shield, primary), pilot (navigation arrow, neutral), observer (eye, sky), retriever (car,
retrieval). Application: pending (hourglass, warning), approved (check, success), rejected (x-circle, error), withdrawn
(circle-slash, muted).

Rules:
- Freshness is computed client-side from the server's `age_s` / `received_at` (clock-offset corrected) and ticks every
  second; the thresholds come from `tokens.json → freshness` and the API contract.
- Marker shape changes with state (solid → hollow → dashed; chevron vs pin vs square) so state survives grayscale.
- The position age is always visible next to the value it qualifies (list row, map label for non-live, detail pane).
  Retrieval ages are phrased per status ("12 dk bekliyor", "kabul edileli 4 dk", "teslim 14:32").
- Vertical speed is derived from the trail and always labelled "tahmini" (estimate). Altitude is always "GPS irtifa".
- Retrieval screens say plainly that Retfast is not an emergency service ("acil durumda 112'yi arayın").
- Phone numbers appear only where the API returns them (organizers; the retriever holding the retrieval) and are
  `tel:` links; otherwise the UI says "Telefon görünmüyor" instead of hiding the row.

## 7. Motion

Durations `fast 120 ms`, `base 200 ms`, `slow 320 ms`, easing `cubic-bezier(0.2, 0, 0, 1)`. Map follow uses a 400 ms
ease; "Ortala" a 600 ms fly. With `prefers-reduced-motion: reduce` all CSS transitions collapse and map moves jump.

## 8. Voice & language

Turkish first (default `tr`), English available (`en`), typed dictionaries (`apps/web/src/lib/i18n`). Sentences are
short and literal; units always shown (m, km/h, m/s, ±m). Times are local, 24 h. Never use exclamation marks in
safety copy.
