import { Link, router } from "expo-router";
import { CheckCircle2, KeyRound, LogOut, Map, Navigation, RadioTower } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Brand } from "../../src/components/Brand";
import { PreferencesBar } from "../../src/components/PreferencesBar";
import { useAuth } from "../../src/contexts/AuthContext";
import { usePreferences } from "../../src/contexts/PreferencesContext";

export default function HomeScreen() {
  const { user, signOut } = useAuth();
  const { copy, palette } = usePreferences();

  async function logout() {
    await signOut();
    router.replace("/login");
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}>
      <View style={styles.header}><Brand /><PreferencesBar /></View>
      <View style={styles.content}>
        <View style={styles.eyebrow}><CheckCircle2 size={15} color={palette.primary} /><Text style={[styles.eyebrowText, { color: palette.primary }]}>{copy.ready}</Text></View>
        <Text style={[styles.title, { color: palette.text }]}>{copy.welcome},{"\n"}{user?.displayName || user?.email?.split("@")[0]}.</Text>
        <Text style={[styles.description, { color: palette.muted }]}>{copy.readyText}</Text>

        <View style={[styles.mapCard, { borderColor: palette.line, backgroundColor: palette.surface }]}>
          <View style={[styles.mapPattern, { borderColor: palette.line }]}><Map size={40} color={palette.primary} /></View>
          <View style={[styles.route, { backgroundColor: palette.lime }]}><Navigation size={17} color="#0B5B4D" /></View>
          <View style={styles.cardCopy}><Text style={[styles.cardTitle, { color: palette.text }]}>{copy.ready}</Text><Text style={[styles.cardText, { color: palette.muted }]}>{copy.readyText}</Text></View>
          <RadioTower size={20} color={palette.faint} />
        </View>

        <View style={styles.actions}>
          <Link href="/change-password" asChild><Pressable style={[styles.action, { borderColor: palette.line, backgroundColor: palette.surface }]}><KeyRound size={17} color={palette.primary} /><Text style={[styles.actionText, { color: palette.text }]}>{copy.changePassword}</Text></Pressable></Link>
          <Pressable onPress={() => void logout()} style={[styles.action, { borderColor: palette.line, backgroundColor: palette.surface }]}><LogOut size={17} color={palette.muted} /><Text style={[styles.actionText, { color: palette.text }]}>{copy.signOut}</Text></Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 22, paddingTop: 8 },
  content: { flex: 1, justifyContent: "center", paddingHorizontal: 24, paddingBottom: 36 },
  eyebrow: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 16 },
  eyebrowText: { fontSize: 10, fontWeight: "800", letterSpacing: 1.1, textTransform: "uppercase" },
  title: { fontSize: 44, lineHeight: 49, fontWeight: "800", letterSpacing: -1.8 },
  description: { marginTop: 15, fontSize: 15, lineHeight: 23 },
  mapCard: { minHeight: 165, marginTop: 34, padding: 20, borderWidth: 1, borderRadius: 22, overflow: "hidden" },
  mapPattern: { position: "absolute", top: -28, right: -20, width: 145, height: 145, borderWidth: 1, borderRadius: 99, alignItems: "center", justifyContent: "center", opacity: 0.75 },
  route: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  cardCopy: { maxWidth: "70%", marginTop: 30 },
  cardTitle: { fontSize: 16, fontWeight: "800" },
  cardText: { marginTop: 6, fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: "row", gap: 11, marginTop: 16 },
  action: { flex: 1, minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderRadius: 13 },
  actionText: { fontSize: 12, fontWeight: "700" },
});
