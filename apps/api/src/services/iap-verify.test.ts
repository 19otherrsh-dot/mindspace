import { jest } from '@jest/globals';

/**
 * Receipt verification must fail closed.
 *
 * The paywall previously granted Pro whenever verification was skipped or
 * threw, so these tests pin the opposite: in production a receipt is honoured
 * only when a store confirms it, and the development shortcut is unreachable
 * there.
 */

const runtime = { isProduction: false };

jest.unstable_mockModule('../config.ts', () => ({
  config: {
    iap: {
      get appleSharedSecret() {
        return runtime.isProduction ? 'shared-secret' : undefined;
      },
      googleServiceAccountKeyPath: undefined,
    },
  },
  get isProduction() {
    return runtime.isProduction;
  },
}));

/**
 * `iap-verify.ts` reads `isProduction` as a module-level import binding, which
 * ESM captures when the module is first evaluated. Flipping the flag after the
 * fact therefore does nothing — the module must be re-imported with the value
 * already set, which is what this helper does.
 */
async function loadModule(isProduction: boolean) {
  runtime.isProduction = isProduction;
  jest.resetModules();
  return import('./iap-verify.ts');
}

/** Asserts the call rejects, and returns the message. */
async function rejection(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    throw new Error('expected verification to fail, but it succeeded');
  } catch (err) {
    return (err as Error).message;
  }
}

afterEach(() => {
  runtime.isProduction = false;
  jest.restoreAllMocks();
});

/** Installs a stubbed Apple verifyReceipt response. */
function stubAppleResponse(body: unknown, ok = true, status = 200) {
  globalThis.fetch = jest.fn(async () => ({
    ok,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe('development receipts', () => {
  it('accepts a dev- receipt outside production', async () => {
    const { verifyAppleReceipt } = await loadModule(false);
    const purchase = await verifyAppleReceipt('dev-abc');

    expect(purchase.store).toBe('apple');
    expect(purchase.originalTransactionId).toBe('dev-abc');
    expect(purchase.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('does NOT accept a dev- receipt in production', async () => {
    // Were this to pass, anyone could post "dev-anything" and be granted Pro.
    // Instead the prefix is ignored and the receipt goes to Apple, which
    // rejects it — 21002 is "the receipt data was malformed".
    const { verifyAppleReceipt } = await loadModule(true);
    stubAppleResponse({ status: 21_002 });

    expect(await rejection(verifyAppleReceipt('dev-abc'))).toMatch(/status 21002/i);
  });
});

describe('Apple verification in production', () => {
  it('rejects when Apple reports a bad receipt', async () => {
    const { verifyAppleReceipt } = await loadModule(true);
    stubAppleResponse({ status: 21_003 });

    expect(await rejection(verifyAppleReceipt('real-looking-receipt'))).toMatch(/21003/);
  });

  it('rejects when Apple is unreachable', async () => {
    // A store outage must not become free Pro.
    const { verifyAppleReceipt } = await loadModule(true);
    stubAppleResponse({}, false, 503);

    expect(await rejection(verifyAppleReceipt('receipt'))).toMatch(/HTTP 503/);
  });

  it('rejects a receipt with no subscription in it', async () => {
    const { verifyAppleReceipt } = await loadModule(true);
    stubAppleResponse({ status: 0, latest_receipt_info: [] });

    expect(await rejection(verifyAppleReceipt('receipt'))).toMatch(/no active subscription/i);
  });

  it('returns the tier the store reports, not one the client claimed', async () => {
    const { verifyAppleReceipt } = await loadModule(true);
    stubAppleResponse({
      status: 0,
      latest_receipt_info: [
        {
          product_id: 'app.mindspace.pro_monthly',
          transaction_id: 't1',
          original_transaction_id: 'orig-1',
          expires_date_ms: String(Date.now() + 86_400_000),
          is_trial_period: 'false',
        },
      ],
    });

    const purchase = await verifyAppleReceipt('receipt');

    expect(purchase.tier).toBe('pro_monthly');
    expect(purchase.originalTransactionId).toBe('orig-1');
  });
});

describe('Google verification in production', () => {
  it('rejects when no service account key is configured', async () => {
    // Fail closed rather than granting the entitlement unverified.
    const { verifyGoogleReceipt } = await loadModule(true);

    expect(await rejection(verifyGoogleReceipt('purchase-token'))).toMatch(
      /GOOGLE_SERVICE_ACCOUNT_KEY_PATH is required/i,
    );
  });
});
