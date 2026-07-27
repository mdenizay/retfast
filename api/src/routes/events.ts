import { randomUUID } from "node:crypto";

import { Router } from "express";
import { z } from "zod";

import { requireEventOperator } from "../access.js";
import { config } from "../config.js";
import { pool, inTransaction } from "../db/pool.js";
import { eventInputSchema, eventRoleSchema, eventStatusSchema, eventVisibilitySchema } from "../domain.js";
import { ApiError } from "../http/error.js";

export const eventsRouter = Router();

function slugify(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const eventSelection = `
  e.id, e.slug, e.name, e.description, e.venue,
  e.starts_at AS "startsAt", e.ends_at AS "endsAt", e.timezone,
  e.visibility, e.status, e.manager_user_id AS "managerUserId",
  e.created_by AS "createdBy", e.created_at AS "createdAt",
  e.updated_at AS "updatedAt",
  COALESCE((SELECT count(*)::int FROM event_memberships c
    WHERE c.event_id = e.id AND c.status = 'approved'), 0) AS "participantCount",
  em.role AS "membershipRole", em.status AS "membershipStatus"`;

eventsRouter.get("/", async (request, response) => {
  const result = await pool.query(
    `SELECT ${eventSelection}
       FROM events e
       JOIN users actor ON actor.id = $1
       LEFT JOIN event_memberships em ON em.event_id = e.id AND em.user_id = $1
      WHERE actor.global_role = 'superadmin'
         OR em.user_id IS NOT NULL
         OR (e.visibility = 'public' AND e.status IN ('published', 'active', 'completed'))
      ORDER BY e.starts_at DESC`,
    [request.auth.uid],
  );
  response.json({ data: { events: result.rows } });
});

eventsRouter.post("/", async (request, response) => {
  const email = request.auth.email?.toLowerCase() ?? "";
  if (!config.superadminEmails.has(email)) {
    throw new ApiError(403, "superadmin_required", "Superadmin access is required.");
  }
  const input = eventInputSchema.parse(request.body);
  const eventId = randomUUID();
  await inTransaction(async (client) => {
    let managerId = request.auth.uid;
    if (input.managerEmail) {
      const manager = await client.query<{ id: string }>(
        "SELECT id FROM users WHERE lower(email) = lower($1)",
        [input.managerEmail],
      );
      if (!manager.rows[0]) {
        throw new ApiError(404, "manager_not_found", "The manager must sign in to RETFAST first.");
      }
      managerId = manager.rows[0].id;
    }
    const slug = `${slugify(input.name)}-${eventId.slice(0, 6)}`;
    await client.query(
      `INSERT INTO events
        (id, slug, name, description, venue, starts_at, ends_at, timezone,
         visibility, status, manager_user_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [eventId, slug, input.name, input.description, input.venue, input.startsAt,
        input.endsAt, input.timezone, input.visibility, input.status, managerId,
        request.auth.uid],
    );
    const managers = new Set([request.auth.uid, managerId]);
    for (const userId of managers) {
      await client.query(
        `INSERT INTO event_memberships (event_id, user_id, role, status, reviewed_by)
         VALUES ($1,$2,'manager','approved',$3)`,
        [eventId, userId, request.auth.uid],
      );
    }
    await client.query(
      "INSERT INTO audit_logs (event_id, actor_id, action, target_id) VALUES ($1,$2,'event.created',$1)",
      [eventId, request.auth.uid],
    );
  });
  response.status(201).json({ data: { eventId } });
});

eventsRouter.get("/:eventId", async (request, response) => {
  const result = await pool.query(
    `SELECT ${eventSelection}
       FROM events e
       JOIN users actor ON actor.id = $1
       LEFT JOIN event_memberships em ON em.event_id = e.id AND em.user_id = $1
      WHERE (e.id = $2 OR e.slug = $2)
        AND (actor.global_role = 'superadmin' OR em.user_id IS NOT NULL
          OR (e.visibility <> 'private' AND e.status <> 'draft'))`,
    [request.auth.uid, request.params.eventId],
  );
  if (!result.rows[0]) throw new ApiError(404, "event_not_found", "Event not found.");
  response.json({ data: { event: result.rows[0] } });
});

eventsRouter.patch("/:eventId", async (request, response) => {
  const eventId = String(request.params.eventId);
  await requireEventOperator(pool, request.auth, eventId);
  const input = z.object({
    name: z.string().trim().min(3).max(100).optional(),
    description: z.string().trim().max(1200).optional(),
    venue: z.string().trim().min(2).max(120).optional(),
    startsAt: z.iso.datetime({ offset: true }).optional(),
    endsAt: z.iso.datetime({ offset: true }).optional(),
    timezone: z.string().trim().min(3).max(64).optional(),
    visibility: eventVisibilitySchema.optional(),
    status: eventStatusSchema.optional(),
  }).parse(request.body);
  const fields: string[] = [];
  const values: unknown[] = [];
  const columns: Record<string, string> = {
    name: "name", description: "description", venue: "venue", startsAt: "starts_at",
    endsAt: "ends_at", timezone: "timezone", visibility: "visibility", status: "status",
  };
  for (const [key, column] of Object.entries(columns)) {
    const value = input[key as keyof typeof input];
    if (value === undefined) continue;
    values.push(value);
    fields.push(`${column} = $${values.length}`);
  }
  if (fields.length) {
    values.push(eventId);
    await pool.query(
      `UPDATE events SET ${fields.join(", ")}, updated_at = now() WHERE id = $${values.length}`,
      values,
    );
  }
  response.json({ data: { eventId } });
});

eventsRouter.post("/:eventId/applications", async (request, response) => {
  const eventId = String(request.params.eventId);
  const result = await pool.query(
    `INSERT INTO event_memberships (event_id, user_id, role, status)
     SELECT id, $2, NULL, 'pending' FROM events
      WHERE id = $1 AND visibility = 'public' AND status IN ('published','active')
     ON CONFLICT (event_id, user_id) DO UPDATE
       SET role = NULL, status = 'pending', updated_at = now()
       WHERE event_memberships.status IN ('rejected')
     RETURNING event_id`,
    [eventId, request.auth.uid],
  );
  if (!result.rows[0]) {
    throw new ApiError(409, "application_unavailable", "This event is not accepting applications.");
  }
  response.status(201).json({ data: { eventId } });
});

eventsRouter.get("/:eventId/members", async (request, response) => {
  const eventId = String(request.params.eventId);
  await requireEventOperator(pool, request.auth, eventId);
  const result = await pool.query(
    `SELECT em.event_id AS "eventId", em.user_id AS "userId", u.email,
       u.display_name AS "displayName", u.radio_callsign AS "radioCallsign",
       em.role, em.status, em.created_at AS "requestedAt"
     FROM event_memberships em JOIN users u ON u.id = em.user_id
     WHERE em.event_id = $1 ORDER BY em.created_at DESC`,
    [eventId],
  );
  response.json({ data: { members: result.rows } });
});

eventsRouter.post("/:eventId/members", async (request, response) => {
  const eventId = String(request.params.eventId);
  await requireEventOperator(pool, request.auth, eventId);
  const input = z.object({ email: z.email(), role: eventRoleSchema }).parse(request.body);
  const user = await pool.query<{ id: string }>(
    "SELECT id FROM users WHERE lower(email) = lower($1)", [input.email],
  );
  if (!user.rows[0]) throw new ApiError(404, "user_not_found", "The user must sign in first.");
  await pool.query(
    `INSERT INTO event_memberships (event_id,user_id,role,status,invited_by,reviewed_by)
     VALUES ($1,$2,$3,'approved',$4,$4)
     ON CONFLICT (event_id,user_id) DO UPDATE SET role=$3,status='approved',reviewed_by=$4,updated_at=now()`,
    [eventId, user.rows[0].id, input.role, request.auth.uid],
  );
  response.status(201).json({ data: { userId: user.rows[0].id } });
});

eventsRouter.patch("/:eventId/members/:userId", async (request, response) => {
  const eventId = String(request.params.eventId);
  await requireEventOperator(pool, request.auth, eventId);
  const input = z.object({
    decision: z.enum(["approved", "rejected"]),
    role: eventRoleSchema.exclude(["manager"]).optional(),
  }).refine((value) => value.decision !== "approved" || value.role !== undefined, {
    path: ["role"], message: "Role is required when approving.",
  }).parse(request.body);
  const result = await pool.query(
    `UPDATE event_memberships SET status=$1, role=$2, reviewed_by=$3, updated_at=now()
     WHERE event_id=$4 AND user_id=$5 AND role IS DISTINCT FROM 'manager'
     RETURNING user_id`,
    [input.decision, input.decision === "approved" ? input.role : null,
      request.auth.uid, eventId, request.params.userId],
  );
  if (!result.rows[0]) throw new ApiError(404, "membership_not_found", "Membership not found.");
  response.json({ data: { userId: request.params.userId, status: input.decision } });
});
