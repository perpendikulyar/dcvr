import { useMemo, useState } from 'react';
import type { PublisherFacet } from '@dcvr/shared';

interface Props {
  facets: PublisherFacet[];
  selected: string[];
  onChange: (selected: string[]) => void;
}

export function PublisherFilter({ facets, selected, onChange }: Props) {
  const [search, setSearch] = useState('');

  // Selected publishers stay visible on top even if the category filter leaves them with 0 rows.
  const options = useMemo(() => {
    const counts = new Map(facets.map((f) => [f.publisher, f.count]));
    const chosen = selected.map((publisher) => ({ publisher, count: counts.get(publisher) ?? 0 }));
    const rest = facets.filter((f) => !selected.includes(f.publisher));
    const needle = search.trim().toLowerCase();
    return [...chosen, ...rest].filter(
      (f) => !needle || f.publisher.toLowerCase().includes(needle),
    );
  }, [facets, selected, search]);

  const toggle = (publisher: string) =>
    onChange(
      selected.includes(publisher)
        ? selected.filter((p) => p !== publisher)
        : [...selected, publisher],
    );

  return (
    <section className="panel filter">
      <header className="filter__header">
        <h2>Publisher</h2>
        {selected.length > 0 && (
          <button className="link-button" onClick={() => onChange([])}>
            Сбросить ({selected.length})
          </button>
        )}
      </header>
      <input
        className="search"
        type="search"
        placeholder={`Поиск среди ${facets.length}`}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <ul className="options">
        {options.map((f) => (
          <li key={f.publisher}>
            <label className="option">
              <input
                type="checkbox"
                checked={selected.includes(f.publisher)}
                onChange={() => toggle(f.publisher)}
              />
              <span className="option__label">{f.publisher}</span>
              <span className="count">{f.count.toLocaleString('ru-RU')}</span>
            </label>
          </li>
        ))}
        {!options.length && <li className="muted">Ничего не найдено</li>}
      </ul>
    </section>
  );
}
