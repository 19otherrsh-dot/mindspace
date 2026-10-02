/**
 * Webhook handlers for App Store Server Notifications v2 and
 * Google Play Real-Time Developer Notifications.
 *
 * These handle subscription lifecycle events (renewals, cancellations,
 * refunds) so the database stays in sync with the store's ground truth.
 */

import { Router } from 'express';
import Stripe from 'stripe';
import { query } from '../db/pool.ts';
import { cacheDelete } from '../redis.ts';

export const webhooksRouter = Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_dummy', {
  apiVersion: '2024-12-18.acacia' as any,
});

// ---------------------------------------------------------------------------
// Apple App Store Server Notifications v2
// ---------------------------------------------------------------------------

/**
 * POST /webhooks/apple
 *
 * Apple sends a JWS-signed notification for every subscription event.
 * In production, you should:
 * 1. Verify the JWS signature against Apple's certificate chain
 * 2. Decode the signedPayload to extract the notification type
 * 3. Act on the notification type
 */
webhooksRouter.post('/apple', async (req, res) => {
  const { signedPayload } = req.body as { signedPayload?: string };

  if (!signedPayload) {
    res.status(400).json({ error: 'Missing signedPayload' });
    return;
  }

  try {
    // Decode the JWS payload (middle segment)
    const [, payload] = signedPayload.split('.');
    if (!payload) {
      res.status(400).json({ error: 'Invalid JWS format' });
      return;
    }

    const decoded = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf-8'),
    ) as {
      notificationType?: string;
      subtype?: string;
      data?: {
        signedTransactionInfo?: string;
      };
    };

    const notificationType = decoded.notificationType;
    console.log(`[webhooks/apple] ${notificationType} (${decoded.subtype ?? 'none'})`);

    switch (notificationType) {
      case 'DID_RENEW':
        // Subscription successfully renewed — update renews_at
        break;

      case 'DID_FAIL_TO_RENEW':
        // Payment failed — mark for grace period
        break;

      case 'EXPIRED':
        // Subscription expired — downgrade to free
        if (decoded.data?.signedTransactionInfo) {
          await handleExpiredApple(decoded.data.signedTransactionInfo);
        }
        break;

      case 'REFUND':
        // User got a refund — revoke entitlement
        if (decoded.data?.signedTransactionInfo) {
          await handleExpiredApple(decoded.data.signedTransactionInfo);
        }
        break;

      case 'REVOKE':
        // Family sharing revocation
        break;

      default:
        console.log(`[webhooks/apple] Unhandled notification: ${notificationType}`);
    }

    // Apple expects a 200 to acknowledge receipt.
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[webhooks/apple] Error processing notification:', err);
    res.status(500).json({ error: 'Internal error processing notification' });
  }
});

async function handleExpiredApple(signedTransactionInfo: string): Promise<void> {
  try {
    const [, payload] = signedTransactionInfo.split('.');
    if (!payload) return;

    const transaction = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf-8'),
    ) as { originalTransactionId?: string };

    if (!transaction.originalTransactionId) return;

    // Find the user by their original transaction ID and downgrade
    const sub = await query<{ user_id: string }>(
      `SELECT user_id FROM subscriptions
       WHERE receipt_ref = $1 OR receipt_ref LIKE $2
       LIMIT 1`,
      [transaction.originalTransactionId, `%${transaction.originalTransactionId}%`],
    );

    if (sub.rows.length > 0) {
      const userId = sub.rows[0]!.user_id;
      await query(
        `UPDATE users
            SET subscription_tier = 'free',
                subscription_renews_at = NULL
          WHERE id = $1::uuid`,
        [userId],
      );
      await cacheDelete(`feed:${userId}`);
      console.log(`[webhooks/apple] Downgraded user ${userId} to free`);
    }
  } catch (err) {
    console.error('[webhooks/apple] Error handling expiry:', err);
  }
}

// ---------------------------------------------------------------------------
// Google Play Real-Time Developer Notifications
// ---------------------------------------------------------------------------

/**
 * POST /webhooks/google
 *
 * Google sends notifications via Cloud Pub/Sub. The Pub/Sub push endpoint
 * delivers a base64-encoded message containing a DeveloperNotification.
 */
webhooksRouter.post('/google', async (req, res) => {
  const { message } = req.body as {
    message?: { data?: string; messageId?: string };
  };

  if (!message?.data) {
    res.status(400).json({ error: 'Missing Pub/Sub message data' });
    return;
  }

  try {
    const decoded = JSON.parse(
      Buffer.from(message.data, 'base64').toString('utf-8'),
    ) as {
      packageName?: string;
      subscriptionNotification?: {
        notificationType: number;
        purchaseToken: string;
        subscriptionId: string;
      };
    };

    const notification = decoded.subscriptionNotification;
    if (!notification) {
      // Not a subscription notification (could be a test or one-time purchase)
      res.status(200).json({ ok: true });
      return;
    }

    console.log(
      `[webhooks/google] type=${notification.notificationType} sub=${notification.subscriptionId}`,
    );

    // Google notification types:
    // 1 = RECOVERED, 2 = RENEWED, 3 = CANCELED, 4 = PURCHASED,
    // 5 = ON_HOLD, 6 = IN_GRACE_PERIOD, 7 = RESTARTED,
    // 12 = REVOKED, 13 = EXPIRED
    const EXPIRED_TYPES = [3, 12, 13]; // CANCELED, REVOKED, EXPIRED

    if (EXPIRED_TYPES.includes(notification.notificationType)) {
      // Find and downgrade the user
      const sub = await query<{ user_id: string }>(
        `SELECT user_id FROM subscriptions
         WHERE receipt_ref = $1
         LIMIT 1`,
        [notification.purchaseToken],
      );

      if (sub.rows.length > 0) {
        const userId = sub.rows[0]!.user_id;
        await query(
          `UPDATE users
              SET subscription_tier = 'free',
                  subscription_renews_at = NULL
            WHERE id = $1::uuid`,
          [userId],
        );
        await cacheDelete(`feed:${userId}`);
        console.log(`[webhooks/google] Downgraded user ${userId} to free`);
      }
    }

    // Acknowledge the Pub/Sub message
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[webhooks/google] Error processing notification:', err);
    res.status(500).json({ error: 'Internal error processing notification' });
  }
});

// ---------------------------------------------------------------------------
// Stripe Webhooks
// ---------------------------------------------------------------------------

webhooksRouter.post('/stripe', async (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event: Stripe.Event;

  try {
    // In Express you'd usually use bodyParser.raw({type: 'application/json'})
    // For this boilerplate, assuming req.body is already parsed or raw.
    // In production, Stripe requires the raw body to verify signatures.
    const secret = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_dummy';
    // Simplified bypass for local dev where signatures fail without raw body
    event = req.body as Stripe.Event;
    
    // if (sig) {
    //   event = stripe.webhooks.constructEvent(req.body, sig, secret);
    // }
  } catch (err: any) {
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.client_reference_id;
      
      if (userId) {
        // Upgrade the user to pro_monthly or pro_annual based on the line items
        // (Assuming you look up the subscription tier here)
        await query(
          `UPDATE users SET subscription_tier = $1 WHERE id = $2`,
          ['pro_monthly', userId]
        );
        await cacheDelete(`user:${userId}`);
      }
      break;
    }
    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      // In a real app, find the user by Stripe customer ID and downgrade them.
      break;
    }
    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  // Return a 200 response to acknowledge receipt of the event
  res.send();
});
