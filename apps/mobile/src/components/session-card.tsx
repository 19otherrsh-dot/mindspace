import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { CATEGORY_LABELS, formatDuration, type Session } from '@mindspace/shared';
import { radius, spacing } from '@/theme';
import { useTheme } from '@/theme/use-theme';
import { Artwork, ProBadge, Txt } from './ui';
import { DownloadButton } from './download-button';
import { useHasPro } from '@/store/auth';
import { useDownloadsStore } from '@/store/downloads';

/** Formats "12 min · Nadia Okoye" for the card's second line. */
function metaLine(session: Session): string {
  const parts = [formatDuration(session.durationSeconds)];
  if (session.instructor) parts.push(session.instructor.name);
  return parts.join(' · ');
}

/** Locked content still navigates — the detail screen opens the paywall. */
function useLocked(session: Session): boolean {
  const hasPro = useHasPro();
  return session.isPro && !hasPro;
}

/** Square card for horizontal carousels on Home and Explore. */
export function SessionCard({ session, width = 156 }: { session: Session; width?: number }) {
  const router = useRouter();
  const locked = useLocked(session);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${session.title}, ${metaLine(session)}${locked ? ', Pro only' : ''}`}
      onPress={() => router.push(`/session/${session.id}`)}
      style={({ pressed }) => ({ width, gap: spacing.sm, opacity: pressed ? 0.8 : 1 })}>
      <Artwork title={session.title} category={session.category} size={width} height={width}>
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', padding: spacing.sm }}>
          {locked ? <ProBadge /> : null}
        </View>
      </Artwork>
      <View style={{ gap: 2 }}>
        <Txt variant="bodyStrong" numberOfLines={2}>
          {session.title}
        </Txt>
        <Txt variant="caption" tone="faint" numberOfLines={1}>
          {metaLine(session)}
        </Txt>
      </View>
    </Pressable>
  );
}

/** Wide row used in category listings and search results. */
export function SessionRow({ session }: { session: Session }) {
  const router = useRouter();
  const theme = useTheme();
  const locked = useLocked(session);
  const downloaded = useDownloadsStore((s) => s.records[session.id]?.status === 'downloaded');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${session.title}, ${metaLine(session)}${locked ? ', Pro only' : ''}`}
      onPress={() => router.push(`/session/${session.id}`)}
      style={({ pressed }) => ({
        flexDirection: 'row',
        gap: spacing.lg,
        alignItems: 'center',
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.xl,
        opacity: pressed ? 0.75 : 1,
      })}>
      <Artwork title={session.title} category={session.category} size={64} rounded={radius.md} />

      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Txt variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
            {session.title}
          </Txt>
          {locked ? <ProBadge /> : null}
        </View>
        <Txt variant="caption" tone="faint" numberOfLines={1}>
          {metaLine(session)}
        </Txt>
        <Txt variant="micro" tone="muted">
          {CATEGORY_LABELS[session.category].toUpperCase()}
          {session.ratingCount > 0 ? `  ★ ${session.rating.toFixed(1)}` : ''}
          {downloaded ? '  ✓ OFFLINE' : ''}
        </Txt>
      </View>

      {session.isFavourite ? <Txt style={{ color: theme.colors.danger }}>♥</Txt> : null}

      {/* Saving for offline should not require opening the session first. */}
      <DownloadButton session={session} />
    </Pressable>
  );
}

/** Full-bleed hero card for the daily recommendation on Home. */
export function HeroCard({
  session,
  reason,
  onPress,
}: {
  session: Session;
  reason: string;
  onPress: () => void;
}) {
  const locked = useLocked(session);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Today's recommendation: ${session.title}`}
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}>
      <Artwork title={session.title} category={session.category} height={220} rounded={radius.xl}>
        <View
          style={{
            padding: spacing.xl,
            gap: spacing.xs,
            // Keeps the text legible against the lighter end of the gradient.
            backgroundColor: 'rgba(6, 9, 22, 0.35)',
          }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Txt variant="micro" style={{ color: 'rgba(255,255,255,0.85)' }}>
              {reason.toUpperCase()}
            </Txt>
            {locked ? <ProBadge /> : null}
          </View>
          <Txt variant="title" style={{ color: '#FFF' }} numberOfLines={2}>
            {session.title}
          </Txt>
          <Txt variant="caption" style={{ color: 'rgba(255,255,255,0.85)' }}>
            {metaLine(session)}
          </Txt>
        </View>
      </Artwork>
    </Pressable>
  );
}
