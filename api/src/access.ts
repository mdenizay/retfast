import type pg from "pg";

import { ApiError } from "./http/error.js";

export type Actor = { uid: string; email?: string };

export async function requireEventMembership(
  client: pg.Pool | pg.PoolClient,
  actor: Actor,
  eventId: string,
) {
  const result = await client.query<{
    role: "manager" | "pilot" | "retriever" | "observer";
    status: "pending" | "approved" | "rejected";
    global_role: "user" | "superadmin";
  }>(
    `SELECT em.role, em.status, u.global_role
       FROM users u
       LEFT JOIN event_memberships em
         ON em.user_id = u.id AND em.event_id = $2
      WHERE u.id = $1`,
    [actor.uid, eventId],
  );
  const access = result.rows[0];
  if (!access || (access.global_role !== "superadmin" && access.status !== "approved")) {
    throw new ApiError(403, "event_access_denied", "Approved event membership is required.");
  }
  return access;
}

export async function requireEventOperator(
  client: pg.Pool | pg.PoolClient,
  actor: Actor,
  eventId: string,
) {
  const access = await requireEventMembership(client, actor, eventId);
  if (access.global_role !== "superadmin" && access.role !== "manager") {
    throw new ApiError(403, "operator_required", "Event manager access is required.");
  }
  return access;
}
