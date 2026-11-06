import type { Upload } from '@dcvr/shared';
import { transaction, type Db } from '../db/index.js';
import type { PublicationRecord } from '../csv/parse.js';

const FIELDS = [
  'title',
  'publisher',
  'category',
  'entity',
  'type',
  'format',
  'impressions',
  'avg_position',
  'first_seen',
  'last_seen',
  'published',
  'source_url',
  'summary',
  'image_url',
  'characters',
] as const satisfies readonly (keyof PublicationRecord)[];

const UPLOAD_COLUMNS = 'id, filename, uploaded_at AS uploadedAt, row_count AS rowCount';

export function createUpload(db: Db, filename: string, records: PublicationRecord[]): Upload {
  return transaction(db, () => {
    const upload = db
      .prepare(
        `INSERT INTO uploads (filename, uploaded_at, row_count) VALUES (?, ?, ?)
         RETURNING ${UPLOAD_COLUMNS}`,
      )
      .get(filename, new Date().toISOString(), records.length) as unknown as Upload;

    const insert = db.prepare(
      `INSERT INTO publications (upload_id, ${FIELDS.join(', ')})
       VALUES (?, ${FIELDS.map(() => '?').join(', ')})`,
    );
    for (const r of records) insert.run(upload.id, ...FIELDS.map((f) => r[f]));

    return { ...upload };
  });
}

export function listUploads(db: Db): Upload[] {
  return db
    .prepare(`SELECT ${UPLOAD_COLUMNS} FROM uploads ORDER BY id DESC`)
    .all() as unknown as Upload[];
}

export function uploadExists(db: Db, id: number): boolean {
  return db.prepare('SELECT 1 FROM uploads WHERE id = ?').get(id) !== undefined;
}

/** Returns false if there was no such upload. Publications go with it via ON DELETE CASCADE. */
export function deleteUpload(db: Db, id: number): boolean {
  return Number(db.prepare('DELETE FROM uploads WHERE id = ?').run(id).changes) > 0;
}
