import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePostHog } from 'posthog-react-native';
import { useTranslation } from 'react-i18next';
import { spacing } from '@/theme';
import { useTheme } from '@/theme/use-theme';
import { Button, Txt } from '@/components/ui';

/** Screen 2 — the three value-proposition slides. */
const SLIDES = [
  {
    id: 'stress',
    glyph: '🌿',
    title: 'Reduce stress',
    body: 'Short, science-backed practices that fit into a working day — and actually shift how it feels.',
    colors: ['#6C63FF', '#3B3F8F'] as const,
  },
  {
    id: 'sleep',
    glyph: '🌙',
    title: 'Sleep better',
    body: 'Sleepcasts, soundscapes and wind-down routines to get you from wired to asleep.',
    colors: ['#3B3F8F', '#1E2154'] as const,
  },
  {
    id: 'focus',
    glyph: '🎯',
    title: 'Focus more',
    body: 'Build the attention span the rest of your day keeps trying to take apart.',
    colors: ['#E8833A', '#B85F1F'] as const,
  },
];

/** Screen 1 — the branded splash, shown for two seconds on first launch. */
function SplashOverlay({ onDone }: { onDone: () => void }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const fadeOut = useRef(new Animated.Value(1)).current;
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion) {
      onDone();
      return;
    }

    // Fade the wordmark in, hold, then dissolve the whole overlay.
    Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.delay(900),
      Animated.timing(fadeOut, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (finished) onDone();
    });
  }, [opacity, fadeOut, onDone, reducedMotion]);

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        ...Dimensions.get('window'),
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 10,
        opacity: fadeOut,
      }}>
      <LinearGradient
        colors={['#131A35', '#0B1026']}
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md }}>
        <Animated.View style={{ opacity, alignItems: 'center', gap: spacing.sm }}>
          <Txt variant="display" style={{ color: '#FFF', letterSpacing: -1 }}>
            mindspace
          </Txt>
          <Txt variant="body" style={{ color: 'rgba(255,255,255,0.7)' }}>
            Find your calm
          </Txt>
        </Animated.View>
      </LinearGradient>
    </Animated.View>
  );
}

export default function Welcome() {
  const router = useRouter();
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const [splashDone, setSplashDone] = useState(false);
  const posthog = usePostHog();
  const { t } = useTranslation();

  useEffect(() => {
    posthog?.capture('Started Onboarding');
  }, [posthog]);

  const slide = SLIDES[index]!;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      {!splashDone ? <SplashOverlay onDone={() => setSplashDone(true)} /> : null}

      <LinearGradient colors={slide.colors} style={{ flex: 1 }}>
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          <View style={{ alignItems: 'flex-end', padding: spacing.xl }}>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/(onboarding)/sign-in')}
              hitSlop={12}>
              <Txt variant="caption" style={{ color: 'rgba(255,255,255,0.85)' }}>
                {t('welcome.skip')}
              </Txt>
            </Pressable>
          </View>

          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(event) => {
              setIndex(Math.round(event.nativeEvent.contentOffset.x / width));
            }}
            style={{ flex: 1 }}>
            {SLIDES.map((item) => (
              <View
                key={item.id}
                style={{
                  width,
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingHorizontal: spacing.xxl,
                  gap: spacing.lg,
                }}>
                <Txt style={{ fontSize: 88 }}>{item.glyph}</Txt>
                <Txt variant="display" style={{ color: '#FFF', textAlign: 'center' }}>
                  {t(`welcome.slides.${item.id}.title`)}
                </Txt>
                <Txt
                  variant="body"
                  style={{ color: 'rgba(255,255,255,0.85)', textAlign: 'center', fontSize: 17, lineHeight: 26 }}>
                  {t(`welcome.slides.${item.id}.body`)}
                </Txt>
              </View>
            ))}
          </ScrollView>

          <View style={{ gap: spacing.xl, padding: spacing.xl }}>
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: spacing.sm }}>
              {SLIDES.map((item, i) => (
                <View
                  key={item.id}
                  style={{
                    width: i === index ? 22 : 7,
                    height: 7,
                    borderRadius: 4,
                    backgroundColor: i === index ? '#FFF' : 'rgba(255,255,255,0.4)',
                  }}
                />
              ))}
            </View>

            <Button
              title={t('welcome.get_started')}
              variant="onColor"
              onPress={() => router.push('/(onboarding)/sign-in')}
            />
          </View>
        </SafeAreaView>
      </LinearGradient>
    </View>
  );
}
