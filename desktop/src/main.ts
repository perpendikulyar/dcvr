import fs from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';

const here = path.dirname(fileURLToPath(import.meta.url));

// Server config is read from the environment when its modules load, so this has
// to happen before the dynamic imports below.
process.env.DB_PATH ??= path.join(app.getPath('userData'), 'dcvr.sqlite');
process.env.WEB_DIST ??= app.isPackaged
  ? path.join(process.resourcesPath, 'web')
  : path.resolve(here, '../../web/dist');

/** Starts the API + UI server on a free localhost port. */
async function startServer() {
  const { openDb } = await import('../../server/src/db/index.js');
  const { buildApp } = await import('../../server/src/app.js');
  const { config } = await import('../../server/src/config.js');

  const db = openDb(config.dbPath);
  const server = await buildApp(db, { server: { logger: { level: 'warn' } } });
  await server.listen({ host: '127.0.0.1', port: 0 });
  const { port } = server.server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    close: async () => {
      await server.close();
      db.close();
    },
  };
}

let server: Awaited<ReturnType<typeof startServer>> | undefined;
let window: BrowserWindow | undefined;

function createWindow(url: string) {
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Discover Stats',
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
  });

  // Source links (target=_blank) and any navigation away from the app open in the browser.
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    openExternal(target);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, target) => {
    if (!target.startsWith(url)) {
      event.preventDefault();
      openExternal(target);
    }
  });
  window.on('closed', () => {
    window = undefined;
  });

  void window.loadURL(url);
}

function openExternal(target: string) {
  if (/^https?:\/\//i.test(target)) void shell.openExternal(target);
}

/** Saves the page, rendered with its print stylesheet, as a PDF the user picks. */
ipcMain.handle('save-pdf', async (event, defaultName: unknown) => {
  const owner = BrowserWindow.fromWebContents(event.sender);
  if (!owner || !server || !event.senderFrame?.url.startsWith(server.url)) {
    throw new Error('Недоступно');
  }
  const name = String(defaultName || 'insights.pdf').replace(/[\\/:*?"<>|]+/g, '-');
  const { canceled, filePath } = await dialog.showSaveDialog(owner, {
    title: 'Сохранить PDF',
    defaultPath: path.join(app.getPath('documents'), name),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return { saved: false };

  const pdf = await event.sender.printToPDF({ printBackground: true, preferCSSPageSize: true });
  await fs.writeFile(filePath, pdf);
  shell.showItemInFolder(filePath);
  return { saved: true, path: filePath };
});

// One instance: the second launch focuses the existing window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });

  app.whenReady().then(async () => {
    try {
      server = await startServer();
    } catch (err) {
      dialog.showErrorBox('Не удалось запустить Discover Stats', (err as Error).stack ?? String(err));
      app.quit();
      return;
    }
    createWindow(server.url);
    app.on('activate', () => {
      if (!window && server) createWindow(server.url);
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  // Stop the server (and any analysis) before exiting; a stopped analysis can be resumed later.
  let closing = false;
  app.on('before-quit', (event) => {
    if (closing || !server) return;
    closing = true;
    event.preventDefault();
    void server.close().finally(() => app.quit());
  });
}
