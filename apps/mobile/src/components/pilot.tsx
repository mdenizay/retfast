import type { EventDetail, PilotState } from '@retfast/core';
import { CarFront, CircleCheck, Clock, LifeBuoy, Navigation, PlaneLanding, Route } from 'lucide-react-native';
import { useMemo, useState, type ComponentType } from 'react';
import { Alert, View } from 'react-native';
import { api, errorCode } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useLive } from '../lib/live';
import { buildPeople } from '../lib/people';
import { useSession } from '../lib/session';
import { STATE_COLOR, useColors } from '../lib/theme';
import { useTracker } from '../lib/tracker';
import { AnnouncementsCard } from './announcements';
import { MapScreen } from './map-screen';
import { SosButton } from './sos-button';
import { TrackingCard } from './tracking-card';
import { Badge, Button, Card, ErrorBox, Text } from './ui';

const ICON: Record<PilotState, ComponentType<{ size?: number; color?: string }>> = {
  preparing: Clock, flying: Navigation, landed: PlaneLanding, awaiting_retrieve: LifeBuoy, retriever_assigned: Route, picked_up: CarFront, completed: CircleCheck,
};

export function PilotView({ ev }: { ev: EventDetail }) {
  const { t, err } = useI18n();
  const c = useColors();
  const { user } = useSession();
  const tr = useTracker();
  const { live, suggestion, clearSuggestion } = useLive(ev.id, ev.status === 'active', user?.id);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const me = live?.members.find((m) => m.user_id === user?.id);
  const state: PilotState = me?.pilot_state ?? 'preparing';
  const retrieve = live?.retrieves.find((r) => r.pilot_id === user?.id);
  const myRetriever = retrieve?.retriever_id ? live?.members.find((m) => m.user_id === retrieve.retriever_id) : undefined;
  const mySos = live?.sos.find((s) => s.user_id === user?.id && s.status !== 'resolved');
  const fix = tr.status?.lastFix;
  const tracking = tr.isTrackingEvent(ev.id);
  const active = ev.status === 'active';
  const people = useMemo(() => buildPeople(live, user?.id), [live, user?.id]);

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

  const sub = retrieve
    ? retrieve.retriever_id ? `${t('m.pilot.retriever')}: ${myRetriever ? `${myRetriever.first_name} ${myRetriever.last_name}` : '—'}` : t('m.pilot.wait')
    : fix ? t('m.track.accuracy', { m: Math.round(fix.acc) }) : t('m.track.no_fix');

  // Panelin her zaman görünen kısmı: durum + o an yapılacak tek ana eylem.
  const primary = !tracking && active ? (
    <Button variant="primary" size="lg" title={t('m.track.start')} loading={tr.busy} onPress={() => void tr.start(ev, 'pilot')} />
  ) : canTakeoff ? (
    <Button variant="primary" size="lg" title={t('m.pilot.takeoff')} loading={busy} disabled={!active} onPress={() => void run(() => api.ops.takeoff(ev.id))} />
  ) : canLand ? (
    <Button variant="primary" size="lg" title={t('m.pilot.landed')} loading={busy} onPress={() => { const f = needFix(); if (f) void run(() => api.ops.land(ev.id, { lat: f.lat, lon: f.lon })); }} />
  ) : canRequest ? (
    <Button variant="primary" size="lg" title={t('m.pilot.request')} loading={busy} onPress={() => { const f = needFix(); if (f) void run(() => api.ops.requestRetrieve(ev.id, { lat: f.lat, lon: f.lon })); }} />
  ) : null;

  const header = (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: color + '2e', alignItems: 'center', justifyContent: 'center' }}>
          <Ico size={23} color={color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text v="headline">{t(`pilot.${state}` as 'pilot.flying')}</Text>
          <Text v="foot" numberOfLines={1}>{sub}</Text>
        </View>
        {me?.bib ? <Badge>#{me.bib}</Badge> : null}
      </View>
      {primary}
    </View>
  );

  return (
    <MapScreen ev={ev} people={people} me={fix ? { lon: fix.lon, lat: fix.lat, hdg: fix.hdg } : null} header={header} sos>
      {suggestion && ((suggestion === 'takeoff' && canTakeoff) || (suggestion === 'landing' && canLand)) ? (
        <Card style={{ backgroundColor: c.blue + '1f' }}>
          <Text v="headline">{t(suggestion === 'takeoff' ? 'm.suggest.takeoff' : 'm.suggest.landing')}</Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button style={{ flex: 1 }} variant="primary" title={t('m.suggest.yes')} loading={busy}
              onPress={() => {
                const kind = suggestion;
                clearSuggestion();
                if (kind === 'takeoff') void run(() => api.ops.takeoff(ev.id));
                else { const f = needFix(); if (f) void run(() => api.ops.land(ev.id, { lat: f.lat, lon: f.lon })); }
              }} />
            <Button style={{ flex: 1 }} title={t('m.suggest.no')} onPress={clearSuggestion} />
          </View>
        </Card>
      ) : null}

      {canLand && canRequest ? (
        <Button title={t('m.pilot.request')} loading={busy} onPress={() => { const f = needFix(); if (f) void run(() => api.ops.requestRetrieve(ev.id, { lat: f.lat, lon: f.lon })); }} />
      ) : null}
      {canDone ? <Button variant="ghost" title={t('m.pilot.done')} loading={busy} onPress={() => void run(() => api.ops.completeFlight(ev.id))} /> : null}

      {retrieve ? (
        <Card>
          <Text v="headline">{t(`retrieve.${retrieve.status}` as 'retrieve.open')}</Text>
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

      <TrackingCard ev={ev} role="pilot" />
      <AnnouncementsCard eventId={ev.id} />

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
    </MapScreen>
  );
}
