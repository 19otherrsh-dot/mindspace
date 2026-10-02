import Anthropic from '@anthropic-ai/sdk';
import {
  LlmError,
  type LlmProvider,
  type LlmRequest,
  type LlmStreamEvent,
} from '../types.ts';

/**
 * Anthropic provider, on the official SDK.
 *
 * Companion-specific choices:
 *
 * - **Effort is `low`.** Claude Opus 5 thinks by default, and deep reasoning is
 *   wrong for a supportive chat turn — it adds seconds of latency to a reply
 *   whose job is to sound present. Effort is the lever here rather than
 *   disabling thinking, which on this model can leak `<thinking>` tags into
 *   the visible answer.
 * - **`max_tokens` is deliberately small.** A companion that monologues is a
 *   worse companion; the cap is a product decision, not a cost one.
 * - **The system prompt is cached.** It is long, identical on every turn, and
 *   sits at the front of the prefix — exactly the shape prompt caching wants.
 */
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic' as const;

  private readonly client: Anthropic;

  constructor(
    readonly model: string,
    apiKey: string | undefined,
    baseUrl?: string,
  ) {
    // An unset key is not necessarily fatal — the SDK also resolves an
    // `ant auth login` profile — so let the SDK decide rather than throwing.
    this.client = new Anthropic({
      ...(apiKey ? { apiKey } : {}),
      ...(baseUrl ? { baseURL: baseUrl } : {}),
    });
  }

  async *stream(request: LlmRequest): AsyncIterable<LlmStreamEvent> {
    try {
      const stream = this.client.messages.stream(
        {
          model: this.model,
          max_tokens: request.maxTokens,
          system: [
            {
              type: 'text',
              text: request.system,
              cache_control: { type: 'ephemeral' },
            },
          ],
          thinking: { type: 'adaptive' },
          output_config: { effort: 'low' },
          messages: request.messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        },
        { signal: request.signal },
      );

      let text = '';

      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          text += event.delta.text;
          yield { type: 'text', text: event.delta.text };
        }
      }

      const final = await stream.finalMessage();

      // Must be checked before reading content: a declined request returns a
      // successful 200 with an empty or partial body.
      if (final.stop_reason === 'refusal') {
        yield {
          type: 'refusal',
          reason: final.stop_details?.explanation ?? null,
        };
        return;
      }

      yield {
        type: 'done',
        text,
        usage: {
          inputTokens: final.usage.input_tokens ?? null,
          outputTokens: final.usage.output_tokens ?? null,
        },
        stopReason: final.stop_reason ?? null,
      };
    } catch (err) {
      throw toLlmError(err);
    }
  }

  async healthy(): Promise<boolean> {
    try {
      await this.client.models.retrieve(this.model);
      return true;
    } catch {
      return false;
    }
  }
}

function toLlmError(err: unknown): LlmError {
  if (err instanceof Anthropic.RateLimitError) {
    return new LlmError('The companion is busy right now.', 'anthropic', true, err);
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return new LlmError('Companion credentials are invalid.', 'anthropic', false, err);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new LlmError('Could not reach the model provider.', 'anthropic', true, err);
  }
  if (err instanceof Anthropic.APIError) {
    // 5xx is worth retrying; a 4xx means the request itself is wrong.
    const retryable = err.status === undefined || err.status >= 500;
    return new LlmError(err.message, 'anthropic', retryable, err);
  }
  return new LlmError((err as Error)?.message ?? 'Unknown model error', 'anthropic', false, err);
}
