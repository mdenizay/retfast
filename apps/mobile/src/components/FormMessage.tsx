import { StyleSheet, Text } from "react-native";

import { usePreferences } from "../contexts/PreferencesContext";

export function FormMessage({ message, kind = "error" }: { message?: string; kind?: "error" | "success" }) {
  const { palette } = usePreferences();
  if (!message) return null;
  const isError = kind === "error";
  return (
    <Text
      accessibilityRole={isError ? "alert" : undefined}
      style={[
        styles.message,
        {
          color: isError ? palette.danger : palette.success,
          backgroundColor: isError ? palette.dangerSoft : palette.successSoft,
          borderColor: isError ? palette.danger : palette.success,
        },
      ]}
    >
      {message}
    </Text>
  );
}

const styles = StyleSheet.create({
  message: { padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: 11, fontSize: 12, lineHeight: 18 },
});
