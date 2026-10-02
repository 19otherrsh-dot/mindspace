import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CATEGORY_LABELS, formatDuration, type Session } from '@mindspace/shared';
import { api } from '@/api/client';
import { useQuery } from '@/api/use-query';
import { radius, spacing } from '@/theme';
import { useTheme } from '@/theme/use-theme';
import {
  Artwork,
  Button,
  Divider,
  ErrorState,
  HScroll,
  IconButton,
  Loading,
  ProBadge,
  Row,
  Screen,
  Txt,
} from '@/components/ui';
import { SessionCard } from '@/components/session-card';
import { DownloadButton, OfflineBadge } from '@/components/download-button';
import * as haptics from '@/lib/haptics';
import { useHasPro } from '@/store/auth';
import { usePlayerStore } from '@/store/player';
import { useDownloadsStore } from '@/store/downloads';

interface SessionDetail {
  session: Session;
  related: Session[];
}

/** Screen 9 — the pre-play detail page. */
export default function SessionDetailScreen() {
  const router = useRouter();
  const theme = useTheme();
  const hasPro = useHasPro();
  const play = usePlayerStore((s) => s.play);
  const { id } = useLocalSearchParams<{ id: string }>();

  const [expanded, setExpanded] = useState(false);
  const [favourite, setFavourite] = useState<boolean | null>(null);

  // Download state is owned by the store, so this screen reflects a download
  // started anywhere else in the app without re-fetching.
  const downloadRecord = useDownloadsStore((s) => (id ? s.records[id] : undefined));

  const { data, error, loading, refetch } = useQuery<SessionDetail>(
    (signal) => api.get<SessionDetail>(`/content/sessions/${id}`, signal),
    [id],
  );

  if (loading && !data) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!data) return null;

  const { session, related } = data;
  const locked = session.isPro && !hasPro;
  const isFavourite = favourite ?? session.isFavourite ?? false;
  const isDownloaded = downloadRecord?.status === 'downloaded';
  const downloadError =
    downloadRecord?.status === 'failed' ? (downloadRecord.error ?? null) : null;

  async function toggleFavourite() {
    // Optimistic: the heart should respond instantly, and a failed request
    // simply rolls the icon back.
    const next = !isFavourite;
    setFavourite(next);
    // Keeping something is a small act of ownership; it should feel like one.
    if (next) haptics.settle();
    try {
      if (next) await api.put(`/content/favourites/${session.id}`);
      else await api.delete(`/content/favourites/${session.id}`);
    } catch {
      setFavourite(!next);
      haptics.nudge();
    }
  }

  function start() {
    if (locked) {
      router.push('/paywall');
      return;
    }
    play(session);
    router.push('/player');
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxxl }}>
        <Artwork title={session.title} category={session.category} height={320} rounded={0}>
          <View style={{ padding: spacing.xl, gap: spacing.sm, backgroundColor: 'rgba(6,9,22,0.35)' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Txt variant="micro" style={{ color: 'rgba(255,255,255,0.85)' }}>
                {CATEGORY_LABELS[session.category].toUpperCase()}
              </Txt>
              {session.isPro ? <ProBadge /> : null}
              {isDownloaded ? <OfflineBadge /> : null}
            </View>
            <Txt variant="display" style={{ color: '#FFF' }}>
              {session.title}
            </Txt>
            {session.subtitle ? (
              <Txt variant="body" style={{ color: 'rgba(255,255,255,0.85)' }}>
                {session.subtitle}
              </Txt>
            ) : null}
          </View>
        </Artwork>

        <View style={{ padding: spacing.xl, gap: spacing.xl }}>
          {/* Facts row */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xl }}>
            <View style={{ gap: 2 }}>
              <Txt variant="micro" tone="faint">
                LENGTH
              </Txt>
              <Txt variant="bodyStrong">{formatDuration(session.durationSeconds)}</Txt>
            </View>

            {session.instructor ? (
              <View style={{ gap: 2, flex: 1 }}>
                <Txt variant="micro" tone="faint">
                  TEACHER
                </Txt>
                <Txt variant="bodyStrong" numberOfLines={1}>
                  {session.instructor.name}
                </Txt>
              </View>
            ) : null}

            {session.ratingCount > 0 ? (
              <View style={{ gap: 2 }}>
                <Txt variant="micro" tone="faint">
                  RATING
                </Txt>
                <Txt variant="bodyStrong">
                  ★ {session.rating.toFixed(1)}{' '}
                  <Txt variant="caption" tone="faint">
                    ({session.ratingCount})
                  </Txt>
                </Txt>
              </View>
            ) : null}
          </View>

          <Divider />

          {/* Collapsible about section */}
          <View style={{ gap: spacing.sm }}>
            <Txt variant="heading">About this session</Txt>
            <Txt variant="body" tone="muted" numberOfLines={expanded ? undefined : 3}>
              {session.description}
            </Txt>
            {session.description.length > 140 ? (
              <Pressable accessibilityRole="button" onPress={() => setExpanded(!expanded)}>
                <Txt variant="caption" tone="accent">
                  {expanded ? 'Show less' : 'Read more'}
                </Txt>
              </Pressable>
            ) : null}
          </View>

          {session.instructor?.bio ? (
            <View style={{ gap: spacing.sm }}>
              <Txt variant="heading">About {session.instructor.name}</Txt>
              <Txt variant="body" tone="muted">
                {session.instructor.bio}
              </Txt>
            </View>
          ) : null}

          {/* Actions */}
          <View style={{ gap: spacing.md }}>
            <Button
              title={locked ? 'Unlock with Pro' : 'Play session'}
              icon={locked ? '🔒' : '▶'}
              onPress={start}
            />

            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={isFavourite ? 'Remove from favourites' : 'Add to favourites'}
                onPress={toggleFavourite}
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: spacing.sm,
                  paddingVertical: spacing.md,
                  borderRadius: radius.pill,
                  backgroundColor: theme.colors.surfaceMuted,
                }}>
                <Txt style={{ color: isFavourite ? theme.colors.danger : theme.colors.textMuted }}>
                  {isFavourite ? '♥' : '♡'}
                </Txt>
                <Txt variant="caption" tone="muted">
                  {isFavourite ? 'Saved' : 'Favourite'}
                </Txt>
              </Pressable>

              <DownloadButton session={session} variant="full" onChange={refetch} />
            </View>

            {downloadError ? (
              <Txt variant="caption" tone="danger" style={{ textAlign: 'center' }}>
                {downloadError}
              </Txt>
            ) : isDownloaded ? (
              <Txt variant="caption" tone="muted" style={{ textAlign: 'center' }}>
                Saved on this device — plays without a connection.
              </Txt>
            ) : null}
          </View>
        </View>

        {related.length > 0 ? (
          <Row title="You might also like">
            <HScroll>
              {related.map((item) => (
                <SessionCard key={item.id} session={item} />
              ))}
            </HScroll>
          </Row>
        ) : null}
      </ScrollView>

      <SafeAreaView style={{ position: 'absolute', top: 0, left: 0 }} edges={['top']}>
        <View style={{ padding: spacing.lg }}>
          <IconButton glyph="‹" label="Go back" tone="onAccent" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    </Screen>
  );
}
