import { Navigation } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";

import { usePreferences } from "../contexts/PreferencesContext";

export function Brand({ centered = false }: { centered?: boolean }) {
  const { palette } = usePreferences();

  return (
    <View style={[styles.brand, centered && styles.centered]}>
      <View style={[styles.symbol, { backgroundColor: palette.lime }]}>
        <Navigation size={19} color="#0B5B4D" strokeWidth={2.5} />
      </View>
      <Text style={[styles.word, { color: palette.text }]}>RETFAST</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  brand: { flexDirection: "row", alignItems: "center", gap: 10 },
  centered: { justifyContent: "center" },
  symbol: {
    width: 39,
    height: 39,
    borderRadius: 12,
    borderBottomLeftRadius: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  word: {
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 2.8,
  },
});
