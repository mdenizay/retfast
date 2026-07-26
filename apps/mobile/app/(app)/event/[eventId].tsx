import { router, useLocalSearchParams } from "expo-router";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock3,
  MapPin,
  Navigation,
  Users,
} from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { usePreferences } from "../../../src/contexts/PreferencesContext";
import {
  applyToEvent,
  useMobileEvent,
  useMobileEvents,
} from "../../../src/lib/events";

export default function EventScreen() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const { copy, locale, palette } = usePreferences();
  const { event, loading } = useMobileEvent(eventId);
  const { membershipByEvent } = useMobileEvents();
  const membership = eventId ? membershipByEvent.get(eventId) : undefined;
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [locale],
  );

  async function apply() {
    if (!eventId) return;
    setApplying(true);
    setMessage(null);
    try {
      await applyToEvent(eventId);
      setMessage(copy.applicationSent);
    } catch {
      setMessage(copy.commandFailed);
    } finally {
      setApplying(false);
    }
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}>
      <View style={styles.header}><Pressable onPress={() => router.back()} style={[styles.backButton, { borderColor: palette.line, backgroundColor: palette.surface }]}><ArrowLeft size={18} color={palette.text} /></Pressable><Text style={[styles.headerTitle, { color: palette.text }]}>{copy.events}</Text><View style={styles.headerSpacer} /></View>
      {loading || !event ? <View style={styles.loader}><Text style={{ color: palette.muted }}>{copy.loadingEvents}</Text></View> : <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.statusBadge, { backgroundColor: event.status === "active" ? palette.successSoft : palette.surfaceSoft }]}><Text style={[styles.statusText, { color: event.status === "active" ? palette.success : palette.muted }]}>{copy[event.status]}</Text></View>
        <Text style={[styles.title, { color: palette.text }]}>{event.name}</Text>
        <Text style={[styles.description, { color: palette.muted }]}>{event.description || copy.noDescription}</Text>

        <View style={styles.metaGrid}><View style={[styles.metaCard, { borderColor: palette.line, backgroundColor: palette.surface }]}><MapPin size={18} color={palette.primary} /><Text style={[styles.metaLabel, { color: palette.faint }]}>{copy.venue}</Text><Text style={[styles.metaValue, { color: palette.text }]}>{event.venue}</Text></View><View style={[styles.metaCard, { borderColor: palette.line, backgroundColor: palette.surface }]}><Users size={18} color={palette.primary} /><Text style={[styles.metaLabel, { color: palette.faint }]}>{copy.participants}</Text><Text style={[styles.metaValue, { color: palette.text }]}>{event.participantCount}</Text></View></View>
        <View style={[styles.scheduleCard, { borderColor: palette.line, backgroundColor: palette.surface }]}><View><CalendarDays size={18} color={palette.primary} /><Text style={[styles.metaLabel, { color: palette.faint }]}>{copy.starts}</Text><Text style={[styles.scheduleValue, { color: palette.text }]}>{formatter.format(event.startsAt.toDate())}</Text></View><View style={[styles.scheduleDivider, { backgroundColor: palette.line }]} /><View><Clock3 size={18} color={palette.primary} /><Text style={[styles.metaLabel, { color: palette.faint }]}>{copy.ends}</Text><Text style={[styles.scheduleValue, { color: palette.text }]}>{formatter.format(event.endsAt.toDate())}</Text></View></View>

        <View style={[styles.applicationCard, { borderColor: palette.line, backgroundColor: palette.surface }]}>{membership ? <><View style={[styles.applicationIcon, { backgroundColor: palette.primarySoft }]}><CheckCircle2 size={22} color={palette.primary} /></View><Text style={[styles.applicationKicker, { color: palette.primary }]}>{copy.myApplication}</Text><Text style={[styles.applicationTitle, { color: palette.text }]}>{membership.role ? copy[membership.role] : copy[membership.status]}</Text><Text style={[styles.applicationText, { color: palette.muted }]}>{membership.role ? copy.workspaceNextPhase : copy.applicationHint}</Text>{membership.role && <View style={[styles.rolePreview, { backgroundColor: palette.primaryStrong }]}><Navigation size={18} color={palette.lime} /><View><Text style={styles.rolePreviewLabel}>{copy.assignedRole}</Text><Text style={styles.rolePreviewValue}>{copy[membership.role]}</Text></View></View>}</> : <><Text style={[styles.applicationKicker, { color: palette.primary }]}>{copy.myApplication}</Text><Text style={[styles.applicationTitle, { color: palette.text }]}>{copy.notApplied}</Text><Text style={[styles.applicationText, { color: palette.muted }]}>{copy.applicationHint}</Text><Pressable disabled={applying} onPress={() => void apply()} style={[styles.applyButton, { backgroundColor: palette.primary }]}><Text style={styles.applyButtonText}>{applying ? copy.applying : copy.apply}</Text></Pressable></>}</View>
        {message && <View style={[styles.message, { backgroundColor: message === copy.applicationSent ? palette.successSoft : palette.dangerSoft }]}><Text style={{ color: message === copy.applicationSent ? palette.success : palette.danger, fontSize: 11 }}>{message}</Text></View>}
      </ScrollView>}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { minHeight: 58, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20 },
  backButton: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderWidth: 1, borderRadius: 12 },
  headerTitle: { fontSize: 12, fontWeight: "800" },
  headerSpacer: { width: 38 },
  loader: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 22, paddingTop: 35, paddingBottom: 45 },
  statusBadge: { alignSelf: "flex-start", paddingHorizontal: 9, paddingVertical: 7, borderRadius: 99 },
  statusText: { fontSize: 9, fontWeight: "800", letterSpacing: 0.7, textTransform: "uppercase" },
  title: { marginTop: 18, fontSize: 38, lineHeight: 42, fontWeight: "800", letterSpacing: -1.4 },
  description: { marginTop: 14, fontSize: 13, lineHeight: 20 },
  metaGrid: { flexDirection: "row", gap: 10, marginTop: 30 },
  metaCard: { flex: 1, minHeight: 112, padding: 15, borderWidth: 1, borderRadius: 17 },
  metaLabel: { marginTop: 12, fontSize: 8, fontWeight: "800", letterSpacing: 0.7, textTransform: "uppercase" },
  metaValue: { marginTop: 4, fontSize: 12, fontWeight: "800" },
  scheduleCard: { flexDirection: "row", marginTop: 10, padding: 17, borderWidth: 1, borderRadius: 17 },
  scheduleDivider: { width: 1, marginHorizontal: 17 },
  scheduleValue: { marginTop: 4, fontSize: 10, fontWeight: "700" },
  applicationCard: { marginTop: 20, padding: 22, borderWidth: 1, borderRadius: 20 },
  applicationIcon: { width: 43, height: 43, alignItems: "center", justifyContent: "center", marginBottom: 18, borderRadius: 14 },
  applicationKicker: { fontSize: 9, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },
  applicationTitle: { marginTop: 5, fontSize: 21, fontWeight: "800" },
  applicationText: { marginTop: 8, fontSize: 11, lineHeight: 17 },
  applyButton: { minHeight: 49, alignItems: "center", justifyContent: "center", marginTop: 21, borderRadius: 14 },
  applyButtonText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
  rolePreview: { flexDirection: "row", alignItems: "center", gap: 11, marginTop: 19, padding: 14, borderRadius: 14 },
  rolePreviewLabel: { color: "rgba(255,255,255,.62)", fontSize: 8, fontWeight: "700", textTransform: "uppercase" },
  rolePreviewValue: { marginTop: 2, color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
  message: { marginTop: 12, padding: 13, borderRadius: 12 },
});
