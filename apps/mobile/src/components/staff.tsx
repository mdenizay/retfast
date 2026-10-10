import type { EventDetail } from '@retfast/core';
import * as Linking from 'expo-linking';
import { View } from 'react-native';
import { WEB_URL } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useLive } from '../lib/live';
import { STATE_COLOR } from '../lib/theme';
import { EventMap } from './event-map';
import { Button, Card, Screen, Text } from './ui';

/** Observer ve etkinlik adminleri için özet; tam operasyon web konsolundadır. */
export function StaffView({ ev }: { ev: EventDetail }) {
  const { t } = useI18n();
  const { live } = useLive(ev.id, ev.status === 'active');
  const members = live?.members ?? [];
  const count = (f: (m: (typeof members)[number]) => boolean) => members.filter(f).length;
  const people = Object.values(live?.positions ?? {}).flatMap((p) => {
    const m = members.find((x) => x.user_id === p.u);
    return m ? [{ id: p.u, lon: p.lon, lat: p.lat, color: m.role === 'retriever' ? '#ffb020' : (STATE_COLOR[m.pilot_state ?? 'preparing'] ?? '#8e8e93'), label: m.bib ? `#${m.bib}` : m.first_name, retriever: m.role === 'retriever' }] : [];
  });
  const center: [number, number] = [ev.center_lon ?? ev.points[0]?.lon ?? 29.3, ev.center_lat ?? ev.points[0]?.lat ?? 37.1];
  const tiles: [string, number][] = [
    [t('live.group.flying'), count((m) => m.pilot_state === 'flying')],
    [t('live.group.waiting'), count((m) => m.pilot_state === 'awaiting_retrieve')],
    [t('live.group.picked_up'), count((m) => m.pilot_state === 'picked_up' || m.pilot_state === 'retriever_assigned')],
    [t('live.group.retrievers'), count((m) => m.role === 'retriever' && m.tracking)],
  ];
  return (
    <Screen>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {tiles.map(([label, n]) => (
          <Card key={label} style={{ width: '48%', gap: 6 }}>
            <Text v="foot">{label}</Text>
            <Text v="metric">{n}</Text>
          </Card>
        ))}
      </View>
      <EventMap center={center} height={360} points={ev.points.map((p) => ({ id: p.id, lon: p.lon, lat: p.lat, name: p.name, color: '#0a84ff' }))} people={people} />
      <Card>
        <Text v="sub">{t('m.observer.note')}</Text>
        <Button variant="primary" title={t('m.observer.open')} onPress={() => void Linking.openURL(`${WEB_URL}/app/events/${ev.id}/live`)} />
      </Card>
    </Screen>
  );
}
