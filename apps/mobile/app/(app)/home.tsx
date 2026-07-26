import { router } from "expo-router";
import {
  CalendarDays,
  ChevronRight,
  KeyRound,
  LogOut,
  MapPin,
  ShieldCheck,
  Users,
} from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Brand } from "../../src/components/Brand";
import { PreferencesBar } from "../../src/components/PreferencesBar";
import { useAuth } from "../../src/contexts/AuthContext";
import { usePreferences } from "../../src/contexts/PreferencesContext";
import { type MobileEvent, useMobileEvents } from "../../src/lib/events";

export default function HomeScreen() {
  const { user, profile, signOut } = useAuth();
  const { copy, locale, palette } = usePreferences();
  const { events, membershipByEvent, loading } = useMobileEvents();

  function eventDate(event: MobileEvent) {
    return new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(event.startsAt.toDate());
  }

  async function logout() {
    await signOut();
    router.replace("/login");
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}>
      <View style={styles.header}><Brand /><PreferencesBar /></View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.greetingRow}><View><Text style={[styles.eyebrow, { color: palette.primary }]}>{copy.operations}</Text><Text style={[styles.title, { color: palette.text }]}>{copy.welcome},{"\n"}{profile?.displayName || user?.displayName || user?.email?.split("@")[0]}.</Text></View>{profile?.globalRole === "superadmin" && <View style={[styles.adminBadge, { backgroundColor: palette.primarySoft }]}><ShieldCheck size={14} color={palette.primary} /><Text style={[styles.adminText, { color: palette.primary }]}>{copy.superadmin}</Text></View>}</View>

        <View style={styles.sectionHeader}><View><Text style={[styles.sectionKicker, { color: palette.primary }]}>{copy.eventOperations}</Text><Text style={[styles.sectionTitle, { color: palette.text }]}>{copy.events}</Text></View><View style={[styles.countBadge, { borderColor: palette.line, backgroundColor: palette.surface }]}><Text style={[styles.countText, { color: palette.text }]}>{events.length}</Text></View></View>

        {loading ? <View style={[styles.emptyCard, { borderColor: palette.line, backgroundColor: palette.surface }]}><Text style={{ color: palette.muted }}>{copy.loadingEvents}</Text></View> : events.length === 0 ? <View style={[styles.emptyCard, { borderColor: palette.line, backgroundColor: palette.surface }]}><CalendarDays size={30} color={palette.primary} /><Text style={[styles.emptyTitle, { color: palette.text }]}>{copy.noEvents}</Text><Text style={[styles.emptyText, { color: palette.muted }]}>{copy.noEventsText}</Text></View> : <View style={styles.eventList}>{events.map((event) => {
          const membership = membershipByEvent.get(event.id);
          return <Pressable key={event.id} onPress={() => router.push({ pathname: "/event/[eventId]", params: { eventId: event.id } })} style={({ pressed }) => [styles.eventCard, { borderColor: palette.line, backgroundColor: palette.surface, opacity: pressed ? 0.78 : 1 }]}><View style={styles.cardTop}><View style={[styles.statusBadge, { backgroundColor: event.status === "active" ? palette.successSoft : palette.surfaceSoft }]}><Text style={[styles.statusText, { color: event.status === "active" ? palette.success : palette.muted }]}>{copy[event.status]}</Text></View>{membership && <Text style={[styles.roleText, { color: palette.primary }]}>{membership.role ? copy[membership.role] : copy[membership.status]}</Text>}</View><Text style={[styles.eventName, { color: palette.text }]}>{event.name}</Text><Text numberOfLines={2} style={[styles.eventDescription, { color: palette.muted }]}>{event.description || copy.noDescription}</Text><View style={styles.metaRow}><View style={styles.metaItem}><MapPin size={14} color={palette.primary} /><Text numberOfLines={1} style={[styles.metaText, { color: palette.muted }]}>{event.venue}</Text></View><View style={styles.metaItem}><CalendarDays size={14} color={palette.primary} /><Text style={[styles.metaText, { color: palette.muted }]}>{eventDate(event)}</Text></View><View style={styles.metaItem}><Users size={14} color={palette.primary} /><Text style={[styles.metaText, { color: palette.muted }]}>{event.participantCount}</Text></View></View><ChevronRight style={styles.chevron} size={20} color={palette.faint} /></Pressable>;
        })}</View>}

        <View style={styles.actions}><Pressable onPress={() => router.push("/change-password")} style={[styles.action, { borderColor: palette.line, backgroundColor: palette.surface }]}><KeyRound size={17} color={palette.primary} /><Text style={[styles.actionText, { color: palette.text }]}>{copy.changePassword}</Text></Pressable><Pressable onPress={() => void logout()} style={[styles.action, { borderColor: palette.line, backgroundColor: palette.surface }]}><LogOut size={17} color={palette.muted} /><Text style={[styles.actionText, { color: palette.text }]}>{copy.signOut}</Text></Pressable></View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 22, paddingTop: 8, paddingBottom: 10 },
  content: { paddingHorizontal: 22, paddingTop: 38, paddingBottom: 42 },
  greetingRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  eyebrow: { marginBottom: 9, fontSize: 10, fontWeight: "800", letterSpacing: 1.1, textTransform: "uppercase" },
  title: { fontSize: 38, lineHeight: 42, fontWeight: "800", letterSpacing: -1.4 },
  adminBadge: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, paddingVertical: 7, borderRadius: 99 },
  adminText: { fontSize: 9, fontWeight: "800", textTransform: "uppercase" },
  sectionHeader: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginTop: 52, marginBottom: 17 },
  sectionKicker: { fontSize: 9, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase" },
  sectionTitle: { marginTop: 4, fontSize: 24, fontWeight: "800", letterSpacing: -0.6 },
  countBadge: { minWidth: 34, minHeight: 28, alignItems: "center", justifyContent: "center", borderWidth: 1, borderRadius: 99 },
  countText: { fontSize: 11, fontWeight: "800" },
  eventList: { gap: 12 },
  eventCard: { position: "relative", minHeight: 190, padding: 18, borderWidth: 1, borderRadius: 20 },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 99 },
  statusText: { fontSize: 8, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase" },
  roleText: { fontSize: 9, fontWeight: "800" },
  eventName: { marginTop: 17, paddingRight: 24, fontSize: 18, fontWeight: "800", letterSpacing: -0.3 },
  eventDescription: { minHeight: 36, marginTop: 7, paddingRight: 22, fontSize: 11, lineHeight: 17 },
  metaRow: { flexDirection: "row", gap: 14, marginTop: 18 },
  metaItem: { maxWidth: "38%", flexDirection: "row", alignItems: "center", gap: 5 },
  metaText: { fontSize: 9, fontWeight: "600" },
  chevron: { position: "absolute", right: 14, top: "54%" },
  emptyCard: { minHeight: 210, alignItems: "center", justifyContent: "center", padding: 28, borderWidth: 1, borderRadius: 20 },
  emptyTitle: { marginTop: 14, fontSize: 17, fontWeight: "800" },
  emptyText: { marginTop: 6, textAlign: "center", fontSize: 11, lineHeight: 17 },
  actions: { flexDirection: "row", gap: 10, marginTop: 28 },
  action: { flex: 1, minHeight: 47, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderWidth: 1, borderRadius: 13 },
  actionText: { fontSize: 11, fontWeight: "700" },
});
