import fs from 'node:fs';
import Fastify, { type FastifyServerOptions } from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import { config } from './config.js';
import type { Db } from './db/index.js';
import { uploadRoutes } from './routes/uploads.js';
import { analysisRoutes } from './routes/analysis.js';
import { AnalysisRunner } from './ai/runner.js';
import { providerFromEnv, type LlmProvider } from './ai/llm.js';

export interface AppOptions {
  server?: FastifyServerOptions;
  /** LLM provider factory; defaults to the one configured in the environment. */
  provider?: () => LlmProvider;
}

export async function buildApp(db: Db, opts: AppOptions = {}) {
  const app = Fastify(opts.server);
  const runner = new AnalysisRunner(db, opts.provider ?? (() => providerFromEnv()), app.log);
  app.addHook('onClose', async () => runner.stopAll());

  await app.register(multipart, { limits: { fileSize: config.maxUploadBytes, files: 1 } });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'Некорректные параметры запроса', details: err.issues });
    }
    const { statusCode: status = 500, message } = err as { statusCode?: number; message?: string };
    if (status >= 500) req.log.error(err);
    return reply
      .code(status)
      .send({ error: status >= 500 ? 'Внутренняя ошибка сервера' : message });
  });

  app.get('/api/health', async () => ({ ok: true }));
  await app.register(uploadRoutes(db), { prefix: '/api' });
  await app.register(analysisRoutes(db, runner), { prefix: '/api' });

  // Production: serve the built SPA. In dev, Vite serves it and proxies /api here.
  if (fs.existsSync(config.webDist)) {
    await app.register(fastifyStatic, { root: config.webDist });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith('/api/')
        ? reply.code(404).send({ error: 'Not found' })
        : reply.sendFile('index.html'),
    );
  }

  return app;
}
