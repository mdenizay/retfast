# RETFAST 2.0 product UX

## System audit

RETFAST has three distinct operating contexts sharing one backend:

1. Observers and administrators coordinate events from the web.
2. Pilots need an outdoor, one-handed flight and safety interface.
3. Retrievers need a driving-oriented offer and assignment workflow.

The earlier UI exposed these capabilities, but treated most surfaces as generic
pages, tabs, forms and card stacks. Navigation consumed context, live state was
spread across multiple components, and the relationship between a selected
person, the map and the available action was not always spatially obvious.

## 2.0 interaction model

The redesign uses a consistent four-layer model:

1. **Global context** — product, account, language and system health.
2. **Mission context** — event, role, date range and live state.
3. **Operational focus** — roster/list beside the map or current task details.
4. **Safe next action** — dispatch, flight transition, retrieval step or SOS.

This ordering applies on every platform even though the layouts differ.

## Web

- The horizontal site header becomes a persistent compact navigation rail.
- A command bar keeps search, account and system state available without
  competing with event content.
- Events open as mission workspaces rather than conventional detail pages.
- The operations console follows a dispatcher layout: persistent live roster,
  large map, compact global metrics and contextual detail drawers.
- Responsive web replaces the rail with a thumb-reachable bottom dock.

## Pilot

- The screen opens with mission identity and an unambiguous tracking state.
- Telemetry is grouped as a single glanceable instrument cluster.
- Retrieval state is promoted from incidental text into a dedicated status
  surface.
- Task transitions stay docked and glove-safe. SOS remains visually isolated
  and requires two deliberate taps.

## Retriever

- Duty state and vehicle capacity form the persistent operational header.
- Expiring requests are visually separated from accepted assignments.
- Each assignment exposes only the valid next state transitions.
- iOS retains a map-first split view; Android uses the same status hierarchy
  while navigation hands coordinates to the installed maps application.

## Visual language

- Graphite backgrounds keep maps and telemetry visually dominant.
- Amber identifies brand, navigation selection and routine primary actions.
- Green means live/available/confirmed; red is reserved for safety or failure.
- Large 20–28 point corners define work surfaces; compact capsules communicate
  state. Uppercase tracked kickers identify the current operational layer.
- The black app icon with the white navigation arrow remains the shared mark.

## Safety and accessibility constraints

- No tracking, offline sync, assignment or SOS behavior was changed by the UI
  redesign.
- Mobile primary actions retain 52–60 point touch targets.
- Color is paired with labels or icons for operational state.
- Missing/stale telemetry continues to degrade to explicit empty or warning
  states rather than appearing healthy.
