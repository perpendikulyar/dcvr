import { ANALYSIS, interestWeight } from './audience.js';

export interface TopicStats {
  publications: number;
  impressions: number;
  /** Interest id → number of the topic's publications tagged with it. */
  interestCounts: Map<number, number>;
}

/** Interests that cover a meaningful share of the topic, most common first. */
export function topicInterests(stats: TopicStats): { id: number; count: number }[] {
  return [...stats.interestCounts]
    .map(([id, count]) => ({ id, count }))
    .filter((i) => i.count / stats.publications >= ANALYSIS.topicInterestShare)
    .sort((a, b) => b.count - a.count || a.id - b.id);
}

/**
 * Audience score in [0, 1]: how well the topic matches the DMP interests
 * (strongest interest + a bonus for each extra one) blended with its reach,
 * where reach is log-impressions normalized across all topics of the run.
 */
export function audienceScores(topics: TopicStats[]): number[] {
  const {
    interestWeight: wInterest,
    reachWeight: wReach,
    extraInterestBonus,
    maxExtraInterests,
  } = ANALYSIS.score;

  const logs = topics.map((t) => Math.log10(Math.max(1, t.impressions)));
  const min = Math.min(...logs);
  const max = Math.max(...logs);

  return topics.map((t, i) => {
    const interests = topicInterests(t);
    if (!interests.length) return 0;
    const best = Math.max(...interests.map((x) => interestWeight(x.id)));
    const extra = Math.min(maxExtraInterests, interests.length - 1) * extraInterestBonus;
    const fit = Math.min(1, best + extra);
    const reach = max > min ? (logs[i]! - min) / (max - min) : 1;
    return wInterest * fit + wReach * reach;
  });
}
