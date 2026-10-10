import { forwardRef, useCallback, useEffect, useImperativeHandle, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { useColors } from '../lib/theme';

export type SheetHandle = { snapTo: (i: 0 | 1 | 2) => void };

/**
 * Haritanın üstünde yüzen alt panel (iOS Haritalar gibi): 3 duraklı (küçük/orta/tam). Başlık bölümü her zaman görünür
 * ve sürüklenir; gövde (ScrollView) orta/tam durakta kaydırılır. `onPeek`: küçük durağın yüksekliği (harita dolgusu için).
 */
export const BottomSheet = forwardRef<SheetHandle, { header: ReactNode; children: ReactNode; onPeek?: (h: number) => void }>(
  function BottomSheet({ header, children, onPeek }, ref) {
    const c = useColors();
    const inset = useSafeAreaInsets();
    const { height: H } = useWindowDimensions();
    const full = Math.round(H - inset.top - 66);
    const mid = Math.round(H * 0.55);
    const [peek, setPeek] = useState(170);
    const [snap, setSnap] = useState<0 | 1 | 2>(0);
    const pos = useCallback((i: number, p = peek) => full - [p, mid, full][i]!, [full, mid, peek]);
    const ty = useSharedValue(full - 170);
    const start = useSharedValue(0);

    useEffect(() => {
      ty.value = withSpring(pos(snap), { damping: 24, stiffness: 240, mass: 0.7 });
    }, [snap, peek, pos, ty]);
    useEffect(() => onPeek?.(peek + inset.bottom * 0), [peek, onPeek, inset.bottom]);
    useImperativeHandle(ref, () => ({ snapTo: (i) => setSnap(i) }), []);

    const onHeader = (e: LayoutChangeEvent) => {
      const h = Math.round(e.nativeEvent.layout.height + 14 + inset.bottom);
      if (Math.abs(h - peek) > 1) setPeek(h);
    };

    const stops = [pos(0), pos(1), pos(2)];
    const pan = Gesture.Pan()
      .onBegin(() => {
        start.value = ty.value;
      })
      .onUpdate((e) => {
        ty.value = Math.min(stops[0]!, Math.max(stops[2]!, start.value + e.translationY));
      })
      .onEnd((e) => {
        const target = ty.value + e.velocityY * 0.18;
        let best = 0;
        for (let i = 1; i < 3; i++) if (Math.abs(stops[i]! - target) < Math.abs(stops[best]! - target)) best = i;
        ty.value = withSpring(stops[best]!, { damping: 24, stiffness: 240, mass: 0.7 });
        scheduleOnRN(setSnap, best as 0 | 1 | 2);
      });

    const style = useAnimatedStyle(() => ({ transform: [{ translateY: ty.value }] }));

    return (
      <Animated.View
        style={[styles.sheet, { height: full, backgroundColor: c.surface, shadowColor: '#000', borderColor: c.hair }, style]}
        pointerEvents="box-none"
      >
        <GestureDetector gesture={pan}>
          <View onLayout={onHeader} style={{ paddingTop: 8, paddingHorizontal: 16, paddingBottom: 6 }}>
            <View style={{ alignSelf: 'center', width: 38, height: 5, borderRadius: 3, backgroundColor: c.fill3, marginBottom: 10 }} />
            {header}
          </View>
        </GestureDetector>
        <ScrollView
          scrollEnabled={snap > 0}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: inset.bottom + 80, gap: 14 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      </Animated.View>
    );
  },
);

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: 30, borderTopRightRadius: 30, borderWidth: StyleSheet.hairlineWidth,
    shadowOpacity: 0.22, shadowRadius: 22, shadowOffset: { width: 0, height: -6 }, overflow: 'hidden',
  },
});
