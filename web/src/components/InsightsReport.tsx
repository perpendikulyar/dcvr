import { createPortal } from 'react-dom';
import type { AnalysisResult, InterestCoverage, Topic } from '@dcvr/shared';

interface Props {
  result: AnalysisResult;
  /** Topics to include — the ones currently shown (interest filter applied). */
  topics: Topic[];
  filename: string | undefined;
  /** Interest the view is filtered by, shown in the report header. */
  interest: InterestCoverage | undefined;
}

const number = (n: number) => n.toLocaleString('ru-RU');

/** "gpt://<folder>/yandexgpt/latest" → "yandexgpt": no account ids in a shared report. */
export function modelName(uri: string): string {
  const parts = uri.replace(/^\w+:\/\//, '').split('/');
  return parts.length > 1 ? parts[parts.length - 2]! : uri;
}
const dateFormat = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeStyle: 'short' });

/**
 * Print-only report of the analysis: hidden on screen, the only thing visible
 * when printing. Both the browser's "Save as PDF" and the desktop app's
 * printToPDF render it through the print stylesheet.
 */
export function InsightsReport({ result, topics, filename, interest }: Props) {
  const { run, coverage } = result;
  const covered = coverage.filter((c) => c.topics > 0);

  return createPortal(
    <article className="report">
      <header className="report__header">
        <h1>Трендовые темы и идеи контента</h1>
        <p>
          {filename && (
            <>
              Выгрузка: {filename}
              <br />
            </>
          )}
          Анализ от {dateFormat.format(new Date(run.finishedAt ?? run.createdAt))} · {run.provider}{' '}
          ({modelName(run.synthModel)})
          {interest && (
            <>
              <br />
              Отбор по интересу: {interest.name}
            </>
          )}
        </p>
        {run.skipped > 0 && (
          <p className="report__muted">
            Пропущено публикаций: {number(run.skipped)} — в темах они не учтены.
          </p>
        )}
      </header>

      {covered.length > 0 && (
        <section className="report__section">
          <h2>Интересы аудитории в трендах</h2>
          <p>{covered.map((c) => `${c.name} (${c.topics})`).join(' · ')}</p>
        </section>
      )}

      {topics.map((topic) => (
        <section key={topic.id} className="report__topic">
          <h2>
            {topic.rank}. {topic.title}
          </h2>
          <p className="report__muted">
            {number(topic.impressions)} показов · {topic.publications} публикаций ·{' '}
            {topic.publishers} издателей · Audience score {Math.round(topic.audienceScore * 100)}
            {topic.interests.length > 0 && <> · {topic.interests.map((i) => i.name).join(', ')}</>}
          </p>

          {topic.whyTrending && (
            <p>
              <strong>Почему в тренде.</strong> {topic.whyTrending}
            </p>
          )}
          {topic.interestsReason && (
            <p>
              <strong>Чем цепляет аудиторию.</strong> {topic.interestsReason}
            </p>
          )}
          {topic.synthError && (
            <p className="report__muted">Модель не сгенерировала инсайты для этой темы.</p>
          )}

          {topic.ideas.map((idea, i) => (
            <div key={i} className="report__idea">
              <h3>
                {idea.title} <span className="report__format">{idea.format}</span>
              </h3>
              <p>
                {idea.angle} <em>Вовлечение:</em> {idea.hook}
              </p>
              {idea.headlines && idea.headlines.length > 0 && (
                <ul>
                  {idea.headlines.map((h) => (
                    <li key={h.title}>
                      <strong>{h.title}</strong>
                      {h.pitch && <> — {h.pitch}</>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}

          {topic.related.length > 0 && (
            <p className="report__muted">Связано: {topic.related.map((r) => r.title).join('; ')}</p>
          )}
        </section>
      ))}
    </article>,
    document.body,
  );
}
