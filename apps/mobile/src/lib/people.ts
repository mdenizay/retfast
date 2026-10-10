import type { LiveMember, LiveState } from '@retfast/core';
import type { MapPerson } from '../components/event-map';

/** Haritadaki kişiler: renk durumdan, koni (baktığı yön) son konumun `hdg` değerinden gelir. */
export function buildPeople(live: LiveState | null, meId?: string): MapPerson[] {
  if (!live) return [];
  const byId = new Map<string, LiveMember>(live.members.map((m) => [m.user_id, m]));
  return Object.values(live.positions).flatMap((p) => {
    const m = byId.get(p.u);
    if (!m || m.user_id === meId || (m.role !== 'pilot' && m.role !== 'retriever')) return [];
    const sos = live.sos.some((s) => s.user_id === m.user_id && s.status !== 'resolved');
    const key = sos ? 'sos' : m.role === 'retriever' ? 'retriever' : (m.pilot_state ?? 'preparing');
    return [{ id: p.u, lon: p.lon, lat: p.lat, hdg: p.hdg, key, label: m.bib ? `#${m.bib}` : m.first_name, retriever: m.role === 'retriever' }];
  });
}
