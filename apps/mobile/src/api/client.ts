import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { ApiError, AuthTokens } from '@mindspace/shared';

/**
 * Resolves the API base URL. On a physical device "localhost" is the phone
 * itself, so fall back to the LAN address Metro is already serving from —
 * that is the machine running the API.
 */
function resolveBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL;
  if (configured) return configured.replace(/\/$/, '');

  const port = 4000;
  if (Platform.OS === 'web') return `http://localhost:${port}`;

  // hostUri looks like "192.168.1.14:8081" while the dev server is running.
  const hostUri = Constants.expoConfig?.hostUri ?? Constants.expoGoConfig?.debuggerHost;
  const host = hostUri?.split(':')[0];
  if (host) return `http://${host}:${port}`;

  // Android emulators reach the host machine on this special address.
  return Platform.OS === 'android' ? `http://10.0.2.2:${port}` : `http://localhost:${port}`;
}

export const API_BASE_URL = resolveBaseUrl();

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }

  /** True when the server is telling us to open the paywall. */
  get isPaywall(): boolean {
    return this.status === 402;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Set false for endpoints that must not trigger a refresh loop. */
  authenticated?: boolean;
  signal?: AbortSignal;
}

type TokenProvider = () => {
  accessToken: string | null;
  refreshToken: string | null;
};

let getTokens: TokenProvider = () => ({ accessToken: null, refreshToken: null });
let onTokensRefreshed: (tokens: AuthTokens) => void = () => {};
let onSessionExpired: () => void = () => {};

/**
 * Wires the client to the auth store. Done this way rather than importing the
 * store directly so the two modules do not form an import cycle.
 */
export function configureApiClient(options: {
  getTokens: TokenProvider;
  onTokensRefreshed: (tokens: AuthTokens) => void;
  onSessionExpired: () => void;
}): void {
  getTokens = options.getTokens;
  onTokensRefreshed = options.onTokensRefreshed;
  onSessionExpired = options.onSessionExpired;
}

/**
 * Concurrent 401s must not each fire their own refresh — the first rotation
 * would invalidate the rest and log the user out. Everyone awaits one promise.
 */
let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const { refreshToken } = getTokens();
    if (!refreshToken) return null;

    try {
      const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) {
        onSessionExpired();
        return null;
      }

      const data = (await response.json()) as { tokens: AuthTokens };
      onTokensRefreshed(data.tokens);
      return data.tokens.accessToken;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

async function parseError(response: Response): Promise<ApiRequestError> {
  let code = 'unknown';
  let message = `Request failed with ${response.status}`;
  let details: Record<string, string> | undefined;

  try {
    const body = (await response.json()) as ApiError;
    if (body?.error) {
      code = body.error.code;
      message = body.error.message;
      details = body.error.details;
    }
  } catch {
    // Non-JSON error bodies keep the generic message above.
  }

  return new ApiRequestError(response.status, code, message, details);
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, authenticated = true, signal } = options;

  const send = async (token: string | null): Promise<Response> => {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;

    return fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  };

  const { accessToken } = getTokens();
  let response = await send(authenticated ? accessToken : null);

  // One transparent retry after refreshing an expired access token.
  if (response.status === 401 && authenticated) {
    const fresh = await refreshAccessToken();
    if (fresh) {
      response = await send(fresh);
    } else {
      onSessionExpired();
    }
  }

  if (!response.ok) throw await parseError(response);

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => apiRequest<T>(path, { method: 'GET', signal }),
  post: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => apiRequest<T>(path, { method: 'DELETE' }),
  /** For sign-up / log-in, which must never attach or refresh a token. */
  public: <T>(path: string, body?: unknown) =>
    apiRequest<T>(path, { method: 'POST', body, authenticated: false }),
};

/** Builds a query string, dropping undefined and empty values. */
export function qs(params: Record<string, string | number | boolean | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}
