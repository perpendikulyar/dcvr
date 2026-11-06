import { z } from 'zod';
import { ANALYSIS, AUDIENCE_DESCRIPTION, EXCLUDED_TOPICS, INTERESTS } from './audience.js';
import type { ChatMessage } from './llm.js';

const interestList = INTERESTS.map((name) => `- ${name}`).join('\n');
const normalizeName = (s: string) => s.trim().toLowerCase().replace(/ё/g, 'е');
const interestIds = new Map(INTERESTS.map((name, i) => [normalizeName(name), i + 1]));

/**
 * Interests come back as names (weak models mix up numbers) and are mapped to
 * ids here; names outside the DMP list are dropped rather than failing the batch.
 */
const interestNames = z
  .array(z.string())
  .nullish()
  .transform((names) => [
    ...new Set((names ?? []).flatMap((n) => interestIds.get(normalizeName(n)) ?? []).slice(0, 3)),
  ]);
const oneLine = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();

/** Some models answer `[...]` instead of `{"key": [...]}`; accept both. */
const arrayAs = (key: string) => (value: unknown) =>
  Array.isArray(value) ? { [key]: value } : value;

const SYSTEM = `Ты — контент-аналитик. ${AUDIENCE_DESCRIPTION}
Отвечаешь строго валидным JSON без markdown и пояснений, в одну строку, без отступов и переносов.`;

// ---------- Map: label each publication ----------

export interface MapItem {
  n: number;
  title: string;
  category: string | null;
  summary: string | null;
}

export const mapSchema = z.preprocess(
  arrayAs('items'),
  z.object({
    items: z.array(
      z.object({
        n: z.number().int(),
        relevant: z.boolean(),
        label: z.string().max(80).nullable().optional(),
        interests: interestNames,
      }),
    ),
  }),
);
export type MapResult = z.infer<typeof mapSchema>;

export function mapPrompt(items: MapItem[]): ChatMessage[] {
  const rows = items
    .map((it) => {
      const summary = oneLine(it.summary).slice(0, ANALYSIS.mapSummaryChars);
      return `${it.n} | ${it.category ?? '-'} | ${oneLine(it.title)}${summary ? ` | ${summary}` : ''}`;
    })
    .join('\n');

  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: `Разметь публикации из ленты рекомендаций. Формат строки: n | категория | заголовок | краткое содержание.

Для каждой публикации определи:
- relevant: true, если тема может быть интересна нашей аудитории. false — для тем, которые нам не нужны:
${EXCLUDED_TOPICS.map((t) => `  • ${t}`).join('\n')}
  а также для узкоспециальных, технических и чисто региональных новостей без общего интереса.
- label: тема публикации — 2–5 слов по-русски, обобщённо, чтобы похожие публикации получили одинаковый ярлык
  (например «осенние заготовки», «уход за комнатными растениями», «сериал Слово пацана»). Только для relevant=true.
- interests: 0–3 интереса аудитории из списка ниже, которым соответствует публикация. Пиши названия точно как
  в списке. Если ни один интерес не подходит — пустой массив.
- Для relevant=false поля label и interests не нужны.

Интересы аудитории:
${interestList}

Публикации:
${rows}

Верни JSON: {"items":[{"n":1,"relevant":true,"label":"осенние заготовки","interests":["Кулинария"]},{"n":2,"relevant":false}]} — по одному элементу на каждую публикацию.`,
    },
  ];
}

// ---------- Reduce: merge labels into topics ----------

export interface ReduceItem {
  n: number;
  label: string;
  count: number;
}

/** Only merged groups come back; anything not mentioned stays on its own. */
export const groupsSchema = z.preprocess(
  arrayAs('groups'),
  z.object({
    groups: z.array(
      z.object({
        title: z.string().min(1).max(100),
        items: z.array(z.number().int()).min(2),
      }),
    ),
  }),
);
export type GroupsResult = z.infer<typeof groupsSchema>;

function groupPrompt(intro: string, items: ReduceItem[]): ChatMessage[] {
  const list = items.map((l) => `${l.n}. ${l.label} (${l.count})`).join('\n');
  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: `${intro} В скобках — число публикаций.
Объедини в группы синонимичные и очень близкие по смыслу элементы. Группа должна оставаться конкретной темой,
на которую можно написать контент («осенние заготовки», а не «еда»; «уход за орхидеями», а не «растения»).
Каждый элемент — не больше чем в одной группе. Верни ТОЛЬКО группы из 2 и более элементов;
элементы без пары не перечисляй.

${list}

Верни JSON: {"groups":[{"title":"название темы","items":[1,5,17]}, ...]}`,
    },
  ];
}

/** First pass: labels of a chunk → topics. */
export function reducePrompt(labels: ReduceItem[]): ChatMessage[] {
  return groupPrompt('Ниже ярлыки тем публикаций из ленты рекомендаций.', labels);
}

/** Second pass: topics from different chunks → merged topics. */
export function mergePrompt(topics: ReduceItem[]): ChatMessage[] {
  return groupPrompt(
    'Ниже темы публикаций, собранные из разных частей ленты; среди них есть дубли и очень близкие темы.',
    topics,
  );
}

// ---------- Synthesis: insights and content ideas ----------

export interface SynthTopic {
  id: number;
  title: string;
  impressions: number;
  publications: number;
  publishers: number;
  interests: string[];
  examples: { title: string; summary: string | null; impressions: number | null }[];
}

export const synthSchema = z.preprocess(
  arrayAs('topics'),
  z.object({
    topics: z.array(
      z.object({
        id: z.number().int(),
        title: z.string().min(1).max(120),
        whyTrending: z.string().min(1),
        interestsReason: z.string().min(1),
        ideas: z
          .array(
            z.object({
              title: z.string().min(1),
              format: z.string().min(1),
              angle: z.string().min(1),
              hook: z.string().min(1),
            }),
          )
          .min(1),
        related: z
          .array(z.object({ id: z.number().int(), why: z.string().min(1) }))
          .max(5)
          .optional(),
      }),
    ),
  }),
);
export type SynthResult = z.infer<typeof synthSchema>;

export function synthPrompt(
  batch: SynthTopic[],
  allTopics: { id: number; title: string }[],
): ChatMessage[] {
  const { min, max } = ANALYSIS.ideasPerTopic;
  const topics = batch
    .map((t) => {
      const examples = t.examples
        .map(
          (e) =>
            `  - ${oneLine(e.title)}${e.summary ? ` — ${oneLine(e.summary).slice(0, 200)}` : ''}`,
        )
        .join('\n');
      return `[${t.id}] ${t.title}
Показы: ${t.impressions}, публикаций: ${t.publications}, издателей: ${t.publishers}
Интересы аудитории: ${t.interests.join(', ') || '—'}
Примеры публикаций:
${examples}`;
    })
    .join('\n\n');
  const catalog = allTopics.map((t) => `[${t.id}] ${t.title}`).join('\n');

  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: `Это трендовые темы из свежей выгрузки ленты рекомендаций (цифры посчитаны точно, не меняй их).
Для каждой темы подготовь:
- title: короткое понятное название темы;
- whyTrending: 1–2 предложения, почему тема сейчас популярна (сезон, событие, инфоповод — по примерам);
- interestsReason: 1 предложение, чем тема цепляет интересы нашей аудитории;
- ideas: ${min}–${max} идей контента для UGC-сервиса. Для каждой: title — цепляющий заголовок;
  format — формат (личная история, вопрос к сообществу, опрос, чек-лист, рецепт, подборка, лайфхак, до/после и т.п.);
  angle — под каким углом подать тему для нашей аудитории; hook — чем вовлечь пользователей поделиться своим опытом.
  Хорошие идеи часто лежат на пересечении интересов (например, отношения × рестораны → идеи для свиданий);
- related: до 3 связанных тем из общего списка (по id) и в чём связь. Не связывай тему саму с собой.

Темы для разбора:
${topics}

Общий список тем (для related):
${catalog}

Верни JSON: {"topics":[{"id":1,"title":"...","whyTrending":"...","interestsReason":"...","ideas":[{"title":"...","format":"...","angle":"...","hook":"..."}],"related":[{"id":2,"why":"..."}]}]}`,
    },
  ];
}

// ---------- Headlines: concrete UGC pieces for an idea ----------

export interface HeadlinesInput {
  topic: string;
  whyTrending: string | null;
  interests: string[];
  idea: { title: string; format: string; angle: string; hook: string };
  examples: string[];
  /** Already generated headlines, so new ones don't repeat them. */
  existing: string[];
}

export const headlinesSchema = z.preprocess(
  arrayAs('headlines'),
  z.object({
    headlines: z
      .array(z.object({ title: z.string().min(5).max(200), pitch: z.string().default('') }))
      .min(1),
  }),
);

export function headlinesPrompt(input: HeadlinesInput): ChatMessage[] {
  const { min, max } = ANALYSIS.headlinesPerIdea;
  const existing = input.existing.length
    ? `\nУже предложены (не повторяй их и не перефразируй близко):\n${input.existing.map((h) => `- ${h}`).join('\n')}\n`
    : '';
  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: `Придумай ${min}–${max} заголовков UGC-материалов по идее контента. UGC-материал пишет обычный пользователь
нашего сервиса о своём опыте, поэтому заголовок — это конкретная история или практичная подборка, а не общая тема.

Требования к заголовкам:
- конкретика: место, срок, бюджет, количество, участники, предмет («с мужем», «на даче под Тверью», «за 3000 рублей», «5 идей»);
- от первого лица («я», «мы с семьёй», «моя бабушка») или подборка с числом;
- разные форматы в одном наборе: личная история, подборка, лайфхак, «до/после», признание, вопрос к читателям;
- живой разговорный язык, без канцелярита и кликбейта («шок», «вы не поверите»), без выдуманных фактов о реальных людях;
- учитывай сезон и инфоповод темы.
pitch — одно предложение: о чём будет материал и чем он полезен или интересен читательнице.

Пример. Идея «Как отметить новогодние праздники ярко и незабываемо»:
- Как я провожу новогодние праздники, чтобы не было скучно
- Новогоднее путешествие по Подмосковью: 5 отличных идей
- На Новый год мы с семьёй каждый раз делаем свои украшения

Тема: ${input.topic}
${input.whyTrending ? `Почему в тренде: ${input.whyTrending}\n` : ''}Интересы аудитории: ${input.interests.join(', ') || '—'}
Идея: ${input.idea.title}
Формат: ${input.idea.format}
Угол подачи: ${input.idea.angle}
Вовлечение: ${input.idea.hook}
Публикации по теме, которые сейчас набирают показы:
${input.examples.map((e) => `- ${oneLine(e)}`).join('\n')}
${existing}
Верни JSON: {"headlines":[{"title":"...","pitch":"..."}]}`,
    },
  ];
}
