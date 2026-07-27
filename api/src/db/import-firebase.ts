import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, type DocumentData } from "firebase-admin/firestore";

import { config } from "../config.js";
import { pool } from "./pool.js";

const app = getApps().find((candidate) => candidate.name === "retfast-import") ??
  initializeApp({ credential: applicationDefault(), projectId: config.FIREBASE_PROJECT_ID }, "retfast-import");
const auth = getAuth(app);
const firestore = getFirestore(app);

function asDate(value: unknown, fallback = new Date()) {
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  if (value && typeof value === "object" && "toDate" in value) {
    const toDate = (value as { toDate?: unknown }).toDate;
    if (typeof toDate === "function") return toDate.call(value) as Date;
  }
  const parsed = new Date(String(value ?? ""));
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

async function importUsers() {
  const profiles = await firestore.collection("users").get();
  const profileById = new Map(profiles.docs.map((doc) => [doc.id, doc.data()]));
  let pageToken: string | undefined;
  let count = 0;
  do {
    const page = await auth.listUsers(1_000, pageToken);
    for (const user of page.users) {
      if (!user.email) continue;
      const profile = profileById.get(user.uid) ?? {};
      const email = user.email.trim().toLowerCase();
      const displayName = text(profile.displayName, user.displayName?.trim() || email.split("@")[0] || "RETFAST User");
      const globalRole = config.superadminEmails.has(email) ? "superadmin" : "user";
      await pool.query(
        `INSERT INTO users (id, email, display_name, locale, global_role, radio_callsign, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, display_name = EXCLUDED.display_name,
           locale = EXCLUDED.locale, global_role = EXCLUDED.global_role,
           radio_callsign = EXCLUDED.radio_callsign, updated_at = EXCLUDED.updated_at`,
        [
          user.uid,
          email,
          displayName.slice(0, 80),
          oneOf(profile.locale, ["tr", "en"] as const, "tr"),
          globalRole,
          profile.radioCallsign ? text(profile.radioCallsign).slice(0, 24) : null,
          asDate(profile.createdAt, new Date(user.metadata.creationTime)),
          asDate(profile.updatedAt),
        ],
      );
      count += 1;
    }
    pageToken = page.pageToken;
  } while (pageToken);
  return count;
}

async function importEvents() {
  const snapshot = await firestore.collection("events").get();
  let count = 0;
  for (const doc of snapshot.docs) {
    const event = doc.data();
    const managerIds = Array.isArray(event.managerIds) ? event.managerIds.map(String) : [];
    const createdBy = text(event.createdBy, managerIds[0]);
    const managerId = managerIds[0] ?? createdBy;
    if (!createdBy || !managerId) {
      console.warn(`Skipping event ${doc.id}: manager/creator is missing.`);
      continue;
    }
    const startsAt = asDate(event.startsAt);
    const candidateEnd = asDate(event.endsAt, new Date(startsAt.getTime() + 86_400_000));
    const endsAt = candidateEnd > startsAt ? candidateEnd : new Date(startsAt.getTime() + 86_400_000);
    await pool.query(
      `INSERT INTO events (id, slug, name, description, venue, starts_at, ends_at, timezone,
         visibility, status, manager_user_id, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (id) DO UPDATE SET slug=EXCLUDED.slug, name=EXCLUDED.name,
         description=EXCLUDED.description, venue=EXCLUDED.venue, starts_at=EXCLUDED.starts_at,
         ends_at=EXCLUDED.ends_at, timezone=EXCLUDED.timezone, visibility=EXCLUDED.visibility,
         status=EXCLUDED.status, manager_user_id=EXCLUDED.manager_user_id, updated_at=EXCLUDED.updated_at`,
      [
        doc.id,
        text(event.slug, doc.id).slice(0, 128),
        text(event.name, "Imported RETFAST event").slice(0, 100),
        text(event.description).slice(0, 1200),
        text(event.venue, "Unknown venue").slice(0, 120),
        startsAt,
        endsAt,
        text(event.timezone, "Europe/Istanbul").slice(0, 64),
        oneOf(event.visibility, ["public", "unlisted", "private"] as const, "private"),
        oneOf(event.status, ["draft", "published", "active", "completed", "cancelled"] as const, "draft"),
        managerId,
        createdBy,
        asDate(event.createdAt),
        asDate(event.updatedAt),
      ],
    );
    count += 1;
  }
  return count;
}

async function importMemberships() {
  const snapshot = await firestore.collection("eventMemberships").get();
  let count = 0;
  for (const doc of snapshot.docs) {
    const membership = doc.data();
    const eventId = text(membership.eventId);
    const userId = text(membership.userId);
    if (!eventId || !userId) continue;
    const rawStatus = text(membership.status, "pending");
    const status = rawStatus === "declined" ? "rejected" : rawStatus === "invited" ? "approved" :
      oneOf(rawStatus, ["pending", "approved", "rejected"] as const, "pending");
    const role = membership.role == null ? null :
      oneOf(membership.role, ["manager", "pilot", "retriever", "observer"] as const, "observer");
    await pool.query(
      `INSERT INTO event_memberships (event_id, user_id, role, status, reviewed_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (event_id, user_id) DO UPDATE SET role=EXCLUDED.role, status=EXCLUDED.status,
         reviewed_by=EXCLUDED.reviewed_by, updated_at=EXCLUDED.updated_at`,
      [eventId, userId, role, status, membership.reviewedBy || null,
        asDate(membership.requestedAt), asDate(membership.updatedAt)],
    );
    count += 1;
  }
  return count;
}

async function importTracking() {
  const snapshot = await firestore.collection("trackingSessions").get();
  let sessions = 0;
  let points = 0;
  for (const doc of snapshot.docs) {
    const session = doc.data();
    const eventId = text(session.eventId);
    const userId = text(session.userId);
    if (!eventId || !userId) continue;
    await pool.query(
      `INSERT INTO tracking_sessions (id,event_id,user_id,role,display_name,radio_callsign,status,
         device_id,started_at,stopped_at,stopped_by,point_count,last_recorded_at,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, stopped_at=EXCLUDED.stopped_at,
         stopped_by=EXCLUDED.stopped_by, point_count=EXCLUDED.point_count,
         last_recorded_at=EXCLUDED.last_recorded_at, updated_at=EXCLUDED.updated_at`,
      [doc.id, eventId, userId, oneOf(session.role, ["pilot", "retriever"] as const, "pilot"),
        text(session.displayName, "RETFAST User").slice(0, 80), session.radioCallsign || null,
        oneOf(session.status, ["active", "completed", "cancelled", "interrupted"] as const, "interrupted"),
        text(session.deviceId, `imported-${doc.id}`).slice(0, 128), asDate(session.startedAt),
        session.stoppedAt ? asDate(session.stoppedAt) : null, session.stoppedBy || null,
        Number(session.pointCount) || 0, session.lastRecordedAt ? asDate(session.lastRecordedAt) : null,
        asDate(session.createdAt), asDate(session.updatedAt)],
    );
    sessions += 1;
    const chunks = await doc.ref.collection("chunks").get();
    for (const chunkDoc of chunks.docs) {
      const chunk = chunkDoc.data();
      const chunkPoints = Array.isArray(chunk.points) ? chunk.points as DocumentData[] : [];
      if (chunkPoints.length === 0) continue;
      const firstDate = asDate(chunkPoints[0]?.recordedAt);
      const lastDate = asDate(chunkPoints.at(-1)?.recordedAt);
      await pool.query(
        `INSERT INTO tracking_batches (id,session_id,point_count,first_recorded_at,last_recorded_at)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
        [`${doc.id}:${chunkDoc.id}`, doc.id, chunkPoints.length, firstDate, lastDate],
      );
      for (const point of chunkPoints) {
        await pool.query(
          `INSERT INTO tracking_points (session_id,sequence,recorded_at,latitude,longitude,accuracy,
             altitude,altitude_accuracy,speed,heading,battery_level,is_charging,connectivity)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           ON CONFLICT (session_id, sequence) DO NOTHING`,
          [doc.id, Number(point.sequence), asDate(point.recordedAt), Number(point.latitude),
            Number(point.longitude), point.accuracy ?? null, point.altitude ?? null,
            point.altitudeAccuracy ?? null, point.speed ?? null, point.heading ?? null,
            point.batteryLevel ?? null, point.isCharging ?? null,
            oneOf(point.connectivity, ["online", "limited", "offline", "unknown"] as const, "unknown")],
        );
        points += 1;
      }
    }
  }
  return { sessions, points };
}

async function importRetrieverStates() {
  const snapshot = await firestore.collection("retrieverStates").get();
  let count = 0;
  for (const doc of snapshot.docs) {
    const state = doc.data();
    const eventId = text(state.eventId);
    const userId = text(state.userId);
    if (!eventId || !userId) continue;
    const capacity = Math.min(20, Math.max(1, Number(state.capacity) || 1));
    const assigned = Math.min(capacity, Math.max(0, Number(state.assignedCount) || 0));
    await pool.query(
      `INSERT INTO retriever_states (event_id,user_id,capacity,assigned_count,availability,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (event_id,user_id) DO UPDATE SET
       capacity=EXCLUDED.capacity, assigned_count=EXCLUDED.assigned_count,
       availability=EXCLUDED.availability, updated_at=EXCLUDED.updated_at`,
      [eventId, userId, capacity, assigned,
        oneOf(state.availability, ["available", "busy", "inactive", "offline"] as const, "inactive"),
        asDate(state.updatedAt)],
    );
    count += 1;
  }
  return count;
}

async function importRetrievalJobs() {
  const snapshot = await firestore.collection("retrievalJobs").get();
  let count = 0;
  for (const doc of snapshot.docs) {
    const job = doc.data();
    const eventId = text(job.eventId);
    const sessionId = text(job.sessionId, doc.id);
    const pilotId = text(job.pilotId);
    if (!eventId || !sessionId || !pilotId) continue;
    const rawStatus = text(job.status, "searching");
    const status = ["not_requested", "queued"].includes(rawStatus) ? "searching" :
      oneOf(rawStatus, ["searching", "offered", "assigned", "picked_up", "delivered", "cancelled"] as const, "searching");
    await pool.query(
      `INSERT INTO retrieval_jobs (id,event_id,session_id,pilot_id,pilot_name,urgency,status,
         offered_retriever_id,offered_retriever_name,assigned_retriever_id,assigned_retriever_name,
         offer_expires_at,picked_up_at,delivered_at,cancelled_at,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status,
         offered_retriever_id=EXCLUDED.offered_retriever_id,
         offered_retriever_name=EXCLUDED.offered_retriever_name,
         assigned_retriever_id=EXCLUDED.assigned_retriever_id,
         assigned_retriever_name=EXCLUDED.assigned_retriever_name,
         offer_expires_at=EXCLUDED.offer_expires_at,picked_up_at=EXCLUDED.picked_up_at,
         delivered_at=EXCLUDED.delivered_at,cancelled_at=EXCLUDED.cancelled_at,
         updated_at=EXCLUDED.updated_at`,
      [doc.id, eventId, sessionId, pilotId, text(job.pilotName, "Pilot").slice(0, 80),
        oneOf(job.urgency, ["normal", "emergency"] as const, "normal"), status,
        job.offeredRetrieverId || null, job.offeredRetrieverName || null,
        job.assignedRetrieverId || null, job.assignedRetrieverName || null,
        job.offerExpiresAt ? asDate(job.offerExpiresAt) : null,
        job.pickedUpAt ? asDate(job.pickedUpAt) : null,
        job.deliveredAt ? asDate(job.deliveredAt) : null,
        job.cancelledAt ? asDate(job.cancelledAt) : null,
        asDate(job.requestedAt), asDate(job.updatedAt)],
    );
    count += 1;
  }
  return count;
}

async function importPushDevices() {
  const users = await firestore.collection("users").get();
  let count = 0;
  for (const user of users.docs) {
    const devices = await user.ref.collection("devices").get();
    for (const doc of devices.docs) {
      const device = doc.data();
      const token = text(device.token);
      if (!token) continue;
      await pool.query(
        `INSERT INTO push_devices (id,user_id,token,platform,updated_at)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (token) DO UPDATE SET
         user_id=EXCLUDED.user_id,platform=EXCLUDED.platform,updated_at=EXCLUDED.updated_at`,
        [doc.id, user.id, token,
          oneOf(device.platform, ["ios", "android", "web"] as const, "ios"), asDate(device.updatedAt)],
      );
      count += 1;
    }
  }
  return count;
}

async function main() {
  console.log("Importing Firebase Auth users and Firestore operational data...");
  const users = await importUsers();
  const events = await importEvents();
  const memberships = await importMemberships();
  const tracking = await importTracking();
  const retrievers = await importRetrieverStates();
  const retrievalJobs = await importRetrievalJobs();
  const pushDevices = await importPushDevices();
  console.log({ users, events, memberships, ...tracking, retrievers, retrievalJobs, pushDevices });
  console.log("Firebase import completed. The command is idempotent and can be run again.");
}

try {
  await main();
} finally {
  await pool.end();
}
