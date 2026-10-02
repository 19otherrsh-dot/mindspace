import { create } from 'zustand';
import type { CompleteSessionResponse, Session } from '@mindspace/shared';

/** Optional ambient layer mixed under a guided session (screen 10). */
export type BackgroundSound = 'none' | 'rain' | 'waves' | 'forest' | 'noise';

export const BACKGROUND_SOUNDS: Array<{ id: BackgroundSound; label: string }> = [
  { id: 'none', label: 'None' },
  { id: 'rain', label: 'Rain' },
  { id: 'waves', label: 'Waves' },
  { id: 'forest', label: 'Forest' },
  { id: 'noise', label: 'White noise' },
];

interface PlaybackRequest {
  session: Session;
  /** Set when the session is being played as part of a course. */
  courseId?: string;
  courseDayNumber?: number;
  /** ISO timestamp captured when the player opened. */
  startedAt: string;
}

interface PlayerState {
  current: PlaybackRequest | null;
  backgroundSound: BackgroundSound;
  volume: number;
  /** Handed to the summary screen after a session ends. */
  lastResult: (CompleteSessionResponse & { session: Session }) | null;

  play: (session: Session, course?: { id: string; dayNumber: number }) => void;
  stop: () => void;
  setBackgroundSound: (sound: BackgroundSound) => void;
  setVolume: (volume: number) => void;
  setResult: (result: CompleteSessionResponse & { session: Session }) => void;
  clearResult: () => void;
}

export const usePlayerStore = create<PlayerState>((set) => ({
  current: null,
  backgroundSound: 'none',
  volume: 1,
  lastResult: null,

  play: (session, course) =>
    set({
      current: {
        session,
        courseId: course?.id,
        courseDayNumber: course?.dayNumber,
        // Recorded here, not on the server, so an early exit still reports the
        // real listening window.
        startedAt: new Date().toISOString(),
      },
    }),

  stop: () => set({ current: null }),
  setBackgroundSound: (backgroundSound) => set({ backgroundSound }),
  setVolume: (volume) => set({ volume: Math.min(1, Math.max(0, volume)) }),
  setResult: (lastResult) => set({ lastResult }),
  clearResult: () => set({ lastResult: null }),
}));
