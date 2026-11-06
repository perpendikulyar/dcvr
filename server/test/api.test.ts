import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CategoryNode, Facets, PublicationsPage, Upload } from '@dcvr/shared';
import { buildApp } from '../src/app.js';
import { openDb } from '../src/db/index.js';
import { loadSample, SAMPLE_NAME } from './sample.js';

const db = openDb(':memory:');
const app = await buildApp(db);
let upload: Upload;

function multipart(filename: string, content: Buffer | string) {
  const boundary = '----dcvrtest';
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        'Content-Type: text/csv\r\n\r\n',
    ),
    Buffer.from(content),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

async function getPage(query: string): Promise<PublicationsPage> {
  const res = await app.inject(`/api/uploads/${upload.id}/publications?${query}`);
  expect(res.statusCode).toBe(200);
  return res.json();
}

function findNode(nodes: CategoryNode[], path: string): CategoryNode | undefined {
  for (const n of nodes) {
    if (n.path === path) return n;
    const found = findNode(n.children, path);
    if (found) return found;
  }
}

beforeAll(async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/uploads',
    ...multipart(SAMPLE_NAME, loadSample()),
  });
  expect(res.statusCode).toBe(201);
  upload = res.json();
});

afterAll(async () => {
  await app.close();
  db.close();
});

describe('uploads', () => {
  it('stores the upload', async () => {
    expect(upload).toMatchObject({ filename: SAMPLE_NAME, rowCount: 2962 });
    const list: Upload[] = (await app.inject('/api/uploads')).json();
    expect(list.map((u) => u.id)).toContain(upload.id);
  });

  it('rejects a CSV with the wrong columns', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/uploads',
      ...multipart('x.csv', 'a,b\n1,2\n'),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/обязательных колонок/);
  });

  it('deletes an upload with its rows', async () => {
    const created: Upload = (
      await app.inject({
        method: 'POST',
        url: '/api/uploads',
        ...multipart('copy.csv', loadSample()),
      })
    ).json();
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/uploads/${created.id}` })).statusCode,
    ).toBe(204);
    expect((await app.inject(`/api/uploads/${created.id}/publications`)).statusCode).toBe(404);
    const { n } = db
      .prepare('SELECT COUNT(*) AS n FROM publications WHERE upload_id = ?')
      .get(created.id) as {
      n: number;
    };
    expect(n).toBe(0);
  });
});

describe('publications', () => {
  it('sorts by impressions desc by default and paginates', async () => {
    const page = await getPage('pageSize=10');
    expect(page.total).toBe(2962);
    expect(page.items).toHaveLength(10);
    const values = page.items.map((i) => i.impressions!);
    expect(values).toEqual([...values].sort((a, b) => b - a));
    expect(page.items[0]).toHaveProperty('sourceUrl');
  });

  it('filters by publisher', async () => {
    const page = await getPage('publisher=vedomosti.ru&publisher=pikabu.ru&pageSize=200');
    expect(page.total).toBe(34 + 191);
    expect(new Set(page.items.map((i) => i.publisher))).toEqual(
      new Set(['vedomosti.ru', 'pikabu.ru']),
    );
  });

  it('includes descendant categories when filtering by a parent', async () => {
    const page = await getPage('category=/Sports&pageSize=200');
    const soccer = await getPage('category=/Sports/Team Sports/Soccer');
    expect(soccer.total).toBe(140);
    expect(page.total).toBeGreaterThan(soccer.total);
    expect(
      page.items.every((i) => i.category === '/Sports' || i.category!.startsWith('/Sports/')),
    ).toBe(true);
  });

  it('does not match sibling categories sharing a prefix', async () => {
    const page = await getPage('category=/News&pageSize=200');
    expect(
      page.items.every((i) => i.category === '/News' || i.category!.startsWith('/News/')),
    ).toBe(true);
  });

  it('filters rows without a category', async () => {
    const page = await getPage('category=__none__');
    expect(page.total).toBe(608);
  });

  it('rejects an unknown sort field', async () => {
    const res = await app.inject(`/api/uploads/${upload.id}/publications?sort=drop`);
    expect(res.statusCode).toBe(400);
  });
});

describe('facets', () => {
  it('returns publisher counts and a category tree with rolled-up counts', async () => {
    const facets: Facets = (await app.inject(`/api/uploads/${upload.id}/facets`)).json();
    expect(facets.publishers[0]).toEqual({ publisher: 'pikabu.ru', count: 191 });
    expect(facets.uncategorized).toBe(608);

    const sports = findNode(facets.categories, '/Sports')!;
    expect(sports.count).toBe((await getPage('category=/Sports')).total);
    expect(findNode(sports.children, '/Sports/Team Sports/Soccer')?.count).toBe(140);

    const total = facets.categories.reduce((s, n) => s + n.count, 0) + facets.uncategorized;
    expect(total).toBe(2962);
  });

  it('applies the other facet filter but not its own', async () => {
    const facets: Facets = (
      await app.inject(`/api/uploads/${upload.id}/facets?publisher=vedomosti.ru&category=/Sports`)
    ).json();
    // Publisher counts are limited by the category filter only.
    expect(facets.publishers.every((p) => p.count <= 191)).toBe(true);
    // Category counts are limited to vedomosti.ru only.
    const total = facets.categories.reduce((s, n) => s + n.count, 0) + facets.uncategorized;
    expect(total).toBe(34);
  });
});
