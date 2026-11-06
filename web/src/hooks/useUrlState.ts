import { useCallback, useEffect, useState } from 'react';
import type { SortField, SortOrder } from '@dcvr/shared';

export type View = 'table' | 'insights';

export interface ViewState {
  view: View;
  upload: number | null;
  /** AI topic whose publications the table shows. */
  topic: number | null;
  publisher: string[];
  category: string[];
  sort: SortField;
  order: SortOrder;
  page: number;
  pageSize: number;
}

const SORT_FIELDS: SortField[] = ['impressions', 'title', 'publisher', 'category'];
export const PAGE_SIZES = [25, 50, 100, 200];

const DEFAULTS: ViewState = {
  view: 'table',
  upload: null,
  topic: null,
  publisher: [],
  category: [],
  sort: 'impressions',
  order: 'desc',
  page: 1,
  pageSize: 50,
};

function read(): ViewState {
  const p = new URLSearchParams(window.location.search);
  const int = (key: string) => {
    const n = Number(p.get(key));
    return Number.isInteger(n) && n > 0 ? n : null;
  };
  const sort = p.get('sort') as SortField;
  const pageSize = int('pageSize');
  return {
    view: p.get('view') === 'insights' ? 'insights' : 'table',
    upload: int('upload'),
    topic: int('topic'),
    publisher: p.getAll('publisher'),
    category: p.getAll('category'),
    sort: SORT_FIELDS.includes(sort) ? sort : DEFAULTS.sort,
    order: p.get('order') === 'asc' ? 'asc' : DEFAULTS.order,
    page: int('page') ?? DEFAULTS.page,
    pageSize: pageSize && PAGE_SIZES.includes(pageSize) ? pageSize : DEFAULTS.pageSize,
  };
}

function write(state: ViewState): string {
  const p = new URLSearchParams();
  if (state.view !== DEFAULTS.view) p.set('view', state.view);
  if (state.upload) p.set('upload', String(state.upload));
  if (state.topic) p.set('topic', String(state.topic));
  state.publisher.forEach((v) => p.append('publisher', v));
  state.category.forEach((v) => p.append('category', v));
  if (state.sort !== DEFAULTS.sort) p.set('sort', state.sort);
  if (state.order !== DEFAULTS.order) p.set('order', state.order);
  if (state.page !== DEFAULTS.page) p.set('page', String(state.page));
  if (state.pageSize !== DEFAULTS.pageSize) p.set('pageSize', String(state.pageSize));
  const search = p.toString();
  return search ? `?${search}` : window.location.pathname;
}

/**
 * View state (selected upload, filters, sorting, paging) mirrored into the URL,
 * so a filtered view can be bookmarked or shared. Any change other than
 * page/pageSize resets to the first page.
 */
export function useUrlState() {
  const [state, setState] = useState<ViewState>(read);

  useEffect(() => {
    const onPop = () => setState(read());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const update = useCallback((patch: Partial<ViewState>) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      if (!('page' in patch)) next.page = 1;
      window.history.replaceState(null, '', write(next));
      return next;
    });
  }, []);

  const resetFilters = useCallback(
    () => update({ publisher: [], category: [], topic: null }),
    [update],
  );

  return { state, update, resetFilters };
}
