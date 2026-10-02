import { useState } from 'react';
import { FlatList, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Collection, Session, SortOrder } from '@mindspace/shared';
import { api, qs } from '@/api/client';
import { useQuery } from '@/api/use-query';
import { spacing } from '@/theme';
import { Artwork, Chip, EmptyState, ErrorState, IconButton, Loading, Screen, Txt } from '@/components/ui';
import { SessionRow } from '@/components/session-card';

type LengthFilter = 'all' | 'free' | 'short' | 'long';

const LENGTH_FILTERS: Array<{ id: LengthFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'free', label: 'Free' },
  { id: 'short', label: 'Short' },
  { id: 'long', label: 'Long' },
];

const SORTS: Array<{ id: SortOrder; label: string }> = [
  { id: 'popular', label: 'Popular' },
  { id: 'new', label: 'New' },
  { id: 'duration', label: 'Duration' },
];

/** Screen 8 — a category or curated collection. */
export default function CollectionScreen() {
  const router = useRouter();
  const { slug } = useLocalSearchParams<{ slug: string }>();

  const [filter, setFilter] = useState<LengthFilter>('all');
  const [sort, setSort] = useState<SortOrder>('popular');

  const { data, error, loading, refetch } = useQuery<Collection>(
    (signal) => api.get<Collection>(`/content/collections/${slug}${qs({ sort })}`, signal),
    [slug, sort],
  );

  if (loading && !data) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!data) return null;

  // Filtering client-side: the collection payload is already fully loaded, so
  // a round trip per chip tap would only add latency.
  const sessions = (data.sessions ?? []).filter((session: Session) => {
    if (filter === 'free') return !session.isPro;
    if (filter === 'short') return session.durationSeconds <= 600;
    if (filter === 'long') return session.durationSeconds > 600;
    return true;
  });

  const header = (
    <View style={{ gap: spacing.xl, paddingBottom: spacing.lg }}>
      <Artwork
        title={data.title}
        category={data.category ?? 'beginners'}
        height={220}
        rounded={0}>
        <View style={{ padding: spacing.xl, gap: spacing.xs, backgroundColor: 'rgba(6,9,22,0.35)' }}>
          <Txt variant="display" style={{ color: '#FFF' }}>
            {data.title}
          </Txt>
          <Txt variant="caption" style={{ color: 'rgba(255,255,255,0.85)' }}>
            {data.sessionCount} sessions
          </Txt>
        </View>
      </Artwork>

      <View style={{ paddingHorizontal: spacing.xl, gap: spacing.lg }}>
        <Txt variant="body" tone="muted">
          {data.description}
        </Txt>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {LENGTH_FILTERS.map((option) => (
            <Chip
              key={option.id}
              label={option.label}
              selected={filter === option.id}
              onPress={() => setFilter(option.id)}
            />
          ))}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Txt variant="micro" tone="faint">
            SORT BY
          </Txt>
          {SORTS.map((option) => (
            <Chip
              key={option.id}
              label={option.label}
              selected={sort === option.id}
              onPress={() => setSort(option.id)}
            />
          ))}
        </View>
      </View>
    </View>
  );

  return (
    <Screen>
      <FlatList
        data={sessions}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={header}
        renderItem={({ item }) => <SessionRow session={item} />}
        contentContainerStyle={{ paddingBottom: spacing.xxxl }}
        ListEmptyComponent={
          <EmptyState
            glyph="🫧"
            title="Nothing fits those filters"
            message="Try widening them — there is more in this collection than these settings allow through."
            action={{ label: 'Show all', onPress: () => setFilter('all') }}
          />
        }
      />

      {/* Floating back control, since the hero runs under the status bar. */}
      <SafeAreaView style={{ position: 'absolute', top: 0, left: 0 }} edges={['top']}>
        <View style={{ padding: spacing.lg }}>
          <IconButton glyph="‹" label="Go back" tone="onAccent" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    </Screen>
  );
}
