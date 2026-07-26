import { Moon, Sun } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { usePreferences } from "../contexts/PreferencesContext";

export function PreferencesBar() {
  const { locale, setLocale, theme, setTheme, palette } = usePreferences();

  return (
    <View style={styles.row}>
      <View style={[styles.locale, { borderColor: palette.line, backgroundColor: palette.surface }]}>
        {(["tr", "en"] as const).map((item) => (
          <Pressable
            key={item}
            onPress={() => setLocale(item)}
            style={[
              styles.localeButton,
              locale === item && { backgroundColor: palette.primarySoft },
            ]}
          >
            <Text style={[styles.localeText, { color: locale === item ? palette.text : palette.faint }]}>
              {item.toUpperCase()}
            </Text>
          </Pressable>
        ))}
      </View>
      <Pressable
        onPress={() => setTheme(theme === "light" ? "dark" : "light")}
        style={[styles.themeButton, { borderColor: palette.line, backgroundColor: palette.surface }]}
      >
        {theme === "light" ? (
          <Moon size={17} color={palette.muted} />
        ) : (
          <Sun size={17} color={palette.muted} />
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  locale: { flexDirection: "row", padding: 3, borderWidth: 1, borderRadius: 10 },
  localeButton: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 7 },
  localeText: { fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },
  themeButton: {
    width: 36,
    height: 36,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
});
