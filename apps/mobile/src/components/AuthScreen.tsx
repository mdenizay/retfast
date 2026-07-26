import { StatusBar } from "expo-status-bar";
import type { PropsWithChildren } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { usePreferences } from "../contexts/PreferencesContext";
import { Brand } from "./Brand";
import { PreferencesBar } from "./PreferencesBar";

type AuthScreenProps = PropsWithChildren<{
  title: string;
  description?: string;
}>;

export function AuthScreen({ title, description, children }: AuthScreenProps) {
  const { theme, palette, copy } = usePreferences();

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <StatusBar style={theme === "dark" ? "light" : "dark"} />
      <View style={styles.header}>
        <Brand />
        <PreferencesBar />
      </View>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.heroMark}>
            <View style={[styles.orbit, { borderColor: palette.line }]} />
            <View style={[styles.orbitInner, { borderColor: palette.line }]} />
            <View style={[styles.centerDot, { backgroundColor: palette.primary }]} />
          </View>
          <Text style={[styles.tagline, { color: palette.primary }]}>{copy.tagline}</Text>
          <Text style={[styles.title, { color: palette.text }]}>{title}</Text>
          {description ? (
            <Text style={[styles.description, { color: palette.muted }]}>{description}</Text>
          ) : null}
          <View style={styles.content}>{children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 22,
    paddingTop: 8,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingTop: 34,
    paddingBottom: 44,
  },
  heroMark: { width: 58, height: 58, alignSelf: "center", marginBottom: 15 },
  orbit: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, borderWidth: 1, borderRadius: 99 },
  orbitInner: { position: "absolute", top: 11, right: 11, bottom: 11, left: 11, borderWidth: 1, borderRadius: 99 },
  centerDot: { position: "absolute", top: 23, right: 23, bottom: 23, left: 23, borderRadius: 99 },
  tagline: {
    marginBottom: 8,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
    textAlign: "center",
    textTransform: "uppercase",
  },
  title: { fontSize: 30, lineHeight: 37, fontWeight: "800", letterSpacing: -1, textAlign: "center" },
  description: { maxWidth: 340, alignSelf: "center", marginTop: 8, fontSize: 14, lineHeight: 21, textAlign: "center" },
  content: { width: "100%", maxWidth: 430, alignSelf: "center", marginTop: 30 },
});
