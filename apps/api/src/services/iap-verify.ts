/**
 * In-app purchase receipt verification for Apple App Store and Google Play.
 *
 * Production deployments must verify receipts server-side before granting
 * entitlements. In development the synthetic receipt path is preserved so the
 * paywall flow can be exercised without a store sandbox.
 */

import { config, isProduction } from '../config.ts';

export interface VerifiedPurchase {
  tier: 'pro_monthly' | 'pro_annual';
  expiresAt: Date;
  isTrialPeriod: boolean;
  store: 'apple' | 'google';
  originalTransactionId: string;
}

// ---------------------------------------------------------------------------
// Apple App Store Server API v2
// ---------------------------------------------------------------------------

/**
 * Verifies an Apple App Store receipt and extracts the subscription details.
 *
 * The production implementation should:
 * 1. Decode the JWS-signed transaction from the receipt
 * 2. Verify the signature against Apple's certificate chain
 * 3. Check the bundle ID matches our app
 * 4. Extract the product ID, expiry date, and trial status
 *
 * For now, this provides the structural contract and validates in production
 * mode, while allowing synthetic receipts in development.
 */
export async function verifyAppleReceipt(receipt: string): Promise<VerifiedPurchase> {
  // In development, accept synthetic receipts to keep the flow testable.
  if (!isProduction && receipt.startsWith('dev-')) {
    return syntheticPurchase('apple', receipt);
  }

  const sharedSecret = config.iap?.appleSharedSecret;
  if (!sharedSecret) {
    throw new Error(
      'APPLE_SHARED_SECRET is required for production receipt verification',
    );
  }

  // Call Apple's verifyReceipt endpoint
  const verifyUrl = isProduction
    ? 'https://buy.itunes.apple.com/verifyReceipt'
    : 'https://sandbox.itunes.apple.com/verifyReceipt';

  const response = await fetch(verifyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      'receipt-data': receipt,
      password: sharedSecret,
      'exclude-old-transactions': true,
    }),
  });

  if (!response.ok) {
    throw new Error(`Apple verification failed with HTTP ${response.status}`);
  }

  const body = (await response.json()) as {
    status: number;
    latest_receipt_info?: Array<{
      product_id: string;
      transaction_id: string;
      original_transaction_id: string;
      expires_date_ms: string;
      is_trial_period: string;
      is_in_intro_offer_period?: string;
    }>;
  };

  if (body.status !== 0) {
    throw new Error(`Apple verification returned status ${body.status}`);
  }

  const latestTransaction = body.latest_receipt_info?.[0];
  if (!latestTransaction) {
    throw new Error('No active subscription found in Apple receipt');
  }

  const tier = productIdToTier(latestTransaction.product_id);
  return {
    tier,
    expiresAt: new Date(Number(latestTransaction.expires_date_ms)),
    isTrialPeriod: latestTransaction.is_trial_period === 'true',
    store: 'apple',
    originalTransactionId: latestTransaction.original_transaction_id,
  };
}

// ---------------------------------------------------------------------------
// Google Play Developer API
// ---------------------------------------------------------------------------

/**
 * Verifies a Google Play purchase token against the Play Developer API.
 *
 * Requires a service account with the 'androidpublisher' scope and access
 * to the app's Play Console.
 */
export async function verifyGoogleReceipt(
  purchaseToken: string,
  productId?: string,
): Promise<VerifiedPurchase> {
  // In development, accept synthetic receipts.
  if (!isProduction && purchaseToken.startsWith('dev-')) {
    return syntheticPurchase('google', purchaseToken);
  }

  const keyPath = config.iap?.googleServiceAccountKeyPath;
  if (!keyPath) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_KEY_PATH is required for production receipt verification',
    );
  }

  // In a full implementation:
  // 1. Load the service account key and create a JWT
  // 2. Exchange for an access token via Google's OAuth2 endpoint
  // 3. Call the Play Developer API subscriptions.get endpoint
  // 4. Parse the subscription state, expiry, and trial status

  const packageName = 'app.mindspace.client';
  const subscriptionId = productId ?? 'pro_annual';

  const accessToken = await getGoogleAccessToken(keyPath);

  const response = await fetch(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/purchases/subscriptions/${subscriptionId}/tokens/${encodeURIComponent(purchaseToken)}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  if (!response.ok) {
    throw new Error(`Google verification failed with HTTP ${response.status}`);
  }

  const body = (await response.json()) as {
    expiryTimeMillis: string;
    paymentState?: number;
    cancelReason?: number;
    orderId?: string;
    startTimeMillis?: string;
  };

  const tier = productIdToTier(subscriptionId);
  return {
    tier,
    expiresAt: new Date(Number(body.expiryTimeMillis)),
    isTrialPeriod: false, // Google indicates trials via paymentState
    store: 'google',
    originalTransactionId: body.orderId ?? purchaseToken,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Maps a store product ID to our internal tier. */
function productIdToTier(productId: string): 'pro_monthly' | 'pro_annual' {
  if (productId.includes('monthly')) return 'pro_monthly';
  return 'pro_annual';
}

/**
 * Development-only stand-in for a store response. Reachable only when
 * NODE_ENV is not production *and* the receipt carries the `dev-` prefix.
 */
function syntheticPurchase(
  store: 'apple' | 'google',
  receipt: string,
  tier: 'pro_monthly' | 'pro_annual' = 'pro_annual',
): VerifiedPurchase {
  const now = new Date();
  const days = tier === 'pro_monthly' ? 30 : 365;
  return {
    tier,
    expiresAt: new Date(now.getTime() + days * 86_400_000),
    isTrialPeriod: false,
    store,
    originalTransactionId: receipt,
  };
}

/**
 * Obtains a Google API access token using the service account key.
 *
 * In production this would:
 * 1. Read the service account JSON key file
 * 2. Create a signed JWT with the androidpublisher scope
 * 3. Exchange it at https://oauth2.googleapis.com/token
 * 4. Cache the token until it expires
 */
async function getGoogleAccessToken(_keyPath: string): Promise<string> {
  // This is a structural placeholder. A full implementation would use
  // google-auth-library or manually construct the JWT + token exchange.
  // For now, throw an actionable error.
  throw new Error(
    'Google service account token exchange not yet implemented. ' +
      'Install google-auth-library and implement the OAuth2 flow, ' +
      'or use a pre-existing access token for testing.',
  );
}
