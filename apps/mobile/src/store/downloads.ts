import { Platform } from 'react-native';
import { create } from 'zustand';
import { useShallow } from 'zustand/shallow';
import { Directory, File, Paths } from 'expo-file-system';
import { PRO_DOWNLOAD_LIMIT, type Session } from '@mindspace/shared';
import { api, ApiRequestError } from '@/api/client';
import { downloadUrlFor } from '@/offline/audio';

/**
 * Offline downloads (PRD §3.1, §5.2).
 *
 * The filesystem is the source of truth for what is playable offline — the
 * server list is only a convenience for syncing across devices, and asking it
 * would defeat the point when the user has no connection. State lives in one
 * store so the download affordance can look identical and stay in step on
 * every screen that shows it.
 */

/** Downloads live in their own folder so listing them cannot pick up strays. */
const FOLDER = 'sessions';

/** expo-file-system's File/Directory API is native-only. */
export const downloadsSupported = Platform.OS !== 'web';

export type DownloadStatus = 'idle' | 'downloading' | 'downloaded' | 'failed';

export interface DownloadRecord {
  status: DownloadStatus;
  /** 0–1. Stays 0 while the server withholds a Content-Length. */
  progress: number;
  bytes: number;
  error?: string;
}

/**
 * Enough of a session to render the downloads list without a network call.
 * Without this the manager would be blank in aeroplane mode, which is exactly
 * when someone checks what they have.
 */
export interface DownloadedMeta {
  id: string;
  title: string;
  subtitle: string | null;
  category: Session['category'];
  durationSeconds: number;
  instructorName: string | null;
  downloadedAt: string;
}

interface DownloadsState {
  records: Record<string, DownloadRecord>;
  meta: Record<string, DownloadedMeta>;
  hydrated: boolean;

  hydrate: () => Promise<void>;
  download: (session: Session) => Promise<void>;
  remove: (sessionId: string) => Promise<void>;
  removeAll: () => Promise<void>;

  get: (sessionId: string) => DownloadRecord;
  localUriFor: (sessionId: string) => string | null;
}

const IDLE: DownloadRecord = { status: 'idle', progress: 0, bytes: 0 };

const INDEX_FILE = 'index.json';

function directory(): Directory {
  return new Directory(Paths.document, FOLDER);
}

function fileFor(sessionId: string): File {
  return new File(directory(), `${sessionId}.mp3`);
}

function ensureDirectory(): void {
  const dir = directory();
  if (!dir.exists) dir.create({ intermediates: true });
}

function readIndex(): Record<string, DownloadedMeta> {
  try {
    const index = new File(directory(), INDEX_FILE);
    if (!index.exists) return {};
    return JSON.parse(index.textSync()) as Record<string, DownloadedMeta>;
  } catch {
    // A corrupt index costs titles, not audio — rebuild rather than crash.
    return {};
  }
}

function writeIndex(meta: Record<string, DownloadedMeta>): void {
  try {
    ensureDirectory();
    const index = new File(directory(), INDEX_FILE);
    if (!index.exists) index.create();
    index.write(JSON.stringify(meta));
  } catch (err) {
    console.warn('[downloads] could not persist index', err);
  }
}

function metaFrom(session: Session): DownloadedMeta {
  return {
    id: session.id,
    title: session.title,
    subtitle: session.subtitle,
    category: session.category,
    durationSeconds: session.durationSeconds,
    instructorName: session.instructor?.name ?? null,
    downloadedAt: new Date().toISOString(),
  };
}

/** Cancels in flight are tracked so a screen unmount does not orphan a task. */
const active = new Map<string, { cancel: () => void }>();

export const useDownloadsStore = create<DownloadsState>((set, get) => ({
  records: {},
  meta: {},
  hydrated: false,

  get: (sessionId) => get().records[sessionId] ?? IDLE,

  localUriFor: (sessionId) => {
    if (!downloadsSupported) return null;
    // Trust the store rather than hitting the filesystem on every render.
    return get().records[sessionId]?.status === 'downloaded'
      ? fileFor(sessionId).uri
      : null;
  },

  /** Rebuilds state from disk. Works with no network, which is the point. */
  async hydrate() {
    if (!downloadsSupported) {
      set({ hydrated: true });
      return;
    }

    try {
      ensureDirectory();
      const records: Record<string, DownloadRecord> = {};
      const storedMeta = readIndex();
      const meta: Record<string, DownloadedMeta> = {};

      for (const entry of directory().list()) {
        // Directory.list() returns files and subdirectories; we only want ours.
        if (!(entry instanceof File)) continue;

        const name = entry.uri.split('/').pop() ?? '';
        if (!name.endsWith('.mp3')) continue;

        const sessionId = name.slice(0, -'.mp3'.length);
        records[sessionId] = {
          status: 'downloaded',
          progress: 1,
          bytes: entry.size ?? 0,
        };

        // The audio file is the truth; the index only supplies its label.
        if (storedMeta[sessionId]) meta[sessionId] = storedMeta[sessionId];
      }

      // Drop index entries whose audio is gone (cleared by the OS, say).
      if (Object.keys(meta).length !== Object.keys(storedMeta).length) {
        writeIndex(meta);
      }

      set({ records, meta, hydrated: true });
    } catch (err) {
      console.warn('[downloads] could not read local downloads', err);
      set({ hydrated: true });
    }
  },

  async download(session) {
    if (!downloadsSupported) {
      throw new Error('Downloads are only available in the mobile app.');
    }

    const existing = get().records[session.id];
    if (existing?.status === 'downloading') return;

    // Ask the server first: it owns the Pro entitlement check and the
    // 50-session cap, and a rejection here means not touching the disk at all.
    try {
      await api.post('/content/downloads', { sessionId: session.id, bytes: 0 });
    } catch (err) {
      set((state) => ({
        records: {
          ...state.records,
          [session.id]: {
            status: 'failed',
            progress: 0,
            bytes: 0,
            error:
              err instanceof ApiRequestError
                ? err.message
                : `Could not start the download. You can keep ${PRO_DOWNLOAD_LIMIT} sessions offline.`,
          },
        },
      }));
      throw err;
    }

    set((state) => ({
      records: {
        ...state.records,
        [session.id]: { status: 'downloading', progress: 0, bytes: 0 },
      },
    }));

    try {
      ensureDirectory();

      const destination = fileFor(session.id);
      // A half-written file from a previous failure would never complete.
      if (destination.exists) destination.delete();

      // Native fires onProgress far more often than the UI can use. Writing
      // the store every tick would re-render every screen showing this session,
      // so only publish whole-percent changes.
      let lastPublished = -1;

      const task = File.createDownloadTask(downloadUrlFor(session), destination, {
        onProgress: ({ bytesWritten, totalBytes }) => {
          // totalBytes is -1 when the server omits Content-Length; showing a
          // bogus percentage is worse than showing an indeterminate spinner.
          const progress = totalBytes > 0 ? Math.min(1, bytesWritten / totalBytes) : 0;
          const percent = Math.floor(progress * 100);
          if (percent === lastPublished) return;
          lastPublished = percent;

          set((state) => {
            const record = state.records[session.id];
            if (record?.status !== 'downloading') return state;
            return {
              records: {
                ...state.records,
                [session.id]: { ...record, progress, bytes: bytesWritten },
              },
            };
          });
        },
      });

      active.set(session.id, { cancel: () => task.cancel() });

      const file = await task.downloadAsync();
      active.delete(session.id);

      // downloadAsync resolves null when the task was paused or cancelled.
      if (!file) {
        set((state) => ({
          records: { ...state.records, [session.id]: IDLE },
        }));
        return;
      }

      const bytes = file.size ?? 0;

      set((state) => {
        const meta = { ...state.meta, [session.id]: metaFrom(session) };
        writeIndex(meta);
        return {
          meta,
          records: {
            ...state.records,
            [session.id]: { status: 'downloaded', progress: 1, bytes },
          },
        };
      });

      // Report the real size so Settings can show storage accurately.
      await api
        .post('/content/downloads', { sessionId: session.id, bytes })
        .catch(() => {
          /* the local copy is what matters; size sync is cosmetic */
        });
    } catch (err) {
      active.delete(session.id);
      // Never leave a partial file behind pretending to be playable.
      try {
        const partial = fileFor(session.id);
        if (partial.exists) partial.delete();
      } catch {
        /* nothing more to do */
      }

      set((state) => ({
        records: {
          ...state.records,
          [session.id]: {
            status: 'failed',
            progress: 0,
            bytes: 0,
            error: 'Download failed. Check your connection and try again.',
          },
        },
      }));

      // Roll back the server record so the 50-cap is not silently consumed.
      await api.delete(`/content/downloads/${session.id}`).catch(() => {});
      throw err;
    }
  },

  async remove(sessionId) {
    active.get(sessionId)?.cancel();
    active.delete(sessionId);

    if (downloadsSupported) {
      try {
        const file = fileFor(sessionId);
        if (file.exists) file.delete();
      } catch (err) {
        console.warn('[downloads] could not delete file', err);
      }
    }

    set((state) => {
      const records = { ...state.records };
      delete records[sessionId];

      const meta = { ...state.meta };
      delete meta[sessionId];
      writeIndex(meta);

      return { records, meta };
    });

    await api.delete(`/content/downloads/${sessionId}`).catch(() => {
      /* the file is gone locally either way */
    });
  },

  async removeAll() {
    const ids = Object.keys(get().records);
    await Promise.all(ids.map((id) => get().remove(id)));
  },
}));

/** Total bytes held on device, for the storage row in Settings. */
export function useDownloadedBytes(): number {
  return useDownloadsStore((s) =>
    Object.values(s.records).reduce(
      (total, record) => total + (record.status === 'downloaded' ? record.bytes : 0),
      0,
    ),
  );
}

/**
 * Session ids currently held on device. The selector builds a fresh array on
 * every call, so it needs shallow comparison — strict reference equality would
 * re-render on every unrelated store write.
 */
export function useDownloadedIds(): string[] {
  return useDownloadsStore(
    useShallow((s) =>
      Object.entries(s.records)
        .filter(([, record]) => record.status === 'downloaded')
        .map(([id]) => id),
    ),
  );
}
