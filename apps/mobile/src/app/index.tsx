import type { EventSummary, MyEvents } from '@retfast/core';
import { useFocusEffect, router } from 'expo-router';
import { CalendarDays, Clock, MapPin } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView } from 'react-native';
import { Badge, Card, Group, Loading, Row, Screen, Text } from '../components/ui';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useColors } from '../lib/theme';
import { useTracker } from '../lib/tracker';

export default function Home() {
  const { t, date } = useI18n();
  const c = useColors();
  const tr = useTracker();
  const [mine, setMine] = useState<MyEvents | null>(null);
  const [open, setOpen] = useState<EventSummary[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [m, o] = await Promise.all([api.me.events(), api.events.list('all')]);
      setMine(m);
      setOpen(o.data);
    } catch {
      /* ağ yok: eski veri kalır */
    }
  }, []);

  useFocusEffect(useCallback(() => void load(), [load]));

  if (!mine) return <Loading />;
  const memberIds = new Set(mine.memberships.map((m) => m.event.id));
  const discover = open.filter((e) => !memberIds.has(e.id) && !mine.applications.some((a) => a.event.id === e.id));
  const tracked = mine.memberships.find((m) => tr.isTrackingEvent(m.event.id));
  const stateColor = (s: string) => (s === 'active' ? c.tint : c.label2);

  return (
    <Screen scroll={false} pad={0} style={{ padding: 0 }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: 48 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      >
        {tracked ? (
          <Card style={{ backgroundColor: c.green + '1f' }}>
            <Text v="headline" color={c.green}>{t('m.track.active')}</Text>
            <Text v="sub" onPress={() => router.push(`/event/${tracked.event.id}`)}>{tracked.event.name}</Text>
          </Card>
        ) : null}

        {mine.memberships.length === 0 ? <Text v="sub" style={{ paddingHorizontal: 8 }}>{t('m.no_events')}</Text> : (
          <Group header={t('dash.title')}>
            {mine.memberships.map(({ role, event: e }) => (
              <Row key={e.id} icon={<CalendarDays size={18} color={stateColor(e.status)} />} iconColor={stateColor(e.status)} title={e.name}
                subtitle={`${date(e.starts_at)} – ${date(e.ends_at)} · ${t(`role.${role}` as 'role.pilot')}`}
                trailing={e.status === 'active' ? <Badge color={c.tintText}>{t('status.active')}</Badge> : undefined}
                onPress={() => router.push(`/event/${e.id}`)} />
            ))}
          </Group>
        )}

        {mine.applications.length > 0 && (
          <Group header={t('dash.applications')}>
            {mine.applications.map((a) => (
              <Row key={a.id} icon={<Clock size={18} color={c.label2} />} iconColor={c.label2} title={a.event.name}
                subtitle={a.status === 'pending' ? t('manage.pending') : t('events.rejected')} onPress={() => router.push(`/event/${a.event.id}`)} />
            ))}
          </Group>
        )}

        {discover.length > 0 && (
          <Group header={t('m.discover')}>
            {discover.map((e) => (
              <Row key={e.id} icon={<MapPin size={18} color={c.blue} />} iconColor={c.blue} title={e.name}
                subtitle={`${[e.city, e.country].filter(Boolean).join(', ')} · ${date(e.starts_at)}`} onPress={() => router.push(`/event/${e.id}`)} />
            ))}
          </Group>
        )}
      </ScrollView>
    </Screen>
  );
}
