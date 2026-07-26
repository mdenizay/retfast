import { Link, router } from "expo-router";
import { LockKeyhole, Mail, UserRound } from "lucide-react-native";
import { useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

import { AuthScreen } from "../../src/components/AuthScreen";
import { Divider, PrimaryButton, SocialButton } from "../../src/components/Buttons";
import { FormField } from "../../src/components/FormField";
import { FormMessage } from "../../src/components/FormMessage";
import { useAuth } from "../../src/contexts/AuthContext";
import { usePreferences } from "../../src/contexts/PreferencesContext";
import { getAuthErrorMessage } from "../../src/lib/auth-errors";

export default function RegisterScreen() {
  const { copy, palette } = usePreferences();
  const { register, signInWithGoogle, signInWithApple } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function run(action: () => Promise<void>) {
    setLoading(true);
    setError("");
    try {
      await action();
      router.replace("/home");
    } catch (nextError) {
      setError(getAuthErrorMessage(nextError, copy));
    } finally {
      setLoading(false);
    }
  }

  function submit() {
    if (password.length < 8) {
      setError(copy.weakPassword);
      return;
    }
    void run(() => register(name, email, password));
  }

  return (
    <AuthScreen title={copy.registerTitle} description={copy.registerDescription}>
      <View style={styles.stack}>
        <SocialButton provider="google" label={copy.continueWithGoogle} loading={loading} onPress={() => void run(signInWithGoogle)} />
        {Platform.OS === "ios" ? <SocialButton provider="apple" label={copy.continueWithApple} loading={loading} onPress={() => void run(signInWithApple)} /> : null}
        <Divider label={copy.or} />
        <FormField label={copy.fullName} icon={UserRound} autoComplete="name" autoCapitalize="words" value={name} onChangeText={setName} />
        <FormField label={copy.email} icon={Mail} keyboardType="email-address" autoComplete="email" value={email} onChangeText={setEmail} />
        <FormField label={copy.password} icon={LockKeyhole} password autoComplete="new-password" value={password} onChangeText={setPassword} hint={copy.passwordHint} />
        <FormMessage message={error} />
        <PrimaryButton label={copy.createAccount} loading={loading} onPress={submit} />
        <Text style={[styles.switchText, { color: palette.muted }]}>{copy.haveAccount}{" "}<Link href="/login" style={{ color: palette.primary, fontWeight: "700" }}>{copy.signIn}</Link></Text>
      </View>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({ stack: { gap: 14 }, switchText: { marginTop: 8, fontSize: 13, textAlign: "center" } });
