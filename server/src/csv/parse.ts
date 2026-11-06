import { parse } from 'csv-parse/sync';

/** A CSV row normalized for storage. Keys match `publications` columns. */
export interface PublicationRecord {
  title: string;
  publisher: string | null;
  category: string | null;
  entity: string | null;
  type: string | null;
  format: string | null;
  impressions: number | null;
  avg_position: number | null;
  first_seen: string | null;
  last_seen: string | null;
  published: string | null;
  source_url: string | null;
  summary: string | null;
  image_url: string | null;
  characters: number | null;
}

/** CSV header → record field. Columns marked required must be present in the header. */
const COLUMNS = [
  { header: 'Title', field: 'title', kind: 'text', required: true },
  { header: 'Publisher', field: 'publisher', kind: 'text', required: true },
  { header: 'Category', field: 'category', kind: 'category', required: true },
  { header: 'Entity', field: 'entity', kind: 'text', required: true },
  { header: 'Type', field: 'type', kind: 'text', required: false },
  { header: 'Format', field: 'format', kind: 'text', required: false },
  { header: 'Impressions', field: 'impressions', kind: 'int', required: true },
  { header: 'Average position', field: 'avg_position', kind: 'float', required: false },
  { header: 'First seen', field: 'first_seen', kind: 'text', required: false },
  { header: 'Last seen', field: 'last_seen', kind: 'text', required: false },
  { header: 'Published', field: 'published', kind: 'text', required: false },
  { header: 'Source URL', field: 'source_url', kind: 'text', required: true },
  { header: 'Summary', field: 'summary', kind: 'text', required: true },
  { header: 'Image URL', field: 'image_url', kind: 'text', required: false },
  { header: 'Characters', field: 'characters', kind: 'int', required: false },
] as const satisfies readonly {
  header: string;
  field: keyof PublicationRecord;
  kind: 'text' | 'category' | 'int' | 'float';
  required: boolean;
}[];

export class CsvFormatError extends Error {}

export function parsePublicationsCsv(input: string | Buffer): PublicationRecord[] {
  let rows: string[][];
  try {
    rows = parse(input, { bom: true, skip_empty_lines: true, relax_column_count: true });
  } catch (err) {
    throw new CsvFormatError(`Не удалось разобрать CSV: ${(err as Error).message}`);
  }

  const [header, ...data] = rows;
  if (!header) throw new CsvFormatError('Файл пустой');

  const index = new Map(header.map((name, i) => [name.trim(), i]));
  const missing = COLUMNS.filter((c) => c.required && !index.has(c.header)).map((c) => c.header);
  if (missing.length) {
    throw new CsvFormatError(`В файле нет обязательных колонок: ${missing.join(', ')}`);
  }

  return data.map((row) => {
    const record = {} as Record<keyof PublicationRecord, string | number | null>;
    for (const col of COLUMNS) {
      const i = index.get(col.header);
      const raw = i === undefined ? undefined : row[i];
      record[col.field] = normalize(raw, col.kind);
    }
    record.title ??= '';
    return record as unknown as PublicationRecord;
  });
}

function normalize(
  raw: string | undefined,
  kind: 'text' | 'category' | 'int' | 'float',
): string | number | null {
  const value = raw?.trim();
  if (!value) return null;
  switch (kind) {
    case 'text':
      return value;
    case 'category': {
      // "/Sports/Soccer/" → "/Sports/Soccer"; keep a single leading slash.
      const segments = value
        .split('/')
        .map((s) => s.trim())
        .filter(Boolean);
      return segments.length ? '/' + segments.join('/') : null;
    }
    case 'int':
    case 'float': {
      // Locale-formatted numbers: "5,38" → 5.38, "1 234" → 1234.
      const n = Number(value.replace(/\s/g, '').replace(',', '.'));
      if (!Number.isFinite(n)) return null;
      return kind === 'int' ? Math.round(n) : n;
    }
  }
}
