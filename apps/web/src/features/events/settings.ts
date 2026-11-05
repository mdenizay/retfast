import type { EventSettings } from "@/lib/api/types";
import type { MessageKey } from "@/lib/i18n";

export const DEFAULT_SETTINGS: EventSettings = {
  applications_open: true,
  live_tracking: true,
  public_live_map: false,
  pilots_see_each_other: true,
  landing_prompt: true,
};

export const SETTING_LABELS: { key: keyof EventSettings; label: MessageKey; hint: MessageKey }[] = [
  { key: "applications_open", label: "evset.applications_open", hint: "evset.applications_open.hint" },
  { key: "live_tracking", label: "evset.live_tracking", hint: "evset.live_tracking.hint" },
  { key: "public_live_map", label: "evset.public_live_map", hint: "evset.public_live_map.hint" },
  { key: "pilots_see_each_other", label: "evset.pilots_see_each_other", hint: "evset.pilots_see_each_other.hint" },
  { key: "landing_prompt", label: "evset.landing_prompt", hint: "evset.landing_prompt.hint" },
];
