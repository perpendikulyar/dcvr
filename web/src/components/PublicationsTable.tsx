import { useMemo, useState } from 'react';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type RowData,
} from '@tanstack/react-table';
import type { PublicationRow, PublicationsPage, SortField, SortOrder } from '@dcvr/shared';
import { PAGE_SIZES } from '../hooks/useUrlState';

interface Props {
  data: PublicationsPage | undefined;
  loading: boolean;
  sort: SortField;
  order: SortOrder;
  onSort: (sort: SortField, order: SortOrder) => void;
  onPage: (page: number, pageSize: number) => void;
  onCategoryClick: (path: string) => void;
  onPublisherClick: (publisher: string) => void;
}

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Server-side sort field; sortable columns only. */
    sort?: SortField;
    className?: string;
  }
}

const column = createColumnHelper<PublicationRow>();

export function PublicationsTable(props: Props) {
  const { data, loading, sort, order, onSort, onPage, onCategoryClick, onPublisherClick } = props;
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const columns = useMemo(
    () => [
      column.accessor('title', {
        header: 'Title',
        meta: { sort: 'title', className: 'col-title' },
      }),
      column.accessor('publisher', {
        header: 'Publisher',
        meta: { sort: 'publisher', className: 'col-publisher' },
        cell: (c) => {
          const publisher = c.getValue();
          return (
            publisher && (
              <button
                className="link-button"
                title="Добавить в фильтр"
                onClick={() => onPublisherClick(publisher)}
              >
                {publisher}
              </button>
            )
          );
        },
      }),
      column.accessor('category', {
        header: 'Category',
        meta: { sort: 'category', className: 'col-category' },
        cell: (c) => <CategoryPath path={c.getValue()} onClick={onCategoryClick} />,
      }),
      column.accessor('entity', { header: 'Entity', meta: { className: 'col-entity' } }),
      column.accessor('sourceUrl', {
        header: '',
        meta: { className: 'col-source' },
        cell: (c) => {
          const url = c.getValue();
          return (
            url && (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                title={url}
                aria-label="Открыть источник"
              >
                <ExternalLinkIcon />
              </a>
            )
          );
        },
      }),
      column.accessor('summary', {
        header: 'Summary',
        meta: { className: 'col-summary' },
        cell: (c) => {
          const summary = c.getValue();
          if (!summary) return null;
          const id = c.row.original.id;
          const open = expanded.has(id);
          return (
            <button
              className={`summary${open ? ' summary--open' : ''}`}
              title={open ? 'Свернуть' : 'Показать полностью'}
              onClick={() =>
                setExpanded((prev) => {
                  const next = new Set(prev);
                  if (open) next.delete(id);
                  else next.add(id);
                  return next;
                })
              }
            >
              {summary}
            </button>
          );
        },
      }),
      column.accessor('impressions', {
        header: 'Impressions',
        meta: { sort: 'impressions', className: 'col-number' },
        cell: (c) => c.getValue()?.toLocaleString('ru-RU'),
      }),
    ],
    [expanded, onCategoryClick, onPublisherClick],
  );

  const table = useReactTable({
    data: data?.items ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => String(row.id),
    manualSorting: true,
    manualPagination: true,
  });

  const headerClick = (field: SortField) => {
    if (field === sort) onSort(field, order === 'asc' ? 'desc' : 'asc');
    else onSort(field, field === 'impressions' ? 'desc' : 'asc');
  };

  const total = data?.total ?? 0;
  const page = data?.page ?? 1;
  const pageSize = data?.pageSize ?? PAGE_SIZES[1]!;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(page * pageSize, total);

  return (
    <section className={`table-wrap${loading ? ' table-wrap--loading' : ''}`}>
      <table className="table">
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => {
                const meta = header.column.columnDef.meta;
                const field = meta?.sort;
                const label = flexRender(header.column.columnDef.header, header.getContext());
                return (
                  <th
                    key={header.id}
                    className={meta?.className}
                    aria-sort={
                      field === sort ? (order === 'asc' ? 'ascending' : 'descending') : undefined
                    }
                  >
                    {field ? (
                      <button className="th-sort" onClick={() => headerClick(field)}>
                        {label}
                        <span className="th-sort__arrow">
                          {field === sort ? (order === 'asc' ? '▲' : '▼') : ''}
                        </span>
                      </button>
                    ) : (
                      label
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className={cell.column.columnDef.meta?.className}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
          {!loading && !total && (
            <tr>
              <td colSpan={columns.length} className="empty">
                Ничего не найдено. Попробуйте изменить фильтры.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <footer className="pager">
        <span className="muted">
          {from.toLocaleString('ru-RU')}–{to.toLocaleString('ru-RU')} из{' '}
          {total.toLocaleString('ru-RU')}
        </span>
        <div className="pager__controls">
          <label className="muted">
            Строк:{' '}
            <select value={pageSize} onChange={(e) => onPage(1, Number(e.target.value))}>
              {PAGE_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <button disabled={page <= 1} onClick={() => onPage(page - 1, pageSize)}>
            ← Назад
          </button>
          <span>
            {page} / {pages}
          </span>
          <button disabled={page >= pages} onClick={() => onPage(page + 1, pageSize)}>
            Вперёд →
          </button>
        </div>
      </footer>
    </section>
  );
}

function CategoryPath({ path, onClick }: { path: string | null; onClick: (path: string) => void }) {
  if (!path) return null;
  const segments = path.split('/').filter(Boolean);
  return (
    <span className="crumbs">
      {segments.map((name, i) => {
        const prefix = '/' + segments.slice(0, i + 1).join('/');
        return (
          <span key={prefix}>
            {i > 0 && <span className="crumbs__sep">›</span>}
            <button
              className="link-button"
              title={`Фильтр: ${prefix}`}
              onClick={() => onClick(prefix)}
            >
              {name}
            </button>
          </span>
        );
      })}
    </span>
  );
}

function ExternalLinkIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 3h7v7" />
      <path d="M10 14 21 3" />
      <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
    </svg>
  );
}
