import { router } from "expo-router";
import { ArrowLeft, LockKeyhole } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AuthScreen } from "../../src/components/AuthScreen";
import { PrimaryButton } from "../../src/components/Buttons";
import { FormField } from "../../src/components/FormField";
import { FormMessage } from "../../src/components/FormMessage";
import { useAuth } from "../../src/contexts/AuthContext";
import { usePreferences } from "../../src/contexts/PreferencesContext";
import { getAuthErrorMessage } from "../../src/lib/auth-errors";

export default function ChangePasswordScreen() {
  const { copy, palette } = usePreferences();
  const { changePassword } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (nextPassword !== confirmation) {
      setError(copy.passwordMismatch);
      return;
    }
    if (nextPassword.length < 8) {
      setError(copy.weakPassword);
      return;
    }
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      await changePassword(currentPassword, nextPassword);
      setCurrentPassword("");
      setNextPassword("");
      setConfirmation("");
      setSuccess(copy.passwordChanged);
    } catch (nextError) {
      setError(getAuthErrorMessage(nextError, copy));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthScreen title={copy.changePasswordTitle}>
      <View style={styles.stack}>
        <Pressable onPress={() => router.back()} style={styles.back}><ArrowLeft size={16} color={palette.primary} /><Text style={{ color: palette.primary, fontWeight: "700" }}>RETFAST</Text></Pressable>
        <FormField label={copy.currentPassword} icon={LockKeyhole} password autoComplete="current-password" value={currentPassword} onChangeText={setCurrentPassword} />
        <FormField label={copy.newPassword} icon={LockKeyhole} password autoComplete="new-password" value={nextPassword} onChangeText={setNextPassword} hint={copy.passwordHint} />
        <FormField label={copy.confirmPassword} icon={LockKeyhole} password autoComplete="new-password" value={confirmation} onChangeText={setConfirmation} />
        <FormMessage message={success} kind="success" />
        <FormMessage message={error} />
        <PrimaryButton label={copy.updatePassword} loading={loading} onPress={() => void submit()} />
      </View>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({ stack: { gap: 15 }, back: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 } });
