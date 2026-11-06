import type { z } from 'zod';
import type { ChatMessage, CompleteOptions, LlmProvider } from './llm.js';

/**
 * The model answered, but not with usable data: invalid/truncated JSON or a
 * refusal (moderation). Unlike transport errors this depends on the input, so
 * callers retry with a smaller input instead of failing the run.
 */
export class ModelOutputError extends Error {
  constructor(
    message: string,
    /** The reply has no JSON at all — typically "Я не могу обсуждать эту тему". */
    readonly refused: boolean,
  ) {
    super(message);
  }
}

class NoJsonError extends Error {}

/** Pulls a JSON value out of a model reply that may wrap it in prose or ``` fences. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = (fenced?.[1] ?? text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.search(/[[{]/);
    const end = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'));
    if (start === -1 || end <= start) throw new NoJsonError('В ответе нет JSON');
    return JSON.parse(candidate.slice(start, end + 1));
  }
}

/**
 * Asks for JSON matching `schema`. On unparsable or invalid output, re-asks with
 * the validation error so the model can correct itself. A refusal (no JSON at all)
 * is not retried: the same input gets the same answer.
 */
export async function completeJson<T>(
  provider: LlmProvider,
  messages: ChatMessage[],
  schema: z.ZodType<T>,
  opts: CompleteOptions,
  maxAttempts = 3,
): Promise<T> {
  const conversation = [...messages];
  let lastError = '';
  let lastReply = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const reply = await provider.complete(conversation, opts);
    lastReply = reply;
    try {
      const result = schema.safeParse(extractJson(reply));
      if (result.success) return result.data;
      lastError = result.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
    } catch (err) {
      lastError = (err as Error).message;
      if (err instanceof NoJsonError) {
        throw new ModelOutputError(`Модель отказалась отвечать: ${sample(reply)}`, true);
      }
    }
    conversation.push(
      { role: 'assistant', content: reply.slice(0, 4000) },
      {
        role: 'user',
        content: `Ответ не прошёл проверку: ${lastError}. Верни исправленный ответ — только JSON по заданной схеме, без пояснений.`,
      },
    );
  }
  throw new ModelOutputError(
    `Модель вернула невалидный JSON после ${maxAttempts} попыток: ${lastError}. Начало ответа: ${sample(lastReply)}`,
    false,
  );
}

function sample(reply: string): string {
  return reply.replace(/\s+/g, ' ').trim().slice(0, 200);
}
