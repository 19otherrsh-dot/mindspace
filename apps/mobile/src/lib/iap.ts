import {
  endConnection,
  finishTransaction,
  getAvailablePurchases,
  initConnection,
  requestPurchase,
  type Purchase,
} from 'react-native-iap';
import type { SubscriptionTier } from '@mindspace/shared';

/**
 * In-app purchases, native implementation.
 *
 * Wrapped rather than re-exported for two reasons: `react-native-iap` is a
 * native module that cannot be bundled for web (see `iap.web.ts`, which Metro
 * substitutes automatically), and its v16 surface is broad and store-shaped
 * while the paywall only needs three verbs — buy, restore, finish.
 */

export type PurchasableTier = Extract<SubscriptionTier, 'pro_monthly' | 'pro_annual'>;

/**
 * Store product identifiers. These are *not* the internal tier names — the
 * stores require reverse-DNS SKUs that must match the App Store Connect and
 * Play Console listings exactly.
 */
const SKUS: Record<PurchasableTier, string> = {
  pro_monthly: 'app.mindspace.pro.monthly',
  pro_annual: 'app.mindspace.pro.annual',
};

export interface PurchaseReceipt {
  tier: PurchasableTier;
  /** Unified token: a JWS on iOS, a purchase token on Android. */
  token: string;
  /** Kept so the transaction can be finished after the server verifies it. */
  raw: Purchase;
}

export const iapSupported = true;

export async function initialize(): Promise<void> {
  await initConnection();
}

export async function shutdown(): Promise<void> {
  await endConnection();
}

function toReceipt(purchase: Purchase, tier: PurchasableTier): PurchaseReceipt {
  // `purchaseToken` is optional in the type because some states (deferred,
  // pending) carry no token yet. Those must not be treated as a purchase.
  if (!purchase.purchaseToken) {
    throw new Error('The store returned a purchase with no receipt token.');
  }
  return { tier, token: purchase.purchaseToken, raw: purchase };
}

/**
 * Starts the store's purchase flow. Resolves null when the user backs out
 * without buying, which is a normal outcome rather than an error.
 */
export async function purchaseSubscription(
  tier: PurchasableTier,
): Promise<PurchaseReceipt | null> {
  const sku = SKUS[tier];

  const result = await requestPurchase({
    type: 'subs',
    request: {
      apple: { sku },
      google: { skus: [sku] },
    },
  });

  const purchase = Array.isArray(result) ? result[0] : result;
  if (!purchase) return null;

  return toReceipt(purchase, tier);
}

/** The most recent active subscription this store account already owns. */
export async function restoreSubscription(): Promise<PurchaseReceipt | null> {
  const purchases = await getAvailablePurchases();

  for (const [tier, sku] of Object.entries(SKUS) as Array<[PurchasableTier, string]>) {
    const match = purchases.find((purchase) => purchase.productId === sku);
    if (match?.purchaseToken) return toReceipt(match, tier);
  }
  return null;
}

/**
 * Acknowledges the purchase with the store. Must only be called *after* the
 * server has verified the receipt — finishing first would hand over the
 * entitlement before anything checked the receipt was genuine, and on Android
 * an unacknowledged purchase is auto-refunded, which is the safer failure.
 */
export async function finish(receipt: PurchaseReceipt): Promise<void> {
  await finishTransaction({ purchase: receipt.raw, isConsumable: false });
}
