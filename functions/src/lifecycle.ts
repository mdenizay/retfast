import type { EventStatus } from "./domain.js";

export type LifecycleTransition = "activate" | "complete";

export function nextLifecycleStatus(
  current: EventStatus,
  startsAt: Date,
  endsAt: Date,
  now: Date,
): EventStatus {
  if (current === "draft" || current === "cancelled") {
    return current;
  }
  if (now.getTime() >= endsAt.getTime()) {
    return "completed";
  }
  if (now.getTime() >= startsAt.getTime()) {
    return "active";
  }
  return "published";
}
