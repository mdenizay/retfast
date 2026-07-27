import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider } from "../src/contexts/AuthContext";
import { PreferencesProvider } from "../src/contexts/PreferencesContext";
import "../src/notifications";
import "../src/tracking/background-task";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <PreferencesProvider>
        <AuthProvider>
          <Stack screenOptions={{ headerShown: false, animation: "fade" }} />
        </AuthProvider>
      </PreferencesProvider>
    </SafeAreaProvider>
  );
}
