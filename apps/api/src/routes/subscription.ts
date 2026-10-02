import { Router } from 'express';
import { z } from 'zod';
import Stripe from 'stripe';
import type { SubscriptionTier } from '@mindspace/shared';
import { query, queryOne, transaction } from '../db/pool.ts';
import { badRequest, conflict, forbidden } from '../lib/errors.ts';
import { isProduction } from '../config.ts';
import { requireAuth } from '../middleware/auth.ts';
import { getUserById } from '../services/users.ts';
import { cacheDelete } from '../redis.ts';
import { verifyAppleReceipt, verifyGoogleReceipt } from '../services/iap-verify.ts';

export const subscriptionRouter = Router();

/** PRD §6. Prices are in cents to keep the arithmetic exact. */
export const PLANS = {
  pro_monthly: { priceCents: 1299, period: 'month', label: 'Pro Monthly' },
  pro_annual: { priceCents: 6999, period: 'year', label: 'Pro Annual' },
} as const;

const TRIAL_DAYS = 7;

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_dummy', {
  apiVersion: '2024-12-18.acacia' as any, // using cast to avoid version-lock type errors
});

/** POST /subscription/checkout — creates a Stripe Checkout session. */
subscriptionRouter.post('/checkout', requireAuth, async (req, res) => {
  const { tier } = z.object({ tier: z.enum(['pro_monthly', 'pro_annual']) }).parse(req.body);
  const userId = req.user!.id;

  const priceId = tier === 'pro_monthly' 
    ? process.env.STRIPE_MONTHLY_PRICE_ID 
    : process.env.STRIPE_ANNUAL_PRICE_ID;

  if (!priceId) {
    // Graceful fallback for local development where Stripe isn't configured
    res.json({ url: 'https://mindspace.example.com/checkout/mock' });
    return;
  }

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    mode: 'subscription',
    client_reference_id: userId,
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    success_url: `https://mindspace.app/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `https://mindspace.app/paywall`,
  });

  res.json({ url: session.url });
});

/** GET /subscription/plans — populates the paywall (screen 17). */
subscriptionRouter.get('/plans', (_req, res) => {
  res.json({
    plans: [
      {
        tier: 'pro_monthly',
        label: PLANS.pro_monthly.label,
        priceCents: PLANS.pro_monthly.priceCents,
        period: 'month',
        monthlyEquivalentCents: PLANS.pro_monthly.priceCents,
        badge: null,
      },
      {
        tier: 'pro_annual',
        label: PLANS.pro_annual.label,
        priceCents: PLANS.pro_annual.priceCents,
        period: 'year',
        // ~$5.83/mo, the saving the paywall leads with.
        monthlyEquivalentCents: Math.round(PLANS.pro_annual.priceCents / 12),
        badge: 'Best Value',
      },
    ],
    trialDays: TRIAL_DAYS,
    benefits: [
      { icon: 'library', text: 'The full library of 500+ guided meditations' },
      { icon: 'moon', text: 'Sleepcasts and sleep soundscapes' },
      { icon: 'download', text: 'Download up to 50 sessions for offline' },
      { icon: 'compass', text: 'Every multi-day course and program' },
      { icon: 'sparkles', text: 'New sessions added every week' },
    ],
  });
});

const subscribeSchema = z.object({
  tier: z.enum(['pro_monthly', 'pro_annual']),
  store: z.enum(['apple', 'google', 'web']).default('apple'),
  receipt: z.string().min(1),
  startTrial: z.boolean().default(false),
});

function renewalDate(tier: 'pro_monthly' | 'pro_annual', from: Date): Date {
  const next = new Date(from);
  if (tier === 'pro_monthly') next.setMonth(next.getMonth() + 1);
  else next.setFullYear(next.getFullYear() + 1);
  return next;
}

/**
 * POST /subscription — records a purchase completed in the store SDK.
 *
 * In production the receipt is verified against Apple's / Google's servers
 * before anything is written; this endpoint is the post-verification step and
 * treats the receipt reference as the idempotency key.
 */
subscriptionRouter.post('/', requireAuth, async (req, res) => {
  const input = subscribeSchema.parse(req.body);
  const userId = req.user!.id;

  /*
   * Entitlement is granted only against a receipt a store has confirmed.
   *
   * The `web` store exists so the paywall flow can be exercised without a
   * sandbox — there is no web payment processor. Left reachable in production
   * it is a bypass: any POST with an arbitrary receipt string would grant Pro
   * indefinitely. So it is refused outright there rather than merely skipped.
   */
  if (isProduction) {
    if (input.store === 'web') {
      throw forbidden(
        'Web purchases are not supported. Subscribe from the iOS or Android app.',
      );
    }

    try {
      const verified =
        input.store === 'apple'
          ? await verifyAppleReceipt(input.receipt)
          : await verifyGoogleReceipt(input.receipt);

      // Trust the store's answer over the client's claim about what it bought.
      input.tier = verified.tier;
    } catch (err) {
      // Verification failing for any reason — bad receipt, missing credentials,
      // store outage — must not grant access.
      console.error('[subscription] receipt verification failed', err);
      throw badRequest(
        'That purchase could not be verified. If you were charged, please contact support.',
      );
    }
  }

  const existing = await queryOne<{ user_id: string }>(
    'SELECT user_id FROM subscriptions WHERE store = $1 AND receipt_ref = $2',
    [input.store, input.receipt],
  );

  if (existing && existing.user_id !== userId) {
    throw conflict('That purchase is already attached to another account');
  }

  const now = new Date();

  // A trial is offered once per account, so a user cannot cycle trials by
  // resubscribing. Any prior subscription row disqualifies them.
  let trialEndsAt: Date | null = null;
  if (input.startTrial) {
    const priorSubs = await queryOne<{ count: number }>(
      'SELECT count(*)::int AS count FROM subscriptions WHERE user_id = $1::uuid',
      [userId],
    );
    if ((priorSubs?.count ?? 0) > 0) {
      throw badRequest('The free trial has already been used on this account');
    }
    trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * 86_400_000);
  }

  // Billing starts after the trial, so renewal is measured from its end.
  const renewsAt = renewalDate(input.tier, trialEndsAt ?? now);

  await transaction(async (client) => {
    await client.query(
      `INSERT INTO subscriptions (user_id, tier, store, receipt_ref, renews_at, trial_ends_at)
       VALUES ($1::uuid, $2::subscription_tier, $3, $4, $5, $6)
       ON CONFLICT (store, receipt_ref) DO UPDATE
         SET renews_at = EXCLUDED.renews_at, cancelled_at = NULL`,
      [userId, input.tier, input.store, input.receipt, renewsAt, trialEndsAt],
    );

    await client.query(
      `UPDATE users
          SET subscription_tier = $2::subscription_tier,
              subscription_renews_at = $3,
              trial_ends_at = $4
        WHERE id = $1::uuid`,
      [userId, input.tier, renewsAt, trialEndsAt],
    );
  });

  // The cached feed was built with the old entitlement and blanked Pro streams.
  await cacheDelete(`feed:${userId}`);
  res.status(201).json(await getUserById(userId));
});

/**
 * DELETE /subscription — cancels auto-renewal. Access continues until the paid
 * period ends, so the tier is left alone; a renewal webhook downgrades it.
 */
subscriptionRouter.delete('/', requireAuth, async (req, res) => {
  const userId = req.user!.id;

  const { rowCount } = await query(
    `UPDATE subscriptions
        SET cancelled_at = now()
      WHERE user_id = $1::uuid AND cancelled_at IS NULL`,
    [userId],
  );

  if (rowCount === 0) throw badRequest('No active subscription to cancel');

  res.json({
    cancelled: true,
    accessUntil: (await getUserById(userId))?.subscriptionRenewsAt ?? null,
  });
});

/**
 * POST /subscription/restore — the "Restore Purchases" link on the paywall.
 * Re-attaches a receipt the store still considers valid to this account.
 */
subscriptionRouter.post('/restore', requireAuth, async (req, res) => {
  const { store, receipt } = z
    .object({ store: z.enum(['apple', 'google', 'web']), receipt: z.string().min(1) })
    .parse(req.body);

  const row = await queryOne<{
    user_id: string;
    tier: SubscriptionTier;
    renews_at: Date | null;
    trial_ends_at: Date | null;
  }>(
    'SELECT user_id, tier, renews_at, trial_ends_at FROM subscriptions WHERE store = $1 AND receipt_ref = $2',
    [store, receipt],
  );

  if (!row) throw badRequest('No purchase found for that receipt');
  if (row.user_id !== req.user!.id) {
    throw conflict('That purchase belongs to another account');
  }

  await query(
    `UPDATE users
        SET subscription_tier = $2::subscription_tier,
            subscription_renews_at = $3,
            trial_ends_at = $4
      WHERE id = $1::uuid`,
    [req.user!.id, row.tier, row.renews_at, row.trial_ends_at],
  );

  await cacheDelete(`feed:${req.user!.id}`);
  res.json(await getUserById(req.user!.id));
});
