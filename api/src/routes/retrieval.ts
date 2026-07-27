import { randomUUID } from "node:crypto";

import { Router } from "express";
import { z } from "zod";

import { requireEventMembership, requireEventOperator } from "../access.js";
import { inTransaction, pool } from "../db/pool.js";
import { ApiError } from "../http/error.js";
import { publishEvent } from "../realtime/hub.js";
import { sendPushToUser } from "../services/push.js";

export const retrievalRouter = Router();

const urgencySchema = z.enum(["normal", "emergency"]);
const availabilitySchema = z.enum(["available", "busy", "inactive"]);

async function expireOffers(eventId?: string) {
  const result = await pool.query<{ id: string; event_id: string }>(
    `UPDATE retrieval_jobs SET status='searching',offered_retriever_id=NULL,
      offered_retriever_name=NULL,offer_expires_at=NULL,version=version+1,updated_at=now()
     WHERE status='offered' AND offer_expires_at <= now()
       AND ($1::text IS NULL OR event_id=$1)
     RETURNING id,event_id`, [eventId ?? null],
  );
  for (const job of result.rows) publishEvent(job.event_id, "retrieval.updated", { jobId: job.id });
  return result.rowCount ?? 0;
}

export function startRetrievalMaintenance() {
  const timer = setInterval(() => void expireOffers().catch(console.error), 15_000);
  timer.unref();
  return () => clearInterval(timer);
}

retrievalRouter.put("/events/:eventId/retrievers/me", async (request, response) => {
  const eventId = String(request.params.eventId);
  const access = await requireEventMembership(pool, request.auth, eventId);
  if (access.role !== "retriever") throw new ApiError(403, "retriever_required", "Retriever role is required.");
  const input = z.object({ capacity: z.number().int().min(1).max(20), availability: availabilitySchema })
    .parse(request.body);
  const result = await pool.query(
    `INSERT INTO retriever_states(event_id,user_id,capacity,availability)
     VALUES($1,$2,$3,$4)
     ON CONFLICT(event_id,user_id) DO UPDATE SET capacity=$3,availability=$4,updated_at=now()
       WHERE retriever_states.assigned_count <= $3
     RETURNING event_id AS "eventId",user_id AS "userId",capacity,assigned_count AS "assignedCount",availability`,
    [eventId, request.auth.uid, input.capacity, input.availability],
  );
  if (!result.rows[0]) throw new ApiError(409, "capacity_below_assignments", "Capacity cannot be below assigned passengers.");
  publishEvent(eventId, "retriever.updated", result.rows[0]);
  response.json({ data: { retriever: result.rows[0] } });
});

retrievalRouter.get("/events/:eventId/retrieval", async (request, response) => {
  const eventId = String(request.params.eventId);
  await requireEventMembership(pool, request.auth, eventId);
  await expireOffers(eventId);
  const [jobs, retrievers] = await Promise.all([
    pool.query(
      `SELECT j.id,j.event_id AS "eventId",j.session_id AS "sessionId",j.pilot_id AS "pilotId",
       j.pilot_name AS "pilotName",pilot.radio_callsign AS "pilotRadioCallsign",
       j.urgency,j.status,j.offered_retriever_id AS "offeredRetrieverId",
       offered_retriever_name AS "offeredRetrieverName",assigned_retriever_id AS "assignedRetrieverId",
       assigned_retriever_name AS "assignedRetrieverName",offer_expires_at AS "offerExpiresAt",
       picked_up_at AS "pickedUpAt",delivered_at AS "deliveredAt",j.created_at AS "createdAt",
       j.created_at AS "requestedAt",j.updated_at AS "updatedAt",j.version,
       CASE WHEN ll.user_id IS NULL THEN NULL ELSE json_build_object(
         'latitude',ll.latitude,'longitude',ll.longitude,
         'recordedAt',(extract(epoch from ll.recorded_at)*1000)::bigint) END AS landing
       FROM retrieval_jobs j JOIN users pilot ON pilot.id=j.pilot_id
       LEFT JOIN live_locations ll ON ll.event_id=j.event_id AND ll.user_id=j.pilot_id
       WHERE j.event_id=$1 ORDER BY j.created_at DESC`,
      [eventId],
    ),
    pool.query(
      `SELECT rs.event_id AS "eventId",rs.user_id AS "userId",u.display_name AS "displayName",
       u.radio_callsign AS "radioCallsign",rs.capacity,rs.assigned_count AS "assignedCount",
       rs.availability,rs.updated_at AS "updatedAt"
       FROM retriever_states rs JOIN users u ON u.id=rs.user_id WHERE rs.event_id=$1`, [eventId],
    ),
  ]);
  response.json({ data: { jobs: jobs.rows, retrievers: retrievers.rows } });
});

retrievalRouter.get("/events/:eventId/retrievers/nearby", async (request, response) => {
  const eventId = String(request.params.eventId);
  const { sessionId } = z.object({ sessionId: z.string().min(1) }).parse(request.query);
  const session = await pool.query<{ user_id: string }>(
    "SELECT user_id FROM tracking_sessions WHERE id=$1 AND event_id=$2 AND status='active'",
    [sessionId, eventId],
  );
  if (session.rows[0]?.user_id !== request.auth.uid) {
    throw new ApiError(403, "session_access_denied", "An active pilot session is required.");
  }
  const result = await pool.query(
    `WITH pilot AS (SELECT latitude,longitude FROM live_locations
      WHERE event_id=$1 AND user_id=$2)
     SELECT rs.user_id AS "userId",u.display_name AS "displayName",u.radio_callsign AS "radioCallsign",
       rs.capacity,rs.assigned_count AS "assignedCount",rs.availability,
       ll.latitude,ll.longitude,
       6371 * 2 * asin(sqrt(power(sin(radians(ll.latitude-p.latitude)/2),2) +
       cos(radians(p.latitude))*cos(radians(ll.latitude))*
       power(sin(radians(ll.longitude-p.longitude)/2),2))) AS "distanceKm"
     FROM retriever_states rs
     JOIN users u ON u.id=rs.user_id
     JOIN live_locations ll ON ll.event_id=rs.event_id AND ll.user_id=rs.user_id
     CROSS JOIN pilot p
     WHERE rs.event_id=$1 AND rs.availability='available'
       AND rs.assigned_count < rs.capacity AND ll.online=true
       AND NOT EXISTS (SELECT 1 FROM retrieval_jobs j WHERE j.event_id=$1
         AND j.offered_retriever_id=rs.user_id AND j.status='offered')
     ORDER BY "distanceKm" LIMIT 20`, [eventId, request.auth.uid],
  );
  response.json({ data: { retrievers: result.rows } });
});

retrievalRouter.post("/events/:eventId/retrieval/jobs", async (request, response) => {
  const eventId = String(request.params.eventId);
  const input = z.object({ sessionId: z.string().min(1), retrieverId: z.string().min(1), urgency: urgencySchema })
    .parse(request.body);
  const job = await inTransaction(async (client) => {
    const session = await client.query<{ user_id: string; display_name: string; role: string; status: string }>(
      "SELECT user_id,display_name,role,status FROM tracking_sessions WHERE id=$1 AND event_id=$2 FOR UPDATE",
      [input.sessionId, eventId],
    );
    const pilot = session.rows[0];
    if (!pilot || pilot.user_id !== request.auth.uid || pilot.role !== "pilot" || pilot.status !== "active") {
      throw new ApiError(403, "pilot_session_required", "An active pilot session is required.");
    }
    const state = await client.query<{ capacity: number; assigned_count: number; availability: string; display_name: string }>(
      `SELECT rs.capacity,rs.assigned_count,rs.availability,u.display_name FROM retriever_states rs
       JOIN users u ON u.id=rs.user_id WHERE rs.event_id=$1 AND rs.user_id=$2 FOR UPDATE OF rs`,
      [eventId, input.retrieverId],
    );
    const retriever = state.rows[0];
    if (!retriever || retriever.availability !== "available" || retriever.assigned_count >= retriever.capacity) {
      throw new ApiError(409, "retriever_unavailable", "Retriever is not available.");
    }
    const id = randomUUID();
    try {
      const result = await client.query(
        `INSERT INTO retrieval_jobs
         (id,event_id,session_id,pilot_id,pilot_name,urgency,status,offered_retriever_id,
          offered_retriever_name,offer_expires_at)
         VALUES($1,$2,$3,$4,$5,$6,'offered',$7,$8,now()+interval '45 seconds')
         ON CONFLICT(session_id) DO UPDATE SET urgency=$6,status='offered',
          offered_retriever_id=$7,offered_retriever_name=$8,offer_expires_at=now()+interval '45 seconds',
          version=retrieval_jobs.version+1,updated_at=now()
         RETURNING id,status,offer_expires_at AS "offerExpiresAt"`,
        [id, eventId, input.sessionId, request.auth.uid, pilot.display_name,
          input.urgency, input.retrieverId, retriever.display_name],
      );
      return result.rows[0];
    } catch (error) {
      if (typeof error === "object" && error && "code" in error && error.code === "23505") {
        throw new ApiError(409, "retriever_has_open_offer", "Retriever is responding to another offer.");
      }
      throw error;
    }
  });
  publishEvent(eventId, "retrieval.updated", job);
  await sendPushToUser(input.retrieverId, {
    title: input.urgency === "emergency" ? "RETFAST · Emergency retrieval" : "RETFAST · New pilot request",
    body: "A pilot is waiting for pickup.",
    data: { type: "retrieval-offer", eventId, jobId: String(job.id) },
  });
  response.status(201).json({ data: { job } });
});

retrievalRouter.post("/events/:eventId/retrieval/jobs/:jobId/respond", async (request, response) => {
  const eventId = String(request.params.eventId);
  let { accept } = z.object({ accept: z.boolean() }).parse(request.body);
  const job = await inTransaction(async (client) => {
    const result = await client.query<any>(
      "SELECT * FROM retrieval_jobs WHERE id=$1 AND event_id=$2 FOR UPDATE", [request.params.jobId, eventId],
    );
    const current = result.rows[0];
    if (!current || current.offered_retriever_id !== request.auth.uid || current.status !== "offered") {
      throw new ApiError(409, "offer_unavailable", "This offer is no longer available.");
    }
    if (new Date(current.offer_expires_at).getTime() <= Date.now()) accept = false;
    if (!accept) {
      return (await client.query(
        `UPDATE retrieval_jobs SET status='searching',offered_retriever_id=NULL,
         offered_retriever_name=NULL,offer_expires_at=NULL,version=version+1,updated_at=now()
         WHERE id=$1 RETURNING id,status,pilot_id AS "pilotId"`, [current.id],
      )).rows[0];
    }
    const state = await client.query<any>(
      "SELECT * FROM retriever_states WHERE event_id=$1 AND user_id=$2 FOR UPDATE",
      [eventId, request.auth.uid],
    );
    const retriever = state.rows[0];
    if (!retriever || retriever.assigned_count >= retriever.capacity || retriever.availability === "inactive") {
      throw new ApiError(409, "retriever_capacity_full", "Retriever capacity is full.");
    }
    await client.query(
      `UPDATE retriever_states SET assigned_count=assigned_count+1,
       availability=CASE WHEN assigned_count+1>=capacity THEN 'busy' ELSE availability END,updated_at=now()
       WHERE event_id=$1 AND user_id=$2`, [eventId, request.auth.uid],
    );
    return (await client.query(
      `UPDATE retrieval_jobs SET status='assigned',assigned_retriever_id=$2,
       assigned_retriever_name=offered_retriever_name,offer_expires_at=NULL,
       version=version+1,updated_at=now() WHERE id=$1 RETURNING id,status,pilot_id AS "pilotId",
       assigned_retriever_id AS "assignedRetrieverId",assigned_retriever_name AS "assignedRetrieverName"`,
      [current.id, request.auth.uid],
    )).rows[0];
  });
  publishEvent(eventId, "retrieval.updated", job);
  if (job.pilotId) {
    await sendPushToUser(String(job.pilotId), {
      title: accept ? "RETFAST · Retriever assigned" : "RETFAST · Request declined",
      body: accept
        ? `${job.assignedRetrieverName ?? "Retriever"} accepted your pickup request.`
        : "The retriever could not accept your request. Please select another vehicle.",
      data: { type: accept ? "retrieval-assigned" : "retrieval-declined", eventId, jobId: String(job.id) },
    });
  }
  response.json({ data: { job } });
});

retrievalRouter.post("/events/:eventId/retrieval/jobs/:jobId/progress", async (request, response) => {
  const eventId = String(request.params.eventId);
  const { action } = z.object({ action: z.enum(["picked_up", "delivered", "cancelled"]) }).parse(request.body);
  const job = await inTransaction(async (client) => {
    const result = await client.query<any>("SELECT * FROM retrieval_jobs WHERE id=$1 AND event_id=$2 FOR UPDATE",
      [request.params.jobId, eventId]);
    const current = result.rows[0];
    if (!current) throw new ApiError(404, "job_not_found", "Retrieval job not found.");
    const operator = current.pilot_id === request.auth.uid || current.assigned_retriever_id === request.auth.uid;
    if (!operator) await requireEventOperator(client, request.auth, eventId);
    const allowed: Record<string, string[]> = {
      picked_up: ["assigned"], delivered: ["picked_up"],
      cancelled: ["searching", "offered", "assigned", "picked_up"],
    };
    if (!allowed[action]!.includes(current.status)) {
      throw new ApiError(409, "invalid_retrieval_transition", "Retrieval status transition is invalid.");
    }
    if (["delivered", "cancelled"].includes(action) && current.assigned_retriever_id) {
      await client.query(
        `UPDATE retriever_states SET assigned_count=greatest(assigned_count-1,0),
         availability=CASE WHEN availability='busy' THEN 'available' ELSE availability END,updated_at=now()
         WHERE event_id=$1 AND user_id=$2`, [eventId, current.assigned_retriever_id],
      );
    }
    const timestampColumn = action === "picked_up" ? "picked_up_at" : action === "delivered" ? "delivered_at" : "cancelled_at";
    return (await client.query(
      `UPDATE retrieval_jobs SET status=$1,${timestampColumn}=now(),version=version+1,updated_at=now()
       WHERE id=$2 RETURNING id,status,pilot_id AS "pilotId",
       assigned_retriever_id AS "assignedRetrieverId",updated_at AS "updatedAt"`, [action, current.id],
    )).rows[0];
  });
  publishEvent(eventId, "retrieval.updated", job);
  const progressTarget = job.pilotId === request.auth.uid ? job.assignedRetrieverId : job.pilotId;
  if (progressTarget) {
    await sendPushToUser(String(progressTarget), {
      title: `RETFAST · ${action.replace("_", " ")}`,
      body: "The retrieval status was updated.",
      data: { type: "retrieval-progress", eventId, jobId: String(job.id), status: action },
    });
  }
  response.json({ data: { job } });
});

retrievalRouter.post("/events/:eventId/retrieval/dispatch", async (request, response) => {
  const eventId = String(request.params.eventId);
  await requireEventOperator(pool, request.auth, eventId);
  const input = z.object({
    sessionId: z.string().min(1), retrieverId: z.string().min(1), urgency: urgencySchema.default("normal"),
  }).parse(request.body);
  const job = await inTransaction(async (client) => {
    const session = await client.query<any>(
      "SELECT * FROM tracking_sessions WHERE id=$1 AND event_id=$2 AND role='pilot' FOR UPDATE",
      [input.sessionId, eventId],
    );
    const pilot = session.rows[0];
    if (!pilot) throw new ApiError(404, "pilot_session_not_found", "Pilot session not found.");
    const target = await client.query<any>(
      `SELECT rs.*,u.display_name FROM retriever_states rs JOIN users u ON u.id=rs.user_id
       WHERE rs.event_id=$1 AND rs.user_id=$2 FOR UPDATE OF rs`, [eventId, input.retrieverId],
    );
    const retriever = target.rows[0];
    if (!retriever || retriever.availability === "inactive" || retriever.assigned_count >= retriever.capacity) {
      throw new ApiError(409, "retriever_unavailable", "Retriever is unavailable or full.");
    }
    const current = await client.query<any>(
      "SELECT * FROM retrieval_jobs WHERE session_id=$1 FOR UPDATE", [input.sessionId],
    );
    if (current.rows[0]?.assigned_retriever_id) {
      throw new ApiError(409, "job_already_assigned", "Use transfer for an assigned job.");
    }
    const id = current.rows[0]?.id ?? randomUUID();
    const result = await client.query(
      `INSERT INTO retrieval_jobs
       (id,event_id,session_id,pilot_id,pilot_name,urgency,status,assigned_retriever_id,assigned_retriever_name)
       VALUES($1,$2,$3,$4,$5,$6,'assigned',$7,$8)
       ON CONFLICT(session_id) DO UPDATE SET status='assigned',urgency=$6,
        offered_retriever_id=NULL,offered_retriever_name=NULL,offer_expires_at=NULL,
        assigned_retriever_id=$7,assigned_retriever_name=$8,version=retrieval_jobs.version+1,updated_at=now()
       RETURNING id,status,pilot_id AS "pilotId",assigned_retriever_id AS "assignedRetrieverId"`,
      [id, eventId, input.sessionId, pilot.user_id, pilot.display_name, input.urgency,
        input.retrieverId, retriever.display_name],
    );
    await client.query(
      `UPDATE retriever_states SET assigned_count=assigned_count+1,
       availability=CASE WHEN assigned_count+1>=capacity THEN 'busy' ELSE availability END,updated_at=now()
       WHERE event_id=$1 AND user_id=$2`, [eventId, input.retrieverId],
    );
    return result.rows[0];
  });
  publishEvent(eventId, "retrieval.updated", job);
  await Promise.all([
    sendPushToUser(input.retrieverId, {
      title: "RETFAST · Retrieval assigned",
      body: "An event manager assigned a pilot to your vehicle.",
      data: { type: "retrieval-assigned", eventId, jobId: String(job.id) },
    }),
    job.pilotId ? sendPushToUser(String(job.pilotId), {
      title: "RETFAST · Retriever assigned",
      body: "The event manager assigned a retriever to you.",
      data: { type: "retrieval-assigned", eventId, jobId: String(job.id) },
    }) : Promise.resolve(false),
  ]);
  response.status(201).json({ data: { job } });
});

retrievalRouter.post("/events/:eventId/retrieval/transfers", async (request, response) => {
  const eventId = String(request.params.eventId);
  await requireEventOperator(pool, request.auth, eventId);
  const input = z.object({ jobIds: z.array(z.string().min(1)).min(1).max(50), targetRetrieverId: z.string().min(1) })
    .parse(request.body);
  await inTransaction(async (client) => {
    const target = await client.query<any>(
      "SELECT * FROM retriever_states WHERE event_id=$1 AND user_id=$2 FOR UPDATE",
      [eventId, input.targetRetrieverId],
    );
    const state = target.rows[0];
    if (!state || state.availability === "inactive" || state.capacity-state.assigned_count < input.jobIds.length) {
      throw new ApiError(409, "target_capacity_insufficient", "Target retriever has insufficient capacity.");
    }
    const jobs = await client.query<any>(
      "SELECT * FROM retrieval_jobs WHERE event_id=$1 AND id=ANY($2::text[]) FOR UPDATE",
      [eventId, input.jobIds],
    );
    if (jobs.rows.length !== input.jobIds.length || jobs.rows.some((job: any) => !["assigned", "picked_up"].includes(job.status))) {
      throw new ApiError(409, "jobs_not_transferable", "One or more jobs cannot be transferred.");
    }
    const targetUser = await client.query<{ display_name: string }>("SELECT display_name FROM users WHERE id=$1", [input.targetRetrieverId]);
    for (const job of jobs.rows) {
      if (job.assigned_retriever_id && job.assigned_retriever_id !== input.targetRetrieverId) {
        await client.query(
          `UPDATE retriever_states SET assigned_count=greatest(assigned_count-1,0),
           availability=CASE WHEN availability='busy' THEN 'available' ELSE availability END,updated_at=now()
           WHERE event_id=$1 AND user_id=$2`, [eventId, job.assigned_retriever_id],
        );
      }
    }
    await client.query(
      `UPDATE retriever_states SET assigned_count=assigned_count+$1,
       availability=CASE WHEN assigned_count+$1>=capacity THEN 'busy' ELSE availability END,updated_at=now()
       WHERE event_id=$2 AND user_id=$3`, [jobs.rows.filter((j: any) => j.assigned_retriever_id !== input.targetRetrieverId).length,
        eventId, input.targetRetrieverId],
    );
    await client.query(
      `UPDATE retrieval_jobs SET assigned_retriever_id=$1,assigned_retriever_name=$2,
       version=version+1,updated_at=now() WHERE event_id=$3 AND id=ANY($4::text[])`,
      [input.targetRetrieverId, targetUser.rows[0]?.display_name, eventId, input.jobIds],
    );
  });
  publishEvent(eventId, "retrieval.transferred", input);
  response.json({ data: { transferred: input.jobIds.length } });
});
