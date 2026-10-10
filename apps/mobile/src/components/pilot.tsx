import type { EventDetail, LiveMember, PilotState } from '@retfast/core';
import { CircleCheck, Clock, CarFront, LifeBuoy, Navigation, PlaneLanding, Route } from 'lucide-react-native';
import { useMemo, useState, type ComponentType } from 'react';
import { Alert, View } from 'react-native';
import { api, errorCode } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useLive } from '../lib/live';
import { useSession } from '../lib/session';
import { STATE_COLOR, useColors } from '../lib/theme';
import { useTracker } from '../lib/tracker';
import { EventMap, type MapPerson } from './event-map';
import { SosButton } from './sos-button';
import { TrackingCard } from './tracking-card';
import { Badge, Button, Card, ErrorBox, Screen, Segmented, Text } from './ui';

const ICON: Record<PilotState, ComponentType<{ size?: number; color?: string }>> = {
  preparing: Clock, flying: Navigation, landed: PlaneLanding, awaiting_retrieve: LifeBuoy, retriever_assigned: Route, picked_up: CarFront, completed: CircleCheck,
};

export function PilotView({ ev }: { ev: EventDetail }) {
  const { t, err } = useI18n();
  const c = useColors();
  const { user } = useSession();
  const tr = useTracker();
  const { live } = useLive(ev.id, ev.status === 'active');
  const [tab, setTab] = useState<'flight' | 'map'>('flight');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const me = live?.members.find((m) => m.user_id === user?.id);
  const state: PilotState = me?.pilot_state ?? 'preparing';
  const retrieve = live?.retrieves.find((r) => r.pilot_id === user?.id);
  const myRetriever = retrieve?.retriever_id ? live?.members.find((m) => m.user_id === retrieve.retriever_id) : undefined;
  const mySos = live?.sos.find((s) => s.user_id === user?.id && s.status !== 'resolved');
  const fix = tr.status?.lastFix;
  const canTakeoff = state === 'preparing' || state === 'completed';
  const canLand = state === 'flying';
  const canRequest = !retrieve && (state === 'flying' || state === 'landed');
  const canDone = state === 'landed' || state === 'awaiting_retrieve';
  const Ico = ICON[state];
  const color = STATE_COLOR[state] ?? c.label2;

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError(err(errorCode(e)));
    } finally {
      setBusy(false);
    }
  }
  const needFix = () => {
    if (fix) return fix;
    Alert.alert(t('m.pilot.no_position'));
    return null;
  };

  const people: MapPerson[] = useMemo(
    () =>
      Object.values(live?.positions ?? {}).flatMap((p) => {
        const m = live?.members.find((x) => x.user_id === p.u);
        if (!m || m.user_id === user?.id) return [];
        return [{ id: p.u, lon: p.lon, lat: p.lat, color: m.role === 'retriever' ? '#ffb020' : (STATE_COLOR[m.pilot_state ?? 'preparing'] ?? '#8e8e93'), label: m.bib ? `#${m.bib}` : m.first_name, retriever: m.role === 'retriever' }];
      }),
    [live, user?.id],
  );

  const center: [number, number] = [ev.center_lon ?? ev.points[0]?.lon ?? 29.3, ev.center_lat ?? ev.points[0]?.lat ?? 37.1];
  const nameOf = (m?: LiveMember) => (m ? `${m.first_name} ${m.last_name}` : '—');

  return (
    <Screen>
      <Segmented value={tab} onChange={setTab} options={[{ value: 'flight', label: t('m.tab.flight') }, { value: 'map', label: t('m.tab.map') }]} />

      {tab === 'map' ? (
        <EventMap center={center} height={520} me={fix ?? null} people={people} points={ev.points.map((p) => ({ id: p.id, lon: p.lon, lat: p.lat, name: p.name, color: '#0a84ff' }))} />
      ) : (
        <>
          <Card style={{ alignItems: 'center', paddingVertical: 24 }}>
            <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: color + '2e', alignItems: 'center', justifyContent: 'center' }}>
              <Ico size={30} color={color} />
            </View>
            <Text v="title">{t(`pilot.${state}` as 'pilot.flying')}</Text>
            {me?.bib ? <Badge>#{me.bib}</Badge> : null}
          </Card>

          <TrackingCard ev={ev} role="pilot" />

          {canTakeoff || canLand || canRequest || canDone ? <Card>
            <View style={{ gap: 10 }}>
              {(state === 'preparing' || state === 'completed') && (
                <Button variant="primary" size="lg" title={t('m.pilot.takeoff')} loading={busy} disabled={ev.status !== 'active'} onPress={() => void run(() => api.ops.takeoff(ev.id))} />
              )}
              {state === 'flying' && (
                <Button variant="primary" size="lg" title={t('m.pilot.landed')} loading={busy} onPress={() => { const f = needFix(); if (f) void run(() => api.ops.land(ev.id, { lat: f.lat, lon: f.lon })); }} />
              )}
              {!retrieve && (state === 'flying' || state === 'landed') && (
                <Button variant={state === 'landed' ? 'primary' : 'secondary'} size="lg" title={t('m.pilot.request')} loading={busy} onPress={() => { const f = needFix(); if (f) void run(() => api.ops.requestRetrieve(ev.id, { lat: f.lat, lon: f.lon })); }} />
              )}
              {(state === 'landed' || state === 'awaiting_retrieve') && (
                <Button variant="ghost" title={t('m.pilot.done')} loading={busy} onPress={() => void run(() => api.ops.completeFlight(ev.id))} />
              )}
            </View>
          </Card> : null}

          {retrieve ? (
            <Card>
              <Text v="headline">{t(`retrieve.${retrieve.status}` as 'retrieve.open')}</Text>
              {retrieve.retriever_id ? (
                <Text v="body">{t('m.pilot.retriever')}: {nameOf(myRetriever)}</Text>
              ) : (
                <Text v="sub">{t('m.pilot.wait')}</Text>
              )}
              <View style={{ gap: 8 }}>
                {(retrieve.status === 'assigned' || retrieve.status === 'arrived') && (
                  <Button title={t('m.pilot.other')} loading={busy} onPress={() => void run(() => api.ops.retrieve(retrieve.id, 'release'))} />
                )}
                {retrieve.status !== 'picked_up' && (
                  <Button variant="ghost" title={t('m.pilot.cancel_request')} loading={busy}
                    onPress={() => Alert.alert(t('m.pilot.cancel_request'), t('common.confirm'), [{ text: t('common.cancel'), style: 'cancel' }, { text: t('m.pilot.cancel_request'), style: 'destructive', onPress: () => void run(() => api.ops.retrieve(retrieve.id, 'cancel')) }])} />
                )}
              </View>
            </Card>
          ) : null}

          <Card>
            {mySos ? (
              <>
                <Text v="headline" color={c.red}>{t('m.sos.sent')}</Text>
                <Button variant="secondary" title={t('m.sos.resolve')} loading={busy} onPress={() => void run(() => api.ops.sosAction(mySos.id, 'resolve'))} />
              </>
            ) : (
              <SosButton onTrigger={() => void run(() => api.ops.sos(ev.id, { lat: fix?.lat, lon: fix?.lon }))} />
            )}
          </Card>
          <ErrorBox>{error}</ErrorBox>
        </>
      )}
    </Screen>
  );
}
