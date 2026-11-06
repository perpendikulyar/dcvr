import { buildApp } from './app.js';
import { config } from './config.js';
import { openDb } from './db/index.js';

const db = openDb(config.dbPath);
const app = await buildApp(db, { server: { logger: true } });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    db.close();
    process.exit(0);
  });
}

try {
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
    console.error(
      `Порт ${config.port} уже занят (возможно, запущен npm run dev). ` +
        'Остановите другой процесс или задайте другой порт: PORT=3001 npm start',
    );
    db.close();
    process.exit(1);
  }
  throw err;
}
