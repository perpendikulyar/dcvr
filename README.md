# Discover Stats Viewer (dcvr)

Веб-сервис для просмотра CSV-выгрузок статистики публикаций с фильтрацией по Publisher и
иерархической Category. Бриф и план работ лежат в [`ai_context/poster.md`](ai_context/poster.md).

## Требования

- Node.js **22.13+** (используется встроенный `node:sqlite`, нативные модули не нужны)

## Запуск

```bash
npm install
npm run dev        # API на :3000, UI на http://localhost:5173 (с прокси /api)
```

Production:

```bash
npm run build
npm start          # API и собранный UI на http://127.0.0.1:3000
```

Переменные окружения: `PORT` (3000), `HOST` (127.0.0.1), `DB_PATH` (`data/dcvr.sqlite`),
настройки LLM — см. `.env.example` (скопируйте в `.env`).

## ИИ-анализ

Вкладка **«Инсайты»** у выгрузки: модель размечает публикации, объединяет их в темы, оценивает
соответствие интересам аудитории (DMP) и предлагает идеи контента для топ-15 тем. Подробности —
[`ai_context/poster-ai.md`](ai_context/poster-ai.md).

- Провайдер по умолчанию — **YandexGPT**: задайте `YANDEX_API_KEY` и `YANDEX_FOLDER_ID` в `.env`.
  Другие OpenAI-совместимые API — `LLM_PROVIDER=openai-compatible` (см. `.env.example`).
- Ошибки 429/5xx повторяются автоматически; прерванный анализ можно продолжить с места остановки
  или завершить по уже обработанным данным.
- Публикации и темы, которые модель отказывается обрабатывать (встроенная модерация), находятся
  делением батча пополам и пропускаются — анализ не останавливается; их число видно в результатах.
- Vireonix не поддерживается: его правила запрещают автоматическую пакетную обработку.
- Профиль аудитории (интересы DMP, исключённые темы и категории, веса скоринга) —
  `server/src/ai/audience.ts`.

## Проверки

```bash
npm test           # тесты парсера и API на примере из stat_files/
npm run typecheck
npm run lint
```

## Формат CSV

Колонки ищутся по имени заголовка, порядок не важен.

- **Обязательные:** `Title, Publisher, Category, Entity, Impressions, Source URL, Summary`
- **Опциональные** (сохраняются в БД для ИИ-анализа): `Type, Format, Average position, First seen,
  Last seen, Published, Image URL, Characters`

Числа в локализованном формате (`"5,38"`, `"1 234"`) нормализуются. Category — путь через `/`;
фильтр по родителю включает все подкатегории.

## Структура

```
shared/   общие TS-типы API (index.d.ts)
server/   Fastify + SQLite: импорт CSV, API, миграции, тесты
web/      React + Vite + TanStack Query/Table
```

## API

| Метод | Путь | |
|---|---|---|
| GET | `/api/uploads` | список выгрузок |
| POST | `/api/uploads` | загрузка CSV (multipart, поле `file`) |
| DELETE | `/api/uploads/:id` | удаление выгрузки |
| GET | `/api/uploads/:id/publications` | `publisher`, `category` (повторяемые; `__none__` — без категории), `sort`, `order`, `page`, `pageSize` |
| GET | `/api/uploads/:id/facets` | счётчики Publisher и дерево Category |
| GET | `/api/uploads/:id/analysis` | последний ИИ-анализ с результатами (или `null`) |
| POST | `/api/uploads/:id/analysis` | запустить ИИ-анализ |
| POST | `/api/analysis/:id/resume` | продолжить прерванный анализ |
| POST | `/api/analysis/:id/finish` | завершить прерванный анализ по обработанным данным |

`publications` и `facets` также принимают `topic=<id>` — только публикации темы ИИ-анализа.
