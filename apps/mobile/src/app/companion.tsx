import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import type {
  CompanionMessage,
  CompanionStatus,
  CrisisResource,
} from '@mindspace/shared';
import { api } from '@/api/client';
import { openSse, type SseConnection } from '@/api/sse';
import { radius, spacing } from '@/theme';
import { useTheme } from '@/theme/use-theme';
import { Button, Card, IconButton, Screen, Txt } from '@/components/ui';
import { useAuthStore } from '@/store/auth';

/**
 * The AI companion (competitor gap: Headspace ships one).
 *
 * The screen is built around one rule: it must be obvious this is not a
 * person, and it must be trivially easy to reach one. The disclaimer is
 * always on screen, and a crisis classification takes over the view entirely
 * rather than appearing as another chat bubble.
 */

interface PendingMessage extends CompanionMessage {
  /** True while tokens are still arriving for this assistant turn. */
  streaming?: boolean;
}

export default function Companion() {
  const router = useRouter();
  const theme = useTheme();
  const token = useAuthStore((s) => s.tokens?.accessToken ?? null);

  const [status, setStatus] = useState<CompanionStatus | null>(null);
  const [messages, setMessages] = useState<PendingMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [crisis, setCrisis] = useState<CrisisResource[] | null>(null);

  const scrollRef = useRef<ScrollView>(null);
  const connection = useRef<SseConnection | null>(null);

  useEffect(() => {
    api
      .get<CompanionStatus>('/companion/status')
      .then(setStatus)
      .catch(() => setError('Could not load the companion.'));

    // Abandon any in-flight stream when the screen goes away.
    return () => connection.current?.abort();
  }, []);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, []);

  function send() {
    const text = draft.trim();
    if (!text || busy) return;

    setDraft('');
    setError(null);
    setBusy(true);

    const localId = `local-${Date.now()}`;
    setMessages((prior) => [
      ...prior,
      { id: localId, role: 'user', content: text, risk: 'none', createdAt: new Date().toISOString() },
      {
        id: `${localId}-reply`,
        role: 'assistant',
        content: '',
        risk: 'none',
        createdAt: new Date().toISOString(),
        streaming: true,
      },
    ]);
    scrollToEnd();

    connection.current = openSse(
      '/companion/chat',
      { message: text, conversationId: conversationId ?? undefined },
      token,
      {
        onEvent: (event, data) => {
          if (event === 'conversation') {
            setConversationId((data as { conversationId: string }).conversationId);
            return;
          }

          if (event === 'crisis') {
            // Takes over the screen: a helpline must not be one bubble among many.
            setCrisis((data as { resources: CrisisResource[] }).resources);
            return;
          }

          if (event === 'text') {
            const chunk = (data as { text: string }).text;
            setMessages((prior) =>
              prior.map((message) =>
                message.streaming ? { ...message, content: message.content + chunk } : message,
              ),
            );
            scrollToEnd();
            return;
          }

          if (event === 'replace') {
            // The server screened its own model's output and substituted it.
            const replacement = (data as { text: string }).text;
            setMessages((prior) =>
              prior.map((message) =>
                message.streaming ? { ...message, content: replacement } : message,
              ),
            );
            return;
          }

          if (event === 'error') {
            setError((data as { message: string }).message);
            setMessages((prior) => prior.filter((message) => !message.streaming));
          }
        },
        onError: setError,
        onClose: () => {
          setBusy(false);
          setMessages((prior) =>
            prior.map((message) => ({ ...message, streaming: false })).filter((m) => m.content.length > 0),
          );
          scrollToEnd();
        },
      },
    );
  }

  /* ---------------- Crisis takeover ---------------- */
  if (crisis) {
    return (
      <Screen>
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          <ScrollView contentContainerStyle={{ padding: spacing.xl, gap: spacing.xl }}>
            <Txt style={{ fontSize: 44 }}>🫂</Txt>
            <Txt variant="display">Please talk to someone now</Txt>
            <Txt variant="body" tone="muted" style={{ fontSize: 16, lineHeight: 24 }}>
              What you described is beyond what an app should handle. The people below are free,
              confidential, and trained for exactly this.
            </Txt>

            <View style={{ gap: spacing.md }}>
              {crisis.map((resource) => (
                <Card key={resource.name} style={{ gap: spacing.sm }}>
                  <Txt variant="subheading">{resource.name}</Txt>
                  <Txt variant="title" tone="accent">
                    {resource.contact}
                  </Txt>
                  <Txt variant="caption" tone="muted">
                    {resource.detail}
                  </Txt>
                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                    {/^[\d\s]+$/.test(resource.contact) ? (
                      <Button
                        title={`Call ${resource.contact}`}
                        size="md"
                        fullWidth={false}
                        onPress={() =>
                          void Linking.openURL(`tel:${resource.contact.replace(/\s/g, '')}`)
                        }
                      />
                    ) : null}
                    {resource.url ? (
                      <Button
                        title="Open"
                        variant="secondary"
                        size="md"
                        fullWidth={false}
                        onPress={() => void Linking.openURL(resource.url!)}
                      />
                    ) : null}
                  </View>
                </Card>
              ))}
            </View>

            <Card style={{ gap: spacing.md, borderColor: theme.colors.accent }}>
              <Txt variant="bodyStrong">Would a therapist help?</Txt>
              <Txt variant="caption" tone="muted">
                You can book a licensed therapist through Mindspace, usually within a few days.
              </Txt>
              <Button title="See therapists" size="md" onPress={() => router.replace('/therapy')} />
            </Card>

            <Button
              title="Go back"
              variant="ghost"
              onPress={() => {
                setCrisis(null);
                router.back();
              }}
            />
          </ScrollView>
        </SafeAreaView>
      </Screen>
    );
  }

  /* ---------------- Chat ---------------- */
  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.md,
            padding: spacing.lg,
          }}>
          <IconButton glyph="‹" label="Go back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Txt variant="heading">Companion</Txt>
            <Txt variant="micro" tone="faint">
              AI, NOT A THERAPIST
            </Txt>
          </View>
        </View>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={90}>
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }}
            keyboardShouldPersistTaps="handled">
            {messages.length === 0 ? (
              <View style={{ gap: spacing.lg, paddingTop: spacing.xl }}>
                <Txt style={{ fontSize: 40 }}>💬</Txt>
                <Txt variant="title">What's on your mind?</Txt>
                <Txt variant="body" tone="muted">
                  I'm here to listen and, where it helps, point you to a practice. I'm an AI — I
                  can't diagnose anything or handle an emergency.
                </Txt>

                {status && !status.available ? (
                  <Card style={{ backgroundColor: theme.colors.surfaceMuted }}>
                    <Txt variant="caption" tone="muted">
                      The companion isn't switched on in this build. Everything else still works.
                    </Txt>
                  </Card>
                ) : (
                  <View style={{ gap: spacing.sm }}>
                    {[
                      "I can't switch off after work",
                      'I keep waking up at 3am',
                      "I'm dreading a conversation tomorrow",
                    ].map((prompt) => (
                      <Pressable
                        key={prompt}
                        accessibilityRole="button"
                        onPress={() => setDraft(prompt)}
                        style={({ pressed }) => ({
                          padding: spacing.lg,
                          borderRadius: radius.lg,
                          backgroundColor: theme.colors.surface,
                          borderWidth: 1,
                          borderColor: theme.colors.border,
                          opacity: pressed ? 0.7 : 1,
                        })}>
                        <Txt variant="body">{prompt}</Txt>
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            ) : null}

            {messages.map((message) => (
              <View
                key={message.id}
                style={{
                  alignSelf: message.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '86%',
                  padding: spacing.lg,
                  borderRadius: radius.lg,
                  backgroundColor:
                    message.role === 'user' ? theme.colors.accent : theme.colors.surface,
                  borderWidth: message.role === 'user' ? 0 : 1,
                  borderColor: theme.colors.border,
                }}>
                {message.content.length > 0 ? (
                  <Txt
                    variant="body"
                    style={{
                      color: message.role === 'user' ? theme.colors.onAccent : theme.colors.text,
                      lineHeight: 22,
                    }}>
                    {message.content}
                  </Txt>
                ) : (
                  <ActivityIndicator size="small" color={theme.colors.textFaint} />
                )}
              </View>
            ))}

            {error ? (
              <Card style={{ borderColor: theme.colors.danger }}>
                <Txt variant="caption" tone="danger">
                  {error}
                </Txt>
              </Card>
            ) : null}
          </ScrollView>

          {/* Always visible, never dismissible. */}
          <Txt
            variant="micro"
            tone="faint"
            style={{ textAlign: 'center', paddingHorizontal: spacing.xl }}>
            {status?.disclaimer ?? 'The companion is an AI, not a therapist.'}
          </Txt>

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'flex-end',
              gap: spacing.md,
              padding: spacing.lg,
            }}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Say what's going on…"
              placeholderTextColor={theme.colors.textFaint}
              multiline
              maxLength={4000}
              editable={!busy}
              onSubmitEditing={send}
              style={{
                flex: 1,
                maxHeight: 120,
                minHeight: 46,
                borderRadius: radius.lg,
                backgroundColor: theme.colors.surfaceMuted,
                paddingHorizontal: spacing.lg,
                paddingVertical: spacing.md,
                color: theme.colors.text,
                fontSize: 15,
              }}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send"
              onPress={send}
              disabled={busy || draft.trim().length === 0}
              style={{
                width: 46,
                height: 46,
                borderRadius: 23,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor:
                  busy || draft.trim().length === 0
                    ? theme.colors.surfaceMuted
                    : theme.colors.accent,
              }}>
              {busy ? (
                <ActivityIndicator size="small" color={theme.colors.textFaint} />
              ) : (
                <Txt style={{ color: theme.colors.onAccent, fontSize: 18 }}>↑</Txt>
              )}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Screen>
  );
}
