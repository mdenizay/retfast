export const lightPalette = {
  background: "#F3F7F4",
  surface: "#FFFFFF",
  surfaceSoft: "#F7FAF8",
  text: "#17312C",
  muted: "#6C817B",
  faint: "#94A69F",
  line: "#DFE8E4",
  primary: "#146C5C",
  primaryStrong: "#0B5649",
  primarySoft: "#E3F3EE",
  lime: "#DFF59B",
  danger: "#B83E46",
  dangerSoft: "#FFF0F1",
  success: "#23755C",
  successSoft: "#EAF7F2",
  white: "#FFFFFF",
};

export const darkPalette: typeof lightPalette = {
  background: "#0D1715",
  surface: "#14211E",
  surfaceSoft: "#192824",
  text: "#EDF5F2",
  muted: "#9CB0AA",
  faint: "#758B84",
  line: "#2A3B36",
  primary: "#54BDA2",
  primaryStrong: "#71D1B8",
  primarySoft: "#183B32",
  lime: "#DFF59B",
  danger: "#FF8C93",
  dangerSoft: "#3B2225",
  success: "#6BD0AD",
  successSoft: "#19382F",
  white: "#FFFFFF",
};

export type Palette = typeof lightPalette;
