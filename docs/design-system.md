# RETFAST visual system

RETFAST uses one operational design language on web, iOS and Android. Version
2.0 rebuilds the product around role-specific mission workspaces instead of
generic pages and card stacks. The system is derived from dispatch consoles:
live context stays visible, selected work moves into a focused detail surface,
and the next safe action remains within immediate reach.

## Information architecture

- **Web:** a persistent navigation rail, global command bar, event workspaces,
  and a roster + map operations console. Lists provide selection context while
  drawers hold detail and dispatch actions.
- **Pilot:** mission header, live-state indicator, glanceable telemetry and a
  docked action surface. Safety controls never compete with routine actions.
- **Retriever:** map-led dispatch view, persistent duty/capacity state,
  expiring offers and assignment progress presented as one workflow.

## Foundation

- **Graphite `#0D0E10`** — application and map-chrome background.
- **Surface `#1B1B19`** / **raised surface `#25241F`** — cards, sheets and
  grouped controls.
- **Amber `#F3A712`** — primary action, live/route emphasis and brand mark.
- **Warm ivory `#FFF4D6`** — primary text and icon detail.
- Red and green are reserved for emergency/error and confirmed success states.

## Components

- Cards use 16–20 px/pt corners, a quiet warm border and restrained shadow.
- Primary buttons are amber with graphite content; secondary buttons are
  raised graphite with an amber-tinted outline. Primary mobile actions retain
  the existing glove-safe 52–60 px/pt hit targets.
- Map controls use compact circular or rounded graphite glass surfaces.
- Telemetry uses compact uppercase labels and high-contrast numeric readouts.
- RETFAST wordmarks are heavy and tightly tracked. Small operational kickers
  use uppercase lettering with wide tracking.
- Navigation and selection use spatial continuity: rail → workspace → live
  console on web, event → role mission → active task on mobile.

## App icon

The shared icon is a single white navigation arrow on a pure black field. The
same master is used by iOS, Android and the web install icon; platforms apply
their own required mask.

## Version policy

Public releases share a semantic `major.minor.patch` version across web,
Android and iOS. Native build numbers (`versionCode` and
`CURRENT_PROJECT_VERSION`) increase monotonically on every uploaded artifact,
including retries, so store uploads cannot collide.
