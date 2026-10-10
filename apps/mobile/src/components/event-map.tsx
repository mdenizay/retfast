import { Camera, GeoJSONSource, Layer, Map as MapLibre, type CameraRef } from '@maplibre/maplibre-react-native';
import { LocateFixed } from 'lucide-react-native';
import { useMemo, useRef, type ComponentProps } from 'react';
import { Pressable, View } from 'react-native';
import { useColors } from '../lib/theme';

export type MapPerson = { id: string; lon: number; lat: number; color: string; label: string; retriever?: boolean; opacity?: number };
export type MapPoint = { id: string; lon: number; lat: number; name: string; color: string };

type GeoData = Exclude<ComponentProps<typeof GeoJSONSource>['data'], string>;
const fc = (features: object[]) => ({ type: 'FeatureCollection', features }) as GeoData;

/** Etkinlik haritası: noktalar, kişiler ve kullanıcının kendi konumu. Karanlık/açık stil sistem temasını izler. */
export function EventMap({ center, points, people, me, height = 320 }: {
  center: [number, number]; points: MapPoint[]; people: MapPerson[]; me?: { lon: number; lat: number } | null; height?: number;
}) {
  const c = useColors();
  const cam = useRef<CameraRef>(null);
  const labelColor = c.dark ? '#ffffff' : '#1c1c1e';
  const halo = c.dark ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.92)';

  const pointsData = useMemo(() => fc(points.map((p) => ({ type: 'Feature', properties: { name: p.name, color: p.color }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } }))), [points]);
  const peopleData = useMemo(
    () => fc(people.map((p) => ({ type: 'Feature', properties: { color: p.color, label: p.label, ret: p.retriever ? 1 : 0, opacity: p.opacity ?? 1 }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } }))),
    [people],
  );
  const meData = useMemo(() => fc(me ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [me.lon, me.lat] } }] : []), [me]);

  return (
    <View style={{ height, borderRadius: 24, overflow: 'hidden' }}>
      <MapLibre mapStyle={c.mapStyle} style={{ flex: 1 }} logo={false} attributionPosition={{ bottom: 6, right: 6 }} compass={false}>
        <Camera ref={cam} initialViewState={{ center, zoom: 11 }} />
        <GeoJSONSource id="points" data={pointsData}>
          <Layer id="points-c" type="circle" paint={{ 'circle-radius': 5.5, 'circle-color': c.surface, 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 3 } as never} />
          <Layer id="points-l" type="symbol" layout={{ 'text-field': ['get', 'name'], 'text-size': 11, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-font': ['Noto Sans Regular'] } as never} paint={{ 'text-color': labelColor, 'text-halo-color': halo, 'text-halo-width': 1.4 } as never} />
        </GeoJSONSource>
        <GeoJSONSource id="people" data={peopleData}>
          <Layer id="people-c" type="circle" paint={{ 'circle-radius': ['case', ['==', ['get', 'ret'], 1], 9, 7.5], 'circle-color': ['get', 'color'], 'circle-opacity': ['get', 'opacity'], 'circle-stroke-color': ['case', ['==', ['get', 'ret'], 1], '#ffb020', '#ffffff'], 'circle-stroke-width': 3 } as never} />
          <Layer id="people-l" type="symbol" layout={{ 'text-field': ['get', 'label'], 'text-size': 11, 'text-offset': [0, 1.5], 'text-anchor': 'top', 'text-optional': true, 'text-font': ['Noto Sans Regular'] } as never} paint={{ 'text-color': labelColor, 'text-halo-color': halo, 'text-halo-width': 1.4 } as never} />
        </GeoJSONSource>
        <GeoJSONSource id="me" data={meData}>
          <Layer id="me-halo" type="circle" paint={{ 'circle-radius': 16, 'circle-color': 'rgba(10,132,255,0.22)' } as never} />
          <Layer id="me-c" type="circle" paint={{ 'circle-radius': 7, 'circle-color': '#0a84ff', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 } as never} />
        </GeoJSONSource>
      </MapLibre>
      {me ? (
        <Pressable
          onPress={() => cam.current?.easeTo({ center: [me.lon, me.lat], zoom: 14, duration: 600 })}
          accessibilityLabel="Center on me"
          style={{ position: 'absolute', right: 12, top: 12, width: 44, height: 44, borderRadius: 22, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } }}
        >
          <LocateFixed size={20} color={c.label} />
        </Pressable>
      ) : null}
    </View>
  );
}
