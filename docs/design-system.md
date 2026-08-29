# RETFAST visual system

RETFAST uses one operational design language on web, iOS and Android. It is
derived from dark map consoles and high-contrast mobile mission controls: the
map/data stays visually dominant while controls remain obvious outdoors.

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

## App icon

The shared icon combines a paraglider canopy, a live signal and a location pin.
The exact same raster master is used by iOS, Android and the web install icon;
platforms apply their own required mask.

## Version policy

Public releases share a semantic `major.minor.patch` version across web,
Android and iOS. Native build numbers (`versionCode` and
`CURRENT_PROJECT_VERSION`) increase monotonically on every uploaded artifact,
including retries, so store uploads cannot collide.
