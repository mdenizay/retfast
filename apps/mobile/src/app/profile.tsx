import type { Locale } from '@retfast/core';
import Constants from 'expo-constants';
import { Button, Card, Screen, Segmented, Text } from '../components/ui';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useSession } from '../lib/session';

export default function Profile() {
  const { t, locale } = useI18n();
  const { user, setUser, logout } = useSession();
  if (!user) return null;
  return (
    <Screen>
      <Card>
        <Text v="title">{user.first_name} {user.last_name}</Text>
        <Text v="sub">{user.email}</Text>
      </Card>
      <Card>
        <Text v="section">{t('form.language')}</Text>
        <Segmented<Locale> value={locale} options={[{ value: 'tr', label: 'Türkçe' }, { value: 'en', label: 'English' }]} onChange={(l) => void api.me.update({ locale: l }).then(setUser)} />
      </Card>
      <Button variant="danger" title={t('nav.logout')} onPress={() => void logout()} />
      <Text v="foot" style={{ textAlign: 'center' }}>Retfast {Constants.expoConfig?.version}</Text>
    </Screen>
  );
}
