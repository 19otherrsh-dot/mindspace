import { Router, type Response } from 'express';
import { z } from 'zod';
import type {
  CompanionConversation,
  CompanionMessage,
  CompanionStatus,
} from '@mindspace/shared';
import { config, isProduction } from '../config.ts';
import { query, queryOne, transaction } from '../db/pool.ts';
import { decryptNote, encryptNote } from '../lib/crypto.ts';
import { localDate } from '../lib/dates.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { requireAuth } from '../middleware/auth.ts';
import { rateLimit } from '../middleware/rateLimit.ts';
import { companionConfigured, llm, LlmError } from '../llm/index.ts';
import {
  assessRisk,
  crisisReply,
  resourcesFor,
  screenedReplacement,
  screenOutput,
  type RiskLevel,
} from '../llm/safety.ts';
import {
  buildSystemPrompt,
  COMPANION_HISTORY_TURNS,
  COMPANION_MAX_TOKENS,
} from '../llm/prompt.ts';
import { getStreak } from '../services/stats.ts';

export const companionRouter = Router();

const DISCLAIMER =
  'The companion is an AI, not a therapist. It cannot diagnose, prescribe, or handle emergencies.';

/**
 * GET /companion/status
 *
 * Deliberately unauthenticated-friendly and never gated: the crisis resources
 * in this payload must be reachable even when the companion itself is not
 * configured, not paid for, or switched off.
 */
companionRouter.get('/status', requireAuth, (req, res) => {
  const region = regionFor(req.user!.timezone);

  const body: CompanionStatus = {
    available: companionConfigured(),
    // Naming the provider in production would leak deployment detail.
    ...(isProduction ? {} : { provider: config.llm.provider, model: llm().model }),
    crisisResources: resourcesFor(region),
    disclaimer: DISCLAIMER,
  };
  res.json(body);
});

/** GET /companion/conversations */
companionRouter.get('/conversations', requireAuth, async (req, res) => {
  const { rows } = await query<{
    id: string;
    title: string | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT id, title, created_at, updated_at
       FROM companion_conversations
      WHERE user_id = $1::uuid AND archived_at IS NULL
      ORDER BY updated_at DESC
      LIMIT 50`,
    [req.user!.id],
  );

  const items: CompanionConversation[] = rows.map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }));
  res.json({ items });
});

/** GET /companion/conversations/:id — full thread, decrypted for the owner. */
companionRouter.get('/conversations/:id', requireAuth, async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

  const conversation = await queryOne<{
    id: string;
    title: string | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT id, title, created_at, updated_at
       FROM companion_conversations
      WHERE id = $1::uuid AND user_id = $2::uuid AND archived_at IS NULL`,
    [id, req.user!.id],
  );
  if (!conversation) throw notFound('Conversation');

  res.json({
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.created_at.toISOString(),
    updatedAt: conversation.updated_at.toISOString(),
    messages: await loadMessages(id),
  } satisfies CompanionConversation);
});

/** DELETE /companion/conversations/:id — hard delete; this is health data. */
companionRouter.delete('/conversations/:id', requireAuth, async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  await query('DELETE FROM companion_conversations WHERE id = $1::uuid AND user_id = $2::uuid', [
    id,
    req.user!.id,
  ]);
  res.status(204).end();
});

const sendSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(4000),
});

/**
 * POST /companion/chat — streams the reply as Server-Sent Events.
 *
 * Rate limited per user because each call costs real money and because an
 * unbounded loop is the most likely way this endpoint gets abused.
 */
companionRouter.post(
  '/chat',
  requireAuth,
  rateLimit({ limit: 30, windowSeconds: 300, bucket: 'companion' }),
  async (req, res) => {
    const input = sendSchema.parse(req.body);
    const user = req.user!;

    // SSE headers must go out before anything else is written.
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Nginx buffers proxied responses by default, which would defeat streaming.
      'X-Accel-Buffering': 'no',
    });

    const conversationId = await ensureConversation(
      user.id,
      input.conversationId,
      input.message,
    );

    const risk = assessRisk(input.message);

    // The user's own message is stored regardless of what happens next.
    const userMessage = await insertMessage({
      conversationId,
      role: 'user',
      content: input.message,
      risk: risk.level,
    });

    send(res, 'conversation', { conversationId, userMessageId: userMessage.id });

    if (risk.level !== 'none') {
      await query(
        `INSERT INTO companion_safety_events (user_id, conversation_id, risk, category)
         VALUES ($1::uuid, $2::uuid, $3::companion_risk, $4)`,
        [user.id, conversationId, risk.level, risk.category ?? 'unknown'],
      );
    }

    /*
     * A crisis classification never reaches the model. The reply is fixed,
     * reviewed text with verified helplines attached — a language model must
     * not be the thing standing between someone and help.
     */
    if (risk.level === 'crisis') {
      const reply = crisisReply();
      send(res, 'crisis', {
        resources: resourcesFor(regionFor(user.timezone)),
        category: risk.category,
      });
      send(res, 'text', { text: reply });

      const stored = await insertMessage({
        conversationId,
        role: 'assistant',
        content: reply,
        risk: 'crisis',
      });
      send(res, 'done', { messageId: stored.id, risk: 'crisis' });
      return res.end();
    }

    if (!companionConfigured()) {
      send(res, 'error', {
        message: 'The companion is not available in this deployment.',
        retryable: false,
      });
      return res.end();
    }

    const [history, streak, mood, profile] = await Promise.all([
      loadMessages(conversationId, COMPANION_HISTORY_TURNS),
      getStreak(user.id, user.timezone),
      queryOne<{ value: number }>(
        `SELECT value FROM mood_entries
          WHERE user_id = $1::uuid AND activity_date = $2::date
          ORDER BY recorded_at DESC LIMIT 1`,
        [user.id, localDate(user.timezone)],
      ),
      queryOne<{ display_name: string; goals: string[] | null }>(
        `SELECT u.display_name, o.goals
           FROM users u LEFT JOIN onboarding_profiles o ON o.user_id = u.id
          WHERE u.id = $1::uuid`,
        [user.id],
      ),
    ]);

    const system = buildSystemPrompt({
      displayName: profile?.display_name ?? 'there',
      goals: profile?.goals ?? [],
      currentStreak: streak,
      todayMood: mood?.value ?? null,
      risk: risk.level,
    });

    // Stop paying for tokens the moment the client hangs up.
    const abort = new AbortController();
    req.on('close', () => abort.abort());

    let full = '';

    try {
      for await (const event of llm().stream({
        system,
        // loadMessages already includes the message just inserted.
        messages: history.map((m) => ({ role: m.role, content: m.content })),
        maxTokens: COMPANION_MAX_TOKENS,
        signal: abort.signal,
      })) {
        if (event.type === 'text') {
          full += event.text;
          send(res, 'text', { text: event.text });
          continue;
        }

        if (event.type === 'refusal') {
          const reply =
            "I'd rather not answer that one. If there's something else on your mind, I'm here.";
          send(res, 'text', { text: reply });
          const stored = await insertMessage({
            conversationId,
            role: 'assistant',
            content: reply,
            risk: risk.level,
          });
          send(res, 'done', { messageId: stored.id, risk: risk.level });
          return res.end();
        }

        if (event.type === 'done') {
          // Last line of defence: a model that invents a helpline number or
          // claims to be a clinician never reaches the user.
          const screen = screenOutput(event.text);
          const finalText = screen.safe ? event.text : screenedReplacement();

          if (!screen.safe) {
            console.warn(`[companion] output screened: ${screen.reason}`);
            // Replace what was already streamed rather than appending to it.
            send(res, 'replace', { text: finalText, reason: screen.reason });
          }

          const stored = await insertMessage({
            conversationId,
            role: 'assistant',
            content: finalText,
            risk: risk.level,
            provider: llm().name,
            model: llm().model,
            inputTokens: event.usage.inputTokens,
            outputTokens: event.usage.outputTokens,
          });

          send(res, 'done', { messageId: stored.id, risk: risk.level });
        }
      }
    } catch (err) {
      if (abort.signal.aborted) return res.end();

      const llmError = err instanceof LlmError ? err : null;
      console.error('[companion] stream failed', err);

      send(res, 'error', {
        message: llmError?.retryable
          ? 'The companion is having trouble right now. Try again in a moment.'
          : 'The companion could not answer that.',
        retryable: llmError?.retryable ?? false,
      });

      // Persist a partial answer rather than losing it silently.
      if (full.trim().length > 0) {
        await insertMessage({
          conversationId,
          role: 'assistant',
          content: full,
          risk: risk.level,
          provider: llm().name,
          model: llm().model,
        }).catch(() => {});
      }
    }

    res.end();
  },
);

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function send(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Best-effort region from an IANA timezone, used only to order crisis
 * resources. Coarse by design — a wrong guess still shows the international
 * fallback, and asking for a country would be friction at the worst moment.
 */
function regionFor(timezone: string): string | null {
  if (timezone.startsWith('America/')) return 'US';
  if (timezone === 'Europe/London') return 'GB';
  if (timezone.startsWith('Asia/Kolkata') || timezone.startsWith('Asia/Calcutta')) return 'IN';
  return null;
}

async function ensureConversation(
  userId: string,
  conversationId: string | undefined,
  firstMessage: string,
): Promise<string> {
  if (conversationId) {
    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM companion_conversations
        WHERE id = $1::uuid AND user_id = $2::uuid AND archived_at IS NULL`,
      [conversationId, userId],
    );
    if (!existing) throw notFound('Conversation');

    await query('UPDATE companion_conversations SET updated_at = now() WHERE id = $1::uuid', [
      conversationId,
    ]);
    return conversationId;
  }

  // Title from the opening message so the list is scannable without
  // decrypting anything.
  const title = firstMessage.length > 60 ? `${firstMessage.slice(0, 57)}…` : firstMessage;

  const created = await queryOne<{ id: string }>(
    `INSERT INTO companion_conversations (user_id, title) VALUES ($1::uuid, $2) RETURNING id`,
    [userId, title],
  );
  if (!created) throw badRequest('Could not start a conversation');
  return created.id;
}

async function insertMessage(input: {
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  risk: RiskLevel;
  provider?: string;
  model?: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
}): Promise<{ id: string }> {
  return transaction(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO companion_messages
         (conversation_id, role, content_encrypted, risk, provider, model, input_tokens, output_tokens)
       VALUES ($1::uuid, $2::companion_role, $3, $4::companion_risk, $5, $6, $7, $8)
       RETURNING id`,
      [
        input.conversationId,
        input.role,
        encryptNote(input.content),
        input.risk,
        input.provider ?? null,
        input.model ?? null,
        input.inputTokens ?? null,
        input.outputTokens ?? null,
      ],
    );

    await client.query(
      'UPDATE companion_conversations SET updated_at = now() WHERE id = $1::uuid',
      [input.conversationId],
    );

    return rows[0]!;
  });
}

async function loadMessages(conversationId: string, limit?: number): Promise<CompanionMessage[]> {
  // Take the newest N, then restore chronological order for the model.
  const { rows } = await query<{
    id: string;
    role: 'user' | 'assistant';
    content_encrypted: Buffer;
    risk: RiskLevel;
    created_at: Date;
  }>(
    `SELECT * FROM (
       SELECT id, role, content_encrypted, risk, created_at
         FROM companion_messages
        WHERE conversation_id = $1::uuid
        ORDER BY created_at DESC
        LIMIT $2
     ) recent ORDER BY created_at ASC`,
    [conversationId, limit ?? 200],
  );

  return rows
    .map((row) => ({
      id: row.id,
      role: row.role,
      content: decryptNote(row.content_encrypted) ?? '',
      risk: row.risk,
      createdAt: row.created_at.toISOString(),
    }))
    // A message that fails to decrypt (rotated key) is dropped rather than
    // sent to the model as an empty turn.
    .filter((message) => message.content.length > 0);
}
