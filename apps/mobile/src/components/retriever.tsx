import type { EventDetail, LiveMember, Retrieve } from '@retfast/core';
import * as Linking from 'expo-linking';
import { Navigation, Phone } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Switch, View } from 'react-native';
import { api, errorCode } from '../lib/api';
import { distanceKm } from '../lib/geo';
import { useI18n } from '../lib/i18n';
import { useLive } from '../lib/live';
import { useSession } from '../lib/session';
import { STATE_COLOR, useColors } from '../lib/theme';
import { useTracker } from '../lib/tracker';
import { AnnouncementsCard } from './announcements';
import { EventMap, type MapPerson } from './event-map';
import { TrackingCard } from './tracking-card';
import { Badge, Button, Card, ErrorBox, Screen, Segmented, Text } from './ui';

export function RetrieverView({ ev }: { ev: EventDetail }) {
  const { t, err } = useI18n();
  const c = useColors();
  const { user } = useSession();
  const tr = useTracker();
  const { live } = useLive(ev.id, ev.status === 'active');
  const [tab, setTab] = useState<'jobs' | 'map'>('jobs');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string | null>(null);

  const me = live?.members.find((m) => m.user_id === user?.id);
  const fix = tr.status?.lastFix;
  const byId = useMemo(() => new Map((live?.members ?? []).map((m) => [m.user_id, m])), [live?.members]);
  const posOf = (id: string) => live?.positions[id];

  const open = (live?.retrieves ?? []).filter((r) => r.status === 'open');
  const mine = (live?.retrieves ?? []).filter((r) => r.retriever_id === user?.id);
  const vehicle = ev.vehicles.find((v) => v.id === me?.vehicle_id);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError(err(errorCode(e)));
    } finally {
      setBusy(null);
    }
  }

  const away = (r: Retrieve) => (fix ? t('m.ret.away', { km: distanceKm(fix, r).toFixed(1) }) : '');
  const navigate = (r: Retrieve) => void Linking.openURL(`http://maps.apple.com/?daddr=${r.lat},${r.lon}&dirflg=d`);

  const JobCard = ({ r, mineJob }: { r: Retrieve; mineJob: boolean }) => {
    const p: LiveMember | undefined = byId.get(r.pilot_id);
    return (
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text v="headline">{p ? `${p.bib ? `#${p.bib} ` : ''}${p.first_name} ${p.last_name}` : '—'}</Text>
          <Badge color={mineJob ? c.violet : '#ff9f0a'}>{t(`retrieve.${r.status}` as 'retrieve.open')}</Badge>
        </View>
        <Text v="sub">{away(r)}{r.note ? `${fix ? ' · ' : ''}“${r.note}”` : ''}</Text>
        <View style={{ gap: 8 }}>
          {!mineJob && <Button variant="primary" size="lg" title={t('m.ret.accept')} loading={busy === r.id} onPress={() => void run(r.id, () => api.ops.retrieve(r.id, 'accept'))} />}
          {mineJob && (
            <>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button style={{ flex: 1 }} icon={<Navigation size={18} color={c.label} />} title={t('m.ret.navigate')} onPress={() => navigate(r)} />
                {p?.phone ? <Button style={{ flex: 1 }} icon={<Phone size={18} color={c.label} />} title={t('m.ret.call')} onPress={() => void Linking.openURL(`tel:${p.phone}`)} /> : null}
              </View>
              {r.status === 'assigned' && <Button variant="primary" size="lg" title={t('m.ret.arrived')} loading={busy === r.id} onPress={() => void run(r.id, () => api.ops.retrieve(r.id, 'arrived'))} />}
              {r.status === 'arrived' && <Button variant="primary" size="lg" title={t('m.ret.picked')} loading={busy === r.id} onPress={() => void run(r.id, () => api.ops.retrieve(r.id, 'picked-up'))} />}
              {r.status === 'picked_up' && <Button variant="primary" size="lg" title={t('m.ret.complete')} loading={busy === r.id} onPress={() => void run(r.id, () => api.ops.retrieve(r.id, 'complete'))} />}
              {r.status !== 'picked_up' && <Button variant="ghost" title={t('live.release')} onPress={() => void run(r.id, () => api.ops.retrieve(r.id, 'release'))} />}
            </>
          )}
        </View>
      </Card>
    );
  };

  const people: MapPerson[] = Object.values(live?.positions ?? {}).flatMap((pos) => {
    const m = byId.get(pos.u);
    if (!m || m.user_id === user?.id || (m.role !== 'pilot' && m.role !== 'retriever')) return [];
    return [{ id: pos.u, lon: pos.lon, lat: pos.lat, color: m.role === 'retriever' ? '#ffb020' : (STATE_COLOR[m.pilot_state ?? 'preparing'] ?? '#8e8e93'), label: m.bib ? `#${m.bib}` : m.first_name, retriever: m.role === 'retriever' }];
  });
  const center: [number, number] = [ev.center_lon ?? ev.points[0]?.lon ?? 29.3, ev.center_lat ?? ev.points[0]?.lat ?? 37.1];

  return (
    <Screen>
      <Segmented value={tab} onChange={setTab} options={[{ value: 'jobs', label: t('m.tab.jobs') }, { value: 'map', label: t('m.tab.map') }]} />
      {tab === 'map' ? (
        <EventMap center={center} height={520} me={fix ?? null} people={people} points={ev.points.map((p) => ({ id: p.id, lon: p.lon, lat: p.lat, name: p.name, color: '#0a84ff' }))} />
      ) : (
        <>
          <AnnouncementsCard eventId={ev.id} />
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text v="headline">{t('m.ret.available')}</Text>
                {vehicle ? <Text v="foot">{t('m.ret.vehicle')}: {vehicle.name}{vehicle.plate ? ` · ${vehicle.plate}` : ''} · {t('live.capacity', { used: mine.length, cap: vehicle.capacity })}</Text> : null}
              </View>
              <Switch value={!!me?.is_available} disabled={ev.status !== 'active'} onValueChange={(v) => void run('avail', () => api.ops.availability(ev.id, { available: v }))} />
            </View>
          </Card>
          <TrackingCard ev={ev} role="retriever" />
          <Text v="section" style={{ paddingHorizontal: 8 }}>{t('m.ret.mine')}</Text>
          {mine.length === 0 ? <Text v="sub" style={{ paddingHorizontal: 8 }}>{t('m.ret.none')}</Text> : mine.map((r) => <JobCard key={r.id} r={r} mineJob />)}
          {open.length > 0 && <Text v="section" style={{ paddingHorizontal: 8 }}>{t('m.ret.open')}</Text>}
          {open.map((r) => <JobCard key={r.id} r={r} mineJob={false} />)}
          <ErrorBox>{error}</ErrorBox>
        </>
      )}
    </Screen>
  );
}
