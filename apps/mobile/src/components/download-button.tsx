import { useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { Session } from '@mindspace/shared';
import { radius, spacing } from '@/theme';
import { useTheme } from '@/theme/use-theme';
import { Txt } from './ui';
import { ApiRequestError } from '@/api/client';
import { useHasPro } from '@/store/auth';
import { downloadsSupported, useDownloadsStore } from '@/store/downloads';
import { formatBytes } from '@/offline/audio';

/**
 * The single download control for the whole app.
 *
 * Four states, each visually distinct at a glance: available (⤓), in progress
 * (a filling ring), on device (✓ in the success colour), and failed (↻ to
 * retry). Using one component everywhere is what makes the feature feel
 * learnable — the icon means the same thing on a list row, a detail page and
 * the downloads manager.
 */
export function DownloadButton({
  session,
  variant = 'icon',
  onChange,
}: {
  session: Session;
  /** `icon` for list rows, `full` for the detail screen's action bar. */
  variant?: 'icon' | 'full';
  onChange?: () => void;
}) {
  const theme = useTheme();
  const router = useRouter();
  const hasPro = useHasPro();

  const record = useDownloadsStore((s) => s.records[session.id]);
  const download = useDownloadsStore((s) => s.download);
  const remove = useDownloadsStore((s) => s.remove);

  const [busy, setBusy] = useState(false);

  // Downloads need the native filesystem; on web the control would be a lie.
  if (!downloadsSupported) return null;

  const status = record?.status ?? 'idle';
  const locked = session.isPro && !hasPro;

  async function handlePress() {
    if (locked) {
      router.push('/paywall');
      return;
    }

    if (status === 'downloading') return;

    if (status === 'downloaded') {
      const confirmRemove = async () => {
        setBusy(true);
        try {
          await remove(session.id);
          onChange?.();
        } finally {
          setBusy(false);
        }
      };

      const message = `Remove "${session.title}" from this device? You can download it again any time.`;

      if (Platform.OS === 'web') {
        void confirmRemove();
      } else {
        Alert.alert('Remove download?', message, [
          { text: 'Keep', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: () => void confirmRemove() },
        ]);
      }
      return;
    }

    setBusy(true);
    try {
      await download(session);
      onChange?.();
    } catch (err) {
      // A 402 means the server refused on entitlement — send them to the paywall
      // rather than showing a dead error.
      if (err instanceof ApiRequestError && err.isPaywall) {
        router.push('/paywall');
      } else if (err instanceof ApiRequestError) {
        Alert.alert('Could not download', err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  const { glyph, label, color } = describe(status, locked, theme);

  if (variant === 'icon') {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${session.title}`}
        accessibilityState={{ busy: status === 'downloading' }}
        onPress={handlePress}
        hitSlop={10}
        style={({ pressed }) => ({
          width: 34,
          height: 34,
          borderRadius: 17,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.surfaceMuted,
          opacity: pressed ? 0.7 : 1,
        })}>
        {status === 'downloading' ? (
          <ProgressPip progress={record?.progress ?? 0} color={theme.colors.accent} />
        ) : (
          <Txt style={{ color, fontSize: 15 }}>{glyph}</Txt>
        )}
      </Pressable>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${session.title}`}
      onPress={handlePress}
      disabled={busy && status !== 'downloading'}
      style={({ pressed }) => ({
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        paddingVertical: spacing.md,
        borderRadius: radius.pill,
        backgroundColor: theme.colors.surfaceMuted,
        opacity: pressed ? 0.75 : 1,
      })}>
      {status === 'downloading' ? (
        <ActivityIndicator size="small" color={theme.colors.accent} />
      ) : (
        <Txt style={{ color, fontSize: 15 }}>{glyph}</Txt>
      )}
      <Txt variant="caption" tone="muted">
        {status === 'downloading' && (record?.progress ?? 0) > 0
          ? `${Math.round((record?.progress ?? 0) * 100)}%`
          : label}
      </Txt>
      {status === 'downloaded' && (record?.bytes ?? 0) > 0 ? (
        <Txt variant="micro" tone="faint">
          {formatBytes(record!.bytes)}
        </Txt>
      ) : null}
    </Pressable>
  );
}

function describe(
  status: string,
  locked: boolean,
  theme: ReturnType<typeof useTheme>,
): { glyph: string; label: string; color: string } {
  if (locked) return { glyph: '🔒', label: 'Download with Pro', color: theme.colors.textMuted };
  switch (status) {
    case 'downloaded':
      return { glyph: '✓', label: 'Downloaded', color: theme.colors.success };
    case 'downloading':
      return { glyph: '⤓', label: 'Downloading…', color: theme.colors.accent };
    case 'failed':
      return { glyph: '↻', label: 'Retry download', color: theme.colors.danger };
    default:
      return { glyph: '⤓', label: 'Download', color: theme.colors.textMuted };
  }
}

/** A small determinate ring, or a pulsing dot when size is unknown. */
function ProgressPip({ progress, color }: { progress: number; color: string }) {
  const theme = useTheme();
  const size = 20;

  if (progress <= 0) {
    return <ActivityIndicator size="small" color={color} />;
  }

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 2,
        borderColor: theme.colors.border,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}>
      {/* Fills bottom-up — reads as "filling up" without needing SVG here. */}
      <View
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: `${Math.round(progress * 100)}%`,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

/** Small "available offline" marker for list rows and the player. */
export function OfflineBadge({ compact = false }: { compact?: boolean }) {
  const theme = useTheme();
  return (
    <View
      accessibilityLabel="Available offline"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: compact ? 6 : spacing.sm,
        paddingVertical: 2,
        borderRadius: radius.sm,
        backgroundColor: theme.colors.surfaceMuted,
      }}>
      <Txt style={{ color: theme.colors.success, fontSize: 10 }}>✓</Txt>
      {!compact ? (
        <Txt variant="micro" tone="muted">
          OFFLINE
        </Txt>
      ) : null}
    </View>
  );
}
