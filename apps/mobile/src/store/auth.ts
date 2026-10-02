import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type {
  AuthResponse,
  AuthTokens,
  OnboardingProfile,
  User,
  UserPreferences,
} from '@mindspace/shared';
import { isPro } from '@mindspace/shared';
import { api, configureApiClient } from '@/api/client';
import { syncWidget } from '@/lib/widget';

const TOKEN_KEY = 'mindspace.tokens';

/**
 * SecureStore is unavailable on web, where localStorage is the closest
 * equivalent. Tokens are short-lived and the refresh token is revocable
 * server-side, which is what limits the blast radius there.
 */
const storage = {
  async get(key: string): Promise<string | null> {
    if (Platform.OS === 'web') {
      try {
        return globalThis.localStorage?.getItem(key) ?? null;
      } catch {
        return null;
      }
    }
    return SecureStore.getItemAsync(key);
  },
  async set(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') {
      try {
        globalThis.localStorage?.setItem(key, value);
      } catch {
        /* private mode */
      }
      return;
    }
    await SecureStore.setItemAsync(key, value);
  },
  async remove(key: string): Promise<void> {
    if (Platform.OS === 'web') {
      try {
        globalThis.localStorage?.removeItem(key);
      } catch {
        /* ignore */
      }
      return;
    }
    await SecureStore.deleteItemAsync(key);
  },
};

interface AuthState {
  user: User | null;
  tokens: AuthTokens | null;
  /** False until the persisted session has been read from storage. */
  hydrated: boolean;
  busy: boolean;

  hydrate: () => Promise<void>;
  signUp: (email: string, password: string, displayName?: string) => Promise<void>;
  logIn: (email: string, password: string) => Promise<void>;
  continueAsGuest: () => Promise<void>;
  convertGuest: (email: string, password: string, displayName?: string) => Promise<void>;
  logOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
  saveOnboarding: (profile: Omit<OnboardingProfile, 'completedAt'>) => Promise<void>;
  updatePreferences: (patch: Partial<UserPreferences>) => Promise<void>;
  updateProfile: (patch: { displayName?: string; avatarUrl?: string | null }) => Promise<void>;
  deleteAccount: () => Promise<void>;
  setSession: (response: AuthResponse) => Promise<void>;
  signInWithApple: (
    identityToken: string,
    fullName?: { givenName?: string; familyName?: string },
    /** Raw nonce; the server re-derives its hash to detect a replayed token. */
    nonce?: string,
  ) => Promise<void>;
  signInWithGoogle: (idToken: string, nonce?: string) => Promise<void>;
}

/** The device's IANA zone, so streaks roll over at the user's midnight. */
function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  tokens: null,
  hydrated: false,
  busy: false,

  async setSession(response: AuthResponse) {
    await storage.set(TOKEN_KEY, JSON.stringify(response.tokens));
    set({ user: response.user, tokens: response.tokens });
    // The widget shows the streak, which arrives with the home feed rather
    // than the user, so Home publishes it once that loads.
  },

  async hydrate() {
    try {
      const raw = await storage.get(TOKEN_KEY);
      if (!raw) return;

      const tokens = JSON.parse(raw) as AuthTokens;
      set({ tokens });

      // Validate against the server rather than trusting the stored copy —
      // the account may have been deleted or the token revoked elsewhere.
      const user = await api.get<User>('/users/me');
      set({ user });
    } catch {
      await storage.remove(TOKEN_KEY);
      set({ user: null, tokens: null });
      syncWidget(null);
    } finally {
      set({ hydrated: true });
    }
  },

  async signUp(email, password, displayName) {
    set({ busy: true });
    try {
      const response = await api.public<AuthResponse>('/auth/signup', {
        email,
        password,
        displayName,
        timezone: deviceTimezone(),
      });
      await get().setSession(response);
    } finally {
      set({ busy: false });
    }
  },

  async logIn(email, password) {
    set({ busy: true });
    try {
      const response = await api.public<AuthResponse>('/auth/login', {
        email,
        password,
        timezone: deviceTimezone(),
      });
      await get().setSession(response);
    } finally {
      set({ busy: false });
    }
  },

  async continueAsGuest() {
    set({ busy: true });
    try {
      const response = await api.public<AuthResponse>('/auth/guest', {
        timezone: deviceTimezone(),
      });
      await get().setSession(response);
    } finally {
      set({ busy: false });
    }
  },

  async convertGuest(email, password, displayName) {
    set({ busy: true });
    try {
      const response = await api.post<AuthResponse>('/auth/convert', {
        email,
        password,
        displayName,
      });
      await get().setSession(response);
    } finally {
      set({ busy: false });
    }
  },

  async signInWithApple(identityToken, fullName, nonce) {
    set({ busy: true });
    try {
      const response = await api.public<AuthResponse>('/auth/apple', {
        identityToken,
        fullName,
        nonce,
        timezone: deviceTimezone(),
      });
      await get().setSession(response);
    } finally {
      set({ busy: false });
    }
  },

  async signInWithGoogle(idToken, nonce) {
    set({ busy: true });
    try {
      const response = await api.public<AuthResponse>('/auth/google', {
        idToken,
        nonce,
        timezone: deviceTimezone(),
      });
      await get().setSession(response);
    } finally {
      set({ busy: false });
    }
  },

  async logOut() {
    const { tokens } = get();
    try {
      // Best-effort revoke; the local session is cleared either way.
      if (tokens?.refreshToken) {
        await api.post('/auth/logout', { refreshToken: tokens.refreshToken });
      }
    } catch {
      /* offline logout still clears the device */
    }
    await storage.remove(TOKEN_KEY);
    set({ user: null, tokens: null });
    syncWidget(null);
  },

  async refreshUser() {
    const user = await api.get<User>('/users/me');
    set({ user });
  },

  async saveOnboarding(profile) {
    const user = await api.put<User>('/users/me/onboarding', profile);
    set({ user });
  },

  async updatePreferences(patch) {
    const preferences = await api.patch<UserPreferences>('/users/me/preferences', patch);
    const current = get().user;
    if (current) set({ user: { ...current, preferences } });
  },

  async updateProfile(patch) {
    const user = await api.patch<User>('/users/me', patch);
    set({ user });
  },

  async deleteAccount() {
    await api.delete('/users/me');
    await storage.remove(TOKEN_KEY);
    set({ user: null, tokens: null });
    // Leaving a streak on the home screen after account deletion would be a
    // small privacy leak on a shared device.
    syncWidget(null);
  },
}));

// Give the API client access to the tokens without creating an import cycle.
configureApiClient({
  getTokens: () => {
    const { tokens } = useAuthStore.getState();
    return {
      accessToken: tokens?.accessToken ?? null,
      refreshToken: tokens?.refreshToken ?? null,
    };
  },
  onTokensRefreshed: (tokens) => {
    useAuthStore.setState({ tokens });
    void storage.set(TOKEN_KEY, JSON.stringify(tokens));
  },
  onSessionExpired: () => {
    void storage.remove(TOKEN_KEY);
    useAuthStore.setState({ user: null, tokens: null });
  },
});

/** True when the signed-in user can play Pro content (paid or in trial). */
export function useHasPro(): boolean {
  return useAuthStore((s) => {
    if (!s.user) return false;
    if (isPro(s.user.subscriptionTier)) return true;
    return s.user.trialEndsAt !== null && new Date(s.user.trialEndsAt).getTime() > Date.now();
  });
}
