import { createHash, createPublicKey, type JsonWebKey } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { unauthorized } from '../lib/errors.ts';
import { config } from '../config.ts';

/**
 * Sign in with Apple / Google.
 *
 * Both providers hand the client a signed ID token; the server's job is to
 * prove that token is genuine before trusting a single claim in it. That means
 * verifying the RS256 signature against the provider's published JWKS and
 * checking issuer, audience and expiry — not decoding the payload and reading
 * the email, which is what makes a forged token trivially work.
 *
 * No new dependency is needed: Node can turn a JWK straight into a key object,
 * and `jsonwebtoken` is already used for our own tokens.
 */

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_JWKS = 'https://appleid.apple.com/auth/keys';

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const GOOGLE_JWKS = 'https://www.googleapis.com/oauth2/v3/certs';

export interface SocialIdentity {
  /** The provider's stable subject claim. The only safe join key. */
  subject: string;
  email: string | null;
  emailVerified: boolean;
  /** Present only when the provider returned one. */
  name: string | null;
}

interface JwksKey extends JsonWebKey {
  kid?: string;
  alg?: string;
}

interface CachedJwks {
  keys: JwksKey[];
  fetchedAt: number;
}

const jwksCache = new Map<string, CachedJwks>();

/** Providers rotate signing keys, so the cache is short-lived by design. */
const JWKS_TTL_MS = 60 * 60 * 1000;

async function fetchJwks(url: string, force = false): Promise<JwksKey[]> {
  const cached = jwksCache.get(url);
  if (!force && cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) {
    return cached.keys;
  }

  const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) {
    // Serving a stale key set beats failing every sign-in during a blip.
    if (cached) return cached.keys;
    throw unauthorized('Could not reach the sign-in provider.');
  }

  const body = (await response.json()) as { keys?: JwksKey[] };
  const keys = body.keys ?? [];
  jwksCache.set(url, { keys, fetchedAt: Date.now() });
  return keys;
}

/**
 * Resolves the signing key named by the token's `kid`. A miss triggers one
 * forced refetch, because the usual cause is the provider having rotated keys
 * since the cache was filled.
 */
async function keyForToken(token: string, jwksUrl: string) {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded === 'string' || !decoded.header.kid) {
    throw unauthorized('Malformed sign-in token.');
  }

  const { kid, alg } = decoded.header;
  if (alg !== 'RS256') throw unauthorized('Unsupported sign-in token algorithm.');

  let keys = await fetchJwks(jwksUrl);
  let jwk = keys.find((candidate) => candidate.kid === kid);

  if (!jwk) {
    keys = await fetchJwks(jwksUrl, true);
    jwk = keys.find((candidate) => candidate.kid === kid);
  }
  if (!jwk) throw unauthorized('Sign-in token was signed by an unknown key.');

  return createPublicKey({ key: jwk, format: 'jwk' });
}

interface VerifyOptions {
  token: string;
  jwksUrl: string;
  issuers: string[];
  audiences: string[];
  /**
   * Raw nonce the client generated. When supplied, the token's `nonce` claim
   * must match its SHA-256 — this is what stops a token captured from one
   * sign-in being replayed into another.
   */
  rawNonce?: string;
}

interface IdTokenClaims extends jwt.JwtPayload {
  sub: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  nonce?: string;
}

async function verifyIdToken(options: VerifyOptions): Promise<IdTokenClaims> {
  if (options.audiences.length === 0) {
    // Without a configured client id there is nothing to bind the token to,
    // so any valid Apple/Google token for any app would be accepted.
    throw unauthorized('This deployment is not configured for that sign-in method.');
  }

  const key = await keyForToken(options.token, options.jwksUrl);

  // `jsonwebtoken` types these as non-empty tuples. Both lists are guaranteed
  // non-empty here — audiences by the check above, issuers by construction.
  const issuer = options.issuers as [string, ...string[]];
  const audience = options.audiences as [string, ...string[]];

  let claims: IdTokenClaims;
  try {
    claims = jwt.verify(options.token, key, {
      algorithms: ['RS256'],
      issuer,
      audience,
    }) as IdTokenClaims;
  } catch {
    throw unauthorized('That sign-in could not be verified.');
  }

  if (!claims.sub) throw unauthorized('Sign-in token is missing a subject.');

  if (options.rawNonce) {
    const expected = createHash('sha256').update(options.rawNonce).digest('hex');
    // Providers differ on whether they echo the raw or hashed value, so accept
    // either — but require that one of them matches.
    if (claims.nonce !== expected && claims.nonce !== options.rawNonce) {
      throw unauthorized('Sign-in token did not match this request.');
    }
  }

  return claims;
}

function normaliseEmailVerified(value: boolean | string | undefined): boolean {
  // Google sends the claim as the string "true" in some flows.
  return value === true || value === 'true';
}

export async function verifyAppleToken(
  identityToken: string,
  rawNonce?: string,
): Promise<SocialIdentity> {
  const claims = await verifyIdToken({
    token: identityToken,
    jwksUrl: APPLE_JWKS,
    issuers: [APPLE_ISSUER],
    audiences: config.social.appleClientIds,
    rawNonce,
  });

  return {
    subject: claims.sub,
    email: claims.email ?? null,
    emailVerified: normaliseEmailVerified(claims.email_verified),
    // Apple never puts the name in the token; it arrives once, from the client.
    name: null,
  };
}

export async function verifyGoogleToken(
  idToken: string,
  rawNonce?: string,
): Promise<SocialIdentity> {
  const claims = await verifyIdToken({
    token: idToken,
    jwksUrl: GOOGLE_JWKS,
    issuers: GOOGLE_ISSUERS,
    audiences: config.social.googleClientIds,
    rawNonce,
  });

  return {
    subject: claims.sub,
    email: claims.email ?? null,
    emailVerified: normaliseEmailVerified(claims.email_verified),
    name: claims.name ?? null,
  };
}
