import { Apple, Globe2, LoaderCircle } from "lucide-react-native";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { usePreferences } from "../contexts/PreferencesContext";

export function PrimaryButton({ label, loading, onPress }: { label: string; loading?: boolean; onPress: () => void }) {
  const { palette } = usePreferences();
  return (
    <Pressable
      disabled={loading}
      onPress={onPress}
      style={({ pressed }) => [styles.button, { backgroundColor: palette.primary }, pressed && styles.pressed, loading && styles.disabled]}
    >
      {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>{label}</Text>}
    </Pressable>
  );
}

export function SocialButton({ provider, label, loading, onPress }: { provider: "google" | "apple"; label: string; loading?: boolean; onPress: () => void }) {
  const { palette } = usePreferences();
  const Icon = provider === "google" ? Globe2 : Apple;
  return (
    <Pressable
      disabled={loading}
      onPress={onPress}
      style={({ pressed }) => [styles.button, styles.social, { borderColor: palette.line, backgroundColor: palette.surface }, pressed && styles.pressed, loading && styles.disabled]}
    >
      {loading ? <LoaderCircle size={19} color={palette.muted} /> : <Icon size={19} color={palette.text} />}
      <Text style={[styles.socialText, { color: palette.text }]}>{label}</Text>
    </Pressable>
  );
}

export function Divider({ label }: { label: string }) {
  const { palette } = usePreferences();
  return (
    <View style={styles.divider}>
      <View style={[styles.line, { backgroundColor: palette.line }]} />
      <Text style={[styles.dividerText, { color: palette.faint }]}>{label.toUpperCase()}</Text>
      <View style={[styles.line, { backgroundColor: palette.line }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 50, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 13 },
  social: { borderWidth: 1 },
  primaryText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  socialText: { fontSize: 14, fontWeight: "700" },
  pressed: { opacity: 0.78, transform: [{ scale: 0.995 }] },
  disabled: { opacity: 0.6 },
  divider: { flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 4 },
  line: { flex: 1, height: StyleSheet.hairlineWidth },
  dividerText: { fontSize: 9, fontWeight: "800", letterSpacing: 1 },
});
