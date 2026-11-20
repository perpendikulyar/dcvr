import fs from 'node:fs';
import path from 'node:path';
import type { LlmSettings } from '@dcvr/shared';

/** Stored form; the API key is never sent back to the UI. */
interface StoredSettings {
  yandexApiKey?: string;
  yandexFolderId?: string;
}

/** Settings edited in the UI. They override the same values from .env / the environment. */
export class SettingsStore {
  constructor(private readonly file: string) {}

  read(): StoredSettings {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8')) as StoredSettings;
    } catch {
      return {};
    }
  }

  /** `undefined` keeps a value, an empty string clears it. */
  update(patch: StoredSettings): void {
    const next = { ...this.read() };
    for (const [key, value] of Object.entries(patch) as [
      keyof StoredSettings,
      string | undefined,
    ][]) {
      if (value === undefined) continue;
      if (value.trim()) next[key] = value.trim();
      else delete next[key];
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    // The file holds an API key: readable by the owner only.
    fs.writeFileSync(this.file, JSON.stringify(next, null, 2), { mode: 0o600 });
  }

  /** Environment for providerFromEnv: process env with saved settings on top. */
  env(): NodeJS.ProcessEnv {
    const s = this.read();
    return {
      ...process.env,
      ...(s.yandexApiKey && { YANDEX_API_KEY: s.yandexApiKey }),
      ...(s.yandexFolderId && { YANDEX_FOLDER_ID: s.yandexFolderId }),
    };
  }

  /** What the UI may see: whether a key is set and its last characters, never the key. */
  view(): LlmSettings {
    const env = this.env();
    const key = env.YANDEX_API_KEY;
    return {
      provider: env.LLM_PROVIDER ?? 'yandex',
      yandexFolderId: env.YANDEX_FOLDER_ID ?? '',
      yandexApiKeySet: Boolean(key),
      yandexApiKeyHint: key ? `…${key.slice(-4)}` : '',
    };
  }
}
