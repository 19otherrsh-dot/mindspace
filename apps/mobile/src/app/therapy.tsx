import { useState } from 'react';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatPrice, type Appointment, type Therapist } from '@mindspace/shared';
import { api, qs } from '@/api/client';
import { useQuery } from '@/api/use-query';
import { radius, spacing } from '@/theme';
import { useTheme } from '@/theme/use-theme';
import { Button, Card, Chip, Divider, ErrorState, IconButton, Loading, Screen, Txt } from '@/components/ui';
import { useJurisdiction, REGION_OPTIONS } from '@/store/region';

/**
 * Therapy home: the client's upcoming appointments plus a directory filtered
 * by where they are.
 *
 * Region is asked for up front rather than inferred, because it is a legal
 * constraint on who may see them — a wrong guess would show a directory they
 * cannot actually book from.
 */
export default function Therapy() {
  const router = useRouter();
  const theme = useTheme();
  const { jurisdiction, setJurisdiction } = useJurisdiction();
  const [specialty, setSpecialty] = useState<string | null>(null);

  const { data: appointments, refetch: refetchAppointments } = useQuery<{ items: Appointment[] }>(
    (signal) => api.get<{ items: Appointment[] }>('/therapy/appointments?scope=upcoming', signal),
    [],
  );

  const { data, error, loading, refetch } = useQuery<{ items: Therapist[] }>(
    (signal) =>
      api.get<{ items: Therapist[] }>(
        `/therapy/therapists${qs({ jurisdiction: jurisdiction ?? undefined, specialty: specialty ?? undefined })}`,
        signal,
      ),
    [jurisdiction, specialty],
  );

  const therapists = data?.items ?? [];
  const specialties = [...new Set(therapists.flatMap((t) => t.specialties))].sort();

  if (loading && !data) return <Loading label="Finding therapists" />;
  if (error && !data) return <ErrorState error={error} onRetry={refetch} />;

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View
          style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg }}>
          <IconButton glyph="‹" label="Go back" onPress={() => router.back()} />
          <Txt variant="heading">Therapy</Txt>
        </View>

        <ScrollView contentContainerStyle={{ padding: spacing.xl, gap: spacing.xl, paddingTop: 0 }}>
          {/* Upcoming sessions come first — this is why most people open the tab. */}
          {(appointments?.items ?? []).length > 0 ? (
            <View style={{ gap: spacing.md }}>
              <Txt variant="heading">Your sessions</Txt>
              {appointments!.items.map((appointment) => (
                <AppointmentCard
                  key={appointment.id}
                  appointment={appointment}
                  onChanged={refetchAppointments}
                />
              ))}
            </View>
          ) : null}

          <View style={{ gap: spacing.md }}>
            <Txt variant="heading">Find a therapist</Txt>
            <Txt variant="body" tone="muted">
              Licensed clinicians, by video. Who you can see depends on where you are.
            </Txt>
          </View>

          {/* Region picker: a licensing constraint, so it is not optional. */}
          <Card style={{ gap: spacing.md }}>
            <Txt variant="caption" tone="muted">
              Where are you?
            </Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {REGION_OPTIONS.map((option) => (
                <Chip
                  key={option.code}
                  label={option.label}
                  selected={jurisdiction === option.code}
                  onPress={() => setJurisdiction(option.code)}
                />
              ))}
            </View>
            {!jurisdiction ? (
              <Txt variant="micro" tone="faint">
                PICK YOUR REGION TO SEE WHO CAN LEGALLY SEE YOU
              </Txt>
            ) : null}
          </Card>

          {specialties.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              <Chip label="All" selected={specialty === null} onPress={() => setSpecialty(null)} />
              {specialties.map((item) => (
                <Chip
                  key={item}
                  label={item[0]!.toUpperCase() + item.slice(1)}
                  selected={specialty === item}
                  onPress={() => setSpecialty(specialty === item ? null : item)}
                />
              ))}
            </View>
          ) : null}

          <View style={{ gap: spacing.md }}>
            {therapists.map((therapist) => (
              <Pressable
                key={therapist.id}
                accessibilityRole="button"
                accessibilityLabel={`${therapist.fullName}, ${therapist.credentials}`}
                onPress={() =>
                  router.push({
                    pathname: '/therapist/[slug]',
                    params: { slug: therapist.slug },
                  })
                }
                style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}>
                <Card
                  style={{
                    gap: spacing.md,
                    // Someone the client cannot book is shown, but visibly muted.
                    opacity: therapist.availableInYourRegion || !jurisdiction ? 1 : 0.55,
                  }}>
                  <View style={{ flexDirection: 'row', gap: spacing.lg, alignItems: 'center' }}>
                    <View
                      style={{
                        width: 54,
                        height: 54,
                        borderRadius: 27,
                        backgroundColor: theme.colors.surfaceMuted,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}>
                      <Txt variant="subheading">{therapist.fullName.charAt(0)}</Txt>
                    </View>

                    <View style={{ flex: 1, gap: 2 }}>
                      <Txt variant="subheading" numberOfLines={1}>
                        {therapist.fullName}
                      </Txt>
                      <Txt variant="micro" tone="faint">
                        {therapist.credentials.toUpperCase()}
                      </Txt>
                    </View>

                    <View style={{ alignItems: 'flex-end' }}>
                      <Txt variant="bodyStrong">
                        {formatPrice(therapist.sessionPriceCents, therapist.currency)}
                      </Txt>
                      <Txt variant="micro" tone="faint">
                        {therapist.sessionMinutes} MIN
                      </Txt>
                    </View>
                  </View>

                  <Txt variant="body" tone="muted" numberOfLines={2}>
                    {therapist.headline}
                  </Txt>

                  {jurisdiction && !therapist.availableInYourRegion ? (
                    <View
                      style={{
                        padding: spacing.sm,
                        borderRadius: radius.sm,
                        backgroundColor: theme.colors.surfaceMuted,
                      }}>
                      <Txt variant="micro" tone="muted">
                        NOT LICENSED IN {jurisdiction} — LICENSED IN{' '}
                        {therapist.licences.map((l) => l.jurisdiction).join(', ')}
                      </Txt>
                    </View>
                  ) : null}
                </Card>
              </Pressable>
            ))}
          </View>

          <Divider />

          <Txt variant="micro" tone="faint" style={{ textAlign: 'center', lineHeight: 16 }}>
            THERAPY SESSIONS ARE WITH INDEPENDENT LICENSED CLINICIANS. MINDSPACE DOES NOT PROVIDE
            EMERGENCY CARE.
          </Txt>
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

function AppointmentCard({
  appointment,
  onChanged,
}: {
  appointment: Appointment;
  onChanged: () => void;
}) {
  const theme = useTheme();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const starts = new Date(appointment.startsAt);
  const minutesAway = (starts.getTime() - Date.now()) / 60_000;
  // The room only becomes useful shortly before the hour.
  const joinable = minutesAway <= 10 && minutesAway > -60;

  async function cancel() {
    setBusy(true);
    setNotice(null);
    try {
      await api.delete(`/therapy/appointments/${appointment.id}`);
      onChanged();
    } catch (err) {
      setNotice((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ gap: spacing.md, borderColor: joinable ? theme.colors.success : theme.colors.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="subheading">{appointment.therapist.fullName}</Txt>
          <Txt variant="caption" tone="faint">
            {starts.toLocaleString(undefined, {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </Txt>
        </View>
        <Txt variant="caption" tone="muted">
          {formatPrice(appointment.priceCents, appointment.currency)}
        </Txt>
      </View>

      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <Button
          title={joinable ? 'Join session' : 'Join opens 10 min before'}
          size="md"
          disabled={!joinable}
          style={{ flex: 1 }}
          onPress={() => void Linking.openURL(appointment.videoUrl)}
        />
        <Button
          title="Cancel"
          variant="secondary"
          size="md"
          fullWidth={false}
          loading={busy}
          onPress={cancel}
        />
      </View>

      {notice ? (
        <Txt variant="caption" tone="danger">
          {notice}
        </Txt>
      ) : null}
    </Card>
  );
}
