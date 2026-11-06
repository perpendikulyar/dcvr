import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AnalysisResult, PublicationsPage, Upload } from '@dcvr/shared';
import { buildApp } from '../src/app.js';
import { openDb } from '../src/db/index.js';
import type { ChatMessage, LlmProvider } from '../src/ai/llm.js';
import { extractJson } from '../src/ai/json.js';
import { audienceScores } from '../src/ai/score.js';
import { prefilter } from '../src/ai/pipeline.js';
import { mapSchema } from '../src/ai/prompts.js';
import { ANALYSIS } from '../src/ai/audience.js';
import { createUpload } from '../src/repo/uploads.js';
import { parsePublicationsCsv } from '../src/csv/parse.js';
import { loadSample } from './sample.js';

/**
 * Deterministic stand-in for an LLM: recognises each pipeline prompt and answers
 * from the rows it contains. `failMapCalls` makes the first N map calls answer
 * without JSON; `downAfter` makes every map call after that many successes throw
 * (an outage); `refuseTitle` / `refuseSynth` make the model refuse (moderation)
 * any request that contains that text.
 */
class FakeProvider implements LlmProvider {
  readonly name = 'fake';
  readonly mapModel = 'fake-map';
  readonly synthModel = 'fake-synth';
  calls = { map: 0, reduce: 0, synth: 0 };
  invalidJsonOnce = true;

  downAfter = Infinity;
  refuseTitle: string | null = null;
  refuseSynth: string | null = null;
  refuseHeadlines = false;
  headlineCalls = 0;

  constructor(public failMapCalls = 0) {}

  async complete(messages: ChatMessage[]): Promise<string> {
    const prompt = messages.filter((m) => m.role === 'user')[0]!.content;

    if (prompt.startsWith('Разметь публикации')) {
      this.calls.map++;
      if (this.failMapCalls > 0) {
        this.failMapCalls--;
        return 'Сервис перегружен';
      }
      if (this.downAfter <= 0) throw new Error('provider down');
      this.downAfter--;
      if (this.refuseTitle && prompt.includes(this.refuseTitle)) {
        return 'Я не могу обсуждать эту тему. Давайте поговорим о чём-нибудь ещё.';
      }
      // A first reply with broken JSON exercises the correction retry.
      if (this.invalidJsonOnce && messages.length === 2) {
        this.invalidJsonOnce = false;
        return '{"items": [';
      }
      const rows = prompt
        .split('Публикации:\n')[1]!
        .split('\n\nВерни JSON')[0]!
        .split('\n')
        .map((line) => line.split(' | '));
      const items = rows.map(([n, category, title]) => {
        const text = `${category} ${title}`.toLowerCase();
        if (/рецепт|печенье|food & drink/.test(text)) {
          return {
            n: Number(n),
            relevant: true,
            label: 'Рецепты',
            interests: ['Кулинария', 'Здоровое питание', 'Космос'],
          };
        }
        if (/home & garden/.test(text))
          return { n: Number(n), relevant: true, label: 'дача и сад', interests: ['декор'] };
        return { n: Number(n), relevant: false };
      });
      return '```json\n' + JSON.stringify({ items }) + '\n```';
    }

    if (prompt.includes('Объедини в группы')) {
      this.calls.reduce++;
      // First pass: nothing to merge. Cross-chunk pass: always broken, which must not fail the run.
      if (prompt.startsWith('Ниже темы')) return '{"groups": [';
      return JSON.stringify({ groups: [] });
    }

    if (prompt.includes('заголовков UGC-материалов')) {
      if (this.refuseHeadlines) return 'Я не могу обсуждать эту тему.';
      const call = ++this.headlineCalls;
      // The second call repeats one headline, which must be dropped as a duplicate.
      return JSON.stringify({
        headlines: [
          { title: `Как я готовлю по рецепту №${call}`, pitch: 'Личная история' },
          { title: `5 идей для ужина, вариант ${call}`, pitch: 'Подборка' },
          { title: 'Мы с семьёй печём печенье каждые выходные', pitch: '' },
        ],
      });
    }

    this.calls.synth++;
    const section = prompt.split('Темы для разбора:')[1]!.split('Общий список тем')[0]!;
    if (this.refuseSynth && section.includes(this.refuseSynth)) {
      return 'Я не могу обсуждать эту тему.';
    }
    const ids = [...section.matchAll(/^\[(\d+)\]/gm)].map((m) => Number(m[1]));
    return JSON.stringify({
      topics: ids.map((id) => ({
        id,
        title: `Инсайт ${id}`,
        whyTrending: 'Сезон',
        interestsReason: 'Кулинария',
        ideas: [{ title: 'Идея', format: 'рецепт', angle: 'просто', hook: 'поделитесь' }],
        related: ids.filter((x) => x !== id).map((x) => ({ id: x, why: 'рядом' })),
      })),
    });
  }
}

let provider = new FakeProvider();
const db = openDb(':memory:');
const app = await buildApp(db, { provider: () => provider });
let upload: Upload;

async function waitForRun(uploadId: number): Promise<AnalysisResult> {
  for (;;) {
    const result: AnalysisResult = (await app.inject(`/api/uploads/${uploadId}/analysis`)).json();
    if (result.run.status === 'done' || result.run.status === 'failed') return result;
    await new Promise((r) => setTimeout(r, 20));
  }
}

beforeAll(() => {
  upload = createUpload(db, 'sample.csv', parsePublicationsCsv(loadSample()));
});

afterAll(async () => {
  await app.close();
  db.close();
});

describe('helpers', () => {
  it('extracts JSON from fenced or chatty replies', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Вот ответ: {"a":[1,2]} — готово')).toEqual({ a: [1, 2] });
    expect(() => extractJson('нет json')).toThrow();
  });

  it('accepts a bare array instead of the wrapping object', () => {
    expect(mapSchema.parse([{ n: 1, relevant: false }])).toEqual({
      items: [{ n: 1, relevant: false, interests: [] }],
    });
    expect(mapSchema.parse([{ n: 1, relevant: false, label: null, interests: null }])).toEqual({
      items: [{ n: 1, relevant: false, label: null, interests: [] }],
    });
  });

  it('maps interest names to ids, ignoring case and unknown names', () => {
    const parsed = mapSchema.parse({
      items: [
        { n: 1, relevant: true, label: 'x', interests: ['кулинария', 'Космос', 'Отношения'] },
      ],
    });
    expect(parsed.items[0]!.interests).toEqual([21, 1]);
  });

  it('scores higher-ranked interests and bigger reach higher', () => {
    const stats = (interest: number, impressions: number) => ({
      publications: 10,
      impressions,
      interestCounts: new Map([[interest, 10]]),
    });
    const [relations, animals, none] = audienceScores([
      stats(1, 1000),
      stats(30, 1000),
      { publications: 10, impressions: 1_000_000, interestCounts: new Map() },
    ]);
    expect(relations).toBeGreaterThan(animals!);
    expect(none).toBe(0);
  });

  it('prefilter drops excluded categories but keeps uncategorized rows', () => {
    const rows = prefilter(db, upload.id);
    expect(rows.some((r) => r.category === null)).toBe(true);
    expect(rows.some((r) => r.category?.startsWith('/Sports'))).toBe(false);
    expect(rows.some((r) => r.category?.startsWith('/Law & Government'))).toBe(false);
    expect(rows.some((r) => r.category === '/News/Weather')).toBe(true);
  });
});

describe('analysis pipeline', () => {
  it('returns null before the first run', async () => {
    expect((await app.inject(`/api/uploads/${upload.id}/analysis`)).json()).toBeNull();
  });

  it('runs end to end and produces ranked topics with ideas', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/uploads/${upload.id}/analysis` });
    expect(res.statusCode).toBe(202);

    const result = await waitForRun(upload.id);
    expect(result.run).toMatchObject({ status: 'done', step: 'done', provider: 'fake' });
    expect(result.topics.length).toBe(2);
    expect(result.topics.map((t) => t.rank)).toEqual([1, 2]);

    const [first] = result.topics;
    expect(first).toMatchObject({ title: expect.stringMatching(/^Инсайт/), whyTrending: 'Сезон' });
    expect(first!.ideas).toHaveLength(1);
    expect(first!.related[0]).toMatchObject({ title: expect.stringMatching(/^Инсайт/) });
    expect(first!.interests.length).toBeGreaterThan(0);

    const cooking = result.coverage.find((c) => c.name === 'Кулинария')!;
    expect(cooking.topics).toBe(1);
    expect(result.coverage).toHaveLength(30);
  });

  it('generates headlines for an idea and adds more on request', async () => {
    const { topics }: AnalysisResult = (
      await app.inject(`/api/uploads/${upload.id}/analysis`)
    ).json();
    const topic = topics[0]!;
    const url = `/api/topics/${topic.id}/ideas/0/headlines`;

    const first = await app.inject({ method: 'POST', url });
    expect(first.statusCode).toBe(200);
    expect(first.json().headlines).toHaveLength(3);

    const second = await app.inject({ method: 'POST', url });
    const all = second.json().headlines as { title: string }[];
    // Two new ones in front; the repeated headline is not added twice.
    expect(all.map((h) => h.title)).toEqual([
      'Как я готовлю по рецепту №2',
      '5 идей для ужина, вариант 2',
      'Как я готовлю по рецепту №1',
      '5 идей для ужина, вариант 1',
      'Мы с семьёй печём печенье каждые выходные',
    ]);

    const result: AnalysisResult = (await app.inject(`/api/uploads/${upload.id}/analysis`)).json();
    expect(result.topics[0]!.ideas[0]!.headlines).toHaveLength(5);
    expect(result.topics[0]!.ideas[1]?.headlines ?? []).toEqual([]);
  });

  it('reports a missing idea and a refused headline request', async () => {
    const { topics }: AnalysisResult = (
      await app.inject(`/api/uploads/${upload.id}/analysis`)
    ).json();
    const missing = await app.inject({
      method: 'POST',
      url: `/api/topics/${topics[0]!.id}/ideas/99/headlines`,
    });
    expect(missing.statusCode).toBe(404);

    provider.refuseHeadlines = true;
    const refused = await app.inject({
      method: 'POST',
      url: `/api/topics/${topics[0]!.id}/ideas/0/headlines`,
    });
    provider.refuseHeadlines = false;
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error).toMatch(/отказалась/);
  });

  it('filters publications by topic', async () => {
    const { topics }: AnalysisResult = (
      await app.inject(`/api/uploads/${upload.id}/analysis`)
    ).json();
    const topic = topics[0]!;
    const page: PublicationsPage = (
      await app.inject(`/api/uploads/${upload.id}/publications?topic=${topic.id}&pageSize=200`)
    ).json();
    expect(page.total).toBe(topic.publications);
  });

  it('recovers from a one-off batch failure by splitting the batch', async () => {
    provider = new FakeProvider(1);
    provider.invalidJsonOnce = false;
    await app.inject({ method: 'POST', url: `/api/uploads/${upload.id}/analysis` });
    const result = await waitForRun(upload.id);
    expect(result.run.status).toBe('done');
    expect(result.topics.length).toBe(2);
  });

  it('resumes a failed run without relabelling finished batches', async () => {
    provider = new FakeProvider();
    provider.invalidJsonOnce = false;
    provider.downAfter = 5;
    await app.inject({ method: 'POST', url: `/api/uploads/${upload.id}/analysis` });

    const failed = await waitForRun(upload.id);
    expect(failed.run.status).toBe('failed');
    expect(failed.run.error).toMatch(/provider down/);
    const { progressDone: labelledBefore, progressTotal: candidates } = failed.run;
    expect(labelledBefore).toBeGreaterThan(0);

    provider.downAfter = Infinity;
    const callsBefore = provider.calls.map;
    const res = await app.inject({ method: 'POST', url: `/api/analysis/${failed.run.id}/resume` });
    expect(res.statusCode).toBe(202);

    const resumed = await waitForRun(upload.id);
    expect(resumed.run.status).toBe('done');
    expect(resumed.run.id).toBe(failed.run.id);
    // Only the batches that were not saved before the failure are sent again.
    expect(candidates).toBe(prefilter(db, upload.id).length);
    expect(provider.calls.map - callsBefore).toBe(
      Math.ceil((candidates - labelledBefore) / ANALYSIS.mapBatchSize),
    );
  });

  it('skips a publication the model refuses and still finishes the run', async () => {
    const refused = prefilter(db, upload.id).find((c) => /рецепт/i.test(c.title))!;
    provider = new FakeProvider();
    provider.invalidJsonOnce = false;
    provider.refuseTitle = refused.title;
    await app.inject({ method: 'POST', url: `/api/uploads/${upload.id}/analysis` });

    const result = await waitForRun(upload.id);
    expect(result.run).toMatchObject({ status: 'done', skipped: 1, partial: false });
    const label = db
      .prepare(
        'SELECT skipped, skip_reason FROM ai_item_labels WHERE run_id = ? AND publication_id = ?',
      )
      .get(result.run.id, refused.id) as { skipped: number; skip_reason: string };
    expect(label.skipped).toBe(1);
    expect(label.skip_reason).toMatch(/отказалась/);
    expect(result.topics.length).toBe(2);
  });

  it('keeps a topic without insights when the model refuses to describe it', async () => {
    provider = new FakeProvider();
    provider.invalidJsonOnce = false;
    provider.refuseSynth = 'дача и сад';
    await app.inject({ method: 'POST', url: `/api/uploads/${upload.id}/analysis` });

    const result = await waitForRun(upload.id);
    expect(result.run.status).toBe('done');
    const refused = result.topics.find((t) => t.synthError);
    const described = result.topics.find((t) => !t.synthError);
    expect(refused).toMatchObject({ title: 'дача и сад', whyTrending: null, ideas: [] });
    expect(described!.ideas.length).toBeGreaterThan(0);
  });

  it('finishes a failed run with what has been processed', async () => {
    provider = new FakeProvider();
    provider.invalidJsonOnce = false;
    provider.downAfter = 5;
    await app.inject({ method: 'POST', url: `/api/uploads/${upload.id}/analysis` });
    const failed = await waitForRun(upload.id);
    expect(failed.run.status).toBe('failed');

    const callsBefore = provider.calls.map;
    const res = await app.inject({ method: 'POST', url: `/api/analysis/${failed.run.id}/finish` });
    expect(res.statusCode).toBe(202);

    const finished = await waitForRun(upload.id);
    expect(finished.run).toMatchObject({ id: failed.run.id, status: 'done', partial: true });
    expect(finished.run.skipped).toBe(failed.run.progressTotal - failed.run.progressDone);
    // Nothing pending is sent to the model again.
    expect(provider.calls.map).toBe(callsBefore);
    expect(finished.topics.length).toBeGreaterThan(0);
  });
});
