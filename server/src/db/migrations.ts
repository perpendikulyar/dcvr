/**
 * Ordered schema migrations. The index + 1 is stored in PRAGMA user_version.
 * Never edit an applied migration — append a new one.
 */
export const migrations: string[] = [
  `
  CREATE TABLE uploads (
    id          INTEGER PRIMARY KEY,
    filename    TEXT    NOT NULL,
    uploaded_at TEXT    NOT NULL,
    row_count   INTEGER NOT NULL
  );

  CREATE TABLE publications (
    id           INTEGER PRIMARY KEY,
    upload_id    INTEGER NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
    title        TEXT    NOT NULL,
    publisher    TEXT,
    category     TEXT,
    entity       TEXT,
    type         TEXT,
    format       TEXT,
    impressions  INTEGER,
    avg_position REAL,
    first_seen   TEXT,
    last_seen    TEXT,
    published    TEXT,
    source_url   TEXT,
    summary      TEXT,
    image_url    TEXT,
    characters   INTEGER
  );

  CREATE INDEX idx_publications_impressions ON publications(upload_id, impressions);
  CREATE INDEX idx_publications_publisher   ON publications(upload_id, publisher);
  CREATE INDEX idx_publications_category    ON publications(upload_id, category);
  `,
  `
  CREATE TABLE ai_runs (
    id             INTEGER PRIMARY KEY,
    upload_id      INTEGER NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
    provider       TEXT    NOT NULL,
    map_model      TEXT    NOT NULL,
    synth_model    TEXT    NOT NULL,
    status         TEXT    NOT NULL, -- queued | running | done | failed
    step           TEXT    NOT NULL, -- prefilter | map | reduce | score | synth | done
    progress_done  INTEGER NOT NULL DEFAULT 0,
    progress_total INTEGER NOT NULL DEFAULT 0,
    error          TEXT,
    created_at     TEXT    NOT NULL,
    finished_at    TEXT
  );
  CREATE INDEX idx_ai_runs_upload ON ai_runs(upload_id, id);

  -- Map step output; also the resume point: labelled rows are not sent again.
  CREATE TABLE ai_item_labels (
    run_id         INTEGER NOT NULL REFERENCES ai_runs(id) ON DELETE CASCADE,
    publication_id INTEGER NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
    relevant       INTEGER NOT NULL,
    label          TEXT,
    interests_json TEXT    NOT NULL DEFAULT '[]',
    PRIMARY KEY (run_id, publication_id)
  );

  CREATE TABLE ai_topics (
    id               INTEGER PRIMARY KEY,
    run_id           INTEGER NOT NULL REFERENCES ai_runs(id) ON DELETE CASCADE,
    rank             INTEGER,          -- position in the final top, NULL if not in it
    title            TEXT    NOT NULL,
    labels_json      TEXT    NOT NULL,
    interests_json   TEXT    NOT NULL, -- [{ id, count }]
    audience_score   REAL    NOT NULL,
    impressions      INTEGER NOT NULL,
    publications     INTEGER NOT NULL,
    publishers       INTEGER NOT NULL,
    why_trending     TEXT,
    interests_reason TEXT,
    ideas_json       TEXT,
    related_json     TEXT
  );
  CREATE INDEX idx_ai_topics_run ON ai_topics(run_id, rank);

  CREATE TABLE ai_topic_items (
    topic_id       INTEGER NOT NULL REFERENCES ai_topics(id) ON DELETE CASCADE,
    publication_id INTEGER NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
    PRIMARY KEY (topic_id, publication_id)
  );
  `,
  `
  -- Rows the model refused (moderation) or that were skipped to finish a run.
  ALTER TABLE ai_item_labels ADD COLUMN skipped INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE ai_item_labels ADD COLUMN skip_reason TEXT;
  -- Set when the model produced no insights for a top topic.
  ALTER TABLE ai_topics ADD COLUMN synth_error TEXT;
  -- "Finish with what's processed": remaining work is skipped instead of retried.
  ALTER TABLE ai_runs ADD COLUMN partial INTEGER NOT NULL DEFAULT 0;
  `,
  `
  -- Headlines generated on demand for a content idea (ideas_json[idea_index]), newest first.
  CREATE TABLE ai_idea_headlines (
    topic_id       INTEGER NOT NULL REFERENCES ai_topics(id) ON DELETE CASCADE,
    idea_index     INTEGER NOT NULL,
    headlines_json TEXT    NOT NULL,
    updated_at     TEXT    NOT NULL,
    PRIMARY KEY (topic_id, idea_index)
  );
  `,
];
