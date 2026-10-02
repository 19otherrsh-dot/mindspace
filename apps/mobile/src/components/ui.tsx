import { forwardRef, useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type TextInputProps,
  type TextProps,
  type ViewProps,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import { categoryColors, radius, spacing, typography } from '@/theme';
import { useTheme } from '@/theme/use-theme';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import type { Category } from '@mindspace/shared';

/** Pressable that can carry an animated transform. */
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */

type Variant = keyof typeof typography;
type Tone = 'default' | 'muted' | 'faint' | 'accent' | 'onAccent' | 'danger' | 'success';

interface TxtProps extends TextProps {
  variant?: Variant;
  tone?: Tone;
}

export function Txt({ variant = 'body', tone = 'default', style, ...rest }: TxtProps) {
  const theme = useTheme();

  const color =
    tone === 'muted'
      ? theme.colors.textMuted
      : tone === 'faint'
        ? theme.colors.textFaint
        : tone === 'accent'
          ? theme.colors.accent
          : tone === 'onAccent'
            ? theme.colors.onAccent
            : tone === 'danger'
              ? theme.colors.danger
              : tone === 'success'
                ? theme.colors.success
                : theme.colors.text;

  const isHeader = ['display', 'title', 'heading'].includes(variant);

  return (
    <Text 
      accessibilityRole={isHeader ? 'header' : undefined}
      style={[typography[variant], { color }, style]} 
      {...rest} 
    />
  );
}

/* ------------------------------------------------------------------ */
/* Screen scaffolding                                                  */
/* ------------------------------------------------------------------ */

export function Screen({ style, children, ...rest }: ViewProps) {
  const theme = useTheme();
  return (
    <View style={[{ flex: 1, backgroundColor: theme.colors.background }, style]} {...rest}>
      {children}
    </View>
  );
}

export function Card({ style, children, ...rest }: ViewProps) {
  const theme = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: theme.colors.surface,
          borderRadius: radius.lg,
          padding: spacing.lg,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
        },
        style,
      ]}
      {...rest}>
      {children}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

interface ButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  title: string;
  /**
   * `onColor` is the white-on-gradient CTA used over hero artwork;
   * `onColorSubtle` is its translucent secondary partner. Both force their own
   * label colour so they stay legible in light and dark themes alike.
   */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'onColor' | 'onColorSubtle';
  size?: 'md' | 'lg';
  loading?: boolean;
  fullWidth?: boolean;
  style?: ViewProps['style'];
  /** Rendered before the label — an emoji or small glyph. */
  icon?: string;
}

export function Button({
  title,
  variant = 'primary',
  size = 'lg',
  loading = false,
  fullWidth = true,
  disabled,
  style,
  icon,
  onPress,
  ...rest
}: ButtonProps) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const isDisabled = disabled || loading;

  const background =
    variant === 'primary'
      ? theme.colors.accent
      : variant === 'danger'
        ? theme.colors.danger
        : variant === 'onColor'
          ? '#FFFFFF'
          : variant === 'onColorSubtle'
            ? 'rgba(255,255,255,0.16)'
            : variant === 'secondary'
              ? theme.colors.surfaceMuted
              : 'transparent';

  // onColor sits on a saturated background, so its label must be dark; its
  // subtle partner sits on the same background but stays white.
  const labelColor =
    variant === 'primary' || variant === 'danger'
      ? theme.colors.onAccent
      : variant === 'onColor'
        ? '#131A35'
        : variant === 'onColorSubtle'
          ? '#FFFFFF'
          : variant === 'ghost'
            ? theme.colors.accent
            : theme.colors.text;

  /*
   * A press should be felt as well as seen. The button gives a little under
   * the thumb and springs back — small enough that nobody would name it, but
   * its absence is what makes an interface feel like a picture of an app
   * rather than an app. Held flat when motion is reduced.
   */
  const press = useRef(new Animated.Value(0)).current;

  const springTo = (value: number) => {
    if (reducedMotion) return;
    Animated.spring(press, {
      toValue: value,
      useNativeDriver: true,
      speed: 40,
      bounciness: 6,
    }).start();
  };

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPressIn={() => springTo(1)}
      onPressOut={() => springTo(0)}
      onPress={(event) => {
        // A light tap on every primary action; the PRD's tone is calm, so
        // nothing heavier than this anywhere in the app.
        if (Platform.OS !== 'web') void Haptics.selectionAsync();
        onPress?.(event);
      }}
      style={({ pressed }: { pressed: boolean }) => [
        {
          backgroundColor: background,
          borderRadius: radius.pill,
          paddingVertical: size === 'lg' ? spacing.lg : spacing.md,
          paddingHorizontal: spacing.xl,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: spacing.sm,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
          opacity: isDisabled ? 0.5 : pressed ? 0.9 : 1,
          borderWidth: variant === 'ghost' ? 0 : StyleSheet.hairlineWidth,
          borderColor: variant === 'secondary' ? theme.colors.border : 'transparent',
          transform: [
            { scale: press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.97] }) },
          ],
        },
        style,
      ]}
      {...rest}>
      {loading ? (
        <ActivityIndicator color={labelColor} />
      ) : (
        <>
          {icon ? (
            <Text style={[typography.subheading, { color: labelColor }]}>{icon}</Text>
          ) : null}
          <Text style={[typography.subheading, { color: labelColor }]}>{title}</Text>
        </>
      )}
    </AnimatedPressable>
  );
}

/** Round icon button used for back arrows, close buttons and player controls. */
export function IconButton({
  glyph,
  onPress,
  size = 44,
  label,
  tone = 'default',
}: {
  glyph: string;
  onPress: () => void;
  size?: number;
  label: string;
  tone?: 'default' | 'onAccent';
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: tone === 'onAccent' ? 'rgba(255,255,255,0.16)' : theme.colors.surfaceMuted,
        opacity: pressed ? 0.7 : 1,
      })}>
      <Text style={{ fontSize: size * 0.42, color: tone === 'onAccent' ? '#FFF' : theme.colors.text }}>
        {glyph}
      </Text>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

interface FieldProps extends TextInputProps {
  label: string;
  error?: string;
}

export const Field = forwardRef<TextInput, FieldProps>(function Field(
  { label, error, style, ...rest },
  ref,
) {
  const theme = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      <Txt variant="caption" tone="muted">
        {label}
      </Txt>
      <TextInput
        ref={ref}
        placeholderTextColor={theme.colors.textFaint}
        style={[
          {
            backgroundColor: theme.colors.surfaceMuted,
            borderRadius: radius.md,
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.lg,
            color: theme.colors.text,
            fontSize: 16,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: error ? theme.colors.danger : theme.colors.border,
          },
          style,
        ]}
        {...rest}
      />
      {error ? (
        <Txt variant="caption" tone="danger">
          {error}
        </Txt>
      ) : null}
    </View>
  );
});

/* ------------------------------------------------------------------ */
/* Chips & badges                                                      */
/* ------------------------------------------------------------------ */

export function Chip({
  label,
  selected = false,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.sm + 2,
        borderRadius: radius.pill,
        backgroundColor: selected ? theme.colors.accent : theme.colors.surfaceMuted,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: selected ? theme.colors.accent : theme.colors.border,
        opacity: pressed ? 0.75 : 1,
      })}>
      <Txt variant="caption" tone={selected ? 'onAccent' : 'muted'}>
        {label}
      </Txt>
    </Pressable>
  );
}

export function ProBadge() {
  const theme = useTheme();
  return (
    <View
      style={{
        paddingHorizontal: spacing.sm,
        paddingVertical: 3,
        borderRadius: radius.sm,
        backgroundColor: theme.colors.warning,
      }}>
      <Text style={[typography.micro, { color: '#2A1D00' }]}>PRO</Text>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Artwork                                                             */
/* ------------------------------------------------------------------ */

/**
 * The seeded artwork URLs point at a CDN that does not exist in development,
 * so cover art is rendered as a deterministic gradient derived from the
 * session's category and title. It keeps the library looking intentional
 * without shipping placeholder images.
 */
export function Artwork({
  title,
  category,
  size,
  height,
  rounded = radius.lg,
  children,
}: {
  title: string;
  category: Category;
  size?: number;
  height?: number;
  rounded?: number;
  children?: React.ReactNode;
}) {
  const [from, to] = categoryColors[category];

  // A stable per-title angle so two cards in the same category still differ.
  const seed = title.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const flip = seed % 2 === 0;

  return (
    <LinearGradient
      colors={flip ? [from, to] : [to, from]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        width: size,
        height: height ?? size,
        borderRadius: rounded,
        overflow: 'hidden',
        justifyContent: 'flex-end',
      }}>
      {children}
    </LinearGradient>
  );
}

/* ------------------------------------------------------------------ */
/* States                                                              */
/* ------------------------------------------------------------------ */

/**
 * Waiting, in the shape of a breath.
 *
 * A spinner communicates "the machine is busy". This app is about slowing
 * down, and a four-second inhale and exhale says the same thing in the
 * product's own language — the wait becomes a small invitation rather than
 * dead time. Falls back to a plain indicator when motion is reduced.
 */
export function Loading({ label }: { label?: string }) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const breath = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reducedMotion) return;

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue: 1,
          duration: 2600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(breath, {
          toValue: 0,
          duration: 3200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breath, reducedMotion]);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg }}>
      {reducedMotion ? (
        <ActivityIndicator color={theme.colors.accent} size="large" />
      ) : (
        <Animated.View
          accessibilityRole="progressbar"
          accessibilityLabel={label ?? 'Loading'}
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            backgroundColor: theme.colors.accent,
            opacity: breath.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.9] }),
            transform: [
              { scale: breath.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1] }) },
            ],
          }}
        />
      )}
      {label ? (
        <Txt variant="caption" tone="faint">
          {label}
        </Txt>
      ) : null}
    </View>
  );
}

/**
 * An empty state is an invitation, not a report of absence.
 *
 * `glyph` gives the space something warm to hold — a bare line of grey text in
 * the middle of a blank screen is the least welcoming thing in any app.
 */
export function EmptyState({
  title,
  message,
  glyph,
  action,
}: {
  title: string;
  message: string;
  glyph?: string;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={{ alignItems: 'center', padding: spacing.xxl, gap: spacing.sm }}>
      {glyph ? (
        <Txt style={{ fontSize: 32, marginBottom: spacing.xs }}>{glyph}</Txt>
      ) : null}
      <Txt variant="heading" style={{ textAlign: 'center' }}>
        {title}
      </Txt>
      <Txt variant="body" tone="muted" style={{ textAlign: 'center' }}>
        {message}
      </Txt>
      {action ? (
        <Button title={action.label} onPress={action.onPress} fullWidth={false} style={{ marginTop: spacing.lg }} />
      ) : null}
    </View>
  );
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry: () => void }) {
  /*
   * "Something went wrong" is the coldest sentence an app can say: it blames
   * nobody, explains nothing, and offers no way out. This one takes the blame,
   * says what to do, and keeps the tone of the rest of the app — nobody opens
   * a meditation app wanting to be told a request failed.
   */
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, gap: spacing.md }}>
      <Txt style={{ fontSize: 34, marginBottom: spacing.xs }}>🌧️</Txt>
      <Txt variant="heading" style={{ textAlign: 'center' }}>
        That didn&rsquo;t load
      </Txt>
      <Txt variant="body" tone="muted" style={{ textAlign: 'center' }}>
        {error.message || 'We could not reach Mindspace just now. Your practice is safe.'}
      </Txt>
      <Button title="Try again" onPress={onRetry} fullWidth={false} style={{ marginTop: spacing.lg }} />
    </View>
  );
}

/** Horizontal rule matching the current theme. */
export function Divider() {
  const theme = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border }} />;
}

/** A labelled row of horizontally scrolling content, used across the feed. */
export function Row({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string | null;
  action?: { label: string; onPress: () => void };
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: spacing.md }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          paddingHorizontal: spacing.xl,
          gap: spacing.md,
        }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="heading">{title}</Txt>
          {subtitle ? (
            <Txt variant="caption" tone="faint">
              {subtitle}
            </Txt>
          ) : null}
        </View>
        {action ? (
          <Pressable onPress={action.onPress} accessibilityRole="button">
            <Txt variant="caption" tone="accent">
              {action.label}
            </Txt>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

export function HScroll({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: spacing.xl, gap: spacing.md }}>
      {children}
    </ScrollView>
  );
}
