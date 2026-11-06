import type { FastifyPluginAsync } from 'fastify';
import type { SortField } from '@dcvr/shared';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { CsvFormatError, parsePublicationsCsv } from '../csv/parse.js';
import { createUpload, deleteUpload, listUploads, uploadExists } from '../repo/uploads.js';
import { getFacets, listPublications } from '../repo/publications.js';

const SORT_FIELDS = [
  'impressions',
  'title',
  'publisher',
  'category',
] as const satisfies SortField[];

/** `?a=x` arrives as a string, `?a=x&a=y` as an array. */
const stringList = z.preprocess(
  (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]),
  z.array(z.string().min(1)),
);

const idParams = z.object({ id: z.coerce.number().int().positive() });

const filtersQuery = z.object({
  publisher: stringList,
  category: stringList,
  topic: z.coerce.number().int().positive().optional(),
});

const listQuery = filtersQuery.extend({
  sort: z.enum(SORT_FIELDS).default('impressions'),
  order: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export function uploadRoutes(db: Db): FastifyPluginAsync {
  return async (app) => {
    app.get('/uploads', async () => listUploads(db));

    app.post('/uploads', async (req, reply) => {
      const file = await req.file();
      if (!file) return reply.code(400).send({ error: 'Файл не передан' });
      if (!file.filename.toLowerCase().endsWith('.csv')) {
        return reply.code(400).send({ error: 'Поддерживаются только файлы .csv' });
      }

      const buffer = await file.toBuffer();
      try {
        const records = parsePublicationsCsv(buffer);
        if (!records.length) return reply.code(400).send({ error: 'В файле нет строк с данными' });
        return reply.code(201).send(createUpload(db, file.filename, records));
      } catch (err) {
        if (err instanceof CsvFormatError) return reply.code(400).send({ error: err.message });
        throw err;
      }
    });

    app.delete('/uploads/:id', async (req, reply) => {
      const { id } = idParams.parse(req.params);
      if (!deleteUpload(db, id)) return reply.code(404).send({ error: 'Загрузка не найдена' });
      return reply.code(204).send();
    });

    app.get('/uploads/:id/publications', async (req, reply) => {
      const { id } = idParams.parse(req.params);
      if (!uploadExists(db, id)) return reply.code(404).send({ error: 'Загрузка не найдена' });
      return listPublications(db, id, listQuery.parse(req.query));
    });

    app.get('/uploads/:id/facets', async (req, reply) => {
      const { id } = idParams.parse(req.params);
      if (!uploadExists(db, id)) return reply.code(404).send({ error: 'Загрузка не найдена' });
      return getFacets(db, id, filtersQuery.parse(req.query));
    });
  };
}
