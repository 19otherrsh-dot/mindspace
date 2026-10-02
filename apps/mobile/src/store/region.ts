import { useCallback, useEffect } from 'react';
import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * The client's jurisdiction, used to decide which therapists may legally see
 * them.
 *
 * Asked for rather than inferred. A timezone gives a decent guess, but the
 * consequence of guessing wrong here is showing someone a clinician who cannot
 * take them — so the guess is only ever a pre-selection the user can correct.
 */

export const REGION_OPTIONS = [
  { code: 'US-CA', label: 'California' },
  { code: 'US-NY', label: 'New York' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'IN', label: 'India' },
] as const;

const STORAGE_KEY = 'mindspace.jurisdiction';

async function persist(value: string): Promise<void> {
  try {
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(STORAGE_KEY, value);
    else await SecureStore.setItemAsync(STORAGE_KEY, value);
  } catch {
    // A lost preference costs one extra tap, not correctness.
  }
}

async function restore(): Promise<string | null> {
  try {
    if (Platform.OS === 'web') return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
    return await SecureStore.getItemAsync(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Timezone-based pre-selection. Only ever a default; never authoritative. */
function guessFromTimezone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone === 'Europe/London') return 'GB';
    if (zone === 'Asia/Kolkata' || zone === 'Asia/Calcutta') return 'IN';
    if (zone === 'America/Los_Angeles') return 'US-CA';
    if (zone === 'America/New_York') return 'US-NY';
    return null;
  } catch {
    return null;
  }
}

interface RegionState {
  jurisdiction: string | null;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  set: (jurisdiction: string) => void;
}

export const useRegionStore = create<RegionState>((setState) => ({
  jurisdiction: null,
  hydrated: false,

  async hydrate() {
    const stored = await restore();
    setState({ jurisdiction: stored ?? guessFromTimezone(), hydrated: true });
  },

  set(jurisdiction) {
    setState({ jurisdiction });
    void persist(jurisdiction);
  },
}));

export function useJurisdiction(): {
  jurisdiction: string | null;
  setJurisdiction: (value: string) => void;
} {
  const jurisdiction = useRegionStore((s) => s.jurisdiction);
  const hydrated = useRegionStore((s) => s.hydrated);
  const hydrate = useRegionStore((s) => s.hydrate);
  const set = useRegionStore((s) => s.set);

  // Reading from storage is a side effect, so it belongs in an effect rather
  // than the render pass.
  useEffect(() => {
    if (!hydrated) void hydrate();
  }, [hydrated, hydrate]);

  const setJurisdiction = useCallback((value: string) => set(value), [set]);
  return { jurisdiction, setJurisdiction };
}
