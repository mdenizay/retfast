import { Link } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Rect } from 'react-native-svg';
import { Button, ErrorBox, Input, Text } from '../components/ui';
import { errorCode } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useSession } from '../lib/session';
import { useColors } from '../lib/theme';

export function Logo({ size = 72 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 1024 1024">
      <Rect width="1024" height="1024" rx="230" fill="#000" />
      <Path fill="#fff" d="M512 164 790 850 512 704 234 850 512 164Zm0 176-125 310 125-66 125 66-125-310Z" />
    </Svg>
  );
}

export default function Login() {
  const { t, err } = useI18n();
  const c = useColors();
  const inset = useSafeAreaInsets();
  const { login } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(undefined);
    try {
      await login(email.trim(), password);
    } catch (e) {
      setError(err(errorCode(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24, paddingTop: inset.top + 24, paddingBottom: inset.bottom + 24, gap: 28 }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', gap: 14 }}>
          <Logo />
          <Text v="large">Retfast</Text>
          <Text v="sub" style={{ textAlign: 'center' }}>{t('app.tagline')}</Text>
        </View>
        <View style={{ gap: 14 }}>
          <Input label={t('auth.email')} value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="username" autoComplete="email" />
          <Input label={t('auth.password')} value={password} onChangeText={setPassword} secureTextEntry textContentType="password" autoComplete="current-password" onSubmitEditing={() => void submit()} />
          <ErrorBox>{error}</ErrorBox>
          <Button variant="primary" size="lg" title={t('nav.login')} loading={busy} disabled={!email || !password} onPress={() => void submit()} />
        </View>
        <View style={{ alignItems: 'center', gap: 4 }}>
          <Text v="sub">{t('auth.no_account')}</Text>
          <Link href="/register"><Text v="headline" color={c.tintText}>{t('nav.register')}</Text></Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
