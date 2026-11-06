import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/index.js';
import type { LlmProvider } from './llm.js';
import { runPipeline } from './pipeline.js';

/**
 * Runs analyses in the background, one pipeline per run id. State lives in the
 * DB, so the UI polls it and an interrupted run can be resumed.
 */
export class AnalysisRunner {
  private readonly active = new Map<number, AbortController>();

  constructor(
    private readonly db: Db,
    /** Provider factory, also used for on-demand generation outside runs. */
    readonly provider: () => LlmProvider,
    private readonly log?: FastifyBaseLogger,
  ) {
    // Runs that were in flight when the server stopped can only be resumed by hand.
    db.prepare(
      `UPDATE ai_runs SET status = 'failed', error = 'Прервано перезапуском сервера'
       WHERE status IN ('queued', 'running')`,
    ).run();
  }

  /** Creates a run for the upload and starts it. Returns the run id. */
  start(uploadId: number): number {
    const provider = this.provider();
    const { id } = this.db
      .prepare(
        `INSERT INTO ai_runs (upload_id, provider, map_model, synth_model, status, step, created_at)
         VALUES (?, ?, ?, ?, 'queued', 'prefilter', ?) RETURNING id`,
      )
      .get(
        uploadId,
        provider.name,
        provider.mapModel,
        provider.synthModel,
        new Date().toISOString(),
      ) as {
      id: number;
    };
    this.launch(id, provider);
    return id;
  }

  /** Continues a failed run from its saved progress. */
  resume(runId: number): void {
    if (this.active.has(runId)) return;
    this.db.prepare(`UPDATE ai_runs SET status = 'queued', error = NULL WHERE id = ?`).run(runId);
    this.launch(runId, this.provider());
  }

  /**
   * Finishes a failed run with what has been processed: pending rows and topics
   * are skipped instead of sent to the model again.
   */
  finish(runId: number): void {
    if (this.active.has(runId)) return;
    this.db.prepare('UPDATE ai_runs SET partial = 1 WHERE id = ?').run(runId);
    this.resume(runId);
  }

  isActive(runId: number): boolean {
    return this.active.has(runId);
  }

  /** Waits for a run to settle (tests). */
  async wait(runId: number): Promise<void> {
    while (this.active.has(runId)) await new Promise((r) => setTimeout(r, 10));
  }

  stopAll(): void {
    for (const controller of this.active.values()) controller.abort();
  }

  private launch(runId: number, provider: LlmProvider) {
    const controller = new AbortController();
    this.active.set(runId, controller);
    runPipeline(this.db, runId, provider, controller.signal)
      .catch((err: Error) => {
        this.log?.error({ err, runId }, 'analysis failed');
        try {
          this.db
            .prepare(`UPDATE ai_runs SET status = 'failed', error = ? WHERE id = ?`)
            .run(err.message.slice(0, 1000), runId);
        } catch {
          // The upload (and its runs) may have been deleted mid-run.
        }
      })
      .finally(() => this.active.delete(runId));
  }
}
