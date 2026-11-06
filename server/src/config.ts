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

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '127.0.0.1',
  dbPath: process.env.DB_PATH ?? path.join(repoRoot, 'data', 'dcvr.sqlite'),
  /** Built frontend, served in production if present. */
  webDist: path.join(repoRoot, 'web', 'dist'),
  maxUploadBytes: 50 * 1024 * 1024,
};
