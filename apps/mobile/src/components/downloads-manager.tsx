import { useState } from 'react';
import { Alert, Platform, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { formatDuration } from '@mindspace/shared';
import { radius, spacing } from '@/theme';
import { useTheme } from '@/theme/use-theme';
import { Artwork, Button, Divider, EmptyState, Txt } from './ui';
import { formatBytes } from '@/offline/audio';
import {
  downloadsSupported,
  useDownloadedBytes,
  useDownloadsStore,
  type DownloadedMeta,
} from '@/store/downloads';
import { FREE_DOWNLOAD_LIMIT, PRO_DOWNLOAD_LIMIT } from '@mindspace/shared';
import { useHasPro } from '@/store/auth';

/**
 * The Downloads tab on the profile (PRD screen 15).
 *
 * Everything here is read from the on-device index rather than the API, so it
 * is fully usable in aeroplane mode — which is the one moment a user genuinely
 * needs to know what they have.
 */
export function DownloadsManager() {
  const router = useRouter();
  const theme = useTheme();
  const pro = useHasPro();

  const meta = useDownloadsStore((s) => s.meta);
  const records = useDownloadsStore((s) => s.records);
  const remove = useDownloadsStore((s) => s.remove);
  const removeAll = useDownloadsStore((s) => s.removeAll);
  const totalBytes = useDownloadedBytes();

  const [busy, setBusy] = useState(false);

  if (!downloadsSupported) {
    return (
      <EmptyState
        title="Not available here"
        message="Offline downloads need the iOS or Android app — the web version always streams."
      />
    );
  }

  const items = Object.values(meta).sort((a, b) =>
    b.downloadedAt.localeCompare(a.downloadedAt),
  );

  // A file with no index entry still occupies space and still plays, so count
  // it rather than pretending it is not there.
  const downloadedIds = Object.entries(records)
    .filter(([, r]) => r.status === 'downloaded')
    .map(([id]) => id);
  const orphanCount = downloadedIds.filter((id) => !meta[id]).length;

  // Free accounts get a few downloads rather than none, so the empty state
  // points them at the library instead of at the paywall.
  const limit = pro ? PRO_DOWNLOAD_LIMIT : FREE_DOWNLOAD_LIMIT;

  if (downloadedIds.length === 0) {
    return (
      <EmptyState
        glyph="✈️"
        title="Practice without a signal"
        message={
          pro
            ? 'Tap the ⤓ on any session to keep it on your device — it will play on a plane, on the underground, anywhere.'
            : `Tap the ⤓ on any free session to keep it on your device. You can hold ${FREE_DOWNLOAD_LIMIT} at a time.`
        }
        action={{ label: 'Browse sessions', onPress: () => router.push('/(tabs)/explore') }}
      />
    );
  }

  function confirmRemoveAll() {
    const message = `Remove all ${downloadedIds.length} downloaded sessions from this device? They stay in your library and can be downloaded again.`;

    const run = async () => {
      setBusy(true);
      try {
        await removeAll();
      } finally {
        setBusy(false);
      }
    };

    if (Platform.OS === 'web') {
      void run();
      return;
    }

    Alert.alert('Remove all downloads?', message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove all', style: 'destructive', onPress: () => void run() },
    ]);
  }

  return (
    <View style={{ gap: spacing.lg }}>
      {/* Storage summary + capacity against the Pro cap */}
      <View style={{ paddingHorizontal: spacing.xl, gap: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ gap: 2 }}>
            <Txt variant="bodyStrong">
              {downloadedIds.length} of {limit} sessions
            </Txt>
            <Txt variant="caption" tone="faint">
              {formatBytes(totalBytes)} on this device
            </Txt>
          </View>
          <Button
            title="Remove all"
            variant="secondary"
            size="md"
            fullWidth={false}
            loading={busy}
            onPress={confirmRemoveAll}
          />
        </View>

        {/* How close they are to the 50-download ceiling */}
        <View
          style={{
            height: 6,
            borderRadius: 3,
            backgroundColor: theme.colors.surfaceMuted,
            overflow: 'hidden',
          }}>
          <View
            style={{
              height: '100%',
              width: `${Math.min(100, (downloadedIds.length / limit) * 100)}%`,
              borderRadius: 3,
              backgroundColor:
                downloadedIds.length >= limit
                  ? theme.colors.warning
                  : theme.colors.accent,
            }}
          />
        </View>

        {orphanCount > 0 ? (
          <Txt variant="micro" tone="faint">
            {orphanCount} DOWNLOADED FILE{orphanCount === 1 ? '' : 'S'} WITHOUT DETAILS — STILL PLAYABLE
          </Txt>
        ) : null}
      </View>

      <Divider />

      <View>
        {items.map((item) => (
          <DownloadRow
            key={item.id}
            item={item}
            bytes={records[item.id]?.bytes ?? 0}
            onOpen={() => router.push(`/session/${item.id}`)}
            onRemove={() => void remove(item.id)}
          />
        ))}
      </View>
    </View>
  );
}

function DownloadRow({
  item,
  bytes,
  onOpen,
  onRemove,
}: {
  item: DownloadedMeta;
  bytes: number;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const theme = useTheme();

  function confirm() {
    const message = `Remove "${item.title}" from this device?`;
    if (Platform.OS === 'web') {
      onRemove();
      return;
    }
    Alert.alert('Remove download?', message, [
      { text: 'Keep', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: onRemove },
    ]);
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.title}, downloaded`}
      onPress={onOpen}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.lg,
        paddingHorizontal: spacing.xl,
        paddingVertical: spacing.md,
        opacity: pressed ? 0.75 : 1,
      })}>
      <Artwork title={item.title} category={item.category} size={52} rounded={radius.md} />

      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="bodyStrong" numberOfLines={1}>
          {item.title}
        </Txt>
        <Txt variant="caption" tone="faint" numberOfLines={1}>
          {formatDuration(item.durationSeconds)}
          {item.instructorName ? ` · ${item.instructorName}` : ''}
          {bytes > 0 ? ` · ${formatBytes(bytes)}` : ''}
        </Txt>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove download: ${item.title}`}
        onPress={confirm}
        hitSlop={10}
        style={({ pressed }) => ({
          width: 34,
          height: 34,
          borderRadius: 17,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.surfaceMuted,
          opacity: pressed ? 0.6 : 1,
        })}>
        <Txt style={{ color: theme.colors.textMuted, fontSize: 14 }}>🗑</Txt>
      </Pressable>
    </Pressable>
  );
}
