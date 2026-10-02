import {
  LlmError,
  type LlmProvider,
  type LlmProviderName,
  type LlmRequest,
  type LlmStreamEvent,
} from '../types.ts';

/**
 * One implementation for every provider that speaks the OpenAI
 * `/chat/completions` wire format — OpenAI itself, DeepSeek, and Ollama's
 * compatibility endpoint.
 *
 * These are handled with raw `fetch` rather than the OpenAI SDK on purpose:
 * the SDK adds a dependency, and the only thing that differs between these
 * three backends is a base URL and an API key. A self-hosted Ollama model is
 * then not a special case — it is the same code path with `OLLAMA_BASE_URL`
 * set and no key.
 */
export class OpenAiCompatibleProvider implements LlmProvider {
  constructor(
    readonly name: LlmProviderName,
    readonly model: string,
    private readonly baseUrl: string,
    private readonly apiKey: string | undefined,
  ) {}

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      // Ollama needs no key; sending an empty Bearer would be rejected.
      ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
    };
  }

  async *stream(request: LlmRequest): AsyncIterable<LlmStreamEvent> {
    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.headers(),
        signal: request.signal,
        body: JSON.stringify({
          model: this.model,
          max_tokens: request.maxTokens,
          stream: true,
          // Ask for usage in the final chunk; providers that do not support
          // this option ignore it rather than failing.
          stream_options: { include_usage: true },
          messages: [
            { role: 'system', content: request.system },
            ...request.messages,
          ],
        }),
      });
    } catch (err) {
      throw new LlmError('Could not reach the model provider.', this.name, true, err);
    }

    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => '');
      throw new LlmError(
        `Model provider returned ${response.status}. ${detail.slice(0, 200)}`,
        this.name,
        response.status >= 500 || response.status === 429,
      );
    }

    let text = '';
    let inputTokens: number | null = null;
    let outputTokens: number | null = null;
    let stopReason: string | null = null;

    for await (const data of readSseData(response.body)) {
      if (data === '[DONE]') break;

      let chunk: OpenAiChunk;
      try {
        chunk = JSON.parse(data) as OpenAiChunk;
      } catch {
        // A malformed frame is not worth aborting a live answer for.
        continue;
      }

      // Usage arrives on its own final chunk with an empty choices array.
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens ?? null;
        outputTokens = chunk.usage.completion_tokens ?? null;
      }

      const choice = chunk.choices?.[0];
      if (!choice) continue;

      if (choice.finish_reason) stopReason = choice.finish_reason;

      // OpenAI signals a content-policy stop here rather than with an error.
      if (choice.finish_reason === 'content_filter') {
        yield { type: 'refusal', reason: 'content_filter' };
        return;
      }

      const delta = choice.delta?.content;
      if (delta) {
        text += delta;
        yield { type: 'text', text: delta };
      }
    }

    yield {
      type: 'done',
      text,
      usage: { inputTokens, outputTokens },
      stopReason,
    };
  }

  async healthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(5_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

interface OpenAiChunk {
  choices?: Array<{
    delta?: { content?: string };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

/**
 * Yields the payload of each `data:` line in an SSE body.
 *
 * Chunk boundaries fall wherever the network puts them, so a frame can arrive
 * split across two reads — the buffer holds the incomplete tail until the rest
 * shows up. Parsing per-chunk instead would silently drop tokens.
 */
async function* readSseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        if (line.startsWith('data:')) {
          yield line.slice(5).trim();
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
