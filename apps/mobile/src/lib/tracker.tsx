import type { EventDetail, TrackingConfig } from '@retfast/core';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert } from 'react-native';
import { Tracking, type TrackingStatus } from '../../modules/retfast-tracking';
import { API_URL, api, errorCode, getToken } from './api';
import { useI18n } from './i18n';
import { useSession } from './session';

type Ctx = {
  status: TrackingStatus | null;
  /** Bu etkinlik için native takip açık mı? */
  isTrackingEvent: (eventId: string) => boolean;
  start: (ev: Pick<EventDetail, 'id' | 'name'>, role: 'pilot' | 'retriever') => Promise<void>;
  stop: (eventId: string) => Promise<void>;
  error: string | null;
  busy: boolean;
};

const Tracker = createContext<Ctx | null>(null);

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** İzin penceresi sonuçlanana (veya zaman aşımına) kadar bekle. */
async function settleAuthorization(): Promise<string> {
  for (let i = 0; i < 80; i++) {
    const a = Tracking.getStatus().authorization;
    if (a !== 'notDetermined') return a;
    await wait(400);
  }
  return Tracking.getStatus().authorization;
}

export function TrackerProvider({ children }: { children: ReactNode }) {
  const { t, err } = useI18n();
  const { user, setUser, logout } = useSession();
  const [status, setStatus] = useState<TrackingStatus | null>(() => {
    try {
      return Tracking.getStatus();
    } catch {
      return null;
    }
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const userRef = useRef(user);
  userRef.current = user;

  useEffect(() => {
    const a = Tracking.onStatus(setStatus);
    const b = Tracking.onSessionEvent((e) => {
      if (e.kind === 'unauthorized') {
        Alert.alert(t('m.track.unauthorized'));
        void logout();
      } else {
        setError(t('m.track.closed'));
      }
    });
    return () => {
      a.remove();
      b.remove();
    };
  }, [t, logout]);

  const start = useCallback(
    async (ev: Pick<EventDetail, 'id' | 'name'>, role: 'pilot' | 'retriever') => {
      setError(null);
      setBusy(true);
      try {
        // 1) Açık rıza: konum paylaşımından önce, bir kez.
        if (!userRef.current?.location_consent_at) {
          const ok = await new Promise<boolean>((resolve) =>
            Alert.alert(t('m.track.consent_title'), t('m.track.consent_body'), [
              { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
              { text: t('m.track.consent_accept'), onPress: () => resolve(true) },
            ]),
          );
          if (!ok) return;
          setUser(await api.me.consentLocation());
        }
        // 2) İzinler: önce "kullanırken", ardından "her zaman" (ekran kilitliyken takip için).
        Tracking.requestPermissions();
        let auth = await settleAuthorization();
        if (auth === 'whenInUse') {
          Tracking.requestPermissions();
          await wait(1500);
          auth = Tracking.getStatus().authorization;
        }
        if (auth === 'denied' || auth === 'restricted') {
          Alert.alert(t('m.track.title'), t('m.track.perm_denied'), [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('m.track.open_settings'), onPress: () => void Linking.openSettings() },
          ]);
          return;
        }
        // 3) Sunucuda oturum aç (ayarlar sunucudan gelir) ve native takibi başlat.
        const r = await api.tracking.start(ev.id, { platform: 'ios', app_version: Constants.expoConfig?.version ?? 'unknown' });
        const token = getToken();
        if (!token) throw new Error('no token');
        await Tracking.start({ api_base: API_URL, token, event_id: ev.id, session_id: r.session_id, role, config: r.config as TrackingConfig });
      } catch (e) {
        setError(err(errorCode(e)));
      } finally {
        setBusy(false);
      }
    },
    [t, err, setUser],
  );

  const stop = useCallback(
    async (eventId: string) => {
      setBusy(true);
      try {
        // Önce konumu durdur (kuyruk yüklenmeye devam eder), sonra sunucuya bildir.
        await Tracking.stop();
        await api.tracking.stop(eventId).catch(() => undefined);
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const value = useMemo<Ctx>(
    () => ({ status, error, busy, start, stop, isTrackingEvent: (id) => !!status?.tracking && status.eventId === id }),
    [status, error, busy, start, stop],
  );
  return <Tracker.Provider value={value}>{children}</Tracker.Provider>;
}

export function useTracker(): Ctx {
  const c = useContext(Tracker);
  if (!c) throw new Error('useTracker outside provider');
  return c;
}
