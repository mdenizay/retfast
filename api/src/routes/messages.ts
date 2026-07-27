import { randomUUID } from "node:crypto";

import { Router } from "express";
import { z } from "zod";

import { requireEventMembership } from "../access.js";
import { pool } from "../db/pool.js";
import { ApiError } from "../http/error.js";
import { publishEvent } from "../realtime/hub.js";

export const messagesRouter = Router();

messagesRouter.get("/events/:eventId/messages", async (request, response) => {
  const eventId = String(request.params.eventId);
  await requireEventMembership(pool, request.auth, eventId);
  const { before, limit } = z.object({
    before: z.iso.datetime({ offset: true }).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }).parse(request.query);
  const result = await pool.query(
    `SELECT m.id,m.event_id AS "eventId",m.sender_id AS "senderId",
      sender.display_name AS "senderName",m.recipient_id AS "recipientId",m.body,
      m.created_at AS "createdAt",m.edited_at AS "editedAt"
     FROM messages m JOIN users sender ON sender.id=m.sender_id
     WHERE m.event_id=$1 AND m.deleted_at IS NULL
       AND (m.recipient_id IS NULL OR m.recipient_id=$2 OR m.sender_id=$2)
       AND ($3::timestamptz IS NULL OR m.created_at<$3)
     ORDER BY m.created_at DESC LIMIT $4`,
    [eventId, request.auth.uid, before ?? null, limit],
  );
  response.json({ data: { messages: result.rows.reverse() } });
});

messagesRouter.post("/events/:eventId/messages", async (request, response) => {
  const eventId = String(request.params.eventId);
  await requireEventMembership(pool, request.auth, eventId);
  const input = z.object({
    recipientId: z.string().min(1).nullable().default(null),
    body: z.string().trim().min(1).max(2000),
  }).parse(request.body);
  if (input.recipientId) {
    const recipient = await pool.query(
      "SELECT 1 FROM event_memberships WHERE event_id=$1 AND user_id=$2 AND status='approved'",
      [eventId, input.recipientId],
    );
    if (!recipient.rows[0]) throw new ApiError(404, "recipient_not_found", "Recipient is not an event member.");
  }
  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO messages(id,event_id,sender_id,recipient_id,body)
     VALUES($1,$2,$3,$4,$5)
     RETURNING id,event_id AS "eventId",sender_id AS "senderId",
       recipient_id AS "recipientId",body,created_at AS "createdAt"`,
    [id, eventId, request.auth.uid, input.recipientId, input.body],
  );
  publishEvent(eventId, "message.created", result.rows[0]);
  response.status(201).json({ data: { message: result.rows[0] } });
});
