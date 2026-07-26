import { Redirect, Stack } from "expo-router";

import { useAuth } from "../../src/contexts/AuthContext";

export default function AuthLayout() {
  const { user, initializing } = useAuth();

  if (!initializing && user) {
    return <Redirect href="/home" />;
  }

  return <Stack screenOptions={{ headerShown: false, animation: "fade_from_bottom" }} />;
}
