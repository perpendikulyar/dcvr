import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { LlmSettings } from '@dcvr/shared';
import { buildApp } from '../src/app.js';
import { openDb } from '../src/db/index.js';
import type { LlmProvider } from '../src/ai/llm.js';
import { SettingsStore } from '../src/settings.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dcvr-settings-'));
const settingsPath = path.join(dir, 'settings.json');

let fail = false;
const provider: LlmProvider = {
  name: 'fake',
  mapModel: 'fake-map',
  synthModel: 'fake-synth',
  async complete() {
    if (fail) throw new Error('HTTP 401 Unauthorized');
    return 'готово';
  },
};

const db = openDb(':memory:');
const app = await buildApp(db, { provider: () => provider, settingsPath });

afterAll(async () => {
  await app.close();
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('settings', () => {
  it('saves the key without ever returning it', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { yandexApiKey: ' secret-key-ABCD ', yandexFolderId: 'b1gtestfolder' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('secret-key');
    expect(res.json()).toMatchObject({
      yandexFolderId: 'b1gtestfolder',
      yandexApiKeySet: true,
      yandexApiKeyHint: '…ABCD',
    });

    const get = await app.inject('/api/settings');
    expect(get.body).not.toContain('secret-key');
    expect(JSON.parse(fs.readFileSync(settingsPath, 'utf8'))).toEqual({
      yandexApiKey: 'secret-key-ABCD',
      yandexFolderId: 'b1gtestfolder',
    });
  });

  it('keeps omitted fields and clears empty ones', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { yandexFolderId: 'b1gother' },
    });
    const store = new SettingsStore(settingsPath);
    expect(store.read()).toEqual({ yandexApiKey: 'secret-key-ABCD', yandexFolderId: 'b1gother' });

    await app.inject({ method: 'PUT', url: '/api/settings', payload: { yandexApiKey: '' } });
    expect(store.read()).toEqual({ yandexFolderId: 'b1gother' });
  });

  it('saved settings override the environment', () => {
    const store = new SettingsStore(settingsPath);
    store.update({ yandexApiKey: 'from-ui' });
    expect(store.env().YANDEX_API_KEY).toBe('from-ui');
    expect((store.view() satisfies LlmSettings).yandexFolderId).toBe('b1gother');
  });

  it('tests the connection with the current provider', async () => {
    const ok = await app.inject({ method: 'POST', url: '/api/settings/test' });
    expect(ok.json()).toEqual({ ok: true, provider: 'fake' });

    fail = true;
    const bad = await app.inject({ method: 'POST', url: '/api/settings/test' });
    fail = false;
    expect(bad.statusCode).toBe(502);
    expect(bad.json().error).toMatch(/401/);
  });
});
