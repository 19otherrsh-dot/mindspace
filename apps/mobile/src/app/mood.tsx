import { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  MOOD_EMOJI,
  MOOD_LABELS,
  type MoodContext,
  type MoodEntry,
  type MoodValue,
} from '@mindspace/shared';
import { api } from '@/api/client';
import { useQuery } from '@/api/use-query';
import * as haptics from '@/lib/haptics';
import { radius, spacing } from '@/theme';
import { useTheme } from '@/theme/use-theme';
import { Button, IconButton, Txt } from '@/components/ui';

const VALUES: MoodValue[] = [1, 2, 3, 4, 5];

/**
 * Screen 6 — the mood check-in.
 *
 * Opened standalone from Home, or with `context=pre_session` before a session
 * and `sessionId` so the reading can be correlated with what was played.
 */
export default function Mood() {
  const router = useRouter();
  const theme = useTheme();
  const params = useLocalSearchParams<{
    context?: MoodContext;
    sessionId?: string;
    next?: string;
  }>();

  const [value, setValue] = useState<MoodValue | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const context = params.context ?? 'standalone';

  // Recent readings power the small trend strip under the scale.
  const { data: history } = useQuery<{ items: MoodEntry[] }>(
    (signal) => api.get<{ items: MoodEntry[] }>('/activity/mood?days=14', signal),
    [],
  );

  const recent = (history?.items ?? []).slice(0, 10).reverse();

  async function submit() {
    if (value === null) return;
    setSaving(true);
    setError(null);

    try {
      await api.post('/activity/mood', {
        value,
        context,
        note: note.trim() || undefined,
        sessionId: params.sessionId,
      });
      // Noticing how you feel is the whole point of the screen; confirm it
      // landed rather than just vanishing.
      haptics.complete();
      dismiss();
    } catch {
      haptics.nudge();
      setError('That did not save — check your connection and try again.');
      setSaving(false);
    }
  }

  /** Returns to wherever the modal was opened from, or falls through to it. */
  function dismiss() {
    if (params.next) router.replace(params.next as never);
    else if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.backgroundElevated }}>
      <ScrollView contentContainerStyle={{ padding: spacing.xl, gap: spacing.xxl, flexGrow: 1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flex: 1, gap: spacing.xs }}>
            <Txt variant="title">
              {context === 'post_session' ? 'How do you feel now?' : 'How are you feeling?'}
            </Txt>
            <Txt variant="caption" tone="faint">
              {context === 'post_session'
                ? 'Comparing before and after shows what actually helps'
                : 'This takes a second and shapes what we suggest'}
            </Txt>
          </View>
          <IconButton glyph="✕" label="Close" onPress={dismiss} />
        </View>

        {/* The 5-point emoji scale */}
        <View style={{ gap: spacing.lg }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
            {VALUES.map((mood) => {
              const selected = value === mood;
              return (
                <Pressable
                  key={mood}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={MOOD_LABELS[mood]}
                  onPress={() => setValue(mood)}
                  style={{
                    flex: 1,
                    aspectRatio: 0.82,
                    borderRadius: radius.lg,
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: spacing.xs,
                    backgroundColor: selected ? theme.colors.accent : theme.colors.surfaceMuted,
                    borderWidth: 1.5,
                    borderColor: selected ? theme.colors.accent : 'transparent',
                    // Selecting nudges the tile up so the choice is obvious.
                    transform: [{ translateY: selected ? -4 : 0 }],
                  }}>
                  <Txt style={{ fontSize: 30 }}>{MOOD_EMOJI[mood]}</Txt>
                </Pressable>
              );
            })}
          </View>

          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Txt variant="micro" tone="faint">
              {MOOD_LABELS[1].toUpperCase()}
            </Txt>
            <Txt variant="micro" tone="accent">
              {value ? MOOD_LABELS[value].toUpperCase() : ''}
            </Txt>
            <Txt variant="micro" tone="faint">
              {MOOD_LABELS[5].toUpperCase()}
            </Txt>
          </View>
        </View>

        {/* Optional note */}
        <View style={{ gap: spacing.sm }}>
          <Txt variant="caption" tone="muted">
            Anything you want to note? (optional)
          </Txt>
          <TextInput
            value={note}
            onChangeText={setNote}
            multiline
            maxLength={1000}
            placeholder="What's on your mind…"
            placeholderTextColor={theme.colors.textFaint}
            style={{
              minHeight: 96,
              borderRadius: radius.md,
              backgroundColor: theme.colors.surfaceMuted,
              padding: spacing.lg,
              color: theme.colors.text,
              fontSize: 15,
              textAlignVertical: 'top',
            }}
          />
          <Txt variant="micro" tone="faint">
            Notes are encrypted before they leave your device's session.
          </Txt>
        </View>

        {/* Recent trend */}
        {recent.length > 1 ? (
          <View style={{ gap: spacing.md }}>
            <Txt variant="caption" tone="muted">
              Your last {recent.length} check-ins
            </Txt>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-end',
                gap: spacing.sm,
                height: 64,
              }}>
              {recent.map((entry) => (
                <View
                  key={entry.id}
                  style={{
                    flex: 1,
                    height: `${(entry.value / 5) * 100}%`,
                    borderRadius: radius.sm,
                    backgroundColor: theme.colors.accent,
                    opacity: 0.35 + (entry.value / 5) * 0.65,
                  }}
                />
              ))}
            </View>
          </View>
        ) : null}

        <View style={{ flex: 1, justifyContent: 'flex-end', gap: spacing.md }}>
          {error ? (
            <Txt variant="caption" tone="danger">
              {error}
            </Txt>
          ) : null}

          <Button
            title={context === 'pre_session' ? 'Start session' : 'Save check-in'}
            onPress={submit}
            loading={saving}
            disabled={value === null}
          />
          <Button title="Skip" variant="ghost" onPress={dismiss} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
