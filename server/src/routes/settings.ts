import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { LlmProvider } from '../ai/llm.js';
import type { SettingsStore } from '../settings.js';

const updateBody = z.object({
  yandexApiKey: z.string().max(500).optional(),
  yandexFolderId: z.string().max(100).optional(),
});

export function settingsRoutes(
  store: SettingsStore,
  provider: () => LlmProvider,
): FastifyPluginAsync {
  return async (app) => {
    app.get('/settings', async () => store.view());

    app.put('/settings', async (req) => {
      store.update(updateBody.parse(req.body));
      return store.view();
    });

    /** Sends a tiny request with the saved settings to check the key and folder. */
    app.post('/settings/test', async (req, reply) => {
      try {
        const llm = provider();
        await llm.complete([{ role: 'user', content: 'Ответь одним словом: готово' }], {
          model: llm.mapModel,
          maxTokens: 10,
          signal: AbortSignal.timeout(30_000),
        });
        return { ok: true, provider: llm.name };
      } catch (err) {
        return reply.code(502).send({ error: (err as Error).message.slice(0, 500) });
      }
    });
  };
}
