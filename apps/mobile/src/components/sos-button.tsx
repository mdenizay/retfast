import * as Haptics from 'expo-haptics';
import { Siren } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { Animated, Pressable, Text as RNText, View } from 'react-native';
import { useI18n } from '../lib/i18n';
import { useColors } from '../lib/theme';
import { Text } from './ui';

/** Yanlışlıkla basılmasın diye 3 sn basılı tutma gerektirir; ilerleme dolgusu ve dokunsal geri bildirim verir. */
export function SosButton({ onTrigger, disabled }: { onTrigger: () => void; disabled?: boolean }) {
  const c = useColors();
  const { t } = useI18n();
  const progress = useRef(new Animated.Value(0)).current;
  const [holding, setHolding] = useState(false);

  const begin = () => {
    setHolding(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Animated.timing(progress, { toValue: 1, duration: 3000, useNativeDriver: false }).start(({ finished }) => {
      if (!finished) return;
      setHolding(false);
      progress.setValue(0);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      onTrigger();
    });
  };
  const cancel = () => {
    setHolding(false);
    progress.stopAnimation();
    Animated.timing(progress, { toValue: 0, duration: 180, useNativeDriver: false }).start();
  };

  return (
    <View style={{ gap: 8 }}>
      <Pressable
        onPressIn={begin}
        onPressOut={cancel}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={t('m.sos.hold')}
        style={{ height: 64, borderRadius: 32, backgroundColor: c.red + '1f', borderWidth: 1.5, borderColor: c.red, overflow: 'hidden', justifyContent: 'center', opacity: disabled ? 0.4 : 1 }}
      >
        <Animated.View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: c.red, width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <Siren size={22} color={holding ? '#fff' : c.red} />
          <RNText style={{ fontSize: 18, fontWeight: '700', color: holding ? '#fff' : c.red, letterSpacing: -0.3 }}>{holding ? t('m.sos.holding') : t('m.sos.hold')}</RNText>
        </View>
      </Pressable>
      <Text v="foot" style={{ textAlign: 'center' }}>{t('live.sos_disclaimer')}</Text>
    </View>
  );
}
