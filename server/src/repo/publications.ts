import type {
  CategoryNode,
  Facets,
  NoCategory,
  PublicationRow,
  PublicationsPage,
  SortField,
  SortOrder,
} from '@dcvr/shared';
import type { Db } from '../db/index.js';

export const NO_CATEGORY: NoCategory = '__none__';

export interface Filters {
  publisher: string[];
  category: string[];
  /** AI topic id; applies to every query, facets included. */
  topic?: number;
}

export interface ListOptions extends Filters {
  sort: SortField;
  order: SortOrder;
  page: number;
  pageSize: number;
}

type Param = string | number;

interface Where {
  sql: string;
  params: Param[];
}

const SORT_COLUMNS: Record<SortField, string> = {
  impressions: 'impressions',
  title: 'title COLLATE NOCASE',
  publisher: 'publisher COLLATE NOCASE',
  category: 'category COLLATE NOCASE',
};

export function listPublications(db: Db, uploadId: number, opts: ListOptions): PublicationsPage {
  const where = buildWhere(uploadId, opts, { publisher: true, category: true });

  const { total } = db
    .prepare(`SELECT COUNT(*) AS total FROM publications WHERE ${where.sql}`)
    .get(...where.params) as { total: number };

  // NULLs always last, whatever the direction; id keeps paging stable.
  const sort = SORT_COLUMNS[opts.sort];
  const dir = opts.order === 'asc' ? 'ASC' : 'DESC';
  const items = db
    .prepare(
      `SELECT id, title, publisher, category, entity, source_url AS sourceUrl, summary, impressions
       FROM publications
       WHERE ${where.sql}
       ORDER BY ${opts.sort} IS NULL, ${sort} ${dir}, id
       LIMIT ? OFFSET ?`,
    )
    .all(
      ...where.params,
      opts.pageSize,
      (opts.page - 1) * opts.pageSize,
    ) as unknown as PublicationRow[];

  return { items: items.map((r) => ({ ...r })), total, page: opts.page, pageSize: opts.pageSize };
}

/**
 * Facet counts. Each facet ignores its own filter and applies the other one,
 * so the user can still see (and add) alternatives within the same facet.
 */
export function getFacets(db: Db, uploadId: number, filters: Filters): Facets {
  const byPublisher = buildWhere(uploadId, filters, { publisher: false, category: true });
  const publishers = db
    .prepare(
      `SELECT publisher, COUNT(*) AS count FROM publications
       WHERE ${byPublisher.sql} AND publisher IS NOT NULL
       GROUP BY publisher ORDER BY count DESC, publisher`,
    )
    .all(...byPublisher.params) as unknown as { publisher: string; count: number }[];

  const byCategory = buildWhere(uploadId, filters, { publisher: true, category: false });
  const categoryCounts = db
    .prepare(
      `SELECT category, COUNT(*) AS count FROM publications
       WHERE ${byCategory.sql} GROUP BY category`,
    )
    .all(...byCategory.params) as unknown as { category: string | null; count: number }[];

  let uncategorized = 0;
  const counted: { category: string; count: number }[] = [];
  for (const row of categoryCounts) {
    if (row.category === null) uncategorized = row.count;
    else counted.push({ category: row.category, count: row.count });
  }

  return {
    publishers: publishers.map((p) => ({ ...p })),
    categories: buildCategoryTree(counted),
    uncategorized,
  };
}

/** Builds a tree from "/A/B/C" paths; node counts include all descendants. */
export function buildCategoryTree(rows: { category: string; count: number }[]): CategoryNode[] {
  const root: CategoryNode = { name: '', path: '', count: 0, children: [] };
  const byPath = new Map<string, CategoryNode>();

  for (const { category, count } of rows) {
    let parent = root;
    let path = '';
    for (const name of category.split('/').filter(Boolean)) {
      path += '/' + name;
      let node = byPath.get(path);
      if (!node) {
        node = { name, path, count: 0, children: [] };
        byPath.set(path, node);
        parent.children.push(node);
      }
      node.count += count;
      parent = node;
    }
  }

  const sort = (nodes: CategoryNode[]) => {
    nodes.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    nodes.forEach((n) => sort(n.children));
  };
  sort(root.children);
  return root.children;
}

function buildWhere(
  uploadId: number,
  filters: Filters,
  apply: { publisher: boolean; category: boolean },
): Where {
  const clauses = ['upload_id = ?'];
  const params: Param[] = [uploadId];

  if (filters.topic) {
    clauses.push('id IN (SELECT publication_id FROM ai_topic_items WHERE topic_id = ?)');
    params.push(filters.topic);
  }

  if (apply.publisher && filters.publisher.length) {
    clauses.push(`publisher IN (${filters.publisher.map(() => '?').join(', ')})`);
    params.push(...filters.publisher);
  }

  if (apply.category && filters.category.length) {
    // A path matches itself and every descendant: "/Sports" → "/Sports", "/Sports/…".
    const parts: string[] = [];
    for (const path of filters.category) {
      if (path === NO_CATEGORY) {
        parts.push('category IS NULL');
      } else {
        parts.push(`(category = ? OR category LIKE ? ESCAPE '\\')`);
        params.push(path, escapeLike(path) + '/%');
      }
    }
    clauses.push(`(${parts.join(' OR ')})`);
  }

  return { sql: clauses.join(' AND '), params };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => '\\' + c);
}
