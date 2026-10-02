import { config } from '../config.ts';
import { AnthropicProvider } from './providers/anthropic.ts';
import { GoogleProvider } from './providers/google.ts';
import { OpenAiCompatibleProvider } from './providers/openai-compatible.ts';
import type { LlmProvider, LlmProviderName } from './types.ts';

export * from './types.ts';

/**
 * Default model per provider, used when LLM_MODEL is unset. Named here rather
 * than inside each provider so swapping backends is a single env change.
 */
const DEFAULT_MODELS: Record<LlmProviderName, string> = {
  anthropic: 'claude-opus-5',
  openai: 'gpt-5',
  google: 'gemini-2.5-flash',
  deepseek: 'deepseek-chat',
  // Whatever the operator has pulled locally; llama3.1 is a reasonable start.
  ollama: 'llama3.1',
};

let cached: LlmProvider | null = null;

/**
 * Builds the configured provider. Cached because constructing a client is
 * cheap but pointless to repeat, and because provider choice is fixed for the
 * process lifetime.
 */
export function llm(): LlmProvider {
  if (cached) return cached;

  const provider = config.llm.provider;
  const model = config.llm.model || DEFAULT_MODELS[provider];

  switch (provider) {
    case 'anthropic':
      cached = new AnthropicProvider(model, config.llm.anthropicApiKey);
      break;

    case 'openai':
      cached = new OpenAiCompatibleProvider(
        'openai',
        model,
        config.llm.openaiBaseUrl,
        config.llm.openaiApiKey,
      );
      break;

    case 'deepseek':
      cached = new OpenAiCompatibleProvider(
        'deepseek',
        model,
        config.llm.deepseekBaseUrl,
        config.llm.deepseekApiKey,
      );
      break;

    case 'ollama':
      // A self-hosted server on the same machine needs no credential at all.
      cached = new OpenAiCompatibleProvider('ollama', model, config.llm.ollamaBaseUrl, undefined);
      break;

    case 'google':
      cached = new GoogleProvider(model, config.llm.googleApiKey);
      break;

    default: {
      // Exhaustiveness: adding a provider to the union without handling it
      // here becomes a compile error rather than a runtime surprise.
      const unreachable: never = provider;
      throw new Error(`Unsupported LLM_PROVIDER: ${String(unreachable)}`);
    }
  }

  console.log(`[llm] provider=${cached.name} model=${cached.model}`);
  return cached;
}

/** True when the companion feature can actually serve a request. */
export function companionConfigured(): boolean {
  const { provider } = config.llm;
  if (provider === 'ollama') return Boolean(config.llm.ollamaBaseUrl);
  if (provider === 'anthropic') return Boolean(config.llm.anthropicApiKey);
  if (provider === 'openai') return Boolean(config.llm.openaiApiKey);
  if (provider === 'deepseek') return Boolean(config.llm.deepseekApiKey);
  if (provider === 'google') return Boolean(config.llm.googleApiKey);
  return false;
}
