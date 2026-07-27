import {
  onDisconnect,
  ref,
  serverTimestamp,
  set,
} from "@react-native-firebase/database";
import { getAuth } from "@react-native-firebase/auth";
import { getFunctions, httpsCallable } from "@react-native-firebase/functions";
import * as Battery from "expo-battery";
import * as Crypto from "expo-crypto";
import * as Location from "expo-location";
import * as Network from "expo-network";
import * as SecureStore from "expo-secure-store";
import * as TaskManager from "expo-task-manager";

import type {
  Connectivity,
  TrackPoint,
  TrackingRole,
  TrackingSessionStatus,
} from "../domain";
import { realtime, realtimeReady } from "./firebase";
import {
  enqueueLocations,
  getTrackingState,
  queuedPoints,
  queueSummary,
  removeQueuedPoints,
  setTrackingState,
} from "./storage";
import type { ActiveTrackingState, QueuedTrackPoint } from "./types";

export const LOCATION_TASK_NAME = "retfast-active-mission-location";

const DEVICE_ID_KEY = "retfast.tracking.device-id";
const functions = getFunctions(undefined, "europe-west1");
let flushPromise: Promise<number> | null = null;

type StartResult = {
  sessionId: string;
  role: TrackingRole;
  resumed: boolean;
};

async function deviceId() {
  const stored = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (stored) return stored;
  const created = Crypto.randomUUID();
  await SecureStore.setItemAsync(DEVICE_ID_KEY, created);
  return created;
}

async function telemetry() {
  const [batteryLevel, batteryState, network] = await Promise.all([
    Battery.getBatteryLevelAsync().catch(() => -1),
    Battery.getBatteryStateAsync().catch(() => Battery.BatteryState.UNKNOWN),
    Network.getNetworkStateAsync().catch(() => null),
  ]);
  let connectivity: Connectivity = "unknown";
  if (network?.isConnected === false) connectivity = "offline";
  else if (network?.isInternetReachable === false) connectivity = "limited";
  else if (network?.isConnected === true && network.isInternetReachable === true) {
    connectivity = "online";
  }
  return {
    batteryLevel: batteryLevel >= 0 ? batteryLevel : null,
    isCharging:
      batteryState === Battery.BatteryState.CHARGING ||
      batteryState === Battery.BatteryState.FULL
        ? true
        : batteryState === Battery.BatteryState.UNKNOWN
          ? null
          : false,
    connectivity,
  };
}

function batchId(state: ActiveTrackingState, points: QueuedTrackPoint[]) {
  const first = points[0]!.sequence;
  const last = points.at(-1)!.sequence;
  return `b_${state.sessionId.slice(0, 18)}_${first}_${last}`;
}

async function ingest(state: ActiveTrackingState, points: QueuedTrackPoint[]) {
  const callable = httpsCallable<
    {
      eventId: string;
      sessionId: string;
      batchId: string;
      points: TrackPoint[];
    },
    { accepted: number; duplicate: boolean }
  >(functions, "ingestTrackBatch");
  await callable({
    eventId: state.eventId,
    sessionId: state.sessionId,
    batchId: batchId(state, points),
    points: points.map(({ queueId: _queueId, ...point }) => point),
  });
  await removeQueuedPoints(points.map((point) => point.queueId));
  return points.length;
}

export async function flushTrackQueue(force = false) {
  if (flushPromise) return flushPromise;
  flushPromise = (async () => {
    const state = await getTrackingState();
    if (!state) return 0;
    const summary = await queueSummary(state.sessionId);
    const count = summary?.count ?? 0;
    const oldest = summary?.oldest ?? null;
    if (
      count === 0 ||
      (!force && count < 30 && (oldest == null || Date.now() - oldest < 5 * 60_000))
    ) {
      return 0;
    }
    let uploaded = 0;
    do {
      const points = await queuedPoints(state.sessionId, 50);
      if (points.length === 0) break;
      uploaded += await ingest(state, points);
      if (!force) break;
    } while (true);
    return uploaded;
  })().finally(() => {
    flushPromise = null;
  });
  return flushPromise;
}

async function publishLive(
  state: ActiveTrackingState,
  point: QueuedTrackPoint,
) {
  await realtimeReady;
  const userId = getAuth().currentUser?.uid;
  if (!userId) return;
  const participantReference = ref(realtime, `live/${state.eventId}/${userId}`);
  await onDisconnect(participantReference).update({
    online: false,
    lastDisconnectedAt: serverTimestamp(),
  });
  await set(participantReference, {
    sessionId: state.sessionId,
    userId,
    role: state.role,
    displayName: state.displayName,
    radioCallsign: state.radioCallsign,
    latitude: point.latitude,
    longitude: point.longitude,
    accuracy: point.accuracy,
    altitude: point.altitude,
    speed: point.speed,
    heading: point.heading,
    batteryLevel: point.batteryLevel,
    isCharging: point.isCharging,
    connectivity: point.connectivity,
    recordedAt: point.recordedAt,
    receivedAt: serverTimestamp(),
    online: true,
    lastDisconnectedAt: null,
  });
}

export async function handleBackgroundLocations(locations: Location.LocationObject[]) {
  const state = await getTrackingState();
  if (!state || state.pendingOutcome || locations.length === 0) return;
  const currentTelemetry = await telemetry();
  const points = await enqueueLocations(state, locations, currentTelemetry);
  const latest = points.at(-1);
  if (latest) await publishLive(state, latest).catch(() => undefined);
  if (currentTelemetry.connectivity !== "offline") {
    await flushTrackQueue(false).catch(() => undefined);
  }
}

function locationOptions(role: TrackingRole, locale: "tr" | "en") {
  const pilot = role === "pilot";
  return {
    accuracy: Location.Accuracy.High,
    distanceInterval: pilot ? 8 : 15,
    timeInterval: pilot ? 10_000 : 15_000,
    deferredUpdatesDistance: pilot ? 45 : 70,
    deferredUpdatesInterval: pilot ? 30_000 : 45_000,
    pausesUpdatesAutomatically: false,
    activityType: pilot
      ? Location.ActivityType.Airborne
      : Location.ActivityType.AutomotiveNavigation,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: "RETFAST",
      notificationBody:
        locale === "tr"
          ? "Aktif görev konumu güvenle kaydediliyor"
          : "Active mission location is being recorded",
      notificationColor: "#126B5B",
      killServiceOnDestroy: false,
    },
  } satisfies Location.LocationTaskOptions;
}

export async function startTracking(input: {
  eventId: string;
  displayName: string;
  radioCallsign: string | null;
  locale: "tr" | "en";
}) {
  const existing = await getTrackingState();
  if (existing?.pendingOutcome) {
    await finalizePending(existing);
  } else if (existing && existing.eventId !== input.eventId) {
    throw new Error("tracking/another-event-is-active");
  }
  if (!(await TaskManager.isAvailableAsync())) {
    throw new Error("tracking/task-manager-unavailable");
  }
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== "granted") {
    throw new Error("tracking/foreground-permission-denied");
  }
  const background = await Location.requestBackgroundPermissionsAsync();
  if (background.status !== "granted") {
    throw new Error("tracking/background-permission-denied");
  }
  const callable = httpsCallable<
    { eventId: string; deviceId: string },
    StartResult
  >(functions, "startTrackingSession");
  const result = await callable({ eventId: input.eventId, deviceId: await deviceId() });
  const state: ActiveTrackingState = {
    eventId: input.eventId,
    sessionId: result.data.sessionId,
    role: result.data.role,
    displayName: input.displayName,
    radioCallsign: input.radioCallsign,
    pendingOutcome: null,
  };
  await setTrackingState(state);
  const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
  if (started) await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
  await Location.startLocationUpdatesAsync(
    LOCATION_TASK_NAME,
    locationOptions(result.data.role, input.locale),
  );
  return { ...result.data, state };
}

async function finalizePending(state: ActiveTrackingState) {
  await flushTrackQueue(true);
  const callable = httpsCallable<
    { eventId: string; sessionId: string; outcome: Exclude<TrackingSessionStatus, "active"> },
    { sessionId: string; status: string }
  >(functions, "stopTrackingSession");
  await callable({
    eventId: state.eventId,
    sessionId: state.sessionId,
    outcome: state.pendingOutcome ?? "interrupted",
  });
  await setTrackingState(null);
}

export async function stopTracking(
  outcome: Exclude<TrackingSessionStatus, "active"> = "completed",
) {
  const state = await getTrackingState();
  if (!state) return;
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME)) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
  }
  const pending = { ...state, pendingOutcome: outcome };
  await setTrackingState(pending);
  await finalizePending(pending);
}

export async function recoverTrackingSync() {
  const state = await getTrackingState();
  if (!state) return null;
  if (state.pendingOutcome) {
    await finalizePending(state);
    return null;
  }
  await flushTrackQueue(false);
  return state;
}

export async function currentTrackingState() {
  return getTrackingState();
}
