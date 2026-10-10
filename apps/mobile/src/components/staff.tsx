import type { EventDetail } from '@retfast/core';
import * as Linking from 'expo-linking';
import { useMemo } from 'react';
import { View } from 'react-native';
import { WEB_URL } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useLive } from '../lib/live';
import { buildPeople } from '../lib/people';
import { AnnouncementsCard } from './announcements';
import { MapScreen } from './map-screen';
import { Button, Card, Text } from './ui';

/** Observer ve etkinlik adminleri için özet; tam operasyon web konsolundadır. */
export function StaffView({ ev }: { ev: EventDetail }) {
  const { t } = useI18n();
  const { live } = useLive(ev.id, ev.status === 'active');
  const members = live?.members ?? [];
  const count = (f: (m: (typeof members)[number]) => boolean) => members.filter(f).length;
  const people = useMemo(() => buildPeople(live), [live]);
  const tiles: [string, number][] = [
    [t('live.group.flying'), count((m) => m.pilot_state === 'flying')],
    [t('live.group.waiting'), count((m) => m.pilot_state === 'awaiting_retrieve')],
    [t('live.group.picked_up'), count((m) => m.pilot_state === 'picked_up' || m.pilot_state === 'retriever_assigned')],
    [t('live.group.retrievers'), count((m) => m.role === 'retriever' && m.tracking)],
  ];
  const header = (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {tiles.map(([label, n]) => (
        <View key={label} style={{ flex: 1 }}>
          <Text v="metric" style={{ fontSize: 22 }}>{n}</Text>
          <Text v="foot" numberOfLines={1}>{label}</Text>
        </View>
      ))}
    </View>
  );
  return (
    <MapScreen ev={ev} people={people} header={header}>
      <AnnouncementsCard eventId={ev.id} />
      <Card>
        <Text v="sub">{t('m.observer.note')}</Text>
        <Button variant="primary" title={t('m.observer.open')} onPress={() => void Linking.openURL(`${WEB_URL}/app/events/${ev.id}/live`)} />
      </Card>
    </MapScreen>
  );
}
