import { setTimeout as sleep } from 'node:timers/promises';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompleteOptions {
  model: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface LlmProvider {
  /** Human-readable provider id, stored with each analysis run. */
  readonly name: string;
  readonly mapModel: string;
  readonly synthModel: string;
  /** Max parallel requests the provider allows; overrides ANALYSIS.concurrency. */
  readonly concurrency?: number;
  complete(messages: ChatMessage[], opts: CompleteOptions): Promise<string>;
}

export interface OpenAiCompatibleConfig {
  name: string;
  baseUrl: string;
  apiKey?: string;
  mapModel: string;
  synthModel: string;
  extraHeaders?: Record<string, string>;
  requestTimeoutMs?: number;
  concurrency?: number;
  maxAttempts?: number;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    /** Rate limited (HTTP 429): retried longer, the provider is just busy. */
    readonly rateLimited = false,
    /** Server-suggested wait from Retry-After, ms. */
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

/**
 * Client for any OpenAI-compatible Chat Completions API (Yandex AI Studio, OpenRouter,
 * Ollama…). Retries 429/5xx/network errors with exponential backoff.
 */
export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name: string;
  readonly mapModel: string;
  readonly synthModel: string;
  readonly concurrency?: number;

  constructor(private readonly config: OpenAiCompatibleConfig) {
    this.name = config.name;
    this.mapModel = config.mapModel;
    this.synthModel = config.synthModel;
    this.concurrency = config.concurrency;
  }

  async complete(messages: ChatMessage[], opts: CompleteOptions): Promise<string> {
    const maxAttempts = this.config.maxAttempts ?? 6;
    // Quota rejections (429) mean "wait", not "broken", so they get a separate, larger budget.
    const maxRateLimited = maxAttempts * 3;
    let failures = 0;
    let rateLimited = 0;
    for (;;) {
      try {
        return await this.request(messages, opts);
      } catch (err) {
        const llmErr = err instanceof LlmError ? err : undefined;
        const retryable = llmErr ? llmErr.retryable : !opts.signal?.aborted;
        if (!retryable) throw err;
        const attempt = llmErr?.rateLimited ? ++rateLimited : ++failures;
        if (attempt >= (llmErr?.rateLimited ? maxRateLimited : maxAttempts)) throw err;
        const backoff = Math.min(30_000, 1000 * 2 ** (attempt - 1)) * (0.5 + Math.random());
        await sleep(Math.max(backoff, llmErr?.retryAfterMs ?? 0), undefined, {
          signal: opts.signal,
        });
      }
    }
  }

  private async request(messages: ChatMessage[], opts: CompleteOptions): Promise<string> {
    const timeout = AbortSignal.timeout(this.config.requestTimeoutMs ?? 180_000);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;

    const res = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
        ...this.config.extraHeaders,
      },
      body: JSON.stringify({
        model: opts.model,
        messages,
        temperature: opts.temperature,
        max_tokens: opts.maxTokens,
      }),
    });

    const text = await res.text();
    if (!res.ok) {
      const rateLimited = res.status === 429;
      const retryAfter = Number(res.headers.get('retry-after'));
      throw new LlmError(
        `${this.name}: HTTP ${res.status} ${text.slice(0, 300)}`,
        rateLimited || res.status >= 500,
        rateLimited,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
      );
    }

    let content: unknown;
    try {
      content = JSON.parse(text).choices?.[0]?.message?.content;
    } catch {
      throw new LlmError(`${this.name}: ответ не JSON: ${text.slice(0, 300)}`, true);
    }
    if (typeof content !== 'string' || !content.trim()) {
      throw new LlmError(`${this.name}: пустой ответ модели`, true);
    }
    return content;
  }
}

/**
 * Builds the provider selected by LLM_PROVIDER (default: yandex).
 * Vireonix is deliberately absent: its terms forbid automated bulk processing,
 * which is exactly what the analysis pipeline does.
 */
export function providerFromEnv(env: NodeJS.ProcessEnv = process.env): LlmProvider {
  const provider = env.LLM_PROVIDER ?? 'yandex';
  switch (provider) {
    case 'yandex': {
      const folder = required(env, 'YANDEX_FOLDER_ID');
      return new OpenAiCompatibleProvider({
        name: 'yandex',
        baseUrl: env.YANDEX_BASE_URL ?? 'https://llm.api.cloud.yandex.net/v1',
        apiKey: required(env, 'YANDEX_API_KEY'),
        mapModel: env.YANDEX_MAP_MODEL ?? `gpt://${folder}/yandexgpt-lite/latest`,
        synthModel: env.YANDEX_SYNTH_MODEL ?? `gpt://${folder}/yandexgpt/latest`,
        extraHeaders: { 'OpenAI-Project': folder },
        // AI Studio allows 5 concurrent completions per cloud by default; keep one spare.
        concurrency: positiveInt(env.YANDEX_CONCURRENCY) ?? 4,
      });
    }

    case 'openai-compatible':
      return new OpenAiCompatibleProvider({
        name: env.LLM_NAME ?? 'openai-compatible',
        baseUrl: required(env, 'LLM_BASE_URL'),
        apiKey: env.LLM_API_KEY,
        mapModel: required(env, 'LLM_MAP_MODEL'),
        synthModel: env.LLM_SYNTH_MODEL ?? required(env, 'LLM_MAP_MODEL'),
        concurrency: positiveInt(env.LLM_CONCURRENCY),
      });

    default:
      throw new Error(
        `Неизвестный LLM_PROVIDER: ${provider} (vireonix | yandex | openai-compatible)`,
      );
  }
}

function positiveInt(value: string | undefined): number | undefined {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

const SETTING_NAMES: Record<string, string> = {
  YANDEX_API_KEY: 'API-ключ Yandex',
  YANDEX_FOLDER_ID: 'ID каталога Yandex Cloud',
};

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) {
    const name = SETTING_NAMES[key];
    throw new Error(
      name
        ? `Не задан ${name} — укажите его в «Настройках» (или ${key} в .env)`
        : `Не задана переменная окружения ${key} — укажите её в .env (см. .env.example)`,
    );
  }
  return value;
}
