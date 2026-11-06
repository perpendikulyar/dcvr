import { describe, expect, it } from 'vitest';
import { CsvFormatError, parsePublicationsCsv } from '../src/csv/parse.js';
import { loadSample } from './sample.js';

const HEADER =
  'Title,Publisher,Category,Entity,Type,Format,Impressions,Average position,First seen,Last seen,Published,Source URL,Summary,Image URL,Characters';

describe('parsePublicationsCsv', () => {
  it('parses the sample export', () => {
    const records = parsePublicationsCsv(loadSample());
    expect(records).toHaveLength(2962);
    expect(records[0]).toMatchObject({
      publisher: 'hibiny.ru',
      category: null,
      impressions: 2953321,
      avg_position: 5.38,
    });
    expect(records.filter((r) => r.category?.startsWith('/Sports')).length).toBeGreaterThan(0);
  });

  it('handles quoted commas, locale numbers and empty values', () => {
    const csv = `${HEADER}\n"A, quoted ""title""",x.ru,/News/Weather/,,News,,"1 234","2,5",,,,https://x.ru/a,,,\n`;
    const [r] = parsePublicationsCsv(csv);
    expect(r).toMatchObject({
      title: 'A, quoted "title"',
      category: '/News/Weather',
      entity: null,
      impressions: 1234,
      avg_position: 2.5,
      summary: null,
    });
  });

  it('rejects files without required columns', () => {
    expect(() => parsePublicationsCsv('Title,Foo\nx,y\n')).toThrow(CsvFormatError);
    expect(() => parsePublicationsCsv('Title,Foo\nx,y\n')).toThrow(/Publisher/);
  });

  it('rejects an empty file', () => {
    expect(() => parsePublicationsCsv('')).toThrow(CsvFormatError);
  });
});
