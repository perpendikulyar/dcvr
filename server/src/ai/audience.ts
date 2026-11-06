/**
 * Audience profile used by the analysis pipeline. Edit here to retune the
 * analysis; nothing else in the pipeline hard-codes audience knowledge.
 */

export const AUDIENCE_DESCRIPTION =
  'UGC-сервис с преимущественно женской аудиторией из России. Основные тематики: отношения, быт, ' +
  'дом, садоводство, рецепты, жизненные ситуации, культурные события.';

/** DMP interests, ordered from the largest audience segment to the smallest. */
export const INTERESTS: readonly string[] = [
  'Отношения',
  'Развлечения и досуг',
  'Кино',
  'Рестораны',
  'Книги',
  'Музыка',
  'Декор',
  'Игры',
  'Телевидение',
  'Танцы',
  'Красота и здоровье',
  'Уход за волосами и телом',
  'Медицинские товары',
  'Здоровое питание',
  'Косметика',
  'Фитнес',
  'Йога',
  'Спортивные товары',
  'Одежда и обувь',
  'Кредиты, ипотека',
  'Кулинария',
  'Чай',
  'Техника для красоты и здоровья',
  'Техника для дома',
  'Товары для детей',
  'Отдых и путешествия',
  'Отели',
  'Спортивный туризм',
  'Подарки и цветы',
  'Животные',
];

/** Interest ids are 1-based positions in INTERESTS. */
export function interestName(id: number): string | undefined {
  return INTERESTS[id - 1];
}

/** Rank-based weight: 1.0 for the top interest, decreasing linearly. */
export function interestWeight(id: number): number {
  return 1 - (id - 1) / INTERESTS.length;
}

/** Topics the audience is not interested in; the map step drops them as irrelevant. */
export const EXCLUDED_TOPICS = [
  'политика, госуправление, военные действия, законы',
  'знаменитости, светская хроника, скандалы звёзд',
  'спортивные новости: матчи, клубы, турниры, трансферы (фитнес и активный отдых — не исключаем)',
];

/** Category prefixes dropped before any LLM call (each includes its subcategories). */
export const EXCLUDED_CATEGORIES = [
  '/Sports',
  '/News/Politics',
  '/Law & Government',
  '/Arts & Entertainment/Celebrities & Entertainment News',
];

export const ANALYSIS = {
  /** Topics in the final top that get insights and ideas. */
  topTopics: 15,
  /** A trend needs several sources: smaller topics are not ranked. */
  minTopicPublications: 2,
  ideasPerTopic: { min: 3, max: 5 },
  headlinesPerIdea: { min: 3, max: 5 },
  /** Saved headlines per idea; "more variants" adds to the list up to this cap. */
  maxStoredHeadlines: 20,
  /** Rows per map request; YandexGPT Lite cuts answers off at ~4K characters. */
  mapBatchSize: 40,
  /** Summary is cut to this many characters in map prompts. */
  mapSummaryChars: 300,
  /** Parallel LLM requests unless the provider sets its own limit. */
  concurrency: 4,
  /** Labels per reduce request; labels are ordered by interest so related ones share a chunk. */
  reduceChunkSize: 150,
  /** Failing reduce chunks are halved down to this size before giving up. */
  reduceMinChunk: 20,
  /** Topics per synthesis request. */
  synthBatchSize: 5,
  /** An interest counts for a topic if at least this share of its rows has it. */
  topicInterestShare: 0.2,
  score: {
    interestWeight: 0.6,
    reachWeight: 0.4,
    /** Bonus per additional matching interest, capped. */
    extraInterestBonus: 0.1,
    maxExtraInterests: 2,
  },
};
