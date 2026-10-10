import { Check } from 'lucide-react-native';
import { TextInput, type TextInputProps } from 'react-native';
import { useEffect, useRef, type ReactNode } from 'react';
import {
  ActivityIndicator, Animated, Pressable, ScrollView, StyleSheet, Text as RNText, View,
  type PressableProps, type StyleProp, type TextProps, type TextStyle, type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '../lib/theme';

type Variant = 'large' | 'title' | 'headline' | 'body' | 'sub' | 'foot' | 'section' | 'metric';
const VARIANTS: Record<Variant, TextStyle> = {
  large: { fontSize: 34, lineHeight: 40, fontWeight: '700', letterSpacing: -0.8 },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.5 },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600', letterSpacing: -0.3 },
  body: { fontSize: 16, lineHeight: 22, letterSpacing: -0.2 },
  sub: { fontSize: 14, lineHeight: 19, letterSpacing: -0.1 },
  foot: { fontSize: 12.5, lineHeight: 17 },
  section: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  metric: { fontSize: 30, lineHeight: 34, fontWeight: '600', letterSpacing: -0.9, fontVariant: ['tabular-nums'] },
};

export function Text({ v = 'body', muted, color, style, ...p }: TextProps & { v?: Variant; muted?: boolean; color?: string }) {
  const c = useColors();
  const base = v === 'sub' || v === 'foot' || v === 'section' || muted;
  return <RNText {...p} style={[VARIANTS[v], { color: color ?? (base ? c.label2 : c.label) }, style]} />;
}

/** Kaydırılabilir veya sabit ekran gövdesi; güvenli alanı ve arka planı uygular. */
export function Screen({ children, scroll = true, pad = 16, style }: { children: ReactNode; scroll?: boolean; pad?: number; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  const inset = useSafeAreaInsets();
  const body = { paddingHorizontal: pad, paddingTop: pad, paddingBottom: inset.bottom + 24, gap: 16 };
  if (!scroll) return <View style={[{ flex: 1, backgroundColor: c.bg }, body, style]}>{children}</View>;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={[body, style]} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return <View style={[{ backgroundColor: c.surface, borderRadius: 24, padding: 18, gap: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: c.hair }, style]}>{children}</View>;
}

/** iOS "inset grouped" liste: satırlar arasında girintili ince çizgi. */
export function Group({ children, header }: { children: ReactNode; header?: string }) {
  const c = useColors();
  const items = (Array.isArray(children) ? children : [children]).filter(Boolean) as ReactNode[];
  return (
    <View style={{ gap: 6 }}>
      {header ? <Text v="section" style={{ paddingHorizontal: 8 }}>{header}</Text> : null}
      <View style={{ backgroundColor: c.surface, borderRadius: 20, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: c.hair }}>
        {items.map((child, i) => (
          <View key={i}>
            {i > 0 ? <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.hair, marginLeft: 62 }} /> : null}
            {child}
          </View>
        ))}
      </View>
    </View>
  );
}

export function Row({ icon, iconColor, title, subtitle, trailing, onPress, selected }: {
  icon?: ReactNode; iconColor?: string; title: string; subtitle?: string; trailing?: ReactNode; onPress?: () => void; selected?: boolean;
}) {
  const c = useColors();
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.fill }]} accessibilityRole={onPress ? 'button' : undefined}>
      {icon ? <View style={[styles.rowIcon, { backgroundColor: (iconColor ?? c.tint) + '2e' }]}>{icon}</View> : null}
      <View style={{ flex: 1 }}>
        <Text v="body" style={{ fontWeight: '500' }} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text v="foot" numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {trailing}
      {selected ? <Check size={18} color={c.tintText} /> : null}
    </Pressable>
  );
}

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export function Button({ title, onPress, variant = 'secondary', size = 'md', icon, disabled, loading, style, ...rest }: Omit<PressableProps, 'style'> & {
  title: string; variant?: BtnVariant; size?: 'md' | 'lg'; icon?: ReactNode; loading?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const bg = { primary: c.tint, secondary: c.fill2, ghost: 'transparent', danger: c.red }[variant];
  const fg = { primary: c.tintInk, secondary: c.label, ghost: c.label2, danger: '#fff' }[variant];
  return (
    <Pressable
      {...rest}
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      style={({ pressed }) => [
        { height: size === 'lg' ? 56 : 46, borderRadius: 999, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 22, opacity: disabled ? 0.4 : pressed ? 0.75 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : icon}
      <RNText style={{ color: fg, fontSize: size === 'lg' ? 18 : 16, fontWeight: variant === 'secondary' || variant === 'ghost' ? '500' : '600', letterSpacing: -0.3 }}>{title}</RNText>
    </Pressable>
  );
}

export function Badge({ children, color }: { children: ReactNode; color?: string }) {
  const c = useColors();
  const col = color ?? c.label2;
  return (
    <View style={{ backgroundColor: col + '26', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start' }}>
      <RNText style={{ color: col, fontSize: 12.5, fontWeight: '600' }}>{children}</RNText>
    </View>
  );
}

/** iOS segmentli kontrol. */
export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const c = useColors();
  const x = useRef(new Animated.Value(Math.max(0, options.findIndex((o) => o.value === value)))).current;
  const w = useRef(0);
  useEffect(() => {
    Animated.spring(x, { toValue: Math.max(0, options.findIndex((o) => o.value === value)), useNativeDriver: true, damping: 18, stiffness: 220, mass: 0.6 }).start();
  }, [value, options, x]);
  return (
    <View onLayout={(e) => (w.current = e.nativeEvent.layout.width)} style={{ flexDirection: 'row', backgroundColor: c.fill2, borderRadius: 999, padding: 3 }}>
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute', top: 3, bottom: 3, left: 3, width: `${100 / options.length}%`, borderRadius: 999,
          backgroundColor: c.dark ? '#636366' : '#fff', shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 4, shadowOffset: { width: 0, height: 1 },
          transform: [{ translateX: x.interpolate({ inputRange: options.map((_, i) => i), outputRange: options.map((_, i) => i * ((w.current - 6) / options.length)) }) }],
        }}
      />
      {options.map((o) => (
        <Pressable key={o.value} onPress={() => onChange(o.value)} style={{ flex: 1, height: 34, alignItems: 'center', justifyContent: 'center' }} accessibilityRole="tab">
          <RNText style={{ fontSize: 14, fontWeight: '600', color: o.value === value ? c.label : c.label2 }}>{o.label}</RNText>
        </Pressable>
      ))}
    </View>
  );
}

export function ErrorBox({ children }: { children?: ReactNode }) {
  const c = useColors();
  if (!children) return null;
  return (
    <View style={{ backgroundColor: c.red + '1f', borderRadius: 16, padding: 14 }} accessibilityRole="alert">
      <RNText style={{ color: c.red, fontSize: 14 }}>{children}</RNText>
    </View>
  );
}

export function Loading() {
  const c = useColors();
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg }}><ActivityIndicator /></View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 11, minHeight: 56 },
  rowIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});

export function Input({ label, style, ...p }: TextInputProps & { label?: string }) {
  const c = useColors();
  return (
    <View style={{ gap: 6 }}>
      {label ? <Text v="section" style={{ paddingHorizontal: 4 }}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={c.label3}
        {...p}
        style={[{ height: 52, borderRadius: 16, backgroundColor: c.fill, paddingHorizontal: 16, fontSize: 17, color: c.label }, p.multiline ? { height: 96, paddingTop: 14, textAlignVertical: 'top' } : null, style]}
      />
    </View>
  );
}
