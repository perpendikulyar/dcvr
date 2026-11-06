import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import type { AnalysisRunner } from '../ai/runner.js';
import { generateHeadlines, IdeaNotFoundError } from '../ai/headlines.js';
import { ModelOutputError } from '../ai/json.js';
import { getResult, getRun, latestRun } from '../repo/analysis.js';
import { uploadExists } from '../repo/uploads.js';

const idParams = z.object({ id: z.coerce.number().int().positive() });
const ideaParams = idParams.extend({ index: z.coerce.number().int().min(0) });

export function analysisRoutes(db: Db, runner: AnalysisRunner): FastifyPluginAsync {
  return async (app) => {
    /** Latest run of the upload with its results; `null` if never analysed. */
    app.get('/uploads/:id/analysis', async (req, reply) => {
      const { id } = idParams.parse(req.params);
      if (!uploadExists(db, id)) return reply.code(404).send({ error: 'Загрузка не найдена' });
      const run = latestRun(db, id);
      return run ? getResult(db, run) : null;
    });

    app.post('/uploads/:id/analysis', async (req, reply) => {
      const { id } = idParams.parse(req.params);
      if (!uploadExists(db, id)) return reply.code(404).send({ error: 'Загрузка не найдена' });
      const current = latestRun(db, id);
      if (current && runner.isActive(current.id)) {
        return reply.code(409).send({ error: 'Анализ уже выполняется' });
      }
      let runId: number;
      try {
        runId = runner.start(id);
      } catch (err) {
        // Provider misconfiguration (e.g. missing API key) — show it to the user as is.
        return reply.code(503).send({ error: (err as Error).message });
      }
      return reply.code(202).send(getRun(db, runId));
    });

    app.post('/analysis/:id/resume', async (req, reply) => {
      const { id } = idParams.parse(req.params);
      const run = getRun(db, id);
      if (!run) return reply.code(404).send({ error: 'Анализ не найден' });
      if (run.status !== 'failed') {
        return reply.code(409).send({ error: 'Продолжить можно только прерванный анализ' });
      }
      runner.resume(id);
      return reply.code(202).send(getRun(db, id));
    });

    /** Generates more headlines for a content idea; returns all saved ones, newest first. */
    app.post('/topics/:id/ideas/:index/headlines', async (req, reply) => {
      const { id, index } = ideaParams.parse(req.params);
      try {
        return { headlines: await generateHeadlines(db, runner.provider(), id, index) };
      } catch (err) {
        if (err instanceof IdeaNotFoundError) return reply.code(404).send({ error: err.message });
        if (err instanceof ModelOutputError) return reply.code(422).send({ error: err.message });
        // Transport or configuration problems with the provider.
        return reply.code(502).send({ error: (err as Error).message });
      }
    });

    /** Finish a failed run with what's processed, skipping the rest. */
    app.post('/analysis/:id/finish', async (req, reply) => {
      const { id } = idParams.parse(req.params);
      const run = getRun(db, id);
      if (!run) return reply.code(404).send({ error: 'Анализ не найден' });
      if (run.status !== 'failed') {
        return reply.code(409).send({ error: 'Завершить можно только прерванный анализ' });
      }
      runner.finish(id);
      return reply.code(202).send(getRun(db, id));
    });
  };
}
