import { useColorScheme } from 'react-native';

// iOS sistem renkleri; web ile aynı belirteç adları (docs/05-tasarim-sistemi.md).
const light = {
  dark: false,
  bg: '#f2f2f7',
  surface: '#ffffff',
  surface2: '#f7f7fa',
  label: '#1c1c1e',
  label2: 'rgba(60,60,67,0.62)',
  label3: 'rgba(60,60,67,0.32)',
  hair: 'rgba(60,60,67,0.14)',
  fill: 'rgba(120,120,128,0.08)',
  fill2: 'rgba(120,120,128,0.13)',
  fill3: 'rgba(120,120,128,0.2)',
  tint: '#ffa30a',
  tintInk: '#1c1100',
  tintText: '#c77700',
  red: '#ff3b30',
  green: '#28a745',
  blue: '#007aff',
  violet: '#af52de',
  mapStyle: 'https://tiles.openfreemap.org/styles/positron',
} as const;

const dark = {
  dark: true,
  bg: '#000000',
  surface: '#1c1c1e',
  surface2: '#232326',
  label: '#f5f5f7',
  label2: 'rgba(235,235,245,0.6)',
  label3: 'rgba(235,235,245,0.3)',
  hair: 'rgba(255,255,255,0.12)',
  fill: 'rgba(120,120,128,0.16)',
  fill2: 'rgba(120,120,128,0.26)',
  fill3: 'rgba(120,120,128,0.36)',
  tint: '#ffb020',
  tintInk: '#1c1100',
  tintText: '#ffb020',
  red: '#ff453a',
  green: '#32d74b',
  blue: '#0a84ff',
  violet: '#bf5af2',
  mapStyle: 'https://tiles.openfreemap.org/styles/dark',
} as const;

export type Colors = { [K in keyof typeof light]: (typeof light)[K] extends boolean ? boolean : string };

export function useColors(): Colors {
  return (useColorScheme() === 'dark' ? dark : light) as Colors;
}

/** Pilot durum renkleri (web ile aynı). */
export const STATE_COLOR: Record<string, string> = {
  preparing: '#8e8e93',
  flying: '#0a84ff',
  landed: '#ffd60a',
  awaiting_retrieve: '#ff9f0a',
  retriever_assigned: '#bf5af2',
  picked_up: '#30d158',
  completed: '#636366',
};
