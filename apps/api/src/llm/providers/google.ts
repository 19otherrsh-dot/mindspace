import {
  LlmError,
  type LlmProvider,
  type LlmRequest,
  type LlmStreamEvent,
} from '../types.ts';

/**
 * Gemini. Its REST surface differs enough from the OpenAI shape to need its
 * own implementation: the system prompt is a dedicated `systemInstruction`
 * field, turns are `contents` with `parts`, the assistant role is called
 * `model`, and streaming responses are a JSON array rather than SSE frames.
 */
export class GoogleProvider implements LlmProvider {
  readonly name = 'google' as const;

  constructor(
    readonly model: string,
    private readonly apiKey: string | undefined,
    private readonly baseUrl = 'https://generativelanguage.googleapis.com/v1beta',
  ) {}

  async *stream(request: LlmRequest): AsyncIterable<LlmStreamEvent> {
    if (!this.apiKey) {
      throw new LlmError('GOOGLE_API_KEY is not set.', 'google', false);
    }

    // `alt=sse` asks for server-sent events instead of a single JSON array,
    // which is what makes incremental delivery possible.
    const url =
      `${this.baseUrl}/models/${this.model}:streamGenerateContent` +
      `?alt=sse&key=${encodeURIComponent(this.apiKey)}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: request.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.system }] },
          contents: request.messages.map((message) => ({
            role: message.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: message.content }],
          })),
          generationConfig: { maxOutputTokens: request.maxTokens },
        }),
      });
    } catch (err) {
      throw new LlmError('Could not reach the model provider.', 'google', true, err);
    }

    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => '');
      throw new LlmError(
        `Model provider returned ${response.status}. ${detail.slice(0, 200)}`,
        'google',
        response.status >= 500 || response.status === 429,
      );
    }

    let text = '';
    let inputTokens: number | null = null;
    let outputTokens: number | null = null;
    let stopReason: string | null = null;

    const reader = response.body.getReader();
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
          if (!line.startsWith('data:')) continue;

          let chunk: GeminiChunk;
          try {
            chunk = JSON.parse(line.slice(5).trim()) as GeminiChunk;
          } catch {
            continue;
          }

          if (chunk.usageMetadata) {
            inputTokens = chunk.usageMetadata.promptTokenCount ?? null;
            outputTokens = chunk.usageMetadata.candidatesTokenCount ?? null;
          }

          // A prompt blocked before generation carries no candidates at all.
          if (chunk.promptFeedback?.blockReason) {
            yield { type: 'refusal', reason: chunk.promptFeedback.blockReason };
            return;
          }

          const candidate = chunk.candidates?.[0];
          if (!candidate) continue;

          if (candidate.finishReason) {
            stopReason = candidate.finishReason;
            if (candidate.finishReason === 'SAFETY' || candidate.finishReason === 'PROHIBITED_CONTENT') {
              yield { type: 'refusal', reason: candidate.finishReason };
              return;
            }
          }

          for (const part of candidate.content?.parts ?? []) {
            if (part.text) {
              text += part.text;
              yield { type: 'text', text: part.text };
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield { type: 'done', text, usage: { inputTokens, outputTokens }, stopReason };
  }

  async healthy(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const response = await fetch(
        `${this.baseUrl}/models?key=${encodeURIComponent(this.apiKey)}`,
        { signal: AbortSignal.timeout(5_000) },
      );
      return response.ok;
    } catch {
      return false;
    }
  }
}

interface GeminiChunk {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}
