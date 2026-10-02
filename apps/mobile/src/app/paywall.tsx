import { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { SubscriptionTier } from '@mindspace/shared';
import { api, API_BASE_URL, ApiRequestError } from '@/api/client';
import { useQuery } from '@/api/use-query';
import { radius, spacing } from '@/theme';
import { Button, IconButton, Loading, Txt } from '@/components/ui';
import { useAuthStore } from '@/store/auth';
import * as RNIap from '@/lib/iap';

interface Plan {
  tier: Exclude<SubscriptionTier, 'free' | 'teams'>;
  label: string;
  priceCents: number;
  period: 'month' | 'year';
  monthlyEquivalentCents: number;
  badge: string | null;
}

interface PlansResponse {
  plans: Plan[];
  trialDays: number;
  benefits: Array<{ icon: string; text: string }>;
}

const BENEFIT_GLYPHS: Record<string, string> = {
  library: '📚',
  moon: '🌙',
  download: '⤓',
  compass: '🧭',
  sparkles: '✨',
};

function price(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Screen 17 — the upgrade screen shown whenever Pro content is requested. */
export default function Paywall() {
  const router = useRouter();
  const refreshUser = useAuthStore((s) => s.refreshUser);

  const [selected, setSelected] = useState<Plan['tier']>('pro_annual');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data, loading } = useQuery<PlansResponse>(
    (signal) => api.get<PlansResponse>('/subscription/plans', signal),
    [],
  );

  /*
   * Two arrivals, two framings. Reached from a lock, this is an unlock screen
   * and Back returns to whatever was refused. Reached at the end of onboarding
   * (`?offer=1`), nothing was refused — the user has just finished their first
   * practice — so it reads as an offer and always continues into the app.
   */
  const asOffer = useLocalSearchParams<{ offer?: string }>().offer === '1';

  function dismiss() {
    if (asOffer) {
      router.replace('/(tabs)');
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  }

  useEffect(() => {
    if (!RNIap.iapSupported) return;

    void RNIap.initialize().catch(() => {
      // A store that will not connect surfaces when the user actually buys.
    });
    return () => {
      void RNIap.shutdown().catch(() => {});
    };
  }, []);

  /** Which store the server should verify the receipt against. */
  const storeName = Platform.OS === 'ios' ? 'apple' : 'google';

  /** Cancelling a store sheet is a normal outcome, not an error to display. */
  function isUserCancellation(err: unknown): boolean {
    const code = (err as { code?: string })?.code ?? '';
    return code === 'E_USER_CANCELLED' || code === 'user-cancelled';
  }

  async function subscribe() {
    setBusy(true);
    setError(null);
    try {
      if (!RNIap.iapSupported) {
        const response = await api.post<{ url: string }>('/subscription/checkout', {
          tier: selected,
        });
        
        if (response.url) {
          if (Platform.OS === 'web') {
            window.location.href = response.url;
          } else {
            Linking.openURL(response.url);
          }
        }
        return;
      } else {
        const receipt = await RNIap.purchaseSubscription(selected);
        // Null means the user dismissed the sheet — leave the screen as it was.
        if (!receipt) return;

        await api.post('/subscription', {
          tier: receipt.tier,
          store: storeName,
          receipt: receipt.token,
          startTrial: true,
        });

        // Only acknowledge once the server has accepted the receipt. Doing it
        // earlier would settle the purchase before anything verified it.
        await RNIap.finish(receipt);
      }

      await refreshUser();
      dismiss();
    } catch (err) {
      if (isUserCancellation(err)) return;
      setError(
        err instanceof ApiRequestError ? err.message : 'Could not complete the purchase.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    setBusy(true);
    setError(null);
    try {
      if (!RNIap.iapSupported) {
        await api.post('/subscription/restore', { store: 'web', receipt: 'web-restore' });
      } else {
        const receipt = await RNIap.restoreSubscription();
        if (!receipt) throw new Error('No previous purchase found on this store account.');

        await api.post('/subscription/restore', {
          store: storeName,
          receipt: receipt.token,
        });
      }

      await refreshUser();
      dismiss();
    } catch (err) {
      if (isUserCancellation(err)) return;
      setError(
        err instanceof ApiRequestError
          ? err.message
          : 'No previous purchase found for this account.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading || !data) return <Loading />;

  return (
    <LinearGradient colors={['#5B7FFF', '#3B3F8F', '#0B1026']} style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={{ alignItems: 'flex-end', padding: spacing.lg }}>
          <IconButton glyph="✕" label="Close" tone="onAccent" onPress={dismiss} />
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.xl, gap: spacing.xl }}>
          <View style={{ gap: spacing.sm }}>
            <Txt variant="display" style={{ color: '#FFF' }}>
              {asOffer ? "That's day one" : 'Mindspace Pro'}
            </Txt>
            <Txt variant="body" style={{ color: 'rgba(255,255,255,0.85)', fontSize: 16 }}>
              {asOffer
                ? 'You just finished your first practice. Pro opens the rest of the library — and the free plan stays free either way.'
                : 'Everything we make, with nothing locked.'}
            </Txt>
          </View>

          {/* Benefits */}
          <View style={{ gap: spacing.md }}>
            {data.benefits.map((benefit) => (
              <View
                key={benefit.text}
                style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
                <Txt style={{ fontSize: 20 }}>{BENEFIT_GLYPHS[benefit.icon] ?? '✓'}</Txt>
                <Txt variant="body" style={{ color: '#FFF', flex: 1 }}>
                  {benefit.text}
                </Txt>
              </View>
            ))}
          </View>

          {/* Plans */}
          <View style={{ gap: spacing.md }}>
            {data.plans.map((plan) => {
              const active = selected === plan.tier;
              return (
                <Pressable
                  key={plan.tier}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${plan.label}, ${price(plan.priceCents)} per ${plan.period}`}
                  onPress={() => setSelected(plan.tier)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing.lg,
                    padding: spacing.lg,
                    borderRadius: radius.lg,
                    backgroundColor: active ? 'rgba(255,255,255,0.96)' : 'rgba(255,255,255,0.14)',
                    borderWidth: 2,
                    borderColor: active ? '#FFF' : 'rgba(255,255,255,0.25)',
                  }}>
                  <View
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 11,
                      borderWidth: 2,
                      borderColor: active ? '#131A35' : 'rgba(255,255,255,0.7)',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                    {active ? (
                      <View
                        style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#131A35' }}
                      />
                    ) : null}
                  </View>

                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                      <Txt
                        variant="subheading"
                        style={{ color: active ? '#131A35' : '#FFF' }}>
                        {plan.label}
                      </Txt>
                      {plan.badge ? (
                        <View
                          style={{
                            paddingHorizontal: spacing.sm,
                            paddingVertical: 2,
                            borderRadius: radius.sm,
                            backgroundColor: '#FFC658',
                          }}>
                          <Txt variant="micro" style={{ color: '#2A1D00' }}>
                            {plan.badge.toUpperCase()}
                          </Txt>
                        </View>
                      ) : null}
                    </View>
                    <Txt
                      variant="caption"
                      style={{ color: active ? 'rgba(19,26,53,0.7)' : 'rgba(255,255,255,0.8)' }}>
                      {price(plan.priceCents)} / {plan.period}
                      {plan.period === 'year'
                        ? ` · ${price(plan.monthlyEquivalentCents)} a month`
                        : ''}
                    </Txt>
                  </View>
                </Pressable>
              );
            })}
          </View>

          {error ? (
            <Txt variant="caption" style={{ color: '#FFD9E2', textAlign: 'center' }}>
              {error}
            </Txt>
          ) : null}
        </ScrollView>

        <View style={{ padding: spacing.xl, gap: spacing.md }}>
          <Button
            title={`Start ${data.trialDays}-day free trial`}
            variant="onColor"
            loading={busy}
            onPress={subscribe}
          />

          <Txt variant="micro" style={{ color: 'rgba(255,255,255,0.7)', textAlign: 'center' }}>
            THEN {price(data.plans.find((p) => p.tier === selected)?.priceCents ?? 0)} PER{' '}
            {(data.plans.find((p) => p.tier === selected)?.period ?? 'year').toUpperCase()} · CANCEL
            ANYTIME
          </Txt>

          {/*
            An offer needs a visible way to decline. A lone ✕ in the corner
            reads as a trap at the end of onboarding, and a user who feels
            cornered on day one is not the one who renews on day thirty.
          */}
          {asOffer ? (
            <Button
              title="Keep using the free plan"
              variant="onColorSubtle"
              onPress={dismiss}
              disabled={busy}
            />
          ) : null}

          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: spacing.xl }}>
            <Pressable accessibilityRole="button" onPress={restore} disabled={busy}>
              <Txt variant="caption" style={{ color: 'rgba(255,255,255,0.85)' }}>
                Restore Purchases
              </Txt>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => void Linking.openURL(`${API_BASE_URL}/legal/terms`)}>
              <Txt variant="caption" style={{ color: 'rgba(255,255,255,0.85)' }}>
                Terms
              </Txt>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => void Linking.openURL(`${API_BASE_URL}/legal/privacy`)}>
              <Txt variant="caption" style={{ color: 'rgba(255,255,255,0.85)' }}>
                Privacy
              </Txt>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}
