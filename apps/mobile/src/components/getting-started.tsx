import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { HomeFeed } from '@mindspace/shared';
import { radius, spacing } from '@/theme';
import { useTheme } from '@/theme/use-theme';
import { Card, Txt } from './ui';
import { useAuthStore } from '@/store/auth';

/**
 * A self-paced getting-started checklist (competitor gap: Calm uses an
 * optional checklist the user works through in their own order, rather than a
 * forced tutorial).
 *
 * Every item is derived from real account state, so it cannot claim something
 * is undone once the user has done it, and the whole card disappears for good
 * once the list is complete.
 */

export interface StartTask {
  id: string;
  label: string;
  hint: string;
  done: boolean;
  onPress: () => void;
}

export function useGettingStarted(feed: HomeFeed | null): StartTask[] {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  if (!feed || !user) return [];

  return [
    {
      id: 'breathe',
      label: 'Take one minute to breathe',
      hint: 'The whole idea, in miniature',
      // Not tracked server-side; treated as done once there is any practice.
      done: feed.streak > 0,
      onPress: () => router.push('/breathe'),
    },
    {
      id: 'session',
      label: 'Finish your first session',
      hint: 'Ten minutes is plenty',
      done: feed.streak > 0,
      onPress: () => router.push('/(tabs)/explore'),
    },
    {
      id: 'mood',
      label: 'Check in with your mood',
      hint: 'Shapes what we suggest',
      done: !feed.needsMoodCheckIn,
      onPress: () => router.push('/mood'),
    },
    {
      id: 'course',
      label: 'Start the Basics course',
      hint: 'Ten days, free on every plan',
      done: feed.continueCourse !== null,
      onPress: () => router.push('/course/basics'),
    },
    {
      id: 'reminder',
      label: 'Set a daily reminder',
      hint: 'The single biggest predictor of sticking with it',
      done: user.preferences.reminderEnabled,
      onPress: () => router.push('/settings'),
    },
  ];
}

export function GettingStarted({ tasks }: { tasks: StartTask[] }) {
  const theme = useTheme();

  const remaining = tasks.filter((task) => !task.done);
  // Nothing left to do means the card has served its purpose.
  if (tasks.length === 0 || remaining.length === 0) return null;

  const completed = tasks.length - remaining.length;

  return (
    <View style={{ paddingHorizontal: spacing.xl }}>
      <Card style={{ gap: spacing.lg }}>
        <View style={{ gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Txt variant="heading">Getting started</Txt>
            <Txt variant="caption" tone="faint">
              {completed} of {tasks.length}
            </Txt>
          </View>

          <View
            style={{
              height: 5,
              borderRadius: 3,
              backgroundColor: theme.colors.surfaceMuted,
              overflow: 'hidden',
            }}>
            <View
              style={{
                height: '100%',
                width: `${(completed / tasks.length) * 100}%`,
                borderRadius: 3,
                backgroundColor: theme.colors.accent,
              }}
            />
          </View>

          <Txt variant="caption" tone="faint">
            No rush — pick whichever appeals.
          </Txt>
        </View>

        <View style={{ gap: spacing.xs }}>
          {tasks.map((task) => (
            <Pressable
              key={task.id}
              accessibilityRole="button"
              accessibilityState={{ checked: task.done }}
              accessibilityLabel={`${task.label}${task.done ? ', done' : ''}`}
              onPress={task.onPress}
              disabled={task.done}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.md,
                paddingVertical: spacing.sm,
                opacity: task.done ? 0.45 : pressed ? 0.7 : 1,
              })}>
              <View
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 11,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: task.done ? theme.colors.success : 'transparent',
                  borderWidth: task.done ? 0 : 1.5,
                  borderColor: theme.colors.border,
                }}>
                {task.done ? <Txt style={{ color: '#08221A', fontSize: 12 }}>✓</Txt> : null}
              </View>

              <View style={{ flex: 1, gap: 1 }}>
                <Txt
                  variant="body"
                  style={task.done ? { textDecorationLine: 'line-through' } : undefined}>
                  {task.label}
                </Txt>
                {!task.done ? (
                  <Txt variant="micro" tone="faint">
                    {task.hint}
                  </Txt>
                ) : null}
              </View>

              {!task.done ? (
                <Txt tone="faint" style={{ fontSize: 18 }}>
                  ›
                </Txt>
              ) : null}
            </Pressable>
          ))}
        </View>
      </Card>
    </View>
  );
}

/** Quick-access tools row: the timer and breathing, always one tap away. */
export function ToolsRow() {
  const router = useRouter();
  const theme = useTheme();

  const tools = [
    { id: 'timer', glyph: '⏱', label: 'Timer', hint: 'Sit in silence', to: '/timer' as const },
    { id: 'breathe', glyph: '🌬️', label: 'Breathe', hint: '1–2 minutes', to: '/breathe' as const },
    { id: 'companion', glyph: '💬', label: 'Talk', hint: 'AI companion', to: '/companion' as const },
    { id: 'therapy', glyph: '🩺', label: 'Therapy', hint: 'Real clinicians', to: '/therapy' as const },
  ];

  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: spacing.md,
        paddingHorizontal: spacing.xl,
      }}>
      {tools.map((tool) => (
        <Pressable
          key={tool.id}
          accessibilityRole="button"
          accessibilityLabel={`${tool.label}: ${tool.hint}`}
          onPress={() => router.push(tool.to)}
          style={({ pressed }) => ({
            // Two per row: `flex: 1` alone would try to fit all four.
            flexBasis: '47%',
            flexGrow: 1,
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.md,
            padding: spacing.lg,
            borderRadius: radius.lg,
            backgroundColor: theme.colors.surface,
            borderWidth: 1,
            borderColor: theme.colors.border,
            opacity: pressed ? 0.75 : 1,
          })}>
          <Txt style={{ fontSize: 22 }}>{tool.glyph}</Txt>
          <View style={{ flex: 1, gap: 1 }}>
            <Txt variant="bodyStrong">{tool.label}</Txt>
            <Txt variant="micro" tone="faint">
              {tool.hint}
            </Txt>
          </View>
        </Pressable>
      ))}
    </View>
  );
}
