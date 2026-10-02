import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) throw new Error(`${name} must be a number, got "${raw}"`);
  return parsed;
}

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: num('PORT', 4000),
  databaseUrl: required(
    'DATABASE_URL',
    'postgresql://mindspace:mindspace@localhost:5433/mindspace',
  ),
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6381',
  jwt: {
    accessSecret: required('JWT_ACCESS_SECRET', 'dev-access-secret-change-me'),
    refreshSecret: required('JWT_REFRESH_SECRET', 'dev-refresh-secret-change-me'),
    accessTtl: num('ACCESS_TOKEN_TTL', 900),
    refreshTtl: num('REFRESH_TOKEN_TTL', 60 * 60 * 24 * 30),
  },
  /** AES-256-GCM key protecting mood notes at rest (PRD §5.2). */
  moodEncryptionKey: required(
    'MOOD_ENCRYPTION_KEY',
    '0'.repeat(64),
  ),
  cdnBaseUrl: process.env.CDN_BASE_URL ?? 'https://cdn.mindspace.example.com',

  /**
   * The AI companion's model backend. Swapping providers — including to a
   * self-hosted Ollama server — is an environment change, never a code change.
   */
  llm: {
    provider: (process.env.LLM_PROVIDER ?? 'anthropic') as
      | 'anthropic'
      | 'openai'
      | 'google'
      | 'deepseek'
      | 'ollama',
    /** Empty means "use the provider's default", resolved in src/llm/index.ts. */
    model: process.env.LLM_MODEL ?? '',

    anthropicApiKey: process.env.ANTHROPIC_API_KEY,

    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiBaseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',

    deepseekApiKey: process.env.DEEPSEEK_API_KEY,
    deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',

    googleApiKey: process.env.GOOGLE_API_KEY,

    // Ollama exposes an OpenAI-compatible surface under /v1.
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1',
  },

  /** Jitsi Meet room base for therapy sessions; self-host by changing this. */
  videoBaseUrl: process.env.VIDEO_BASE_URL ?? 'https://meet.jit.si',

  /** In-app purchase verification credentials. */
  iap: {
    appleSharedSecret: process.env.APPLE_SHARED_SECRET,
    googleServiceAccountKeyPath: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
  },

  /**
   * Client ids an Apple/Google ID token may be issued for — the token's `aud`
   * claim. Without them nothing binds a token to *this* app, so social sign-in
   * is refused rather than accepting any valid token from any app.
   * Comma-separated, because iOS and Android use different ids.
   */
  social: {
    appleClientIds: splitList(process.env.APPLE_CLIENT_IDS),
    googleClientIds: splitList(process.env.GOOGLE_CLIENT_IDS),
  },

  telemetry: {
    sentryDsn: process.env.SENTRY_DSN,
    posthogKey: process.env.POSTHOG_KEY,
    posthogHost: process.env.POSTHOG_HOST ?? 'https://app.posthog.com',
  },
} as const;

function splitList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export const isProduction = config.env === 'production';

if (isProduction) {
  const insecure = [
    ['JWT_ACCESS_SECRET', config.jwt.accessSecret.includes('change-me')],
    ['JWT_REFRESH_SECRET', config.jwt.refreshSecret.includes('change-me')],
    ['MOOD_ENCRYPTION_KEY', /^0+$/.test(config.moodEncryptionKey)],
  ].filter(([, bad]) => bad);

  if (insecure.length > 0) {
    throw new Error(
      `Refusing to start in production with development secrets: ${insecure
        .map(([name]) => name)
        .join(', ')}`,
    );
  }
}
