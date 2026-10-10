import { useState } from 'react';
import { Button, ErrorBox, Input, Screen, Text } from '../components/ui';
import { errorCode } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useSession } from '../lib/session';

export default function Register() {
  const { t, err } = useI18n();
  const { register } = useSession();
  const [f, setF] = useState({ first_name: '', last_name: '', email: '', password: '' });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  async function submit() {
    setBusy(true);
    setError(undefined);
    try {
      await register({ ...f, email: f.email.trim(), first_name: f.first_name.trim(), last_name: f.last_name.trim() });
    } catch (e) {
      setError(err(errorCode(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Text v="large">{t('auth.register_title')}</Text>
      <Input label={t('auth.first_name')} value={f.first_name} onChangeText={set('first_name')} textContentType="givenName" autoComplete="given-name" />
      <Input label={t('auth.last_name')} value={f.last_name} onChangeText={set('last_name')} textContentType="familyName" autoComplete="family-name" />
      <Input label={t('auth.email')} value={f.email} onChangeText={set('email')} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress" autoComplete="email" />
      <Input label={`${t('auth.password')} (${t('auth.password_hint')})`} value={f.password} onChangeText={set('password')} secureTextEntry textContentType="newPassword" autoComplete="new-password" />
      <ErrorBox>{error}</ErrorBox>
      <Button variant="primary" size="lg" title={t('nav.register')} loading={busy} disabled={!f.first_name || !f.last_name || !f.email || f.password.length < 8} onPress={() => void submit()} />
    </Screen>
  );
}
