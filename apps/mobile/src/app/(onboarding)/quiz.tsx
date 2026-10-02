import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import type {
  Category,
  ExperienceLevel,
  OnboardingProfile,
  SleepQuality,
} from '@mindspace/shared';
import { radius, spacing } from '@/theme';
import { useTheme } from '@/theme/use-theme';
import { Button, IconButton, Txt } from '@/components/ui';
import { useAuthStore } from '@/store/auth';
import { usePostHog } from 'posthog-react-native';

type TimeOfDay = OnboardingProfile['preferredTimeOfDay'];

interface Option<T> {
  value: T;
  label: string;
  glyph: string;
  hint?: string;
}

const GOALS: Option<Category>[] = [
  { value: 'stress', label: 'Manage stress', glyph: '🌿' },
  { value: 'sleep', label: 'Sleep better', glyph: '🌙' },
  { value: 'anxiety', label: 'Ease anxiety', glyph: '💧' },
  { value: 'focus', label: 'Sharpen focus', glyph: '🎯' },
  { value: 'relationships', label: 'Improve relationships', glyph: '🤝' },
  { value: 'sports', label: 'Perform better', glyph: '⚡' },
];

const EXPERIENCE: Option<ExperienceLevel>[] = [
  { value: 'new', label: 'Never tried it', glyph: '🌱', hint: "We'll start from the beginning" },
  { value: 'some', label: 'A little', glyph: '🌿', hint: 'Some sessions here and there' },
  { value: 'experienced', label: 'I practise regularly', glyph: '🌳', hint: 'Straight to the good stuff' },
];

const SLEEP: Option<SleepQuality>[] = [
  { value: 'poor', label: 'Badly', glyph: '😩', hint: 'Trouble falling or staying asleep' },
  { value: 'fair', label: 'So-so', glyph: '😐', hint: 'Some nights are better than others' },
  { value: 'good', label: 'Pretty well', glyph: '😴', hint: 'Sleep is not my problem' },
];

const MINUTES: Option<number>[] = [
  { value: 3, label: '3 minutes', glyph: '⚡', hint: 'Just a reset' },
  { value: 10, label: '10 minutes', glyph: '☕', hint: 'The sweet spot for most people' },
  { value: 20, label: '20 minutes', glyph: '🧘', hint: 'A proper sit' },
];

const TIMES: Option<TimeOfDay>[] = [
  { value: 'morning', label: 'Morning', glyph: '🌅' },
  { value: 'afternoon', label: 'Afternoon', glyph: '☀️' },
  { value: 'evening', label: 'Evening', glyph: '🌆' },
  { value: 'flexible', label: 'It varies', glyph: '🔀' },
];

const BACKDROPS: Array<readonly [string, string]> = [
  ['#6C63FF', '#3B3F8F'],
  ['#4FA3D1', '#2F6E92'],
  ['#3B3F8F', '#1E2154'],
  ['#E8833A', '#B85F1F'],
  ['#D65DB1', '#9C3A80'],
  // The recap returns to the periwinkle the rest of the app is built on —
  // the questions are over and this is Mindspace now, not the quiz.
  ['#5B7FFF', '#3B3F8F'],
];

/** One tappable answer tile. */
function Tile<T>({
  option,
  selected,
  onPress,
}: {
  option: Option<T>;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.lg,
        padding: spacing.lg,
        borderRadius: radius.lg,
        backgroundColor: selected ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.14)',
        borderWidth: 1.5,
        borderColor: selected ? '#FFF' : 'rgba(255,255,255,0.25)',
        opacity: pressed ? 0.85 : 1,
      })}>
      <Txt style={{ fontSize: 26 }}>{option.glyph}</Txt>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="subheading" style={{ color: selected ? '#131A35' : '#FFF' }}>
          {option.label}
        </Txt>
        {option.hint ? (
          <Txt
            variant="caption"
            style={{ color: selected ? 'rgba(19,26,53,0.65)' : 'rgba(255,255,255,0.75)' }}>
            {option.hint}
          </Txt>
        ) : null}
      </View>
      {selected ? <Txt style={{ fontSize: 20, color: '#131A35' }}>✓</Txt> : null}
    </Pressable>
  );
}

/** One line of the closing recap: what we heard, in the user's own terms. */
function Recap({ glyph, label, value }: { glyph: string; label: string; value: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.lg,
        padding: spacing.lg,
        borderRadius: radius.lg,
        backgroundColor: 'rgba(255,255,255,0.16)',
      }}>
      <Txt style={{ fontSize: 26 }}>{glyph}</Txt>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="micro" style={{ color: 'rgba(255,255,255,0.7)' }}>
          {label.toUpperCase()}
        </Txt>
        <Txt variant="bodyStrong" style={{ color: '#FFF' }}>
          {value}
        </Txt>
      </View>
    </View>
  );
}

/** Screen 4 — the personalisation quiz, ending in a recap of the plan. */
export default function Quiz() {
  const router = useRouter();
  const theme = useTheme();
  const saveOnboarding = useAuthStore((s) => s.saveOnboarding);
  const posthog = usePostHog();

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [goals, setGoals] = useState<Category[]>([]);
  const [experience, setExperience] = useState<ExperienceLevel | null>(null);
  const [sleep, setSleep] = useState<SleepQuality | null>(null);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [time, setTime] = useState<TimeOfDay | null>(null);

  const steps = [
    {
      question: 'What brings you here?',
      hint: 'Pick as many as you like',
      // Goals is the only multi-select question.
      canAdvance: goals.length > 0,
      body: (
        <View style={{ gap: spacing.md }}>
          {GOALS.map((option) => (
            <Tile
              key={option.value}
              option={option}
              selected={goals.includes(option.value)}
              onPress={() =>
                setGoals((current) =>
                  current.includes(option.value)
                    ? current.filter((g) => g !== option.value)
                    : [...current, option.value],
                )
              }
            />
          ))}
        </View>
      ),
    },
    {
      question: 'Have you meditated before?',
      hint: null,
      canAdvance: experience !== null,
      body: (
        <View style={{ gap: spacing.md }}>
          {EXPERIENCE.map((option) => (
            <Tile
              key={option.value}
              option={option}
              selected={experience === option.value}
              onPress={() => setExperience(option.value)}
            />
          ))}
        </View>
      ),
    },
    {
      question: 'How are you sleeping?',
      hint: null,
      canAdvance: sleep !== null,
      body: (
        <View style={{ gap: spacing.md }}>
          {SLEEP.map((option) => (
            <Tile
              key={option.value}
              option={option}
              selected={sleep === option.value}
              onPress={() => setSleep(option.value)}
            />
          ))}
        </View>
      ),
    },
    {
      question: 'How much time can you give it?',
      hint: 'Be honest — a habit you keep beats one you abandon',
      canAdvance: minutes !== null,
      body: (
        <View style={{ gap: spacing.md }}>
          {MINUTES.map((option) => (
            <Tile
              key={option.value}
              option={option}
              selected={minutes === option.value}
              onPress={() => setMinutes(option.value)}
            />
          ))}
        </View>
      ),
    },
    {
      question: 'When suits you best?',
      hint: "We'll set your reminder for then",
      canAdvance: time !== null,
      body: (
        <View style={{ gap: spacing.md }}>
          {TIMES.map((option) => (
            <Tile
              key={option.value}
              option={option}
              selected={time === option.value}
              onPress={() => setTime(option.value)}
            />
          ))}
        </View>
      ),
    },
    {
      /*
       * The recap. Answering five questions and being dropped straight into
       * the app leaves the user unsure anything was heard — reading their own
       * answers back, as commitments rather than data, is what turns the quiz
       * into a plan they have made.
       */
      question: "Here's your plan",
      hint: 'You can change any of this later in Settings',
      canAdvance: true,
      body: (
        <View style={{ gap: spacing.md }}>
          <Recap
            glyph="🎯"
            label="Working on"
            value={
              goals.length > 0
                ? goals.map((g) => GOALS.find((o) => o.value === g)?.label ?? g).join(', ')
                : 'A bit of everything'
            }
          />
          <Recap
            glyph={MINUTES.find((o) => o.value === minutes)?.glyph ?? '☕'}
            label="Each day"
            value={`${minutes ?? 10} minutes`}
          />
          <Recap
            glyph={TIMES.find((o) => o.value === time)?.glyph ?? '🔀'}
            label="Reminder"
            value={
              time && time !== 'flexible'
                ? `Every ${time}`
                : 'None for now — you can add one later'
            }
          />
          {sleep === 'poor' ? (
            <Recap glyph="🌙" label="Also" value="Sleep content, kept close to hand" />
          ) : null}
        </View>
      ),
    },
  ];

  const current = steps[step]!;
  const isLast = step === steps.length - 1;

  async function finish() {
    setSaving(true);
    setError(null);
    try {
      await saveOnboarding({
        goals,
        experienceLevel: experience ?? 'new',
        sleepQuality: sleep ?? 'fair',
        dailyMinutes: minutes ?? 10,
        preferredTimeOfDay: time ?? 'flexible',
      });
      
      posthog?.capture('Completed Onboarding');

      // Headspace's strongest onboarding move: end the questions by actually
      // doing the thing, so the first experience is practice rather than forms.
      router.replace('/breathe?onboarding=1');
    } catch {
      setError('Could not save your answers. You can set these later in Settings.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <LinearGradient colors={BACKDROPS[step] ?? BACKDROPS[0]!} style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={{ padding: spacing.xl, gap: spacing.lg }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
            {step > 0 ? (
              <IconButton
                glyph="‹"
                label="Previous question"
                tone="onAccent"
                onPress={() => setStep(step - 1)}
              />
            ) : (
              <View style={{ width: 44 }} />
            )}

            <View style={{ flex: 1, gap: spacing.sm }}>
              <Txt variant="micro" style={{ color: 'rgba(255,255,255,0.8)' }}>
                {step + 1} OF {steps.length}
              </Txt>
              <View
                style={{
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: 'rgba(255,255,255,0.25)',
                  overflow: 'hidden',
                }}>
                <View
                  style={{
                    width: `${((step + 1) / steps.length) * 100}%`,
                    height: '100%',
                    backgroundColor: '#FFF',
                    borderRadius: 2,
                  }}
                />
              </View>
            </View>

            <Pressable
              accessibilityRole="button"
              onPress={() => router.replace('/(tabs)')}
              hitSlop={12}>
              <Txt variant="caption" style={{ color: 'rgba(255,255,255,0.8)' }}>
                Skip
              </Txt>
            </Pressable>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={{ paddingHorizontal: spacing.xl, paddingBottom: spacing.xl, gap: spacing.xl }}>
          <View style={{ gap: spacing.sm }}>
            <Txt variant="title" style={{ color: '#FFF' }}>
              {current.question}
            </Txt>
            {current.hint ? (
              <Txt variant="body" style={{ color: 'rgba(255,255,255,0.8)' }}>
                {current.hint}
              </Txt>
            ) : null}
          </View>

          {current.body}
        </ScrollView>

        <View style={{ padding: spacing.xl, gap: spacing.md }}>
          {error ? (
            <Txt variant="caption" style={{ color: '#FFD9E2', textAlign: 'center' }}>
              {error}
            </Txt>
          ) : null}
          <Button
            title={isLast ? 'Start meditating' : 'Continue'}
            variant="onColor"
            loading={saving}
            disabled={!current.canAdvance}
            onPress={() => (isLast ? void finish() : setStep(step + 1))}
          />
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}
