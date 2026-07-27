import { randomUUID } from "node:crypto";

import { Router } from "express";
import { z } from "zod";

import { requireEventMembership, requireEventOperator } from "../access.js";
import { pool, inTransaction } from "../db/pool.js";
import { trackPointSchema, trackingStatusSchema, type TrackPoint } from "../domain.js";
import { ApiError } from "../http/error.js";
import { publishEvent } from "../realtime/hub.js";

export const trackingRouter = Router();

const liveSelection = `event_id AS "eventId", user_id AS "userId",
  session_id AS "sessionId", role, display_name AS "displayName",
  radio_callsign AS "radioCallsign", latitude, longitude, accuracy, altitude,
  speed, heading, battery_level AS "batteryLevel", is_charging AS "isCharging",
  connectivity, (extract(epoch from recorded_at) * 1000)::bigint AS "recordedAt",
  (extract(epoch from received_at) * 1000)::bigint AS "receivedAt", online,
  (extract(epoch from last_disconnected_at) * 1000)::bigint AS "lastDisconnectedAt"`;

trackingRouter.post("/events/:eventId/tracking/sessions", async (request, response) => {
  const eventId = String(request.params.eventId);
  const { deviceId } = z.object({ deviceId: z.string().trim().min(8).max(128) })
    .parse(request.body);
  const access = await requireEventMembership(pool, request.auth, eventId);
  if (access.role !== "pilot" && access.role !== "retriever") {
    throw new ApiError(409, "tracking_role_required", "Pilot or retriever role is required.");
  }
  const result = await inTransaction(async (client) => {
    const existing = await client.query<{ id: string }>(
      "SELECT id FROM tracking_sessions WHERE event_id=$1 AND user_id=$2 AND status='active' FOR UPDATE",
      [eventId, request.auth.uid],
    );
    if (existing.rows[0]) return { sessionId: existing.rows[0].id, resumed: true };
    const event = await client.query("SELECT status FROM events WHERE id=$1 FOR SHARE", [eventId]);
    if (!event.rows[0] || !["published", "active"].includes(event.rows[0].status)) {
      throw new ApiError(409, "tracking_unavailable", "Tracking is not available for this event.");
    }
    const user = await client.query<{ display_name: string; radio_callsign: string | null }>(
      "SELECT display_name, radio_callsign FROM users WHERE id=$1", [request.auth.uid],
    );
    const sessionId = randomUUID();
    await client.query(
      `INSERT INTO tracking_sessions
       (id,event_id,user_id,role,display_name,radio_callsign,device_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [sessionId, eventId, request.auth.uid, access.role,
        user.rows[0]?.display_name, user.rows[0]?.radio_callsign, deviceId],
    );
    await client.query(
      "INSERT INTO audit_logs(event_id,actor_id,action,target_id) VALUES($1,$2,'tracking.started',$3)",
      [eventId, request.auth.uid, sessionId],
    );
    return { sessionId, resumed: false };
  });
  response.status(result.resumed ? 200 : 201).json({
    data: { ...result, role: access.role },
  });
});

trackingRouter.post("/tracking/sessions/:sessionId/points", async (request, response) => {
  const sessionId = String(request.params.sessionId);
  const input = z.object({
    eventId: z.string().min(1).max(128),
    batchId: z.string().min(1).max(160),
    points: z.array(trackPointSchema).min(1).max(100),
  }).parse(request.body);
  const latest = [...input.points].sort((a, b) =>
    a.recordedAt - b.recordedAt || a.sequence - b.sequence).at(-1)!;
  if (latest.recordedAt > Date.now() + 5 * 60_000) {
    throw new ApiError(400, "future_track_point", "Track points cannot be in the future.");
  }
  const result = await inTransaction(async (client) => {
    const session = await client.query<{
      event_id: string; user_id: string; role: string; display_name: string;
      radio_callsign: string | null; status: string;
    }>("SELECT * FROM tracking_sessions WHERE id=$1 FOR UPDATE", [sessionId]);
    const state = session.rows[0];
    if (!state) throw new ApiError(404, "session_not_found", "Tracking session not found.");
    if (state.user_id !== request.auth.uid || state.event_id !== input.eventId) {
      throw new ApiError(403, "session_access_denied", "This tracking session is not yours.");
    }
    if (state.status !== "active") throw new ApiError(409, "session_inactive", "Tracking session is not active.");
    const batch = await client.query(
      `INSERT INTO tracking_batches(id,session_id,point_count,first_recorded_at,last_recorded_at)
       VALUES($1,$2,$3,to_timestamp($4/1000.0),to_timestamp($5/1000.0))
       ON CONFLICT(id) DO NOTHING RETURNING id`,
      [input.batchId, sessionId, input.points.length,
        input.points[0]!.recordedAt, latest.recordedAt],
    );
    if (!batch.rows[0]) return { duplicate: true, accepted: 0, live: null };

    const columnsPerPoint = 13;
    const values: unknown[] = [];
    const tuples = input.points.map((point, pointIndex) => {
      const offset = pointIndex * columnsPerPoint;
      values.push(sessionId, point.sequence, point.recordedAt, point.latitude,
        point.longitude, point.accuracy, point.altitude, point.altitudeAccuracy,
        point.speed, point.heading, point.batteryLevel, point.isCharging,
        point.connectivity);
      const p = Array.from({ length: columnsPerPoint }, (_, index) => `$${offset + index + 1}`);
      p[2] = `to_timestamp(${p[2]}/1000.0)`;
      return `(${p.join(",")})`;
    });
    await client.query(
      `INSERT INTO tracking_points
       (session_id,sequence,recorded_at,latitude,longitude,accuracy,altitude,
        altitude_accuracy,speed,heading,battery_level,is_charging,connectivity)
       VALUES ${tuples.join(",")}
       ON CONFLICT(session_id,sequence) DO NOTHING`, values,
    );
    await client.query(
      `UPDATE tracking_sessions SET point_count=point_count+$1,
       last_recorded_at=to_timestamp($2/1000.0),updated_at=now() WHERE id=$3`,
      [input.points.length, latest.recordedAt, sessionId],
    );
    await client.query(
      `INSERT INTO live_locations
       (event_id,user_id,session_id,role,display_name,radio_callsign,latitude,
        longitude,accuracy,altitude,speed,heading,battery_level,is_charging,
        connectivity,recorded_at,online)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,to_timestamp($16/1000.0),true)
       ON CONFLICT(event_id,user_id) DO UPDATE SET
        session_id=EXCLUDED.session_id,role=EXCLUDED.role,display_name=EXCLUDED.display_name,
        radio_callsign=EXCLUDED.radio_callsign,latitude=EXCLUDED.latitude,
        longitude=EXCLUDED.longitude,accuracy=EXCLUDED.accuracy,altitude=EXCLUDED.altitude,
        speed=EXCLUDED.speed,heading=EXCLUDED.heading,battery_level=EXCLUDED.battery_level,
        is_charging=EXCLUDED.is_charging,connectivity=EXCLUDED.connectivity,
        recorded_at=EXCLUDED.recorded_at,received_at=now(),online=true,last_disconnected_at=NULL`,
      [state.event_id, state.user_id, sessionId, state.role, state.display_name,
        state.radio_callsign, latest.latitude, latest.longitude, latest.accuracy,
        latest.altitude, latest.speed, latest.heading, latest.batteryLevel,
        latest.isCharging, latest.connectivity, latest.recordedAt],
    );
    const live = await client.query(`SELECT ${liveSelection} FROM live_locations WHERE event_id=$1 AND user_id=$2`,
      [state.event_id, state.user_id]);
    return { duplicate: false, accepted: input.points.length, live: live.rows[0] };
  });
  if (result.live) publishEvent(input.eventId, "location.updated", result.live);
  response.json({ data: { accepted: result.accepted, duplicate: result.duplicate } });
});

trackingRouter.post("/tracking/sessions/:sessionId/stop", async (request, response) => {
  const sessionId = String(request.params.sessionId);
  const { eventId, outcome } = z.object({
    eventId: z.string().min(1).max(128), outcome: trackingStatusSchema.default("completed"),
  }).parse(request.body);
  const session = await pool.query<{ user_id: string }>(
    "SELECT user_id FROM tracking_sessions WHERE id=$1 AND event_id=$2", [sessionId, eventId],
  );
  if (!session.rows[0]) throw new ApiError(404, "session_not_found", "Tracking session not found.");
  if (session.rows[0].user_id !== request.auth.uid) {
    await requireEventOperator(pool, request.auth, eventId);
  }
  await inTransaction(async (client) => {
    await client.query(
      `UPDATE tracking_sessions SET status=$1,stopped_at=now(),stopped_by=$2,updated_at=now()
       WHERE id=$3 AND status='active'`, [outcome, request.auth.uid, sessionId],
    );
    await client.query(
      `UPDATE live_locations SET online=false,last_disconnected_at=now(),received_at=now()
       WHERE event_id=$1 AND session_id=$2`, [eventId, sessionId],
    );
  });
  publishEvent(eventId, "tracking.stopped", { sessionId, outcome });
  response.json({ data: { sessionId, status: outcome } });
});

trackingRouter.get("/events/:eventId/live", async (request, response) => {
  const eventId = String(request.params.eventId);
  await requireEventMembership(pool, request.auth, eventId);
  const result = await pool.query(`SELECT ${liveSelection} FROM live_locations WHERE event_id=$1`, [eventId]);
  response.json({ data: { participants: result.rows } });
});

trackingRouter.get("/events/:eventId/tracking/sessions", async (request, response) => {
  const eventId = String(request.params.eventId);
  await requireEventMembership(pool, request.auth, eventId);
  const result = await pool.query(
    `SELECT id,event_id AS "eventId",user_id AS "userId",role,display_name AS "displayName",
      radio_callsign AS "radioCallsign",status,started_at AS "startedAt",stopped_at AS "stoppedAt",
      point_count AS "pointCount",last_recorded_at AS "lastRecordedAt"
     FROM tracking_sessions WHERE event_id=$1 ORDER BY started_at DESC LIMIT 500`, [eventId],
  );
  response.json({ data: { sessions: result.rows } });
});

trackingRouter.get("/tracking/sessions/:sessionId/points", async (request, response) => {
  const sessionId = String(request.params.sessionId);
  const session = await pool.query<{ event_id: string }>("SELECT event_id FROM tracking_sessions WHERE id=$1", [sessionId]);
  if (!session.rows[0]) throw new ApiError(404, "session_not_found", "Tracking session not found.");
  await requireEventMembership(pool, request.auth, session.rows[0].event_id);
  const result = await pool.query(
    `SELECT sequence,(extract(epoch from recorded_at)*1000)::bigint AS "recordedAt",
      latitude,longitude,accuracy,altitude,altitude_accuracy AS "altitudeAccuracy",
      speed,heading,battery_level AS "batteryLevel",is_charging AS "isCharging",connectivity
     FROM tracking_points WHERE session_id=$1 ORDER BY recorded_at,sequence LIMIT 100000`, [sessionId],
  );
  response.json({ data: { points: result.rows } });
});
