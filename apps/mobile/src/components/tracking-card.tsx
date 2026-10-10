import { shortAge, type EventDetail } from '@retfast/core';
import * as Linking from 'expo-linking';
import { MapPin, Satellite, WifiOff } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useI18n } from '../lib/i18n';
import { useColors } from '../lib/theme';
import { useTracker } from '../lib/tracker';
import { Badge, Button, Card, ErrorBox, Text } from './ui';

/** Konum paylaşımı: başlat/durdur, GPS durumu, yüklenmeyi bekleyen nokta sayısı. */
export function TrackingCard({ ev, role }: { ev: Pick<EventDetail, 'id' | 'name' | 'status'>; role: 'pilot' | 'retriever' }) {
  const { t, locale } = useI18n();
  const c = useColors();
  const tr = useTracker();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  const on = tr.isTrackingEvent(ev.id);
  const st = tr.status;
  const fix = st?.lastFix;
  const fixAge = fix ? now - fix.t : null;
  const live = on && fixAge != null && fixAge < 90_000;
  const offline = on && (st?.pending ?? 0) > 0 && !!st?.lastError && st.lastError !== 'closed';
  const active = ev.status === 'active';

  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text v="headline">{t('m.track.title')}</Text>
        <Badge color={on ? (live ? c.green : c.tintText) : c.label2}>{on ? t('m.track.active') : t('m.track.off')}</Badge>
      </View>

      {on ? (
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {fix ? <Satellite size={16} color={live ? c.green : c.label2} /> : <MapPin size={16} color={c.label2} />}
            <Text v="sub">
              {fix ? `${t('m.track.last_fix')}: ${shortAge(locale, fixAge ?? 0)} · ${t('m.track.accuracy', { m: Math.round(fix.acc) })}` : t('m.track.no_fix')}
            </Text>
          </View>
          {st?.mode ? <Text v="foot">{t(`m.track.mode.${st.mode}` as 'm.track.mode.moving')}{st.batteryLow ? ' · ⚡' : ''}</Text> : null}
          {offline ? (
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <WifiOff size={16} color={c.tintText} />
              <Text v="foot" color={c.tintText} style={{ flex: 1 }}>{t('m.track.offline')}</Text>
            </View>
          ) : null}
          <Text v="foot">
            {(st?.pending ?? 0) > 0 ? t('m.track.pending', { n: st!.pending }) : st?.lastSyncAt ? t('m.track.synced', { age: shortAge(locale, now - st.lastSyncAt) }) : t('m.track.never_synced')}
          </Text>
        </View>
      ) : !active ? (
        <Text v="sub">{t('m.track.event_off')}</Text>
      ) : null}

      {on && st?.authorization === 'whenInUse' ? (
        <Pressable onPress={() => void Linking.openSettings()} style={{ backgroundColor: c.tint + '26', borderRadius: 16, padding: 12 }} accessibilityRole="button">
          <Text v="foot" color={c.tintText}>{t('m.track.perm_always')} · {t('m.track.open_settings')}</Text>
        </Pressable>
      ) : null}
      <ErrorBox>{tr.error}</ErrorBox>
      {on ? (
        <Button variant="secondary" title={t('m.track.stop')} loading={tr.busy} onPress={() => void tr.stop(ev.id)} />
      ) : (
        <Button variant="primary" size="lg" title={t('m.track.start')} disabled={!active} loading={tr.busy} onPress={() => void tr.start(ev, role)} />
      )}
    </Card>
  );
}
