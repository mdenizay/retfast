import { Redirect } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { useAuth } from "../src/contexts/AuthContext";
import { usePreferences } from "../src/contexts/PreferencesContext";

export default function Index() {
  const { user, initializing } = useAuth();
  const { palette } = usePreferences();

  if (initializing) {
    return (
      <View style={[styles.loading, { backgroundColor: palette.background }]}>
        <ActivityIndicator color={palette.primary} />
      </View>
    );
  }

  return <Redirect href={user ? "/home" : "/login"} />;
}

const styles = StyleSheet.create({ loading: { flex: 1, alignItems: "center", justifyContent: "center" } });
