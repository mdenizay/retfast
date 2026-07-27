import { Link, router } from "expo-router";
import { LockKeyhole, Mail } from "lucide-react-native";
import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { AuthScreen } from "../../src/components/AuthScreen";
import { Divider, PrimaryButton, SocialButton } from "../../src/components/Buttons";
import { FormField } from "../../src/components/FormField";
import { FormMessage } from "../../src/components/FormMessage";
import { useAuth } from "../../src/contexts/AuthContext";
import { usePreferences } from "../../src/contexts/PreferencesContext";
import { getAuthErrorMessage } from "../../src/lib/auth-errors";

export default function LoginScreen() {
  const { copy, palette } = usePreferences();
  const { signIn, signInWithGoogle, signInWithApple } = useAuth();
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

  return (
    <AuthScreen title={copy.signInTitle} description={copy.signInDescription}>
      <View style={styles.stack}>
        <SocialButton provider="google" label={copy.continueWithGoogle} loading={loading} onPress={() => void run(signInWithGoogle)} />
        {Platform.OS === "ios" ? (
          <SocialButton provider="apple" label={copy.continueWithApple} loading={loading} onPress={() => void run(signInWithApple)} />
        ) : null}
        <Divider label={copy.or} />
        <FormField label={copy.email} icon={Mail} keyboardType="email-address" autoComplete="email" value={email} onChangeText={setEmail} />
        <FormField label={copy.password} icon={LockKeyhole} password autoComplete="current-password" value={password} onChangeText={setPassword} />
        <Link href="/forgot-password" asChild>
          <Pressable style={styles.forgot}><Text style={[styles.link, { color: palette.primary }]}>{copy.forgotPassword}</Text></Pressable>
        </Link>
        <FormMessage message={error} />
        <PrimaryButton label={copy.signIn} loading={loading} onPress={() => void run(() => signIn(email, password))} />
        <Text style={[styles.switchText, { color: palette.muted }]}>
          {copy.noAccount}{" "}
          <Link href="/register" style={{ color: palette.primary, fontWeight: "700" }}>{copy.createAccount}</Link>
        </Text>
      </View>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 15 },
  forgot: { alignSelf: "flex-end", marginTop: -2 },
  link: { fontSize: 12, fontWeight: "700" },
  switchText: { marginTop: 8, fontSize: 13, textAlign: "center" },
});
