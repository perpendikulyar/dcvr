import { useCallback, useEffect } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from './api/client';
import { useUrlState } from './hooks/useUrlState';
import { UploadPanel } from './components/UploadPanel';
import { PublisherFilter } from './components/PublisherFilter';
import { CategoryFilter, NO_CATEGORY } from './components/CategoryFilter';
import { PublicationsTable } from './components/PublicationsTable';
import { InsightsView } from './components/InsightsView';

export function App() {
  const { state, update, resetFilters } = useUrlState();
  const { view, upload: uploadId, topic, publisher, category, sort, order, page, pageSize } = state;

  const uploads = useQuery({ queryKey: ['uploads'], queryFn: api.listUploads });

  // Fall back to the latest upload when none is selected or the selected one is gone.
  useEffect(() => {
    const list = uploads.data;
    if (!list) return;
    if (!list.some((u) => u.id === uploadId)) {
      update({ upload: list[0]?.id ?? null, publisher: [], category: [], topic: null });
    }
  }, [uploads.data, uploadId, update]);

  const ready = uploadId !== null && Boolean(uploads.data?.some((u) => u.id === uploadId));

  const facets = useQuery({
    queryKey: ['facets', uploadId, publisher, category, topic],
    queryFn: () => api.getFacets(uploadId!, { publisher, category, topic: topic ?? undefined }),
    enabled: ready,
    placeholderData: keepPreviousData,
  });

  const publications = useQuery({
    queryKey: ['publications', uploadId, publisher, category, topic, sort, order, page, pageSize],
    queryFn: () =>
      api.listPublications(uploadId!, {
        publisher,
        category,
        topic: topic ?? undefined,
        sort,
        order,
        page,
        pageSize,
      }),
    enabled: ready,
    placeholderData: keepPreviousData,
  });

  const addPublisher = useCallback(
    (p: string) => !publisher.includes(p) && update({ publisher: [...publisher, p] }),
    [publisher, update],
  );
  const addCategory = useCallback(
    (path: string) => {
      // Already covered by itself or a selected ancestor.
      if (category.some((c) => c === path || path.startsWith(c + '/'))) return;
      update({ category: [...category.filter((c) => !c.startsWith(path + '/')), path] });
    },
    [category, update],
  );

  // Shares the cache with InsightsView; only needed here for the topic chip title.
  const analysis = useQuery({
    queryKey: ['analysis', uploadId],
    queryFn: () => api.getAnalysis(uploadId!),
    enabled: ready && topic !== null,
  });
  const topicTitle =
    analysis.data?.topics.find((t) => t.id === topic)?.title ?? (topic ? `#${topic}` : '');

  const hasFilters = publisher.length > 0 || category.length > 0 || topic !== null;
  const error = uploads.error ?? facets.error ?? publications.error;

  return (
    <div className="layout">
      <aside className="sidebar">
        <h1 className="brand">Discover Stats</h1>
        <UploadPanel
          uploads={uploads.data ?? []}
          selected={uploadId}
          onSelect={(id) => update({ upload: id, publisher: [], category: [], topic: null })}
        />
        {ready && view === 'table' && facets.data && (
          <>
            <CategoryFilter
              tree={facets.data.categories}
              uncategorized={facets.data.uncategorized}
              selected={category}
              onChange={(c) => update({ category: c })}
            />
            <PublisherFilter
              facets={facets.data.publishers}
              selected={publisher}
              onChange={(p) => update({ publisher: p })}
            />
          </>
        )}
      </aside>

      <main className="main">
        {error && <p className="error">{error.message}</p>}

        {ready && (
          <nav className="tabs">
            <button
              className={view === 'table' ? 'tabs__tab tabs__tab--active' : 'tabs__tab'}
              onClick={() => update({ view: 'table' })}
            >
              Публикации
            </button>
            <button
              className={view === 'insights' ? 'tabs__tab tabs__tab--active' : 'tabs__tab'}
              onClick={() => update({ view: 'insights' })}
            >
              Инсайты
            </button>
          </nav>
        )}

        {ready && view === 'insights' ? (
          <InsightsView
            uploadId={uploadId!}
            onOpenTopic={(t) => update({ view: 'table', topic: t.id, publisher: [], category: [] })}
          />
        ) : ready ? (
          <>
            {hasFilters && (
              <div className="chips">
                {topic !== null && (
                  <Chip
                    key="topic"
                    label={`Тема: ${topicTitle}`}
                    onRemove={() => update({ topic: null })}
                  />
                )}
                {category.map((c) => (
                  <Chip
                    key={`c:${c}`}
                    label={c === NO_CATEGORY ? 'Без категории' : c}
                    onRemove={() => update({ category: category.filter((x) => x !== c) })}
                  />
                ))}
                {publisher.map((p) => (
                  <Chip
                    key={`p:${p}`}
                    label={p}
                    onRemove={() => update({ publisher: publisher.filter((x) => x !== p) })}
                  />
                ))}
                <button className="link-button" onClick={resetFilters}>
                  Сбросить все
                </button>
              </div>
            )}
            <PublicationsTable
              data={publications.data}
              loading={publications.isFetching}
              sort={sort}
              order={order}
              onSort={(s, o) => update({ sort: s, order: o })}
              onPage={(p, size) => update({ page: p, pageSize: size })}
              onCategoryClick={addCategory}
              onPublisherClick={addPublisher}
            />
          </>
        ) : (
          !uploads.isLoading && (
            <div className="placeholder">
              <p>Загрузите CSV-выгрузку статистики, чтобы начать.</p>
            </div>
          )
        )}
      </main>
    </div>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="chip">
      {label}
      <button className="chip__remove" aria-label={`Убрать фильтр ${label}`} onClick={onRemove}>
        ×
      </button>
    </span>
  );
}
