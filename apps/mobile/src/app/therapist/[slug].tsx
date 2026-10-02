import { useMemo, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  formatPrice,
  type Appointment,
  type AppointmentSlot,
  type Therapist,
} from '@mindspace/shared';
import { api, ApiRequestError, qs } from '@/api/client';
import { useQuery } from '@/api/use-query';
import { radius, spacing } from '@/theme';
import { useTheme } from '@/theme/use-theme';
import {
  Button,
  Card,
  Divider,
  ErrorState,
  IconButton,
  Loading,
  Screen,
  Txt,
} from '@/components/ui';
import { useJurisdiction, REGION_OPTIONS } from '@/store/region';

interface SlotsResponse {
  therapistId: string;
  sessionMinutes: number;
  timezone: string;
  slots: AppointmentSlot[];
}

/** Therapist profile and booking. */
export default function TherapistScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { jurisdiction } = useJurisdiction();

  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<Appointment | null>(null);

  const { data: therapist, error: loadError, loading, refetch } = useQuery<Therapist>(
    (signal) =>
      api.get<Therapist>(
        `/therapy/therapists/${slug}${qs({ jurisdiction: jurisdiction ?? undefined })}`,
        signal,
      ),
    [slug, jurisdiction],
  );

  const { data: availability, refetch: refetchSlots } = useQuery<SlotsResponse>(
    (signal) => api.get<SlotsResponse>(`/therapy/therapists/${slug}/slots?days=14`, signal),
    [slug],
  );

  /** Slots grouped by the client's own local calendar day. */
  const byDay = useMemo(() => {
    const groups = new Map<string, AppointmentSlot[]>();
    for (const slot of availability?.slots ?? []) {
      const day = new Date(slot.startsAt).toLocaleDateString(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      });
      groups.set(day, [...(groups.get(day) ?? []), slot]);
    }
    return [...groups.entries()];
  }, [availability]);

  if (loading && !therapist) return <Loading />;
  if (loadError) return <ErrorState error={loadError} onRetry={refetch} />;
  if (!therapist) return null;

  const blocked = Boolean(jurisdiction) && !therapist.availableInYourRegion;

  async function book() {
    if (!selected || !jurisdiction) return;

    setBooking(true);
    setError(null);
    try {
      const appointment = await api.post<Appointment>('/therapy/appointments', {
        therapistId: therapist!.id,
        startsAt: selected,
        note: note.trim() || undefined,
        jurisdiction,
      });
      setConfirmed(appointment);
    } catch (err) {
      const message =
        err instanceof ApiRequestError ? err.message : 'Could not book that session.';
      setError(message);
      // A conflict means someone else took the slot — refresh what is left.
      if (err instanceof ApiRequestError && err.status === 409) void refetchSlots();
      setSelected(null);
    } finally {
      setBooking(false);
    }
  }

  /* ---------------- Confirmation ---------------- */
  if (confirmed) {
    const starts = new Date(confirmed.startsAt);
    return (
      <Screen>
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          <ScrollView contentContainerStyle={{ padding: spacing.xl, gap: spacing.xl, flexGrow: 1 }}>
            <View style={{ flex: 1, justifyContent: 'center', gap: spacing.lg, alignItems: 'center' }}>
              <Txt style={{ fontSize: 52 }}>📅</Txt>
              <Txt variant="display" style={{ textAlign: 'center' }}>
                You're booked
              </Txt>
              <Txt variant="body" tone="muted" style={{ textAlign: 'center' }}>
                {confirmed.therapist.fullName} will see you on{' '}
                {starts.toLocaleString(undefined, {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                .
              </Txt>

              <Card style={{ alignSelf: 'stretch', gap: spacing.sm }}>
                <Txt variant="caption" tone="muted">
                  The video link opens ten minutes before your session. You'll find it under
                  Therapy, and you can cancel free up to 24 hours beforehand.
                </Txt>
              </Card>
            </View>

            <Button title="Done" onPress={() => router.replace('/therapy')} />
          </ScrollView>
        </SafeAreaView>
      </Screen>
    );
  }

  /* ---------------- Profile + booking ---------------- */
  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View
          style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg }}>
          <IconButton glyph="‹" label="Go back" onPress={() => router.back()} />
          <Txt variant="heading" numberOfLines={1} style={{ flex: 1 }}>
            {therapist.fullName}
          </Txt>
        </View>

        <ScrollView contentContainerStyle={{ padding: spacing.xl, paddingTop: 0, gap: spacing.xl }}>
          <View style={{ flexDirection: 'row', gap: spacing.lg, alignItems: 'center' }}>
            <View
              style={{
                width: 68,
                height: 68,
                borderRadius: 34,
                backgroundColor: theme.colors.surfaceMuted,
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              <Txt variant="title">{therapist.fullName.charAt(0)}</Txt>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="micro" tone="faint">
                {therapist.credentials.toUpperCase()}
              </Txt>
              <Txt variant="bodyStrong">
                {formatPrice(therapist.sessionPriceCents, therapist.currency)} ·{' '}
                {therapist.sessionMinutes} min
              </Txt>
              <Txt variant="caption" tone="faint">
                Speaks {therapist.languages.join(', ')}
              </Txt>
            </View>
          </View>

          <Txt variant="body" tone="muted" style={{ lineHeight: 22 }}>
            {therapist.bio}
          </Txt>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {therapist.specialties.map((item) => (
              <View
                key={item}
                style={{
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.xs,
                  borderRadius: radius.pill,
                  backgroundColor: theme.colors.surfaceMuted,
                }}>
                <Txt variant="micro" tone="muted">
                  {item.toUpperCase()}
                </Txt>
              </View>
            ))}
          </View>

          <Card style={{ gap: spacing.sm }}>
            <Txt variant="caption" tone="muted">
              Licensed in
            </Txt>
            {therapist.licences.map((licence) => (
              <Txt key={licence.licenceNumber} variant="caption">
                {licence.jurisdiction} · {licence.licenceBody} · {licence.licenceNumber}
              </Txt>
            ))}
          </Card>

          <Divider />

          {/* Booking is gated on a region, because licensing is. */}
          {!jurisdiction ? (
            <Card style={{ gap: spacing.md }}>
              <Txt variant="bodyStrong">Where are you?</Txt>
              <Txt variant="caption" tone="muted">
                Therapists can only see clients in places they're licensed. Pick your region on the
                Therapy screen to book.
              </Txt>
              <Button title="Choose region" size="md" onPress={() => router.replace('/therapy')} />
            </Card>
          ) : blocked ? (
            <Card style={{ gap: spacing.md, borderColor: theme.colors.warning }}>
              <Txt variant="bodyStrong">Not available in {jurisdiction}</Txt>
              <Txt variant="caption" tone="muted">
                {therapist.fullName} is licensed in{' '}
                {therapist.licences.map((l) => l.jurisdiction).join(', ')}. That is a legal limit,
                not a preference — try a therapist licensed where you are.
              </Txt>
              <Button
                title="See who can"
                variant="secondary"
                size="md"
                onPress={() => router.replace('/therapy')}
              />
            </Card>
          ) : (
            <View style={{ gap: spacing.lg }}>
              <View style={{ gap: spacing.xs }}>
                <Txt variant="heading">Pick a time</Txt>
                <Txt variant="caption" tone="faint">
                  Shown in your local time
                </Txt>
              </View>

              {byDay.length === 0 ? (
                <Txt variant="body" tone="muted">
                  No times free in the next two weeks. Check back soon.
                </Txt>
              ) : (
                byDay.map(([day, slots]) => (
                  <View key={day} style={{ gap: spacing.sm }}>
                    <Txt variant="caption" tone="muted">
                      {day}
                    </Txt>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                      {slots.map((slot) => {
                        const isSelected = selected === slot.startsAt;
                        return (
                          <Pressable
                            key={slot.startsAt}
                            accessibilityRole="radio"
                            accessibilityState={{ selected: isSelected }}
                            onPress={() => setSelected(slot.startsAt)}
                            style={{
                              paddingHorizontal: spacing.lg,
                              paddingVertical: spacing.md,
                              borderRadius: radius.md,
                              backgroundColor: isSelected
                                ? theme.colors.accent
                                : theme.colors.surfaceMuted,
                            }}>
                            <Txt
                              variant="caption"
                              tone={isSelected ? 'onAccent' : 'default'}>
                              {new Date(slot.startsAt).toLocaleTimeString(undefined, {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </Txt>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                ))
              )}

              {selected ? (
                <View style={{ gap: spacing.md }}>
                  <Txt variant="caption" tone="muted">
                    Anything you want them to know beforehand? (optional)
                  </Txt>
                  <TextInput
                    value={note}
                    onChangeText={setNote}
                    multiline
                    maxLength={2000}
                    placeholder="What you'd like to work on…"
                    placeholderTextColor={theme.colors.textFaint}
                    style={{
                      minHeight: 88,
                      borderRadius: radius.md,
                      backgroundColor: theme.colors.surfaceMuted,
                      padding: spacing.lg,
                      color: theme.colors.text,
                      fontSize: 15,
                      textAlignVertical: 'top',
                    }}
                  />
                  <Txt variant="micro" tone="faint">
                    ENCRYPTED, AND ONLY YOUR THERAPIST CAN READ IT
                  </Txt>
                </View>
              ) : null}

              {error ? (
                <Txt variant="caption" tone="danger">
                  {error}
                </Txt>
              ) : null}

              <Button
                title={
                  selected
                    ? `Book ${formatPrice(therapist.sessionPriceCents, therapist.currency)} session`
                    : 'Pick a time above'
                }
                disabled={!selected}
                loading={booking}
                onPress={() => {
                  if (Platform.OS === 'web') return void book();
                  Alert.alert(
                    'Confirm booking',
                    `Book ${therapist.sessionMinutes} minutes with ${therapist.fullName}?`,
                    [
                      { text: 'Not yet', style: 'cancel' },
                      { text: 'Book', onPress: () => void book() },
                    ],
                  );
                }}
              />
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}
