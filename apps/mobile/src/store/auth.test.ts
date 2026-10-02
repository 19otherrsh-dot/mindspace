import type { AuthTokens, User } from '@mindspace/shared';
import { useAuthStore } from './auth';

/**
 * Store-level tests only: these exercise state transitions, not the network.
 * `logOut` makes a best-effort revoke call that is expected to fail here, and
 * the store is written so the local session clears regardless — which is the
 * behaviour worth pinning down.
 */

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'test@example.com',
    displayName: 'Test User',
    avatarUrl: null,
    isGuest: false,
    subscriptionTier: 'free',
    subscriptionRenewsAt: null,
    trialEndsAt: null,
    memberSince: new Date('2026-01-01').toISOString(),
    preferences: {
      reminderEnabled: true,
      reminderTime: '08:00',
      reminderDays: [],
      reminderMessage: 'Time to find your calm.',
      bedtimeEnabled: false,
      bedtimeTime: '22:00',
      backgroundSoundEnabled: true,
      audioQuality: 'standard',
      theme: 'system',
      preferredVoicePack: 'calm',
      downloadOverCellular: false,
    },
    onboarding: null,
    ...overrides,
  };
}

function makeTokens(overrides: Partial<AuthTokens> = {}): AuthTokens {
  return {
    accessToken: 'access-123',
    refreshToken: 'refresh-123',
    expiresIn: 900,
    ...overrides,
  };
}

describe('auth store', () => {
  beforeEach(() => {
    useAuthStore.setState({ tokens: null, user: null, busy: false, hydrated: false });
  });

  it('starts with no session', () => {
    const state = useAuthStore.getState();
    expect(state.tokens).toBeNull();
    expect(state.user).toBeNull();
    expect(state.busy).toBe(false);
  });

  it('setSession stores the user and tokens', async () => {
    const user = makeUser();
    const tokens = makeTokens();

    await useAuthStore.getState().setSession({ user, tokens });

    const state = useAuthStore.getState();
    expect(state.user).toEqual(user);
    expect(state.tokens).toEqual(tokens);
  });

  it('logOut clears the session even when the revoke call fails', async () => {
    useAuthStore.setState({ user: makeUser(), tokens: makeTokens() });

    await useAuthStore.getState().logOut();

    const state = useAuthStore.getState();
    expect(state.tokens).toBeNull();
    expect(state.user).toBeNull();
  });

  it('treats a guest as not having Pro', async () => {
    await useAuthStore
      .getState()
      .setSession({ user: makeUser({ isGuest: true }), tokens: makeTokens() });

    expect(useAuthStore.getState().user?.subscriptionTier).toBe('free');
  });
});
