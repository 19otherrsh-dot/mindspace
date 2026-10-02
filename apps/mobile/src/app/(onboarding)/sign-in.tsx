import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as AuthSession from 'expo-auth-session';
import * as Crypto from 'expo-crypto';
import { useTranslation } from 'react-i18next';
import { spacing, radius } from '@/theme';
import { useTheme } from '@/theme/use-theme';
import { Button, Divider, Field, IconButton, Txt } from '@/components/ui';
import { useAuthStore } from '@/store/auth';
import { API_BASE_URL, ApiRequestError } from '@/api/client';

type Mode = 'signup' | 'login';

/** Screen 3 — account creation, sign in, and the guest entry point. */
export default function SignIn() {
  const router = useRouter();
  const theme = useTheme();
  const { t } = useTranslation();

  const [mode, setMode] = useState<Mode>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const busy = useAuthStore((s) => s.busy);
  const signUp = useAuthStore((s) => s.signUp);
  const logIn = useAuthStore((s) => s.logIn);
  const continueAsGuest = useAuthStore((s) => s.continueAsGuest);
  const signInWithApple = useAuthStore((s) => s.signInWithApple);
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle);

  async function submit() {
    setErrors({});

    // Cheap client-side checks first so the common typo does not need a
    // round trip; the server validates again regardless.
    const next: Record<string, string> = {};
    if (!email.includes('@')) next.email = 'Enter a valid email address';
    if (mode === 'signup' && password.length < 8) {
      next.password = 'Use at least 8 characters';
    } else if (password.length === 0) {
      next.password = 'Enter your password';
    }

    if (Object.keys(next).length > 0) {
      setErrors(next);
      return;
    }

    try {
      if (mode === 'signup') await signUp(email.trim(), password);
      else await logIn(email.trim(), password);
      // The root layout's auth gate takes it from here.
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setErrors(err.details ?? { form: err.message });
      } else {
        setErrors({ form: 'Could not reach Mindspace. Check your connection.' });
      }
    }
  }

  async function guest() {
    setErrors({});
    try {
      await continueAsGuest();
      router.replace('/(tabs)');
    } catch {
      setErrors({ form: 'Could not start a trial session right now.' });
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ padding: spacing.xl, gap: spacing.xl, flexGrow: 1 }}
          keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row' }}>
            <IconButton glyph="‹" label="Go back" onPress={() => router.back()} />
          </View>

          <View style={{ gap: spacing.sm }}>
            <Txt variant="display">
              {mode === 'signup' ? t('signIn.create_account') : t('signIn.welcome_back')}
            </Txt>
            <Txt variant="body" tone="muted">
              {mode === 'signup'
                ? t('signIn.signup_description')
                : t('signIn.login_description')}
            </Txt>
          </View>

          <View style={{ gap: spacing.lg }}>
            <Field
              label={t('signIn.email')}
              value={email}
              onChangeText={setEmail}
              error={errors.email}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              placeholder="you@example.com"
              textContentType="emailAddress"
            />
            <Field
              label={t('signIn.password')}
              value={password}
              onChangeText={setPassword}
              error={errors.password}
              secureTextEntry
              autoCapitalize="none"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              placeholder={mode === 'signup' ? t('signIn.placeholder_password') : t('signIn.password')}
              textContentType={mode === 'signup' ? 'newPassword' : 'password'}
              onSubmitEditing={submit}
              returnKeyType="go"
            />

            {errors.form ? (
              <Txt variant="caption" tone="danger">
                {errors.form}
              </Txt>
            ) : null}

            <Button
              title={mode === 'signup' ? t('signIn.sign_up') : t('signIn.sign_in')}
              onPress={submit}
              loading={busy}
            />

            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setMode(mode === 'signup' ? 'login' : 'signup');
                setErrors({});
              }}
              style={{ alignSelf: 'center', padding: spacing.sm }}>
              <Txt variant="caption" tone="accent">
                {mode === 'signup'
                  ? 'Already have an account? Sign in'
                  : 'New to Mindspace? Create an account'}
              </Txt>
            </Pressable>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
            <View style={{ flex: 1 }}>
              <Divider />
            </View>
            <Txt variant="micro" tone="faint">
              OR
            </Txt>
            <View style={{ flex: 1 }}>
              <Divider />
            </View>
          </View>

          <View style={{ gap: spacing.md }}>
            {/*
              Apple sign-in uses the native SDK on iOS; falls back to guest
              on platforms where it is unavailable.
            */}
            <Button
              title={t('signIn.continue_with_apple')}
              icon=""
              variant="secondary"
              onPress={async () => {
                setErrors({});
                try {
                  if (Platform.OS === 'ios') {
                    /*
                     * Replay protection. The raw nonce must be unpredictable —
                     * a timestamp is not — and Apple embeds the *hashed* value
                     * in the identity token, so the server is sent the raw one
                     * and re-derives the hash to compare.
                     */
                    const rawNonce = Crypto.randomUUID();
                    const hashedNonce = await Crypto.digestStringAsync(
                      Crypto.CryptoDigestAlgorithm.SHA256,
                      rawNonce,
                    );

                    const credential = await AppleAuthentication.signInAsync({
                      requestedScopes: [
                        AppleAuthentication.AppleAuthenticationScope.EMAIL,
                        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
                      ],
                      nonce: hashedNonce,
                    });

                    if (credential.identityToken) {
                      await signInWithApple(
                        credential.identityToken,
                        credential.fullName
                          ? {
                              givenName: credential.fullName.givenName ?? undefined,
                              familyName: credential.fullName.familyName ?? undefined,
                            }
                          : undefined,
                        rawNonce,
                      );
                    }
                  } else {
                    await guest();
                  }
                } catch (err: any) {
                  if (err?.code === 'ERR_REQUEST_CANCELED') return;
                  setErrors({ form: 'Apple sign-in failed. Please try again.' });
                }
              }}
              disabled={busy}
            />
            {/*
              Google sign-in uses expo-auth-session with Google's discovery
              document; falls back to guest on web.
            */}
            <Button
              title={t('signIn.continue_with_google')}
              icon="G"
              variant="secondary"
              onPress={async () => {
                setErrors({});
                try {
                  if (Platform.OS === 'web') {
                    await guest();
                    return;
                  }
                  const discovery = await AuthSession.fetchDiscoveryAsync(
                    'https://accounts.google.com',
                  );
                  // Google echoes the nonce into the token unhashed.
                  const rawNonce = Crypto.randomUUID();

                  const request = new AuthSession.AuthRequest({
                    clientId: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? '',
                    scopes: ['openid', 'email', 'profile'],
                    responseType: AuthSession.ResponseType.IdToken,
                    // Required by AuthRequestConfig. Built from the app's
                    // `scheme` in app.json so it matches what Google is
                    // configured to redirect back to.
                    redirectUri: AuthSession.makeRedirectUri({ scheme: 'mindspace' }),
                    extraParams: { nonce: rawNonce },
                  });

                  const result = await request.promptAsync(discovery);
                  if (result.type === 'success' && result.params.id_token) {
                    await signInWithGoogle(result.params.id_token, rawNonce);
                  }
                } catch (err: any) {
                  if (err?.code === 'ERR_REQUEST_CANCELED') return;
                  setErrors({ form: 'Google sign-in failed. Please try again.' });
                }
              }}
              disabled={busy}
            />
          </View>

          <View style={{ flex: 1, justifyContent: 'flex-end', gap: spacing.lg }}>
            <Pressable
              accessibilityRole="button"
              onPress={guest}
              disabled={busy}
              style={{
                alignSelf: 'center',
                paddingVertical: spacing.md,
                paddingHorizontal: spacing.xl,
                borderRadius: radius.pill,
              }}>
              <Txt variant="bodyStrong" tone="accent">
                Try for free →
              </Txt>
            </Pressable>

            <Txt variant="micro" tone="faint" style={{ textAlign: 'center', lineHeight: 18 }}>
              By continuing you agree to our{' '}
              <Txt
                variant="micro"
                tone="accent"
                onPress={() => void Linking.openURL(`${API_BASE_URL}/legal/terms`)}>
                Terms of Service
              </Txt>{' '}
              and{' '}
              <Txt
                variant="micro"
                tone="accent"
                onPress={() => void Linking.openURL(`${API_BASE_URL}/legal/privacy`)}>
                Privacy Policy
              </Txt>
              .
            </Txt>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
