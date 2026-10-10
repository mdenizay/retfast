import { router } from 'expo-router';
import { ArrowLeft, LocateFixed, Siren } from 'lucide-react-native';
import { useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { EventDetail } from '@retfast/core';
import { useI18n } from '../lib/i18n';
import { useColors } from '../lib/theme';
import { useTracker } from '../lib/tracker';
import { EventMap, type EventMapHandle, type MapMe, type MapPerson } from './event-map';
import { BottomSheet, type SheetHandle } from './sheet';
import { Text } from './ui';

const shadow = { shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } } as const;

function RoundButton({ children, onPress, label, bg }: { children: ReactNode; onPress: () => void; label: string; bg?: string }) {
  const c = useColors();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [{ width: 46, height: 46, borderRadius: 23, backgroundColor: bg ?? c.surface, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.8 : 1 }, shadow]}>
      {children}
    </Pressable>
  );
}

/**
 * Tek ekran: tam ekran harita; üstte geri / etkinlik / durum çubuğu ve SOS, altta sürüklenebilir panel.
 * `header` panelin her zaman görünen kısmı (ana eylem), `children` genişleyince görünen gövde.
 */
export function MapScreen({ ev, people, me, header, children, sos }: {
  ev: EventDetail; people: MapPerson[]; me?: MapMe | null; header: ReactNode; children: ReactNode; sos?: boolean;
}) {
  const c = useColors();
  const { t } = useI18n();
  const inset = useSafeAreaInsets();
  const tr = useTracker();
  const map = useRef<EventMapHandle>(null);
  const sheet = useRef<SheetHandle>(null);
  const [peek, setPeek] = useState(170);

  const center: [number, number] = [ev.center_lon ?? ev.points[0]?.lon ?? 29.3, ev.center_lat ?? ev.points[0]?.lat ?? 37.1];
  const on = tr.isTrackingEvent(ev.id);
  const fix = tr.status?.lastFix;
  const fresh = on && !!fix && Date.now() - fix.t < 90_000;
  const dot = on ? (fresh ? c.green : c.tint) : c.label3;
  const topInset = inset.top + 70;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <EventMap
        ref={map}
        center={center}
        me={me}
        people={people}
        topInset={topInset}
        bottomInset={peek}
        points={ev.points.map((p) => ({ id: p.id, lon: p.lon, lat: p.lat, name: p.name, color: '#0a84ff' }))}
      />

      <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { paddingTop: inset.top + 8, paddingHorizontal: 12 }]}>
        <View pointerEvents="box-none" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <RoundButton label={t('common.back')} onPress={() => router.back()}><ArrowLeft size={22} color={c.label} /></RoundButton>
          <View style={[{ flex: 1, height: 46, borderRadius: 23, backgroundColor: c.surface, paddingHorizontal: 16, justifyContent: 'center' }, shadow]}>
            <Text v="headline" numberOfLines={1} style={{ fontSize: 15.5 }}>{ev.name}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: dot }} />
              <Text v="foot" numberOfLines={1}>
                {on ? (fix ? `${t('m.track.active')} · ±${Math.round(fix.acc)} m` : t('m.track.no_fix')) : t('m.track.off')}
              </Text>
            </View>
          </View>
          {sos ? <RoundButton label="SOS" bg={c.red} onPress={() => sheet.current?.snapTo(2)}><Siren size={22} color="#fff" /></RoundButton> : null}
        </View>
      </View>

      {me ? (
        <View pointerEvents="box-none" style={{ position: 'absolute', right: 14, bottom: peek + 14 }}>
          <RoundButton label="Center on me" onPress={() => map.current?.recenter()}><LocateFixed size={22} color={c.label} /></RoundButton>
        </View>
      ) : null}

      <BottomSheet ref={sheet} header={header} onPeek={setPeek}>{children}</BottomSheet>
    </View>
  );
}
