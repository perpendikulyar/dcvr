import type { ContentIdea, Headline } from '@dcvr/shared';
import type { Db } from '../db/index.js';
import { ANALYSIS, interestName } from './audience.js';
import { completeJson } from './json.js';
import type { LlmProvider } from './llm.js';
import { headlinesPrompt, headlinesSchema } from './prompts.js';

export class IdeaNotFoundError extends Error {}

/**
 * Generates headlines for one content idea of a topic and adds them in front of
 * the saved ones. Returns the full saved list, newest first.
 */
export async function generateHeadlines(
  db: Db,
  provider: LlmProvider,
  topicId: number,
  ideaIndex: number,
): Promise<Headline[]> {
  const topic = db
    .prepare(
      `SELECT title, why_trending AS whyTrending, interests_json AS interests, ideas_json AS ideas
       FROM ai_topics WHERE id = ?`,
    )
    .get(topicId) as
    | { title: string; whyTrending: string | null; interests: string; ideas: string | null }
    | undefined;
  const idea = topic && (JSON.parse(topic.ideas ?? '[]') as ContentIdea[])[ideaIndex];
  if (!topic || !idea) throw new IdeaNotFoundError('Идея не найдена');

  const existing = savedHeadlines(db, topicId, ideaIndex);
  const examples = (
    db
      .prepare(
        `SELECT p.title FROM ai_topic_items ti JOIN publications p ON p.id = ti.publication_id
         WHERE ti.topic_id = ? ORDER BY p.impressions DESC LIMIT 6`,
      )
      .all(topicId) as { title: string }[]
  ).map((r) => r.title);

  const result = await completeJson(
    provider,
    headlinesPrompt({
      topic: topic.title,
      whyTrending: topic.whyTrending,
      interests: (JSON.parse(topic.interests) as { id: number }[]).map((i) => interestName(i.id)!),
      idea,
      examples,
      existing: existing.map((h) => h.title),
    }),
    headlinesSchema,
    { model: provider.synthModel, temperature: 0.8, maxTokens: 2000 },
  );

  const seen = new Set(existing.map((h) => normalize(h.title)));
  const fresh = result.headlines
    .map((h) => ({ title: h.title.trim(), pitch: h.pitch.trim() }))
    .filter((h) => !seen.has(normalize(h.title)) && seen.add(normalize(h.title)))
    .slice(0, ANALYSIS.headlinesPerIdea.max);
  const all = [...fresh, ...existing].slice(0, ANALYSIS.maxStoredHeadlines);

  db.prepare(
    `INSERT INTO ai_idea_headlines (topic_id, idea_index, headlines_json, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (topic_id, idea_index)
     DO UPDATE SET headlines_json = excluded.headlines_json, updated_at = excluded.updated_at`,
  ).run(topicId, ideaIndex, JSON.stringify(all), new Date().toISOString());
  return all;
}

export function savedHeadlines(db: Db, topicId: number, ideaIndex: number): Headline[] {
  const row = db
    .prepare('SELECT headlines_json FROM ai_idea_headlines WHERE topic_id = ? AND idea_index = ?')
    .get(topicId, ideaIndex) as { headlines_json: string } | undefined;
  return row ? (JSON.parse(row.headlines_json) as Headline[]) : [];
}

function normalize(title: string): string {
  return title
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
