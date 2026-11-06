import type { AnalysisStep } from '@dcvr/shared';
import { transaction, type Db } from '../db/index.js';
import { ANALYSIS, EXCLUDED_CATEGORIES, INTERESTS, interestName } from './audience.js';
import { completeJson, ModelOutputError } from './json.js';
import type { LlmProvider } from './llm.js';
import {
  groupsSchema,
  mapPrompt,
  mapSchema,
  mergePrompt,
  type MapResult,
  reducePrompt,
  type GroupsResult,
  synthPrompt,
  synthSchema,
  type SynthTopic,
} from './prompts.js';
import { audienceScores, topicInterests, type TopicStats } from './score.js';

interface Candidate {
  id: number;
  title: string;
  category: string | null;
  summary: string | null;
}

/**
 * Runs (or resumes) an analysis. Every step persists its output, so a failed
 * run continues where it stopped: labelled rows and synthesized topics are kept.
 */
export async function runPipeline(
  db: Db,
  runId: number,
  provider: LlmProvider,
  signal?: AbortSignal,
): Promise<void> {
  const { upload_id: uploadId, partial } = db
    .prepare('SELECT upload_id, partial FROM ai_runs WHERE id = ?')
    .get(runId) as { upload_id: number; partial: number };
  // "Finish with what's processed": no new LLM calls for rows/topics still pending.
  const finishPartial = partial === 1;

  db.prepare(`UPDATE ai_runs SET status = 'running', error = NULL WHERE id = ?`).run(runId);

  setStep(db, runId, 'prefilter');
  const candidates = prefilter(db, uploadId);

  await mapStep(db, runId, provider, candidates, finishPartial, signal);

  // Reduce/score are cheap to redo; only skip them if synthesis already started.
  const hasTopics = db.prepare('SELECT 1 FROM ai_topics WHERE run_id = ?').get(runId);
  if (!hasTopics) {
    setStep(db, runId, 'reduce');
    const topics = await reduceStep(db, runId, provider, finishPartial, signal);
    setStep(db, runId, 'score');
    scoreStep(db, runId, topics);
  }

  await synthStep(db, runId, provider, finishPartial, signal);

  db.prepare(`UPDATE ai_runs SET status = 'done', step = 'done', finished_at = ? WHERE id = ?`).run(
    new Date().toISOString(),
    runId,
  );
}

function setStep(db: Db, runId: number, step: AnalysisStep, done = 0, total = 0) {
  db.prepare('UPDATE ai_runs SET step = ?, progress_done = ?, progress_total = ? WHERE id = ?').run(
    step,
    done,
    total,
    runId,
  );
}

function setProgress(db: Db, runId: number, done: number) {
  db.prepare('UPDATE ai_runs SET progress_done = ? WHERE id = ?').run(done, runId);
}

// ---------- Prefilter ----------

export function prefilter(db: Db, uploadId: number): Candidate[] {
  const excluded = EXCLUDED_CATEGORIES.map(() => `(category = ? OR category LIKE ? || '/%')`);
  return db
    .prepare(
      `SELECT id, title, category, summary FROM publications
       WHERE upload_id = ? AND (category IS NULL OR NOT (${excluded.join(' OR ')}))
       ORDER BY impressions DESC, id`,
    )
    .all(uploadId, ...EXCLUDED_CATEGORIES.flatMap((c) => [c, c])) as unknown as Candidate[];
}

// ---------- Map ----------

async function mapStep(
  db: Db,
  runId: number,
  provider: LlmProvider,
  candidates: Candidate[],
  finishPartial: boolean,
  signal?: AbortSignal,
) {
  const labelled = new Set(
    (
      db.prepare('SELECT publication_id AS id FROM ai_item_labels WHERE run_id = ?').all(runId) as {
        id: number;
      }[]
    ).map((r) => r.id),
  );
  const pending = candidates.filter((c) => !labelled.has(c.id));
  let done = candidates.length - pending.length;
  setStep(db, runId, 'map', done, candidates.length);

  const insert = db.prepare(
    `INSERT OR REPLACE INTO ai_item_labels
       (run_id, publication_id, relevant, label, interests_json, skipped, skip_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  if (finishPartial) {
    transaction(db, () => {
      for (const c of pending)
        insert.run(runId, c.id, 0, null, '[]', 1, 'Пропущено при завершении');
    });
    setProgress(db, runId, candidates.length);
    return;
  }

  type Part = { items: Candidate[]; result: MapResult } | { items: Candidate[]; skip: string };

  // A batch the model can't answer (truncated JSON, or a refusal triggered by
  // one of its rows) is split in half until the offending row is isolated and
  // skipped. Transport errors are not split: the provider already retried them.
  const labelBatch = async (batch: Candidate[]): Promise<Part[]> => {
    const items = batch.map((c, i) => ({ n: i + 1, ...c }));
    try {
      const result = await completeJson(provider, mapPrompt(items), mapSchema, {
        model: provider.mapModel,
        temperature: 0.2,
        maxTokens: 6000,
        signal,
      });
      return [{ items: batch, result }];
    } catch (err) {
      if (signal?.aborted || !(err instanceof ModelOutputError)) throw err;
      if (batch.length === 1) return [{ items: batch, skip: err.message.slice(0, 500) }];
      const half = Math.ceil(batch.length / 2);
      return [
        ...(await labelBatch(batch.slice(0, half))),
        ...(await labelBatch(batch.slice(half))),
      ];
    }
  };

  await pool(
    chunk(pending, ANALYSIS.mapBatchSize),
    provider.concurrency ?? ANALYSIS.concurrency,
    async (batch) => {
      for (const part of await labelBatch(batch)) {
        if ('skip' in part) {
          insert.run(runId, part.items[0]!.id, 0, null, '[]', 1, part.skip);
        } else {
          save(part.items, part.result);
        }
      }
      done += batch.length;
      setProgress(db, runId, done);
    },
  );

  function save(batch: Candidate[], result: MapResult) {
    const items = batch.map((c, i) => ({ n: i + 1, ...c }));
    const byN = new Map(result.items.map((r) => [r.n, r]));

    transaction(db, () => {
      for (const item of items) {
        const r = byN.get(item.n);
        // Rows the model skipped are stored as irrelevant so a resume doesn't loop on them.
        const label = r?.relevant ? normalizeLabel(r.label) : null;
        const interests = [...new Set(r?.interests ?? [])];
        const json = JSON.stringify(label ? interests : []);
        insert.run(runId, item.id, label ? 1 : 0, label, json, 0, null);
      }
    });
  }
}

function normalizeLabel(label: string | null | undefined): string | null {
  const value = label
    ?.trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.«»"]/g, '');
  return value || null;
}

// ---------- Reduce ----------

interface DraftTopic {
  title: string;
  labels: string[];
  count: number;
}

/**
 * Two-pass merge. Map labels are nearly unique, and asking for a full mapping of
 * hundreds of them gets truncated, so the model only returns groups to merge:
 * first within interest-ordered chunks, then across the chunks' results.
 */
async function reduceStep(
  db: Db,
  runId: number,
  provider: LlmProvider,
  finishPartial: boolean,
  signal?: AbortSignal,
): Promise<DraftTopic[]> {
  const rows = db
    .prepare(
      `SELECT label, interests_json AS interests FROM ai_item_labels
       WHERE run_id = ? AND relevant = 1`,
    )
    .all(runId) as { label: string; interests: string }[];
  if (!rows.length) throw new Error('Модель не нашла ни одной подходящей публикации');

  // Label → publication count and its most common interest (0 = none).
  const stats = new Map<string, { count: number; interests: Map<number, number> }>();
  for (const r of rows) {
    const s = stats.get(r.label) ?? { count: 0, interests: new Map() };
    s.count++;
    for (const id of JSON.parse(r.interests) as number[]) {
      s.interests.set(id, (s.interests.get(id) ?? 0) + 1);
    }
    stats.set(r.label, s);
  }
  const primary = (s: { interests: Map<number, number> }) =>
    [...s.interests].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? INTERESTS.length + 1;

  const labels: DraftTopic[] = [...stats]
    .sort(([a, sa], [b, sb]) => primary(sa) - primary(sb) || a.localeCompare(b))
    .map(([label, s]) => ({ title: label, labels: [label], count: s.count }));

  const opts = { model: provider.synthModel, temperature: 0.2, maxTokens: 6000, signal };

  let drafts: DraftTopic[] = [];
  // A chunk the model can't answer is split in half and retried; a small chunk
  // that still fails stays unmerged. Finishing a run partially tolerates any error.
  const reduceChunk = async (part: DraftTopic[]): Promise<DraftTopic[]> => {
    const items = part.map((d, i) => ({ n: i + 1, label: d.title, count: d.count }));
    try {
      const result = await completeJson(provider, reducePrompt(items), groupsSchema, opts);
      return applyGroups(part, result.groups);
    } catch (err) {
      if (signal?.aborted) throw err;
      if (!(err instanceof ModelOutputError) && !finishPartial) throw err;
      if (part.length <= ANALYSIS.reduceMinChunk || !(err instanceof ModelOutputError)) {
        return part;
      }
      const half = Math.ceil(part.length / 2);
      return [
        ...(await reduceChunk(part.slice(0, half))),
        ...(await reduceChunk(part.slice(half))),
      ];
    }
  };
  await pool(
    chunk(labels, ANALYSIS.reduceChunkSize),
    provider.concurrency ?? ANALYSIS.concurrency,
    async (part) => {
      drafts.push(...(await reduceChunk(part)));
    },
  );

  // The cross-chunk pass is an improvement, not a requirement: keep pass-one topics if it fails.
  if (drafts.length > 1) {
    drafts.sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
    const items = drafts.map((d, i) => ({ n: i + 1, label: d.title, count: d.count }));
    try {
      const result = await completeJson(provider, mergePrompt(items), groupsSchema, opts);
      drafts = applyGroups(drafts, result.groups);
    } catch (err) {
      if (signal?.aborted) throw err;
    }
  }
  return drafts;
}

/** Merges `items` per 1-based `groups`; items not in any group are kept as they are. */
function applyGroups(items: DraftTopic[], groups: GroupsResult['groups']): DraftTopic[] {
  const used = new Set<number>();
  const out: DraftTopic[] = [];
  for (const g of groups) {
    const members = [...new Set(g.items)].filter(
      (n) => n >= 1 && n <= items.length && !used.has(n),
    );
    if (!members.length) continue;
    members.forEach((n) => used.add(n));
    const merged = members.map((n) => items[n - 1]!);
    out.push({
      title: members.length > 1 ? g.title : merged[0]!.title,
      labels: merged.flatMap((m) => m.labels),
      count: merged.reduce((s, m) => s + m.count, 0),
    });
  }
  items.forEach((item, i) => !used.has(i + 1) && out.push(item));
  return out;
}

// ---------- Score ----------

function scoreStep(db: Db, runId: number, drafts: DraftTopic[]) {
  const rows = db
    .prepare(
      `SELECT l.publication_id AS id, l.label, l.interests_json AS interests, p.impressions, p.publisher
       FROM ai_item_labels l JOIN publications p ON p.id = l.publication_id
       WHERE l.run_id = ? AND l.relevant = 1`,
    )
    .all(runId) as {
    id: number;
    label: string;
    interests: string;
    impressions: number | null;
    publisher: string | null;
  }[];

  const byLabel = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byLabel.get(r.label);
    if (list) list.push(r);
    else byLabel.set(r.label, [r]);
  }
  const topics = drafts.map((d) => {
    const items = d.labels.flatMap((l) => byLabel.get(l) ?? []);
    const interestCounts = new Map<number, number>();
    for (const item of items) {
      for (const id of JSON.parse(item.interests) as number[]) {
        interestCounts.set(id, (interestCounts.get(id) ?? 0) + 1);
      }
    }
    const stats: TopicStats = {
      publications: items.length,
      impressions: items.reduce((s, i) => s + (i.impressions ?? 0), 0),
      interestCounts,
    };
    return {
      ...d,
      items,
      stats,
      publishers: new Set(items.map((i) => i.publisher).filter(Boolean)).size,
    };
  });

  const scores = audienceScores(topics.map((t) => t.stats));
  const ranked = topics
    .map((t, i) => ({ ...t, score: scores[i]! }))
    .sort((a, b) => b.score - a.score || b.stats.impressions - a.stats.impressions);

  let rank = 0;
  const insertTopic = db.prepare(
    `INSERT INTO ai_topics (run_id, rank, title, labels_json, interests_json, audience_score,
                            impressions, publications, publishers)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  );
  const insertItem = db.prepare(
    'INSERT INTO ai_topic_items (topic_id, publication_id) VALUES (?, ?)',
  );

  transaction(db, () => {
    for (const t of ranked) {
      const eligible =
        t.score > 0 &&
        t.stats.publications >= ANALYSIS.minTopicPublications &&
        rank < ANALYSIS.topTopics;
      const { id } = insertTopic.get(
        runId,
        eligible ? ++rank : null,
        t.title,
        JSON.stringify(t.labels),
        JSON.stringify(topicInterests(t.stats)),
        t.score,
        t.stats.impressions,
        t.stats.publications,
        t.publishers,
      ) as { id: number };
      for (const item of t.items) insertItem.run(id, item.id);
    }
  });
}

// ---------- Synthesis ----------

async function synthStep(
  db: Db,
  runId: number,
  provider: LlmProvider,
  finishPartial: boolean,
  signal?: AbortSignal,
) {
  const top = db
    .prepare(
      `SELECT id, title, interests_json AS interests, impressions, publications, publishers,
              why_trending IS NOT NULL OR synth_error IS NOT NULL AS done
       FROM ai_topics WHERE run_id = ? AND rank IS NOT NULL ORDER BY rank`,
    )
    .all(runId) as {
    id: number;
    title: string;
    interests: string;
    impressions: number;
    publications: number;
    publishers: number;
    done: number;
  }[];

  const pending = top.filter((t) => !t.done);
  let done = top.length - pending.length;
  setStep(db, runId, 'synth', done, top.length);

  const examples = db.prepare(
    `SELECT p.title, p.summary, p.impressions FROM ai_topic_items ti
     JOIN publications p ON p.id = ti.publication_id
     WHERE ti.topic_id = ? ORDER BY p.impressions DESC LIMIT 8`,
  );
  const catalog = top.map((t) => ({ id: t.id, title: t.title }));
  const topIds = new Set(top.map((t) => t.id));
  const update = db.prepare(
    `UPDATE ai_topics SET title = ?, why_trending = ?, interests_reason = ?, ideas_json = ?, related_json = ?
     WHERE id = ? AND run_id = ?`,
  );
  const markFailed = db.prepare('UPDATE ai_topics SET synth_error = ? WHERE id = ? AND run_id = ?');

  if (finishPartial) {
    for (const t of pending) markFailed.run('Пропущено при завершении', t.id, runId);
    setProgress(db, runId, top.length);
    return;
  }

  type Pending = (typeof pending)[number];

  // Same isolation as in the map step: a refused batch is split down to single
  // topics, and a topic the model still refuses is kept without insights.
  const synthBatch = async (batch: Pending[]): Promise<void> => {
    try {
      await synthesize(batch);
    } catch (err) {
      if (signal?.aborted || !(err instanceof ModelOutputError)) throw err;
      if (batch.length === 1) {
        markFailed.run(err.message.slice(0, 500), batch[0]!.id, runId);
        return;
      }
      const half = Math.ceil(batch.length / 2);
      await synthBatch(batch.slice(0, half));
      await synthBatch(batch.slice(half));
    }
  };

  await pool(
    chunk(pending, ANALYSIS.synthBatchSize),
    provider.concurrency ?? ANALYSIS.concurrency,
    async (batch) => {
      await synthBatch(batch);
      done += batch.length;
      setProgress(db, runId, done);
    },
  );

  async function synthesize(batch: Pending[]) {
    const input: SynthTopic[] = batch.map((t) => ({
      id: t.id,
      title: t.title,
      impressions: t.impressions,
      publications: t.publications,
      publishers: t.publishers,
      interests: (JSON.parse(t.interests) as { id: number }[]).map((i) => interestName(i.id)!),
      examples: examples.all(t.id) as unknown as SynthTopic['examples'],
    }));

    const result = await completeJson(provider, synthPrompt(input, catalog), synthSchema, {
      model: provider.synthModel,
      temperature: 0.7,
      maxTokens: 8000,
      signal,
    });

    const wanted = new Set(batch.map((t) => t.id));
    const answered = result.topics.filter((t) => wanted.has(t.id));
    if (answered.length < batch.length) {
      throw new ModelOutputError(`Синтез вернул ${answered.length} из ${batch.length} тем`, false);
    }

    transaction(db, () => {
      for (const t of answered) {
        const related = (t.related ?? []).filter((r) => r.id !== t.id && topIds.has(r.id));
        const ideas = t.ideas.slice(0, ANALYSIS.ideasPerTopic.max);
        update.run(
          t.title,
          t.whyTrending,
          t.interestsReason,
          JSON.stringify(ideas),
          JSON.stringify(related),
          t.id,
          runId,
        );
      }
    });
  }
}

// ---------- Helpers ----------

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Runs `fn` over items with at most `limit` in flight; the first error rejects. */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const item = items[next++]!;
      try {
        await fn(item);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
