import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(serverRoot, '..');

// Local settings (LLM provider, keys) live in <repo>/.env; real env vars take precedence.
try {
  process.loadEnvFile(path.join(repoRoot, '.env'));
} catch {
  // No .env — defaults apply.
}

const dbPath = process.env.DB_PATH ?? path.join(repoRoot, 'data', 'dcvr.sqlite');

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '127.0.0.1',
  dbPath,
  /** Settings edited in the UI (LLM keys); kept next to the database. */
  settingsPath: process.env.SETTINGS_PATH ?? path.join(path.dirname(dbPath), 'settings.json'),
  /** Built frontend, served in production if present. */
  webDist: process.env.WEB_DIST ?? path.join(repoRoot, 'web', 'dist'),
  maxUploadBytes: 50 * 1024 * 1024,
};
