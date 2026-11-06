import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const statDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../stat_files');

export const SAMPLE_NAME = 'discover-publications-20261028-1149.xlsx - Publications.csv';

export function loadSample(): Buffer {
  return fs.readFileSync(path.join(statDir, SAMPLE_NAME));
}
