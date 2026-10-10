import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { UserRound } from 'lucide-react-native';
import { Pressable } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Loading } from '../components/ui';
import { useI18n } from '../lib/i18n';
import { SessionProvider, useSession } from '../lib/session';
import { useColors } from '../lib/theme';
import { TrackerProvider } from '../lib/tracker';

function Navigator() {
  const { user, loading } = useSession();
  const { t } = useI18n();
  const c = useColors();
  if (loading) return <Loading />;
  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerTintColor: c.label, headerStyle: { backgroundColor: c.bg }, headerShadowVisible: false, contentStyle: { backgroundColor: c.bg } }}>
        <Stack.Protected guard={!!user}>
          <Stack.Screen
            name="index"
            options={{
              title: t('dash.title'),
              headerLargeTitle: true,
              headerRight: () => (
                <Pressable onPress={() => router.push('/profile')} hitSlop={12} accessibilityLabel={t('nav.profile')}>
                  <UserRound size={22} color={c.label} />
                </Pressable>
              ),
            }}
          />
          <Stack.Screen name="event/[id]" options={{ title: '', headerBackTitle: t('common.back') }} />
          <Stack.Screen name="profile" options={{ title: t('nav.profile'), presentation: 'modal' }} />
        </Stack.Protected>
        <Stack.Protected guard={!user}>
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="register" options={{ title: '', headerBackTitle: t('common.back') }} />
        </Stack.Protected>
      </Stack>
    </>
  );
}

export default function Root() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SessionProvider>
          <TrackerProvider>
            <Navigator />
          </TrackerProvider>
        </SessionProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
