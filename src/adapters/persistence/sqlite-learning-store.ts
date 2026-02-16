import { mkdir } from "node:fs/promises";
import path from "node:path";
import type {
  LearningOutcomeRecord,
  LearningStatsQuery,
  LearningStatsResult,
  LearningStorePort,
  OutcomeStatus
} from "../../ports/learning-store-port.js";

type SqliteDatabase = {
  pragma(sql: string): unknown;
  prepare(sql: string): {
    run(params?: unknown): unknown;
    get(params?: unknown): Record<string, unknown> | undefined;
    all(params?: unknown): Array<Record<string, unknown>>;
  };
};

export async function createLearningStore(dbFilePath: string): Promise<LearningStorePort> {
  const directory = path.dirname(dbFilePath);
  await mkdir(directory, { recursive: true });
  const moduleName = "better-sqlite3";
  const mod = (await import(moduleName)) as { default: new (file: string) => SqliteDatabase };
  const db = new mod.default(dbFilePath);
  const store = new SqliteLearningStore(db);
  store.initialize();
  return store;
}

class SqliteLearningStore implements LearningStorePort {
  constructor(private readonly db: SqliteDatabase) {}

  initialize(): void {
    this.db.pragma("journal_mode = WAL");
    this.db.prepare(
      `CREATE TABLE IF NOT EXISTS learning_outcomes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
        pair TEXT NOT NULL,
        symbol TEXT NOT NULL,
        timeframe TEXT NOT NULL,
        horizon_minutes INTEGER NOT NULL,
        market_regime TEXT NOT NULL,
        signal TEXT NOT NULL,
        confidence REAL NOT NULL,
        setup_quality REAL NOT NULL,
        status TEXT NOT NULL,
        pnl_usd REAL
      )`
    ).run();
    this.db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_learning_outcomes_lookup
       ON learning_outcomes(pair, timeframe, market_regime, recorded_at)`
    ).run();
  }

  async recordOutcome(input: LearningOutcomeRecord): Promise<void> {
    this.db.prepare(
      `INSERT INTO learning_outcomes (
        pair, symbol, timeframe, horizon_minutes, market_regime,
        signal, confidence, setup_quality, status, pnl_usd
      ) VALUES (
        @pair, @symbol, @timeframe, @horizonMinutes, @marketRegime,
        @signal, @confidence, @setupQuality, @status, @pnlUsd
      )`
    ).run(input);
  }

  async getStats(input: LearningStatsQuery): Promise<LearningStatsResult> {
    const aggregate =
      this.db
        .prepare(
          `SELECT
            COUNT(*) AS samples,
            AVG(CASE WHEN status = 'SUCCESS' THEN 1.0 ELSE 0.0 END) AS winRate,
            AVG(COALESCE(pnl_usd, 0)) AS avgPnlUsd
          FROM learning_outcomes
          WHERE pair = @pair
            AND timeframe = @timeframe
            AND market_regime = @marketRegime
            AND recorded_at >= datetime('now', '-' || @lookbackDays || ' days')`
        )
        .get(input) ?? {};

    const recentRows = this.db
      .prepare(
        `SELECT status
         FROM learning_outcomes
         WHERE pair = @pair
           AND timeframe = @timeframe
           AND market_regime = @marketRegime
           AND recorded_at >= datetime('now', '-' || @lookbackDays || ' days')
         ORDER BY id DESC
         LIMIT @limit`
      )
      .all(input);

    const samples = Number(aggregate.samples ?? 0);
    if (!samples) {
      return { samples: 0, winRate: 0, avgPnlUsd: 0, recentStatuses: [] };
    }
    return {
      samples,
      winRate: Number(aggregate.winRate ?? 0),
      avgPnlUsd: Number(aggregate.avgPnlUsd ?? 0),
      recentStatuses: recentRows
        .map((row) => String(row.status).toUpperCase())
        .filter((value): value is OutcomeStatus => value === "SUCCESS" || value === "FAILURE")
    };
  }
}
