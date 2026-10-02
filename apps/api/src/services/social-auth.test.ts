import { jest } from '@jest/globals';
import { createHash, generateKeyPairSync, type KeyObject } from 'node:crypto';
import jwt from 'jsonwebtoken';

/**
 * Regression tests for Sign in with Apple / Google.
 *
 * These exist because an earlier implementation decoded the identity token and
 * read its claims without ever checking the signature, which let anyone mint a
 * token for any email and take over that account. Every rejection asserted
 * below is a real attack, not a hypothetical: the point is that a change which
 * reintroduces the bypass fails here rather than in production.
 *
 * Signatures are genuine — a real RSA keypair is generated and its public half
 * served as the provider's JWKS — so the tests exercise the actual crypto path
 * rather than a stubbed verifier.
 */

const APPLE_AUD = 'app.mindspace.client';
const GOOGLE_AUD = '123456.apps.googleusercontent.com';
const KID = 'test-key-1';

// Mutable so individual tests can simulate an unconfigured deployment.
const socialConfig = {
  appleClientIds: [APPLE_AUD],
  googleClientIds: [GOOGLE_AUD],
};

jest.unstable_mockModule('../config.ts', () => ({
  config: {
    get social() {
      return socialConfig;
    },
  },
  isProduction: false,
}));

// The provider's real key, and an attacker's key of the same shape.
const provider = generateKeyPairSync('rsa', { modulusLength: 2048 });
const attacker = generateKeyPairSync('rsa', { modulusLength: 2048 });

const providerJwk = { ...provider.publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256' };

/** Serves the provider's JWKS for any provider URL the service asks for. */
const fetchMock = jest.fn(async () => ({
  ok: true,
  json: async () => ({ keys: [providerJwk] }),
})) as unknown as typeof fetch;

globalThis.fetch = fetchMock;

const { verifyAppleToken, verifyGoogleToken } = await import('./social-auth.ts');

interface TokenOptions {
  key?: KeyObject;
  kid?: string | undefined;
  issuer?: string;
  audience?: string;
  expiresIn?: string | number;
  claims?: Record<string, unknown>;
}

function signToken(options: TokenOptions = {}): string {
  const {
    key = provider.privateKey,
    kid = KID,
    issuer = 'https://appleid.apple.com',
    audience = APPLE_AUD,
    expiresIn = '1h',
    claims = {},
  } = options;

  return jwt.sign({ sub: 'provider-subject-001', ...claims }, key, {
    algorithm: 'RS256',
    issuer,
    audience,
    expiresIn,
    ...(kid ? { keyid: kid } : {}),
  } as jwt.SignOptions);
}

/** Asserts the call rejects, and returns the message for further checking. */
async function rejection(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    throw new Error('expected the token to be rejected, but it was accepted');
  } catch (err) {
    return (err as Error).message;
  }
}

beforeEach(() => {
  socialConfig.appleClientIds = [APPLE_AUD];
  socialConfig.googleClientIds = [GOOGLE_AUD];
});

describe('verifyAppleToken', () => {
  it('accepts a genuinely signed token', async () => {
    const identity = await verifyAppleToken(
      signToken({ claims: { email: 'user@example.com', email_verified: true } }),
    );

    expect(identity.subject).toBe('provider-subject-001');
    expect(identity.email).toBe('user@example.com');
    expect(identity.emailVerified).toBe(true);
  });

  it('rejects a token signed by someone else', async () => {
    // The attack the old code allowed: every claim is right, only the
    // signature is not the provider's.
    const forged = signToken({
      key: attacker.privateKey,
      claims: { email: 'victim@example.com', email_verified: true },
    });

    expect(await rejection(verifyAppleToken(forged))).toMatch(/could not be verified/i);
  });

  it('rejects an unsigned "alg: none" token', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', kid: KID })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: 'x',
        email: 'victim@example.com',
        iss: 'https://appleid.apple.com',
        aud: APPLE_AUD,
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString('base64url');

    expect(await rejection(verifyAppleToken(`${header}.${payload}.`))).toMatch(
      /unsupported .* algorithm/i,
    );
  });

  it('rejects a structurally invalid token', async () => {
    expect(await rejection(verifyAppleToken('not-a-jwt'))).toMatch(/malformed/i);
  });

  it('rejects a token whose key is unknown to the provider', async () => {
    const forged = signToken({ key: attacker.privateKey, kid: 'some-other-kid' });
    expect(await rejection(verifyAppleToken(forged))).toMatch(/unknown key/i);
  });

  it('rejects a token issued by someone other than Apple', async () => {
    const wrongIssuer = signToken({ issuer: 'https://evil.example.com' });
    expect(await rejection(verifyAppleToken(wrongIssuer))).toMatch(/could not be verified/i);
  });

  it('rejects a token issued for a different app', async () => {
    // A validly-signed Apple token for someone else's client id must not be a
    // login here — this is what binding to the audience prevents.
    const otherApp = signToken({ audience: 'com.someone.else.app' });
    expect(await rejection(verifyAppleToken(otherApp))).toMatch(/could not be verified/i);
  });

  it('rejects an expired token', async () => {
    const expired = signToken({ expiresIn: -60 });
    expect(await rejection(verifyAppleToken(expired))).toMatch(/could not be verified/i);
  });

  it('refuses entirely when no client id is configured', async () => {
    // Fail closed: with nothing to bind to, any valid Apple token for any app
    // would otherwise be accepted.
    socialConfig.appleClientIds = [];

    expect(await rejection(verifyAppleToken(signToken()))).toMatch(/not configured/i);
  });

  describe('nonce', () => {
    it('accepts the hashed nonce Apple echoes back', async () => {
      const rawNonce = 'a-random-client-nonce';
      const hashed = createHash('sha256').update(rawNonce).digest('hex');

      const identity = await verifyAppleToken(
        signToken({ claims: { nonce: hashed } }),
        rawNonce,
      );

      expect(identity.subject).toBe('provider-subject-001');
    });

    it('rejects a token captured from a different sign-in', async () => {
      const replayed = signToken({
        claims: { nonce: createHash('sha256').update('someone-elses-nonce').digest('hex') },
      });

      expect(await rejection(verifyAppleToken(replayed, 'my-nonce'))).toMatch(
        /did not match this request/i,
      );
    });

    it('rejects a token carrying no nonce when one was required', async () => {
      expect(await rejection(verifyAppleToken(signToken(), 'my-nonce'))).toMatch(
        /did not match this request/i,
      );
    });
  });
});

describe('verifyGoogleToken', () => {
  const googleToken = (claims: Record<string, unknown> = {}) =>
    signToken({ issuer: 'https://accounts.google.com', audience: GOOGLE_AUD, claims });

  it('accepts a genuinely signed token and returns the name', async () => {
    const identity = await verifyGoogleToken(
      googleToken({ email: 'user@gmail.com', email_verified: true, name: 'Test User' }),
    );

    expect(identity.subject).toBe('provider-subject-001');
    expect(identity.name).toBe('Test User');
  });

  it('accepts the bare "accounts.google.com" issuer form', async () => {
    const identity = await verifyGoogleToken(
      signToken({ issuer: 'accounts.google.com', audience: GOOGLE_AUD }),
    );

    expect(identity.subject).toBe('provider-subject-001');
  });

  it('treats the string "true" as a verified email', async () => {
    // Google sends email_verified as a string in some flows; reading it as a
    // boolean would silently mark every such address unverified.
    const identity = await verifyGoogleToken(
      googleToken({ email: 'user@gmail.com', email_verified: 'true' }),
    );

    expect(identity.emailVerified).toBe(true);
  });

  it('rejects a token signed by someone else', async () => {
    const forged = signToken({
      key: attacker.privateKey,
      issuer: 'https://accounts.google.com',
      audience: GOOGLE_AUD,
      claims: { email: 'victim@gmail.com' },
    });

    expect(await rejection(verifyGoogleToken(forged))).toMatch(/could not be verified/i);
  });

  it('rejects an Apple token presented to the Google route', async () => {
    expect(await rejection(verifyGoogleToken(signToken()))).toMatch(/could not be verified/i);
  });
});
