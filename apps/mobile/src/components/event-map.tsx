import { Camera, GeoJSONSource, Images, Layer, Map as MapLibre, type CameraRef } from '@maplibre/maplibre-react-native';
import { forwardRef, useImperativeHandle, useMemo, useRef, type ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';
import { STATE_COLOR, useColors } from '../lib/theme';

export type MapPerson = { id: string; lon: number; lat: number; hdg: number | null; key: string; label: string; retriever?: boolean; opacity?: number };
export type MapPoint = { id: string; lon: number; lat: number; name: string; color: string };
export type MapMe = { lon: number; lat: number; hdg?: number | null };
export type EventMapHandle = { recenter: () => void };

type GeoData = Exclude<ComponentProps<typeof GeoJSONSource>['data'], string>;
const fc = (features: object[]) => ({ type: 'FeatureCollection', features }) as GeoData;

// Baktığı yönü gösteren renkli koniler (assets/cones; saf Python ile üretildi, SDF değil).
const CONES = {
  'cone-preparing': require('../../assets/cones/cone-preparing.png'),
  'cone-flying': require('../../assets/cones/cone-flying.png'),
  'cone-landed': require('../../assets/cones/cone-landed.png'),
  'cone-awaiting_retrieve': require('../../assets/cones/cone-awaiting_retrieve.png'),
  'cone-retriever_assigned': require('../../assets/cones/cone-retriever_assigned.png'),
  'cone-picked_up': require('../../assets/cones/cone-picked_up.png'),
  'cone-completed': require('../../assets/cones/cone-completed.png'),
  'cone-sos': require('../../assets/cones/cone-sos.png'),
  'cone-retriever': require('../../assets/cones/cone-retriever.png'),
};
const CONE_SIZE = ['interpolate', ['linear'], ['zoom'], 8, 0.14, 14, 0.34] as const;

/**
 * Tam ekran etkinlik haritası. Panel ve üst çubuk haritanın ÜSTÜNDE yüzer; `bottomInset` kamera dolgusudur, böylece
 * "bana odaklan" paneli ve alttaki kartı aşmadan konumu görünür alanın ortasına getirir.
 */
export const EventMap = forwardRef<EventMapHandle, {
  center: [number, number]; points: MapPoint[]; people: MapPerson[]; me?: MapMe | null; topInset?: number; bottomInset?: number;
}>(function EventMap({ center, points, people, me, topInset = 0, bottomInset = 0 }, ref) {
  const c = useColors();
  const cam = useRef<CameraRef>(null);
  const labelColor = c.dark ? '#ffffff' : '#1c1c1e';
  const halo = c.dark ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.92)';
  const padding = { top: topInset, bottom: bottomInset, left: 0, right: 0 };

  useImperativeHandle(ref, () => ({
    recenter: () => {
      if (me) cam.current?.easeTo({ center: [me.lon, me.lat], zoom: 14, duration: 600, padding } as never);
    },
  }), [me, topInset, bottomInset]); // eslint-disable-line react-hooks/exhaustive-deps

  const pointsData = useMemo(() => fc(points.map((p) => ({ type: 'Feature', properties: { name: p.name, color: p.color }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } }))), [points]);
  const peopleData = useMemo(
    () => fc(people.map((p) => ({
      type: 'Feature',
      properties: { color: p.retriever ? '#ffb020' : (STATE_COLOR[p.key] ?? '#8e8e93'), label: p.label, ret: p.retriever ? 1 : 0, opacity: p.opacity ?? 1,
        cone: p.hdg != null ? `cone-${p.key}` : '', hdg: p.hdg ?? 0 },
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    }))),
    [people],
  );
  const meData = useMemo(
    () => fc(me ? [{ type: 'Feature', properties: { cone: me.hdg != null ? 'cone-flying' : '', hdg: me.hdg ?? 0 }, geometry: { type: 'Point', coordinates: [me.lon, me.lat] } }] : []),
    [me],
  );

  return (
    <View style={StyleSheet.absoluteFill}>
      <MapLibre mapStyle={c.mapStyle} style={{ flex: 1 }} logo={false} attributionPosition={{ bottom: bottomInset + 6, right: 6 }} compass={false}>
        <Camera ref={cam} initialViewState={{ center: me ? [me.lon, me.lat] : center, zoom: me ? 14 : 11, padding } as never} />
        <Images images={CONES as never} />
        <GeoJSONSource id="points" data={pointsData}>
          <Layer id="points-c" type="circle" paint={{ 'circle-radius': 5.5, 'circle-color': c.surface, 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 3 } as never} />
          <Layer id="points-l" type="symbol" layout={{ 'text-field': ['get', 'name'], 'text-size': 11, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-font': ['Noto Sans Regular'] } as never} paint={{ 'text-color': labelColor, 'text-halo-color': halo, 'text-halo-width': 1.4 } as never} />
        </GeoJSONSource>
        <GeoJSONSource id="people" data={peopleData}>
          <Layer id="people-cone" type="symbol" filter={['!=', ['get', 'cone'], ''] as never}
            layout={{ 'icon-image': ['get', 'cone'], 'icon-rotate': ['get', 'hdg'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-size': CONE_SIZE } as never}
            paint={{ 'icon-opacity': ['get', 'opacity'] } as never} />
          <Layer id="people-c" type="circle" paint={{ 'circle-radius': ['case', ['==', ['get', 'ret'], 1], 9, 7.5], 'circle-color': ['get', 'color'], 'circle-opacity': ['get', 'opacity'], 'circle-stroke-color': ['case', ['==', ['get', 'ret'], 1], '#ffffff', '#ffffff'], 'circle-stroke-width': 3 } as never} />
          <Layer id="people-l" type="symbol" layout={{ 'text-field': ['get', 'label'], 'text-size': 11, 'text-offset': [0, 1.5], 'text-anchor': 'top', 'text-optional': true, 'text-font': ['Noto Sans Regular'] } as never} paint={{ 'text-color': labelColor, 'text-halo-color': halo, 'text-halo-width': 1.4 } as never} />
        </GeoJSONSource>
        <GeoJSONSource id="me" data={meData}>
          <Layer id="me-cone" type="symbol" filter={['!=', ['get', 'cone'], ''] as never}
            layout={{ 'icon-image': ['get', 'cone'], 'icon-rotate': ['get', 'hdg'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-size': CONE_SIZE } as never} />
          <Layer id="me-halo" type="circle" paint={{ 'circle-radius': 14, 'circle-color': 'rgba(10,132,255,0.22)' } as never} />
          <Layer id="me-c" type="circle" paint={{ 'circle-radius': 7, 'circle-color': '#0a84ff', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 } as never} />
        </GeoJSONSource>
      </MapLibre>
    </View>
  );
});
