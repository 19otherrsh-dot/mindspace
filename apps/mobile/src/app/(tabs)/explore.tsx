import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  CATEGORY_LABELS,
  type Category,
  type Collection,
  type Instructor,
  type Paginated,
  type Session,
} from '@mindspace/shared';
import { api, qs } from '@/api/client';
import { useQuery } from '@/api/use-query';
import { radius, spacing } from '@/theme';
import { useTheme } from '@/theme/use-theme';
import { Artwork, Button, Chip, EmptyState, HScroll, Loading, Row, Screen, Txt } from '@/components/ui';
import { SessionRow } from '@/components/session-card';

const CATEGORIES: Category[] = [
  'beginners',
  'sleep',
  'stress',
  'anxiety',
  'focus',
  'relationships',
  'sports',
];

/** Screen 7 — the browsable content library. */
export default function Explore() {
  const router = useRouter();
  const theme = useTheme();

  const [rawQuery, setRawQuery] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category | null>(null);

  // Debounced so typing does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(rawQuery.trim()), 300);
    return () => clearTimeout(timer);
  }, [rawQuery]);

  const searching = query.length > 0 || category !== null;

  const { data: collections } = useQuery<{ items: Collection[] }>(
    (signal) => api.get<{ items: Collection[] }>('/content/collections', signal),
    [],
  );

  const { data: teachers } = useQuery<{ items: Instructor[] }>(
    (signal) => api.get<{ items: Instructor[] }>('/content/teachers', signal),
    [],
  );

  const { data: results, loading } = useQuery<Paginated<Session>>(
    (signal) =>
      api.get<Paginated<Session>>(
        `/content/sessions${qs({
          q: query || undefined,
          category: category ?? undefined,
          limit: 40,
        })}`,
        signal,
      ),
    [query, category],
  );

  const featured = useMemo(
    () => (collections?.items ?? []).filter((c) => c.sessionCount > 0),
    [collections],
  );

  const header = (
    <View style={{ gap: spacing.xl, paddingBottom: spacing.lg }}>
      {/* Search */}
      <View style={{ paddingHorizontal: spacing.xl, gap: spacing.lg }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Txt variant="display">Explore</Txt>
          <Button title="Breathe" icon="🌬️" onPress={() => router.push('/breathe')} fullWidth={false} />
        </View>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.md,
            backgroundColor: theme.colors.surfaceMuted,
            borderRadius: radius.pill,
            paddingHorizontal: spacing.lg,
          }}>
          <Txt tone="faint">⌕</Txt>
          <TextInput
            value={rawQuery}
            onChangeText={setRawQuery}
            placeholder="Search sessions, sleep, focus…"
            placeholderTextColor={theme.colors.textFaint}
            returnKeyType="search"
            autoCorrect={false}
            style={{ flex: 1, paddingVertical: spacing.md + 2, color: theme.colors.text, fontSize: 15 }}
          />
          {rawQuery.length > 0 ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setRawQuery('')}>
              <Txt tone="faint">✕</Txt>
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Category chips */}
      <HScroll>
        <Chip label="All" selected={category === null} onPress={() => setCategory(null)} />
        {CATEGORIES.map((item) => (
          <Chip
            key={item}
            label={CATEGORY_LABELS[item]}
            selected={category === item}
            onPress={() => setCategory(category === item ? null : item)}
          />
        ))}
      </HScroll>

      {/* Collections are only relevant while browsing, not while searching */}
      {!searching && featured.length > 0 ? (
        <Row title="Collections" subtitle="Curated by our editors">
          <HScroll>
            {featured.map((collection) => (
              <Pressable
                key={collection.id}
                accessibilityRole="button"
                onPress={() => router.push(`/collection/${collection.slug}`)}
                style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
                <Artwork
                  title={collection.title}
                  category={collection.category ?? 'beginners'}
                  size={240}
                  height={128}
                  rounded={radius.lg}>
                  <View style={{ padding: spacing.lg, backgroundColor: 'rgba(6,9,22,0.3)' }}>
                    <Txt variant="subheading" style={{ color: '#FFF' }} numberOfLines={1}>
                      {collection.title}
                    </Txt>
                    <Txt variant="micro" style={{ color: 'rgba(255,255,255,0.8)' }}>
                      {collection.sessionCount} SESSIONS
                    </Txt>
                  </View>
                </Artwork>
              </Pressable>
            ))}
          </HScroll>
        </Row>
      ) : null}

      {/* Teachers: competitors bill the narrator prominently, so make them
          somewhere you can actually go. */}
      {!searching && (teachers?.items ?? []).length > 0 ? (
        <Row title="Teachers" subtitle="The voices behind the sessions">
          <HScroll>
            {(teachers?.items ?? []).map((teacher) => (
              <Pressable
                key={teacher.id}
                accessibilityRole="button"
                accessibilityLabel={`${teacher.name}, ${teacher.sessionCount} sessions`}
                // `slug` is optional on Instructor because it is absent when
                // the type is embedded in a Session; the directory always sets it.
                onPress={() =>
                  router.push({
                    pathname: '/teacher/[slug]',
                    params: { slug: teacher.slug ?? '' },
                  })
                }
                style={({ pressed }) => ({
                  width: 132,
                  alignItems: 'center',
                  gap: spacing.sm,
                  opacity: pressed ? 0.8 : 1,
                })}>
                <Artwork title={teacher.name} category="beginners" size={92} rounded={46} />
                <View style={{ alignItems: 'center', gap: 1 }}>
                  <Txt variant="bodyStrong" numberOfLines={1}>
                    {teacher.name}
                  </Txt>
                  <Txt variant="micro" tone="faint" numberOfLines={1}>
                    {teacher.tagline ?? `${teacher.sessionCount} sessions`}
                  </Txt>
                </View>
              </Pressable>
            ))}
          </HScroll>
        </Row>
      ) : null}

      <View style={{ paddingHorizontal: spacing.xl }}>
        <Txt variant="heading">
          {searching
            ? `${results?.total ?? 0} result${results?.total === 1 ? '' : 's'}`
            : 'All sessions'}
        </Txt>
      </View>
    </View>
  );

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <FlatList
          data={results?.items ?? []}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={header}
          renderItem={({ item }) => <SessionRow session={item} />}
          contentContainerStyle={{ paddingBottom: spacing.xxxl, paddingTop: spacing.lg }}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            loading ? (
              <Loading />
            ) : (
              <EmptyState
                glyph={searching ? '🔍' : '🫧'}
                title={searching ? 'No matches for that' : 'Nothing here yet'}
                message={
                  searching
                    ? 'Try a shorter word, or clear the filters and browse instead.'
                    : 'The library is still loading.'
                }
                action={
                  searching
                    ? {
                        label: 'Clear filters',
                        onPress: () => {
                          setRawQuery('');
                          setCategory(null);
                        },
                      }
                    : undefined
                }
              />
            )
          }
        />
      </SafeAreaView>
    </Screen>
  );
}
