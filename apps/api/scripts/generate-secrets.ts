#!/usr/bin/env tsx
/**
 * Generate cryptographically secure secrets for a production deployment.
 *
 * Usage:
 *   npx tsx scripts/generate-secrets.ts
 *
 * Paste the output into your production .env (or your hosting platform's
 * environment variable panel). Never commit the values to source control.
 */

import { randomBytes } from 'node:crypto';

function hex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

const jwtAccess = hex(64);
const jwtRefresh = hex(64);
const moodKey = hex(32); // 32 bytes = 64 hex chars = AES-256

console.log(`
# ─── Generated secrets ─── paste into your production .env ───
#
# JWT signing secrets (512-bit random)
JWT_ACCESS_SECRET=${jwtAccess}
JWT_REFRESH_SECRET=${jwtRefresh}

# AES-256-GCM key for mood/health data at rest (256-bit random, 64 hex chars)
MOOD_ENCRYPTION_KEY=${moodKey}
#
# ─── Do not commit these values to source control ───
`.trim());
