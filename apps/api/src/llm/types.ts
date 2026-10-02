/**
 * The provider-neutral contract every LLM backend implements.
 *
 * Deliberately narrow: the companion needs streamed chat completion with a
 * system prompt and nothing else. Keeping the surface this small is what makes
 * a self-hosted Ollama model a genuine drop-in for a frontier API rather than
 * a second-class path.
 */

export type LlmProviderName = 'anthropic' | 'openai' | 'google' | 'deepseek' | 'ollama';

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmRequest {
  system: string;
  messages: LlmMessage[];
  maxTokens: number;
  /** Abort propagated from the HTTP request, so a disconnect stops the spend. */
  signal?: AbortSignal;
}

export interface LlmUsage {
  inputTokens: number | null;
  outputTokens: number | null;
}

/** Streamed chunks. `done` carries the final text and usage. */
export type LlmStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'done'; text: string; usage: LlmUsage; stopReason: string | null }
  /**
   * The provider declined to answer — Claude's safety classifiers, OpenAI's
   * content filter, and so on. Distinct from an error: the request succeeded,
   * the model chose not to respond, and the caller must show something useful
   * rather than a stack trace.
   */
  | { type: 'refusal'; reason: string | null };

export interface LlmProvider {
  readonly name: LlmProviderName;
  readonly model: string;
  /** Async iterator so routes can pipe straight into an SSE response. */
  stream(request: LlmRequest): AsyncIterable<LlmStreamEvent>;
  /** Cheap liveness probe surfaced on /health. */
  healthy(): Promise<boolean>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly provider: LlmProviderName,
    readonly retryable: boolean,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}
