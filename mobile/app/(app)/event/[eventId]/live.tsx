import { router, useLocalSearchParams } from "expo-router";
import {
  AlertTriangle,
  ArrowLeft,
  BatteryMedium,
  Car,
  Check,
  CloudOff,
  Gauge,
  MapPinned,
  Minus,
  Navigation,
  PackageCheck,
  Play,
  Plus,
  Radio,
  Square,
  Users,
  X,
} from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import MapView, { Marker, type Region } from "react-native-maps";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "../../../../src/contexts/AuthContext";
import { usePreferences } from "../../../../src/contexts/PreferencesContext";
import { useMobileEvent, useMobileEvents } from "../../../../src/lib/events";
import { registerForRetrievalNotifications } from "../../../../src/notifications";
import {
  configureRetrieverCommand,
  listNearbyRetrieversCommand,
  requestRetrievalCommand,
  respondRetrievalCommand,
  updateRetrievalCommand,
  useRetrievalOperations,
  type NearbyRetriever,
  type RetrievalJob,
  type RetrieverAvailability,
} from "../../../../src/retrieval";
import {
  currentTrackingState,
  startTracking,
  stopTracking,
} from "../../../../src/tracking/service";
import type {
  ActiveTrackingState,
  LiveParticipant,
} from "../../../../src/tracking/types";
import { useLiveEvent } from "../../../../src/tracking/useLiveEvent";

const TURKEY_REGION: Region = {
  latitude: 39,
  longitude: 35,
  latitudeDelta: 9,
  longitudeDelta: 9,
};

function ParticipantMarker({ participant }: { participant: LiveParticipant }) {
  const isPilot = participant.role === "pilot";
  return (
    <Marker
      coordinate={{ latitude: participant.latitude, longitude: participant.longitude }}
      title={participant.displayName}
      description={`${Math.round(participant.altitude ?? 0)} m · ${Math.round((participant.speed ?? 0) * 3.6)} km/h`}
    >
      <View
        style={[
          styles.marker,
          {
            backgroundColor: isPilot ? "#D9655C" : "#126B5B",
            opacity: participant.online ? 1 : 0.55,
          },
        ]}
      >
        <View style={{ transform: [{ rotate: `${participant.heading ?? 0}deg` }] }}>
          <Navigation size={16} color="#FFFFFF" fill="#FFFFFF" />
        </View>
      </View>
    </Marker>
  );
}

export default function LiveMissionScreen() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const { user, profile } = useAuth();
  const { copy, locale, palette } = usePreferences();
  const { event } = useMobileEvent(eventId);
  const { membershipByEvent } = useMobileEvents();
  const membership = eventId ? membershipByEvent.get(eventId) : undefined;
  const approved = membership?.status === "approved";
  const { participants, connected, loading } = useLiveEvent(eventId, approved);
  const { jobs, retrievers } = useRetrievalOperations(eventId, approved);
  const [tracking, setTracking] = useState<ActiveTrackingState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [nearby, setNearby] = useState<NearbyRetriever[]>([]);
  const [requestUrgency, setRequestUrgency] = useState<"normal" | "emergency">("normal");
  const [capacityOverride, setCapacityOverride] = useState<number | null>(null);
  const mapReference = useRef<MapView>(null);
  const ownLive = participants.find((participant) => participant.userId === user?.uid);
  const canTrack = membership?.role === "pilot" || membership?.role === "retriever";
  const ownRetriever = retrievers.find((state) => state.userId === user?.uid);
  const capacity = capacityOverride ?? ownRetriever?.capacity ?? 3;
  const pilotJob = tracking
    ? jobs.find((job) => job.sessionId === tracking.sessionId && job.pilotId === user?.uid)
    : undefined;
  const offers = jobs.filter(
    (job) => job.status === "offered" && job.offeredRetrieverId === user?.uid,
  );
  const assignedJobs = jobs.filter(
    (job) =>
      job.assignedRetrieverId === user?.uid &&
      ["assigned", "picked_up"].includes(job.status),
  );

  useEffect(() => {
    void currentTrackingState().then((state) => {
      setTracking(state?.eventId === eventId ? state : null);
    });
  }, [eventId]);

  useEffect(() => {
    if (!approved || !canTrack) return;
    void registerForRetrievalNotifications().catch(() => undefined);
  }, [approved, canTrack]);

  useEffect(() => {
    if (!ownLive) return;
    mapReference.current?.animateCamera(
      {
        center: { latitude: ownLive.latitude, longitude: ownLive.longitude },
        zoom: 14,
      },
      { duration: 650 },
    );
  }, [ownLive]);

  const activeParticipants = useMemo(
    () => participants.filter((participant) => participant.online),
    [participants],
  );

  async function run(command: () => Promise<unknown>, success?: string) {
    setBusy(true);
    setMessage(null);
    try {
      await command();
      if (success) setMessage(success);
      return true;
    } catch {
      setMessage(copy.retrievalFailed);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function begin() {
    if (!eventId || !profile) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await startTracking({
        eventId,
        displayName: profile.displayName,
        radioCallsign: profile.radioCallsign,
        locale,
      });
      setTracking(result.state);
      if (membership?.role === "retriever" && !ownRetriever) {
        await configureRetrieverCommand(eventId, capacity, "available");
      }
    } catch {
      setMessage(copy.trackingStartFailed);
    } finally {
      setBusy(false);
    }
  }

  function confirmBegin() {
    Alert.alert(copy.backgroundLocationTitle, copy.backgroundLocationExplanation, [
      { text: copy.notNow, style: "cancel" },
      { text: copy.continue, onPress: () => void begin() },
    ]);
  }

  async function finish() {
    setBusy(true);
    setMessage(null);
    try {
      if (eventId && membership?.role === "retriever" && ownRetriever) {
        await configureRetrieverCommand(eventId, capacity, "inactive");
      }
      await stopTracking("completed");
      setTracking(null);
      setNearby([]);
      setMessage(copy.trackSaved);
    } catch {
      setTracking(await currentTrackingState());
      setMessage(copy.trackPendingSync);
    } finally {
      setBusy(false);
    }
  }

  function openCoordinates(latitude: number, longitude: number) {
    const destination = `${latitude},${longitude}`;
    const url = Platform.OS === "ios"
      ? `maps://?daddr=${destination}&dirflg=d`
      : `google.navigation:q=${destination}`;
    void Linking.openURL(url);
  }

  async function findRetrievers(urgency: "normal" | "emergency") {
    if (!eventId || !tracking) return;
    setRequestUrgency(urgency);
    setBusy(true);
    setMessage(null);
    try {
      const result = await listNearbyRetrieversCommand(eventId, tracking.sessionId);
      setNearby(result);
      if (!result.length) setMessage(copy.noRetrievers);
    } catch {
      setMessage(copy.retrievalFailed);
    } finally {
      setBusy(false);
    }
  }

  async function selectRetriever(retrieverId: string) {
    if (!eventId || !tracking) return;
    const completed = await run(
      () => requestRetrievalCommand(
        eventId,
        tracking.sessionId,
        retrieverId,
        requestUrgency,
      ),
      copy.requestSent,
    );
    if (completed) setNearby([]);
  }

  async function setAvailability(
    availability: Exclude<RetrieverAvailability, "offline">,
  ) {
    if (!eventId) return;
    await run(() => configureRetrieverCommand(eventId, capacity, availability));
  }

  async function respond(job: RetrievalJob, accept: boolean) {
    if (!eventId) return;
    await run(() => respondRetrievalCommand(eventId, job.id, accept));
  }

  async function progress(
    job: RetrievalJob,
    action: "picked_up" | "delivered" | "cancelled",
  ) {
    if (!eventId) return;
    await run(() => updateRetrievalCommand(eventId, job.id, action));
  }

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <MapView ref={mapReference} style={StyleSheet.absoluteFill} initialRegion={TURKEY_REGION}>
        {activeParticipants.map((participant) => (
          <ParticipantMarker key={participant.userId} participant={participant} />
        ))}
      </MapView>

      <SafeAreaView edges={["top"]} style={styles.topOverlay}>
        <View style={styles.topBar}>
          <Pressable
            onPress={() => router.back()}
            style={[styles.roundButton, { backgroundColor: palette.surface, borderColor: palette.line }]}
          >
            <ArrowLeft size={18} color={palette.text} />
          </Pressable>
          <View style={[styles.eventChip, { backgroundColor: palette.surface, borderColor: palette.line }]}>
            <View style={[styles.liveDot, { backgroundColor: connected ? palette.success : palette.danger }]} />
            <View>
              <Text numberOfLines={1} style={[styles.eventName, { color: palette.text }]}>{event?.name ?? copy.liveMission}</Text>
              <Text style={[styles.connectionText, { color: palette.muted }]}>{connected ? copy.connected : copy.offline}</Text>
            </View>
          </View>
          <View style={[styles.counterChip, { backgroundColor: palette.primaryStrong }]}>
            <Users size={15} color={palette.lime} />
            <Text style={styles.counterText}>{activeParticipants.length}</Text>
          </View>
        </View>
      </SafeAreaView>

      <View style={[styles.missionPanel, { backgroundColor: palette.surface, borderColor: palette.line }]}>
        <View style={styles.panelHandle} />
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.panelHeading}>
            <View>
              <Text style={[styles.kicker, { color: palette.primary }]}>{copy.liveMission}</Text>
              <Text style={[styles.panelTitle, { color: palette.text }]}>
                {tracking ? copy.locationRecording : canTrack ? copy.readyToStart : copy.liveOverview}
              </Text>
            </View>
            {tracking && <View style={[styles.recordingBadge, { backgroundColor: palette.dangerSoft }]}><View style={styles.recordingDot} /><Text style={{ color: palette.danger }}>{copy.recording}</Text></View>}
          </View>

          {ownLive ? (
            <View style={styles.telemetryRow}>
              <View style={[styles.metric, { backgroundColor: palette.surfaceSoft }]}><Gauge size={16} color={palette.primary} /><Text style={[styles.metricValue, { color: palette.text }]}>{Math.round((ownLive.speed ?? 0) * 3.6)}</Text><Text style={[styles.metricUnit, { color: palette.faint }]}>km/h</Text></View>
              <View style={[styles.metric, { backgroundColor: palette.surfaceSoft }]}><MapPinned size={16} color={palette.primary} /><Text style={[styles.metricValue, { color: palette.text }]}>{Math.round(ownLive.altitude ?? 0)}</Text><Text style={[styles.metricUnit, { color: palette.faint }]}>m</Text></View>
              <View style={[styles.metric, { backgroundColor: palette.surfaceSoft }]}><BatteryMedium size={16} color={palette.primary} /><Text style={[styles.metricValue, { color: palette.text }]}>{ownLive.batteryLevel == null ? "—" : Math.round(ownLive.batteryLevel * 100)}</Text><Text style={[styles.metricUnit, { color: palette.faint }]}>%</Text></View>
            </View>
          ) : (
            <View style={[styles.awaitingLocation, { backgroundColor: palette.surfaceSoft }]}>
              {loading ? <Radio size={18} color={palette.primary} /> : <CloudOff size={18} color={palette.muted} />}
              <Text style={{ color: palette.muted }}>{loading ? copy.loadingLive : copy.awaitingFirstLocation}</Text>
            </View>
          )}

          {tracking && membership?.role === "pilot" && (
            <View style={styles.operationsSection}>
              <Text style={[styles.kicker, { color: palette.primary }]}>{copy.retrievalOperations}</Text>
              {pilotJob ? (
                <View style={[styles.operationCard, { backgroundColor: pilotJob.urgency === "emergency" ? palette.dangerSoft : palette.surfaceSoft }]}>
                  <View style={styles.operationHeading}>
                    {pilotJob.urgency === "emergency" ? <AlertTriangle size={18} color={palette.danger} /> : <Car size={18} color={palette.primary} />}
                    <View style={styles.operationIdentity}>
                      <Text style={[styles.operationTitle, { color: palette.text }]}>{copy[pilotJob.status]}</Text>
                      <Text style={[styles.operationMeta, { color: palette.muted }]}>{pilotJob.assignedRetrieverName ?? pilotJob.offeredRetrieverName ?? copy.assignedRetriever}</Text>
                    </View>
                  </View>
                  {pilotJob.status === "searching" && <Pressable disabled={busy} onPress={() => void findRetrievers(pilotJob.urgency)} style={[styles.smallPrimary, { backgroundColor: palette.primary }]}><Text style={styles.smallPrimaryText}>{copy.nearbyRetrievers}</Text></Pressable>}
                  {["offered", "assigned"].includes(pilotJob.status) && <Pressable disabled={busy} onPress={() => void progress(pilotJob, "cancelled")} style={styles.textButton}><Text style={{ color: palette.danger }}>{copy.cancelRequest}</Text></Pressable>}
                  {["delivered", "cancelled"].includes(pilotJob.status) && <Pressable disabled={busy} onPress={() => void finish()} style={[styles.smallPrimary, { backgroundColor: palette.primary }]}><PackageCheck size={15} color="#FFFFFF" /><Text style={styles.smallPrimaryText}>{copy.endTracking}</Text></Pressable>}
                </View>
              ) : (
                <View style={styles.splitActions}>
                  <Pressable disabled={busy} onPress={() => void findRetrievers("emergency")} style={[styles.actionButton, { backgroundColor: palette.danger }]}><AlertTriangle size={16} color="#FFFFFF" /><Text style={styles.actionText}>{copy.emergency}</Text></Pressable>
                  <Pressable disabled={busy} onPress={() => void findRetrievers("normal")} style={[styles.actionButton, { backgroundColor: palette.primary }]}><MapPinned size={16} color="#FFFFFF" /><Text style={styles.actionText}>{copy.landAndFind}</Text></Pressable>
                </View>
              )}
              {nearby.length > 0 && <View style={styles.nearbyList}><Text style={[styles.sectionLabel, { color: palette.text }]}>{copy.nearbyRetrievers}</Text>{nearby.map((retriever) => <View key={retriever.userId} style={[styles.nearbyRow, { backgroundColor: palette.surfaceSoft }]}><View style={styles.operationIdentity}><Text style={[styles.operationTitle, { color: palette.text }]}>{retriever.displayName}</Text><Text style={[styles.operationMeta, { color: palette.muted }]}>{retriever.distanceKm.toFixed(1)} km · {retriever.capacity - retriever.assignedCount} {copy.seats}</Text></View><Pressable disabled={busy} onPress={() => void selectRetriever(retriever.userId)} style={[styles.chooseButton, { backgroundColor: palette.primary }]}><Text style={styles.smallPrimaryText}>{copy.choose}</Text></Pressable></View>)}</View>}
            </View>
          )}

          {membership?.role === "retriever" && (
            <View style={styles.operationsSection}>
              <Text style={[styles.kicker, { color: palette.primary }]}>{copy.configureVehicle}</Text>
              <View style={[styles.vehicleCard, { backgroundColor: palette.surfaceSoft }]}>
                <View><Text style={[styles.sectionLabel, { color: palette.text }]}>{copy.vehicleCapacity}</Text><Text style={[styles.operationMeta, { color: palette.muted }]}>{ownRetriever?.assignedCount ?? 0}/{capacity} {copy.seats}</Text></View>
                <View style={styles.capacityControl}><Pressable disabled={busy || capacity <= Math.max(1, ownRetriever?.assignedCount ?? 0)} onPress={() => setCapacityOverride(Math.max(1, capacity - 1))} style={[styles.capacityButton, { borderColor: palette.line }]}><Minus size={14} color={palette.text} /></Pressable><Text style={[styles.capacityValue, { color: palette.text }]}>{capacity}</Text><Pressable disabled={busy || capacity >= 12} onPress={() => setCapacityOverride(Math.min(12, capacity + 1))} style={[styles.capacityButton, { borderColor: palette.line }]}><Plus size={14} color={palette.text} /></Pressable></View>
              </View>
              <View style={styles.statusRow}>{(["available", "busy", "inactive"] as const).map((availability) => <Pressable key={availability} disabled={busy} onPress={() => void setAvailability(availability)} style={[styles.statusButton, { borderColor: ownRetriever?.availability === availability ? palette.primary : palette.line, backgroundColor: ownRetriever?.availability === availability ? palette.primarySoft : palette.surface }]}><Text style={{ color: ownRetriever?.availability === availability ? palette.primary : palette.muted, fontSize: 9, fontWeight: "800" }}>{copy[availability]}</Text></Pressable>)}</View>

              {offers.map((job) => <View key={job.id} style={[styles.operationCard, { backgroundColor: job.urgency === "emergency" ? palette.dangerSoft : palette.primarySoft }]}><View style={styles.operationHeading}>{job.urgency === "emergency" ? <AlertTriangle size={18} color={palette.danger} /> : <Radio size={18} color={palette.primary} />}<View style={styles.operationIdentity}><Text style={[styles.operationTitle, { color: palette.text }]}>{job.pilotName}</Text><Text style={[styles.operationMeta, { color: palette.muted }]}>{job.pilotRadioCallsign ?? copy.offered}</Text></View></View><View style={styles.splitActions}><Pressable disabled={busy} onPress={() => void respond(job, false)} style={[styles.outlineAction, { borderColor: palette.danger }]}><X size={15} color={palette.danger} /><Text style={{ color: palette.danger, fontSize: 9, fontWeight: "800" }}>{copy.reject}</Text></Pressable><Pressable disabled={busy} onPress={() => void respond(job, true)} style={[styles.actionButton, { backgroundColor: palette.primary }]}><Check size={15} color="#FFFFFF" /><Text style={styles.actionText}>{copy.accept}</Text></Pressable></View></View>)}

              {assignedJobs.length > 0 && <Text style={[styles.sectionLabel, { color: palette.text }]}>{copy.activePickups}</Text>}
              {assignedJobs.map((job) => <View key={job.id} style={[styles.operationCard, { backgroundColor: palette.surfaceSoft }]}><View style={styles.operationHeading}><Car size={18} color={palette.primary} /><View style={styles.operationIdentity}><Text style={[styles.operationTitle, { color: palette.text }]}>{job.pilotName}</Text><Text style={[styles.operationMeta, { color: palette.muted }]}>{copy[job.status]}</Text></View></View><View style={styles.jobActions}><Pressable onPress={() => openCoordinates(job.landing.latitude, job.landing.longitude)} style={styles.textButton}><Navigation size={13} color={palette.primary} /><Text style={{ color: palette.primary, fontSize: 9, fontWeight: "800" }}>{copy.openDirections}</Text></Pressable>{job.status === "assigned" ? <Pressable disabled={busy} onPress={() => void progress(job, "picked_up")} style={[styles.smallPrimary, { backgroundColor: palette.primary }]}><Text style={styles.smallPrimaryText}>{copy.pickup}</Text></Pressable> : <Pressable disabled={busy} onPress={() => void progress(job, "delivered")} style={[styles.smallPrimary, { backgroundColor: palette.primary }]}><Text style={styles.smallPrimaryText}>{copy.deliver}</Text></Pressable>}</View></View>)}
            </View>
          )}

          {message && <Text style={[styles.message, { color: palette.muted }]}>{message}</Text>}
          {canTrack && !tracking && <Pressable disabled={busy} onPress={confirmBegin} style={[styles.missionButton, { backgroundColor: palette.primary }, busy && styles.disabled]}><Play size={17} color="#FFFFFF" fill="#FFFFFF" /><Text style={styles.missionButtonText}>{busy ? copy.working : copy.startMission}</Text></Pressable>}
          {tracking && membership?.role === "retriever" && assignedJobs.length === 0 && offers.length === 0 && <Pressable disabled={busy} onPress={() => void finish()} style={[styles.missionButton, { backgroundColor: palette.danger }, busy && styles.disabled]}><Square size={16} color="#FFFFFF" fill="#FFFFFF" /><Text style={styles.missionButtonText}>{copy.endTracking}</Text></Pressable>}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topOverlay: { position: "absolute", top: 0, right: 0, left: 0 },
  topBar: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingTop: 8 },
  roundButton: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderWidth: 1, borderRadius: 14 },
  eventChip: { flex: 1, minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 13, borderWidth: 1, borderRadius: 15 },
  liveDot: { width: 8, height: 8, borderRadius: 8 },
  eventName: { maxWidth: 190, fontSize: 11, fontWeight: "800" },
  connectionText: { marginTop: 1, fontSize: 8, fontWeight: "700", textTransform: "uppercase" },
  counterChip: { height: 42, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderRadius: 14 },
  counterText: { color: "#FFFFFF", fontSize: 11, fontWeight: "800" },
  marker: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: "rgba(255,255,255,.8)", borderRadius: 18, shadowColor: "#000", shadowOpacity: 0.22, shadowRadius: 6, shadowOffset: { width: 0, height: 4 } },
  missionPanel: { position: "absolute", right: 12, bottom: 12, left: 12, maxHeight: "61%", padding: 18, borderWidth: 1, borderRadius: 25 },
  panelHandle: { alignSelf: "center", width: 34, height: 4, marginBottom: 15, borderRadius: 3, backgroundColor: "#CBD5D1" },
  panelHeading: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  kicker: { fontSize: 8, fontWeight: "800", letterSpacing: 0.9, textTransform: "uppercase" },
  panelTitle: { marginTop: 4, fontSize: 20, fontWeight: "800", letterSpacing: -0.5 },
  recordingBadge: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 99 },
  recordingDot: { width: 6, height: 6, borderRadius: 6, backgroundColor: "#D9655C" },
  telemetryRow: { flexDirection: "row", gap: 8, marginTop: 16 },
  metric: { flex: 1, minHeight: 68, alignItems: "center", justifyContent: "center", borderRadius: 14 },
  metricValue: { marginTop: 3, fontSize: 14, fontWeight: "800" },
  metricUnit: { fontSize: 7, fontWeight: "700", textTransform: "uppercase" },
  awaitingLocation: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 10, marginTop: 16, paddingHorizontal: 14, borderRadius: 14 },
  operationsSection: { gap: 9, marginTop: 18 },
  operationCard: { gap: 10, padding: 13, borderRadius: 15 },
  operationHeading: { flexDirection: "row", alignItems: "center", gap: 10 },
  operationIdentity: { flex: 1 },
  operationTitle: { fontSize: 11, fontWeight: "800" },
  operationMeta: { marginTop: 2, fontSize: 8, lineHeight: 12 },
  splitActions: { flexDirection: "row", gap: 8 },
  actionButton: { flex: 1, minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 9, borderRadius: 13 },
  actionText: { color: "#FFFFFF", fontSize: 9, fontWeight: "800" },
  outlineAction: { flex: 1, minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderRadius: 13 },
  smallPrimary: { minHeight: 36, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 12, borderRadius: 11 },
  smallPrimaryText: { color: "#FFFFFF", fontSize: 9, fontWeight: "800" },
  textButton: { minHeight: 30, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  nearbyList: { gap: 7 },
  sectionLabel: { fontSize: 10, fontWeight: "800" },
  nearbyRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 11, borderRadius: 13 },
  chooseButton: { minWidth: 58, minHeight: 34, alignItems: "center", justifyContent: "center", borderRadius: 10 },
  vehicleCard: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 12, borderRadius: 14 },
  capacityControl: { flexDirection: "row", alignItems: "center", gap: 10 },
  capacityButton: { width: 31, height: 31, alignItems: "center", justifyContent: "center", borderWidth: 1, borderRadius: 10 },
  capacityValue: { minWidth: 18, textAlign: "center", fontSize: 13, fontWeight: "800" },
  statusRow: { flexDirection: "row", gap: 7 },
  statusButton: { flex: 1, minHeight: 37, alignItems: "center", justifyContent: "center", borderWidth: 1, borderRadius: 11 },
  jobActions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 9 },
  message: { marginTop: 11, fontSize: 9, lineHeight: 13 },
  missionButton: { minHeight: 49, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 14, borderRadius: 15 },
  missionButtonText: { color: "#FFFFFF", fontSize: 11, fontWeight: "800" },
  disabled: { opacity: 0.55 },
});
