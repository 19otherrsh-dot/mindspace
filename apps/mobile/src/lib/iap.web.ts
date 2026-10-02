import type { SubscriptionTier } from '@mindspace/shared';

/**
 * Web stub for in-app purchases.
 *
 * Metro resolves `.web.ts` ahead of `.ts`, so this keeps the native module out
 * of the web bundle entirely — importing `react-native-iap` there fails at
 * bundle time, not gracefully at runtime.
 *
 * The web build has no store, so the paywall falls back to the server's
 * `store: 'web'` path. These functions exist to satisfy the shared shape.
 */

export type PurchasableTier = Extract<SubscriptionTier, 'pro_monthly' | 'pro_annual'>;

export interface PurchaseReceipt {
  tier: PurchasableTier;
  token: string;
  raw: unknown;
}

export const iapSupported = false;

export async function initialize(): Promise<void> {
  // No store to connect to.
}

export async function shutdown(): Promise<void> {
  // Nothing to tear down.
}

export async function purchaseSubscription(): Promise<PurchaseReceipt | null> {
  throw new Error('In-app purchases are not available on the web.');
}

export async function restoreSubscription(): Promise<PurchaseReceipt | null> {
  return null;
}

export async function finish(): Promise<void> {
  // Nothing to acknowledge.
}
