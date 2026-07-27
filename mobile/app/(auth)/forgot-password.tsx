import { Link } from "expo-router";
import { Mail } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { AuthScreen } from "../../src/components/AuthScreen";
import { PrimaryButton } from "../../src/components/Buttons";
import { FormField } from "../../src/components/FormField";
import { FormMessage } from "../../src/components/FormMessage";
import { useAuth } from "../../src/contexts/AuthContext";
import { usePreferences } from "../../src/contexts/PreferencesContext";
import { getAuthErrorMessage } from "../../src/lib/auth-errors";

export default function ForgotPasswordScreen() {
  const { copy, palette } = usePreferences();
  const { sendReset } = useAuth();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      await sendReset(email);
      setSuccess(copy.resetSent);
    } catch (nextError) {
      setError(getAuthErrorMessage(nextError, copy));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthScreen title={copy.forgotTitle} description={copy.forgotDescription}>
      <View style={styles.stack}>
        <FormField label={copy.email} icon={Mail} keyboardType="email-address" autoComplete="email" value={email} onChangeText={setEmail} />
        <FormMessage message={success} kind="success" />
        <FormMessage message={error} />
        <PrimaryButton label={copy.sendResetLink} loading={loading} onPress={() => void submit()} />
        <Link href="/login" style={[styles.back, { color: palette.primary }]}>{copy.backToSignIn}</Link>
      </View>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({ stack: { gap: 15 }, back: { marginTop: 8, fontSize: 13, fontWeight: "700", textAlign: "center" } });
