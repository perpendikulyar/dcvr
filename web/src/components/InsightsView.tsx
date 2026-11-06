import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AnalysisResult, AnalysisRun, AnalysisStep, ContentIdea, Topic } from '@dcvr/shared';
import { api } from '../api/client';

interface Props {
  uploadId: number;
  onOpenTopic: (topic: Topic) => void;
}

const STEP_LABELS: Record<AnalysisStep, string> = {
  prefilter: 'Отбор публикаций',
  map: 'Разметка публикаций',
  reduce: 'Объединение в темы',
  score: 'Подсчёт метрик',
  synth: 'Инсайты и идеи',
  done: 'Готово',
};

const number = (n: number) => n.toLocaleString('ru-RU');
const dateFormat = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
const isActive = (run: AnalysisRun | undefined) =>
  run?.status === 'queued' || run?.status === 'running';

export function InsightsView({ uploadId, onOpenTopic }: Props) {
  const queryClient = useQueryClient();
  const [interest, setInterest] = useState<number | null>(null);

  const analysis = useQuery({
    queryKey: ['analysis', uploadId],
    queryFn: () => api.getAnalysis(uploadId),
    refetchInterval: (q) => (isActive(q.state.data?.run) ? 2000 : false),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['analysis', uploadId] });
  const start = useMutation({ mutationFn: () => api.startAnalysis(uploadId), onSuccess: refresh });
  const resume = useMutation({ mutationFn: api.resumeAnalysis, onSuccess: refresh });
  const finish = useMutation({ mutationFn: api.finishAnalysis, onSuccess: refresh });

  const result = analysis.data;
  const run = result?.run;
  const mutationError = start.error ?? resume.error ?? finish.error;

  if (analysis.isLoading) return <p className="muted">Загрузка…</p>;

  return (
    <div className="insights">
      {(analysis.error ?? mutationError) && (
        <p className="error">{(analysis.error ?? mutationError)!.message}</p>
      )}

      {!run && (
        <section className="insights__intro">
          <h2>ИИ-анализ выгрузки</h2>
          <p>
            Модель разметит публикации, объединит их в темы, оценит соответствие интересам аудитории
            (DMP) и предложит идеи контента для топ-тем. Это занимает несколько минут; страницу
            можно закрыть — анализ продолжится.
          </p>
          <button className="primary" disabled={start.isPending} onClick={() => start.mutate()}>
            Проанализировать
          </button>
        </section>
      )}

      {run && isActive(run) && <RunProgress run={run} />}

      {run?.status === 'failed' && (
        <section className="insights__intro">
          <h2>Анализ прерван</h2>
          <p className="error">{run.error}</p>
          {run.progressTotal > 0 && (
            <p>
              Шаг «{STEP_LABELS[run.step]}»: обработано {number(run.progressDone)} из{' '}
              {number(run.progressTotal)}.
            </p>
          )}
          <p className="muted">
            Готовые шаги сохранены. «Продолжить» повторит необработанное. Если ошибка повторяется,
            «Завершить по обработанным» пропустит оставшееся и построит темы и идеи по тому, что уже
            готово.
          </p>
          <div className="actions">
            <button
              className="primary"
              disabled={resume.isPending || finish.isPending}
              onClick={() => resume.mutate(run.id)}
            >
              Продолжить
            </button>
            <button
              disabled={resume.isPending || finish.isPending}
              onClick={() => finish.mutate(run.id)}
            >
              Завершить по обработанным
            </button>
            <button disabled={start.isPending} onClick={() => start.mutate()}>
              Начать заново
            </button>
          </div>
        </section>
      )}

      {result && run?.status === 'done' && (
        <Results
          result={result}
          interest={interest}
          onInterest={setInterest}
          onOpenTopic={onOpenTopic}
          onRestart={() => {
            if (confirm('Запустить анализ заново? Текущие результаты останутся в истории.')) {
              start.mutate();
            }
          }}
          restarting={start.isPending}
        />
      )}
    </div>
  );
}

function RunProgress({ run }: { run: AnalysisRun }) {
  const steps: AnalysisStep[] = ['prefilter', 'map', 'reduce', 'score', 'synth'];
  const current = steps.indexOf(run.step);
  const share = run.progressTotal ? run.progressDone / run.progressTotal : 0;
  return (
    <section className="insights__intro">
      <h2>Идёт анализ…</h2>
      <ol className="steps">
        {steps.map((step, i) => (
          <li
            key={step}
            className={i < current ? 'steps__done' : i === current ? 'steps__current' : 'muted'}
          >
            {STEP_LABELS[step]}
            {i === current && run.progressTotal > 0 && (
              <span className="muted">
                {' '}
                — {number(run.progressDone)} из {number(run.progressTotal)}
              </span>
            )}
          </li>
        ))}
      </ol>
      {run.progressTotal > 0 && (
        <div className="progress" role="progressbar" aria-valuenow={Math.round(share * 100)}>
          <div className="progress__bar" style={{ width: `${share * 100}%` }} />
        </div>
      )}
      <p className="muted">
        Провайдер: {run.provider}. Ошибки сети и перегрузки модели повторяются автоматически.
      </p>
    </section>
  );
}

interface ResultsProps {
  result: AnalysisResult;
  interest: number | null;
  onInterest: (id: number | null) => void;
  onOpenTopic: (topic: Topic) => void;
  onRestart: () => void;
  restarting: boolean;
}

function Results({
  result,
  interest,
  onInterest,
  onOpenTopic,
  onRestart,
  restarting,
}: ResultsProps) {
  const { run, topics, coverage } = result;
  const visible = interest
    ? topics.filter((t) => t.interests.some((i) => i.id === interest))
    : topics;

  return (
    <>
      <header className="insights__header">
        <div>
          <h2>Трендовые темы для аудитории</h2>
          <p className="muted">
            {topics.length} тем · {run.provider} ({run.synthModel}) ·{' '}
            {dateFormat.format(new Date(run.finishedAt ?? run.createdAt))}
          </p>
        </div>
        <button disabled={restarting} onClick={onRestart}>
          Перезапустить анализ
        </button>
      </header>

      {run.skipped > 0 && (
        <p className="notice">
          Пропущено публикаций: {number(run.skipped)}.{' '}
          {run.partial
            ? 'Анализ завершён по обработанным данным — часть публикаций и тем не отправлялась в модель.'
            : 'Модель отказалась их обрабатывать (встроенная модерация) — в темах они не учтены.'}
        </p>
      )}

      <section className="coverage">
        <h3>Интересы DMP в трендах</h3>
        <div className="coverage__list">
          {coverage.map((c) => (
            <button
              key={c.id}
              className={[
                'coverage__item',
                c.topics ? '' : 'coverage__item--empty',
                interest === c.id ? 'coverage__item--active' : '',
              ].join(' ')}
              disabled={!c.topics}
              title={
                c.topics
                  ? `${c.topics} тем, ${number(c.impressions)} показов`
                  : 'В этой выгрузке нет трендов под этот интерес'
              }
              onClick={() => onInterest(interest === c.id ? null : c.id)}
            >
              {c.name}
              <span className="count">{c.topics}</span>
            </button>
          ))}
        </div>
      </section>

      {!topics.length && (
        <p className="muted">Модель не нашла тем, подходящих аудитории, в этой выгрузке.</p>
      )}

      <div className="topics">
        {visible.map((topic) => (
          <TopicCard key={topic.id} topic={topic} onOpen={() => onOpenTopic(topic)} />
        ))}
      </div>
    </>
  );
}

function TopicCard({ topic, onOpen }: { topic: Topic; onOpen: () => void }) {
  return (
    <article className="topic" id={`topic-${topic.id}`}>
      <header className="topic__header">
        <span className="topic__rank">#{topic.rank}</span>
        <h3 className="topic__title">{topic.title}</h3>
        <span className="topic__score" title="Audience score: интересы DMP × охват">
          {Math.round(topic.audienceScore * 100)}
        </span>
      </header>

      <p className="topic__metrics muted">
        {number(topic.impressions)} показов · {topic.publications} публикаций · {topic.publishers}{' '}
        издателей
      </p>

      <div className="badges">
        {topic.interests.map((i) => (
          <span key={i.id} className="badge" title={`${i.count} публикаций`}>
            {i.name}
          </span>
        ))}
      </div>

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
        <p className="muted" title={topic.synthError}>
          Модель не сгенерировала инсайты и идеи для этой темы — метрики и публикации доступны.
        </p>
      )}

      {topic.ideas.length > 0 && (
        <>
          <h4>Идеи контента</h4>
          <ul className="ideas">
            {topic.ideas.map((idea, i) => (
              <IdeaItem key={i} idea={idea} topicId={topic.id} index={i} />
            ))}
          </ul>
        </>
      )}

      {topic.related.length > 0 && (
        <div className="related">
          <span className="muted">Связано:</span>
          {topic.related.map((r) => (
            <a key={r.id} href={`#topic-${r.id}`} className="related__item" title={r.why}>
              {r.title}
            </a>
          ))}
        </div>
      )}

      <footer className="topic__footer">
        <button className="link-button" onClick={onOpen}>
          Публикации темы ({topic.publications}) →
        </button>
      </footer>
    </article>
  );
}

function IdeaItem({ idea, topicId, index }: { idea: ContentIdea; topicId: number; index: number }) {
  const queryClient = useQueryClient();
  const headlines = useMutation({
    mutationFn: () => api.generateHeadlines(topicId, index),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['analysis'] }),
  });
  const saved = headlines.data?.headlines ?? idea.headlines ?? [];
  const ideaText = `${idea.title}\nФормат: ${idea.format}\nУгол: ${idea.angle}\nВовлечение: ${idea.hook}`;

  return (
    <li className="idea">
      <div className="idea__head">
        <span className="idea__title">{idea.title}</span>
        <span className="badge badge--muted">{idea.format}</span>
        <CopyButton text={ideaText} className="idea__copy" />
      </div>
      <p className="muted">
        {idea.angle} <em>Вовлечение:</em> {idea.hook}
      </p>

      {saved.length > 0 && (
        <ul className="headlines">
          {saved.map((h) => (
            <li key={h.title} className="headline">
              <div className="headline__text">
                <span className="headline__title">{h.title}</span>
                {h.pitch && <span className="muted"> — {h.pitch}</span>}
              </div>
              <CopyButton text={h.title} />
            </li>
          ))}
        </ul>
      )}

      <button
        className="link-button headlines__more"
        disabled={headlines.isPending}
        onClick={() => headlines.mutate()}
      >
        {headlines.isPending
          ? 'Придумываю заголовки…'
          : saved.length
            ? '+ Ещё варианты заголовков'
            : '+ Заголовки для материалов'}
      </button>
      {headlines.error && <p className="error">{headlines.error.message}</p>}
    </li>
  );
}

function CopyButton({ text, className = '' }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be unavailable (e.g. insecure context); nothing to do.
    }
  };
  return (
    <button className={`icon-button ${className}`} title="Скопировать" onClick={copy}>
      {copied ? '✓' : '⧉'}
    </button>
  );
}
