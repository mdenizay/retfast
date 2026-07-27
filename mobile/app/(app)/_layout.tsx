import { Redirect, Stack } from "expo-router";

import { useAuth } from "../../src/contexts/AuthContext";

export default function AppLayout() {
  const { user, initializing } = useAuth();

  if (!initializing && !user) {
    return <Redirect href="/login" />;
  }

  return <Stack screenOptions={{ headerShown: false, animation: "fade_from_bottom" }} />;
}
