import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

/**
 * The app's haptic vocabulary.
 *
 * Four gestures, deliberately few. A meditation app that buzzes at everything
 * is a contradiction — the feeling to aim for is a hand on your shoulder, not
 * a tap on the glass. Everything here stays at or below a success
 * notification; the only thing that goes further is `milestone`, and it does
 * so by repeating something gentle rather than by hitting harder.
 *
 * Every call is fire-and-forget and silently inert on web, so callers never
 * need to guard.
 */

const enabled = Platform.OS !== 'web';

/** A choice registering. Used by every primary control. */
export function tap(): void {
  if (!enabled) return;
  void Haptics.selectionAsync().catch(() => {});
}

/** Something landing in place — a mood picked, a session favourited. */
export function settle(): void {
  if (!enabled) return;
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

/** A thing finished. The end of a sit, a breathing round, a saved check-in. */
export function complete(): void {
  if (!enabled) return;
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

/** A gentle refusal — a cap reached, a form that will not submit yet. */
export function nudge(): void {
  if (!enabled) return;
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
}

/**
 * A genuine milestone: ten days of practice, a badge unlocked.
 *
 * Three light beats rising into a success rather than one heavy buzz. It reads
 * as applause instead of an alarm, which is the difference between celebrating
 * with someone and startling them.
 */
export function milestone(): void {
  if (!enabled) return;

  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  setTimeout(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, 110);
  setTimeout(() => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, 240);
}
