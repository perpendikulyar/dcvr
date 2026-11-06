import type {
  AnalysisResult,
  AnalysisRun,
  ContentIdea,
  InterestCoverage,
  RelatedTopic,
  Topic,
  TopicInterest,
} from '@dcvr/shared';
import type { Db } from '../db/index.js';
import { INTERESTS, interestName } from '../ai/audience.js';
import type { Headline } from '@dcvr/shared';

const RUN_COLUMNS = `id, upload_id AS uploadId, provider, map_model AS mapModel, synth_model AS synthModel,
  status, step, progress_done AS progressDone, progress_total AS progressTotal, error,
  created_at AS createdAt, finished_at AS finishedAt, partial,
  (SELECT COUNT(*) FROM ai_item_labels l WHERE l.run_id = ai_runs.id AND l.skipped = 1) AS skipped`;

function toRun(row: Record<string, unknown> | undefined): AnalysisRun | undefined {
  return row ? ({ ...row, partial: row.partial === 1 } as unknown as AnalysisRun) : undefined;
}

export function getRun(db: Db, runId: number): AnalysisRun | undefined {
  return toRun(db.prepare(`SELECT ${RUN_COLUMNS} FROM ai_runs WHERE id = ?`).get(runId));
}

export function latestRun(db: Db, uploadId: number): AnalysisRun | undefined {
  return toRun(
    db
      .prepare(`SELECT ${RUN_COLUMNS} FROM ai_runs WHERE upload_id = ? ORDER BY id DESC LIMIT 1`)
      .get(uploadId),
  );
}

export function getResult(db: Db, run: AnalysisRun): AnalysisResult {
  const rows =
    run.status === 'done'
      ? (db
          .prepare(
            `SELECT id, rank, title, audience_score AS audienceScore, impressions, publications, publishers,
                    interests_json, why_trending AS whyTrending, interests_reason AS interestsReason,
                    ideas_json, related_json, synth_error AS synthError
             FROM ai_topics WHERE run_id = ? AND rank IS NOT NULL ORDER BY rank`,
          )
          .all(run.id) as Record<string, unknown>[])
      : [];

  const titles = new Map(rows.map((r) => [r.id as number, r.title as string]));
  const headlines = new Map<string, Headline[]>();
  if (rows.length) {
    const saved = db
      .prepare(
        `SELECT h.topic_id AS topicId, h.idea_index AS idx, h.headlines_json AS json
         FROM ai_idea_headlines h JOIN ai_topics t ON t.id = h.topic_id WHERE t.run_id = ?`,
      )
      .all(run.id) as { topicId: number; idx: number; json: string }[];
    for (const h of saved) headlines.set(`${h.topicId}:${h.idx}`, JSON.parse(h.json));
  }
  const topics: Topic[] = rows.map((r) => ({
    id: r.id as number,
    rank: r.rank as number,
    title: r.title as string,
    audienceScore: r.audienceScore as number,
    impressions: r.impressions as number,
    publications: r.publications as number,
    publishers: r.publishers as number,
    whyTrending: r.whyTrending as string | null,
    synthError: r.synthError as string | null,
    interestsReason: r.interestsReason as string | null,
    interests: (JSON.parse(r.interests_json as string) as Omit<TopicInterest, 'name'>[]).map(
      (i) => ({ ...i, name: interestName(i.id) ?? `#${i.id}` }),
    ),
    ideas: (JSON.parse((r.ideas_json as string | null) ?? '[]') as ContentIdea[]).map(
      (idea, i) => ({ ...idea, headlines: headlines.get(`${r.id}:${i}`) ?? [] }),
    ),
    related: (
      JSON.parse((r.related_json as string | null) ?? '[]') as Omit<RelatedTopic, 'title'>[]
    )
      .filter((x) => titles.has(x.id))
      .map((x) => ({ ...x, title: titles.get(x.id)! })),
  }));

  const coverage: InterestCoverage[] = INTERESTS.map((name, i) => {
    const matching = topics.filter((t) => t.interests.some((x) => x.id === i + 1));
    return {
      id: i + 1,
      name,
      topics: matching.length,
      impressions: matching.reduce((s, t) => s + t.impressions, 0),
    };
  });

  return { run, topics, coverage };
}

export function topicBelongsToUpload(db: Db, topicId: number, uploadId: number): boolean {
  return (
    db
      .prepare(
        `SELECT 1 FROM ai_topics t JOIN ai_runs r ON r.id = t.run_id WHERE t.id = ? AND r.upload_id = ?`,
      )
      .get(topicId, uploadId) !== undefined
  );
}
