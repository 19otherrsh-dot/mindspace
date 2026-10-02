import type { Session } from '@mindspace/shared';

/**
 * Resolving what to actually play, and what to actually download.
 *
 * The seeded catalogue points at `cdn.mindspace.example.com`, which is not a
 * real host — see docs/audio-production-brief.md. Until real HLS manifests
 * exist, downloads would always fail and the offline feature could not be
 * exercised at all, so development falls back to a single public demo track.
 *
 * This is deliberately the *only* place that fallback lives. Set
 * EXPO_PUBLIC_DEMO_AUDIO_URL to point it elsewhere, and once the CDN is real
 * the placeholder host check stops matching and every session streams and
 * downloads its own audio with no code change.
 */

const PLACEHOLDER_CDN = 'cdn.mindspace.example.com';

const DEMO_AUDIO_URL =
  process.env.EXPO_PUBLIC_DEMO_AUDIO_URL ??
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3';

/** True while the catalogue still points at the placeholder CDN. */
export function isPlaceholderAudio(session: Pick<Session, 'streamUrl'>): boolean {
  return !session.streamUrl || session.streamUrl.includes(PLACEHOLDER_CDN);
}

/**
 * The URL to fetch when downloading for offline. HLS manifests cannot be
 * stored as a single file, so a real deployment would hand back a progressive
 * MP3/AAC rendition here — that is what the `/content/downloads` response is
 * for on the server side.
 */
export function downloadUrlFor(session: Session): string {
  return isPlaceholderAudio(session) ? DEMO_AUDIO_URL : session.streamUrl;
}

/**
 * What the player should load: the local copy when one exists, otherwise the
 * stream. Returns null when there is nothing playable, which puts the player
 * into its timed-session fallback.
 */
export function playbackUriFor(session: Session, localUri: string | null): string | null {
  if (localUri) return localUri;
  if (isPlaceholderAudio(session)) return DEMO_AUDIO_URL;
  return session.streamUrl || null;
}

/**
 * Returns the URL for a background ambient loop, such as rain or waves.
 * Like the main sessions, falls back to a placeholder during development.
 */
export function backgroundPlaybackUriFor(id: string): string {
  // If we are using the placeholder CDN or DEMO_AUDIO_URL is set, use a demo background loop
  if (process.env.EXPO_PUBLIC_DEMO_AUDIO_URL || process.env.NODE_ENV === 'development') {
    return 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3';
  }
  // Otherwise, use the production CDN
  // Using the domain from a known real session stream or assuming a config
  // The brief states: ${CDN_BASE_URL}/ambience/{id}.m3u8
  return `https://cdn.mindspace.example.com/ambience/${id}.m3u8`;
}

/** Human-readable byte size for the downloads manager. */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 0.1) return '<0.1 MB';
  if (mb < 1000) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}
