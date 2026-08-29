// Minimal WKB/EWKB point parser — PostgREST serializes geography columns as
// hex-encoded EWKB. We only ever store 2-D points (SRID 4326).
export function parseWkbPoint(hex: unknown): { lng: number; lat: number } | null {
  if (typeof hex !== "string" || hex.length < 42) return null;
  try {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    const view = new DataView(bytes.buffer);
    const littleEndian = bytes[0] === 1;
    const type = view.getUint32(1, littleEndian);
    let offset = 5;
    if (type & 0x20000000) offset += 4; // SRID present
    if ((type & 0xff) !== 1) return null; // not a point
    const lng = view.getFloat64(offset, littleEndian);
    const lat = view.getFloat64(offset + 8, littleEndian);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    return { lng, lat };
  } catch {
    return null;
  }
}
