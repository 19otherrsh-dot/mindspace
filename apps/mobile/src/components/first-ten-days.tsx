import { View } from 'react-native';
import { FIRST_TEN_DAYS } from '@mindspace/shared';
import { radius, spacing } from '@/theme';
import { useTheme } from '@/theme/use-theme';
import { Card, Txt } from './ui';

/**
 * Progress through the first ten days of practice.
 *
 * Ten days is the point where a habit tends to hold, and it is the strongest
 * predictor we have of whether someone is still practising months later — so
 * it is worth naming as a milestone rather than leaving the early days
 * shapeless. The card retires permanently once it is reached; a goal that
 * lingers after completion stops reading as an achievement.
 */
export function FirstTenDays({ completed }: { completed: number }) {
  const theme = useTheme();

  if (completed >= FIRST_TEN_DAYS) return null;

  const remaining = FIRST_TEN_DAYS - completed;

  return (
    <View style={{ paddingHorizontal: spacing.xl }}>
      <Card style={{ gap: spacing.md }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'baseline',
            justifyContent: 'space-between',
          }}>
          <Txt variant="bodyStrong">Your first ten days</Txt>
          <Txt variant="caption" tone="muted">
            {completed} of {FIRST_TEN_DAYS}
          </Txt>
        </View>

        {/*
          Ten discrete pips rather than a bar: at this scale each one is a day
          the user actually did, and they can count them.
        */}
        <View
          style={{ flexDirection: 'row', gap: spacing.xs }}
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: FIRST_TEN_DAYS, now: completed }}
          accessibilityLabel={`${completed} of ${FIRST_TEN_DAYS} days practised`}>
          {Array.from({ length: FIRST_TEN_DAYS }, (_, i) => (
            <View
              key={i}
              style={{
                flex: 1,
                height: 6,
                borderRadius: radius.pill,
                backgroundColor:
                  i < completed ? theme.colors.accent : theme.colors.surfaceMuted,
              }}
            />
          ))}
        </View>

        <Txt variant="caption" tone="muted">
          {completed === 0
            ? 'People who practise ten days tend to keep going. Today is day one.'
            : remaining === 1
              ? 'One more day. This is the one that makes it stick.'
              : `${remaining} days to go — this is the stretch where it becomes a habit.`}
        </Txt>
      </Card>
    </View>
  );
}
