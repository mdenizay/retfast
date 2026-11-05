/**
 * Event-scoped permissions derived from `event.me` (api-contract "Roles and the event workflow").
 * These only decide what the UI offers; the API remains the security boundary.
 */
import type { Me, MemberRole, RfEvent } from "@/lib/api/types";
import { isAdmin } from "@/lib/auth";

export type EventBadgeRole = "organizer" | MemberRole;

export interface EventAccess {
  admin: boolean;
  organizer: boolean;
  role: MemberRole | null;
  /** Organizer or platform admin: settings, applications, members, assign/cancel retrievals. */
  canManage: boolean;
  /** Live operations room (all pilots + retrieval board). */
  canOperate: boolean;
  /** Pilots get the live map with what the API returns for them (own flight; others if pilots_see_each_other). */
  canSeePilotMap: boolean;
  isRetriever: boolean;
  isMember: boolean;
}

export function eventAccess(event: RfEvent | null | undefined, user: Me | null | undefined): EventAccess {
  const admin = isAdmin(user);
  const organizer = Boolean(event?.me?.is_organizer);
  const role = event?.me?.role ?? null;
  const canManage = organizer || admin;
  return {
    admin,
    organizer,
    role,
    canManage,
    canOperate: canManage || role === "observer",
    canSeePilotMap: role === "pilot",
    isRetriever: role === "retriever",
    isMember: organizer || role !== null,
  };
}

/** Badges to show for "my role" in an event, organizer first. */
export function myEventRoles(event: RfEvent): EventBadgeRole[] {
  const out: EventBadgeRole[] = [];
  if (event.me?.is_organizer) out.push("organizer");
  if (event.me?.role) out.push(event.me.role);
  return out;
}
