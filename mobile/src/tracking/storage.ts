import type { LocationObject } from "expo-location";
import * as SQLite from "expo-sqlite";

import type { TrackPoint } from "../domain";
import type { ActiveTrackingState, QueuedTrackPoint } from "./types";

type Telemetry = Pick<
  TrackPoint,
  "batteryLevel" | "isCharging" | "connectivity"
>;

type QueueRow = {
  id: number;
  recorded_at: number;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  altitude: number | null;
  altitude_accuracy: number | null;
  speed: number | null;
  heading: number | null;
  battery_level: number | null;
  is_charging: number | null;
  connectivity: TrackPoint["connectivity"];
};

let databasePromise: ReturnType<typeof SQLite.openDatabaseAsync> | null = null;

function boundedValue(
  value: number | null,
  minimum: number,
  maximum: number,
) {
  return value != null &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : null;
}

async function database() {
  databasePromise ??= SQLite.openDatabaseAsync("retfast-tracking.db");
  const instance = await databasePromise;
  await instance.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS tracking_state (
      id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS track_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      recorded_at INTEGER NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      accuracy REAL,
      altitude REAL,
      altitude_accuracy REAL,
      speed REAL,
      heading REAL,
      battery_level REAL,
      is_charging INTEGER,
      connectivity TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS track_queue_session_id
      ON track_queue(session_id, id);
  `);
  return instance;
}

export async function getTrackingState() {
  const instance = await database();
  const row = await instance.getFirstAsync<{ payload: string }>(
    "SELECT payload FROM tracking_state WHERE id = 1",
  );
  if (!row) return null;
  try {
    return JSON.parse(row.payload) as ActiveTrackingState;
  } catch {
    return null;
  }
}

export async function setTrackingState(state: ActiveTrackingState | null) {
  const instance = await database();
  if (!state) {
    await instance.runAsync("DELETE FROM tracking_state WHERE id = 1");
    return;
  }
  await instance.runAsync(
    "INSERT OR REPLACE INTO tracking_state (id, payload) VALUES (1, ?)",
    JSON.stringify(state),
  );
}

export async function enqueueLocations(
  state: ActiveTrackingState,
  locations: LocationObject[],
  telemetry: Telemetry,
) {
  const instance = await database();
  const points: QueuedTrackPoint[] = [];
  await instance.withExclusiveTransactionAsync(async (transaction) => {
    for (const location of locations) {
      const { coords } = location;
      const accuracy = boundedValue(coords.accuracy, 0, 5_000);
      const altitude = boundedValue(coords.altitude, -1_000, 20_000);
      const altitudeAccuracy = boundedValue(
        coords.altitudeAccuracy,
        0,
        5_000,
      );
      const speed = boundedValue(coords.speed, 0, 200);
      const heading = boundedValue(coords.heading, 0, 360);
      const result = await transaction.runAsync(
        `INSERT INTO track_queue (
          session_id, event_id, recorded_at, latitude, longitude, accuracy,
          altitude, altitude_accuracy, speed, heading, battery_level,
          is_charging, connectivity
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        state.sessionId,
        state.eventId,
        Math.round(location.timestamp),
        coords.latitude,
        coords.longitude,
        accuracy,
        altitude,
        altitudeAccuracy,
        speed,
        heading,
        telemetry.batteryLevel,
        telemetry.isCharging == null ? null : telemetry.isCharging ? 1 : 0,
        telemetry.connectivity,
      );
      points.push({
        queueId: result.lastInsertRowId,
        sequence: result.lastInsertRowId,
        recordedAt: Math.round(location.timestamp),
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracy,
        altitude,
        altitudeAccuracy,
        speed,
        heading,
        ...telemetry,
      });
    }
  });
  return points;
}

export async function queuedPoints(sessionId: string, limit = 50) {
  const instance = await database();
  const rows = await instance.getAllAsync<QueueRow>(
    "SELECT * FROM track_queue WHERE session_id = ? ORDER BY id LIMIT ?",
    sessionId,
    limit,
  );
  return rows.map<QueuedTrackPoint>((row) => ({
    queueId: row.id,
    sequence: row.id,
    recordedAt: row.recorded_at,
    latitude: row.latitude,
    longitude: row.longitude,
    accuracy: row.accuracy,
    altitude: row.altitude,
    altitudeAccuracy: row.altitude_accuracy,
    speed: row.speed,
    heading: row.heading,
    batteryLevel: row.battery_level,
    isCharging: row.is_charging == null ? null : row.is_charging === 1,
    connectivity: row.connectivity,
  }));
}

export async function queueSummary(sessionId: string) {
  const instance = await database();
  return instance.getFirstAsync<{ count: number; oldest: number | null }>(
    "SELECT COUNT(*) AS count, MIN(recorded_at) AS oldest FROM track_queue WHERE session_id = ?",
    sessionId,
  );
}

export async function removeQueuedPoints(queueIds: number[]) {
  if (queueIds.length === 0) return;
  const instance = await database();
  const placeholders = queueIds.map(() => "?").join(",");
  await instance.runAsync(
    `DELETE FROM track_queue WHERE id IN (${placeholders})`,
    queueIds,
  );
}
