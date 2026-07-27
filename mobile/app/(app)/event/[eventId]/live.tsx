import { router, useLocalSearchParams } from "expo-router";
import {
  ArrowLeft,
  BatteryMedium,
  CloudOff,
  Gauge,
  MapPinned,
  Navigation,
  Play,
  Radio,
  Square,
  Users,
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
          { backgroundColor: isPilot ? "#D9655C" : "#126B5B", opacity: participant.online ? 1 : 0.55 },
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
  const [tracking, setTracking] = useState<ActiveTrackingState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const mapReference = useRef<MapView>(null);
  const ownLive = participants.find((participant) => participant.userId === user?.uid);
  const canTrack = membership?.role === "pilot" || membership?.role === "retriever";

  useEffect(() => {
    void currentTrackingState().then((state) => {
      setTracking(state?.eventId === eventId ? state : null);
    });
  }, [eventId]);

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
      await stopTracking("completed");
      setTracking(null);
      setMessage(copy.trackSaved);
    } catch {
      setTracking(await currentTrackingState());
      setMessage(copy.trackPendingSync);
    } finally {
      setBusy(false);
    }
  }

  function openDirections(participant: LiveParticipant) {
    const destination = `${participant.latitude},${participant.longitude}`;
    const url = Platform.OS === "ios"
      ? `maps://?daddr=${destination}&dirflg=d`
      : `google.navigation:q=${destination}`;
    void Linking.openURL(url);
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

        {activeParticipants.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.peopleRow}>
            {activeParticipants.map((participant) => (
              <Pressable
                key={participant.userId}
                onPress={() => membership?.role === "retriever" && participant.role === "pilot" ? openDirections(participant) : undefined}
                style={[styles.personCard, { backgroundColor: palette.surfaceSoft }]}
              >
                <View style={[styles.personRole, { backgroundColor: participant.role === "pilot" ? "#D9655C" : palette.primary }]}><Navigation size={12} color="#FFFFFF" /></View>
                <View><Text numberOfLines={1} style={[styles.personName, { color: palette.text }]}>{participant.displayName}</Text><Text style={[styles.personMeta, { color: palette.muted }]}>{copy[participant.role]} · {Math.round(participant.altitude ?? 0)} m</Text></View>
              </Pressable>
            ))}
          </ScrollView>
        )}

        {message && <Text style={[styles.message, { color: palette.muted }]}>{message}</Text>}
        {canTrack && (
          <Pressable
            disabled={busy || Boolean(tracking?.pendingOutcome)}
            onPress={tracking ? () => void finish() : confirmBegin}
            style={[
              styles.missionButton,
              { backgroundColor: tracking ? palette.danger : palette.primary },
              busy && styles.disabled,
            ]}
          >
            {tracking ? <Square size={16} color="#FFFFFF" fill="#FFFFFF" /> : <Play size={17} color="#FFFFFF" fill="#FFFFFF" />}
            <Text style={styles.missionButtonText}>{busy ? copy.working : tracking ? copy.completeMission : copy.startMission}</Text>
          </Pressable>
        )}
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
  missionPanel: { position: "absolute", right: 12, bottom: 12, left: 12, maxHeight: "47%", padding: 18, borderWidth: 1, borderRadius: 25 },
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
  peopleRow: { gap: 8, paddingTop: 13 },
  personCard: { minWidth: 150, flexDirection: "row", alignItems: "center", gap: 9, padding: 10, borderRadius: 13 },
  personRole: { width: 29, height: 29, alignItems: "center", justifyContent: "center", borderRadius: 10 },
  personName: { maxWidth: 105, fontSize: 10, fontWeight: "800" },
  personMeta: { marginTop: 2, fontSize: 8 },
  message: { marginTop: 11, fontSize: 9, lineHeight: 13 },
  missionButton: { minHeight: 49, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 14, borderRadius: 15 },
  missionButtonText: { color: "#FFFFFF", fontSize: 11, fontWeight: "800" },
  disabled: { opacity: 0.55 },
});
