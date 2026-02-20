import { mkdir } from "node:fs/promises";
import path from "node:path";
import type {
  LearningBucketRow,
  LearningOverview,
  LearningOutcomeRecord,
  LearningOutcomeSummary,
  LearningStatsQuery,
  LearningStatsResult,
  LearningStorePort,
  OutcomeFailureType,
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
        setup_grade TEXT,
        analysis_interval TEXT,
        analysis_bias_interval TEXT,
        entry REAL,
        stop_loss REAL,
        take_profit REAL,
        risk_reward_ratio REAL,
        status TEXT NOT NULL,
        failure_type TEXT NOT NULL DEFAULT 'NONE',
        directional_correct INTEGER,
        mfe_pct REAL,
        mae_pct REAL,
        pnl_usd REAL,
        recommendation_snapshot_json TEXT NOT NULL DEFAULT '{}'
      )`
    ).run();
    this.ensureColumn("learning_outcomes", "failure_type", "TEXT NOT NULL DEFAULT 'NONE'");
    this.ensureColumn("learning_outcomes", "directional_correct", "INTEGER");
    this.ensureColumn("learning_outcomes", "mfe_pct", "REAL");
    this.ensureColumn("learning_outcomes", "mae_pct", "REAL");
    this.ensureColumn("learning_outcomes", "setup_grade", "TEXT");
    this.ensureColumn("learning_outcomes", "analysis_interval", "TEXT");
    this.ensureColumn("learning_outcomes", "analysis_bias_interval", "TEXT");
    this.ensureColumn("learning_outcomes", "entry", "REAL");
    this.ensureColumn("learning_outcomes", "stop_loss", "REAL");
    this.ensureColumn("learning_outcomes", "take_profit", "REAL");
    this.ensureColumn("learning_outcomes", "risk_reward_ratio", "REAL");
    this.ensureColumn("learning_outcomes", "recommendation_snapshot_json", "TEXT NOT NULL DEFAULT '{}'");
    this.db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_learning_outcomes_lookup
       ON learning_outcomes(pair, timeframe, market_regime, recorded_at)`
    ).run();
  }

  async recordOutcome(input: LearningOutcomeRecord): Promise<void> {
    this.db.prepare(
      `INSERT INTO learning_outcomes (
        pair, symbol, timeframe, horizon_minutes, market_regime,
        signal, confidence, setup_quality, setup_grade, analysis_interval, analysis_bias_interval,
        entry, stop_loss, take_profit, risk_reward_ratio,
        status, failure_type, directional_correct, mfe_pct, mae_pct, pnl_usd, recommendation_snapshot_json
      ) VALUES (
        @pair, @symbol, @timeframe, @horizonMinutes, @marketRegime,
        @signal, @confidence, @setupQuality, @setupGrade, @analysisInterval, @analysisBiasInterval,
        @entry, @stopLoss, @takeProfit, @riskRewardRatio,
        @status, @failureType, @directionalCorrect, @maxFavorableExcursionPct, @maxAdverseExcursionPct, @pnlUsd, @recommendationSnapshotJson
      )`
    ).run({
      ...input,
      setupGrade: input.recommendationSnapshot?.setupGrade ?? null,
      analysisInterval: input.recommendationSnapshot?.analysisInterval ?? null,
      analysisBiasInterval: input.recommendationSnapshot?.analysisBiasInterval ?? null,
      entry: input.recommendationSnapshot?.entry ?? null,
      stopLoss: input.recommendationSnapshot?.stopLoss ?? null,
      takeProfit: input.recommendationSnapshot?.takeProfit ?? null,
      riskRewardRatio: input.recommendationSnapshot?.riskRewardRatio ?? null,
      maxFavorableExcursionPct: input.maxFavorableExcursionPct ?? null,
      maxAdverseExcursionPct: input.maxAdverseExcursionPct ?? null,
      pnlUsd: input.pnlUsd ?? null,
      failureType: input.failureType ?? "NONE",
      directionalCorrect:
        input.directionalCorrect === undefined ? null : input.directionalCorrect ? 1 : 0,
      recommendationSnapshotJson: toJsonString(input.recommendationSnapshot ?? {})
    });
  }

  async getStats(input: LearningStatsQuery): Promise<LearningStatsResult> {
    const { whereClause, params } = this.buildStatsWhere(input);
    const aggregate =
      this.db
        .prepare(
          `SELECT
            COUNT(*) AS samples,
            AVG(CASE WHEN status = 'SUCCESS' THEN 1.0 ELSE 0.0 END) AS winRate,
            AVG(COALESCE(pnl_usd, 0)) AS avgPnlUsd
          FROM learning_outcomes
          WHERE ${whereClause}`
        )
        .get(params) ?? {};

    const recentRows = this.db
      .prepare(
        `SELECT status, failure_type
         FROM learning_outcomes
         WHERE ${whereClause}
         ORDER BY id DESC
         LIMIT @limit`
      )
      .all(params);

    const samples = Number(aggregate.samples ?? 0);
    if (!samples) {
      return { samples: 0, winRate: 0, avgPnlUsd: 0, recentOutcomes: [] };
    }
    return {
      samples,
      winRate: Number(aggregate.winRate ?? 0),
      avgPnlUsd: Number(aggregate.avgPnlUsd ?? 0),
      recentOutcomes: recentRows
        .map((row): LearningOutcomeSummary | null => {
          const status = String(row.status).toUpperCase();
          if (status !== "SUCCESS" && status !== "FAILURE") {
            return null;
          }
          const failureType = normalizeFailureType(row.failure_type);
          return { status, failureType };
        })
        .filter((value): value is LearningOutcomeSummary => value !== null)
    };
  }

  private buildStatsWhere(input: LearningStatsQuery): {
    whereClause: string;
    params: Record<string, unknown>;
  } {
    const filters: string[] = [
      "status IN ('SUCCESS', 'FAILURE')",
      "recorded_at >= datetime('now', '-' || @lookbackDays || ' days')"
    ];
    const params: Record<string, unknown> = {
      lookbackDays: input.lookbackDays,
      limit: input.limit
    };
    if (input.pair) {
      filters.push("pair = @pair");
      params.pair = input.pair;
    }
    if (input.timeframe) {
      filters.push("timeframe = @timeframe");
      params.timeframe = input.timeframe;
    }
    if (input.marketRegime) {
      filters.push("market_regime = @marketRegime");
      params.marketRegime = input.marketRegime;
    }
    return {
      whereClause: filters.join(" AND "),
      params
    };
  }

  async getOverview(input: { lookbackDays: number }): Promise<LearningOverview> {
    const row =
      this.db
        .prepare(
          `SELECT
            COUNT(*) AS totalSamples,
            SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) AS wins,
            SUM(CASE WHEN status = 'FAILURE' THEN 1 ELSE 0 END) AS losses,
            AVG(CASE WHEN status = 'SUCCESS' THEN 1.0 ELSE 0.0 END) AS winRate,
            AVG(COALESCE(pnl_usd, 0)) AS avgPnlUsd
          FROM learning_outcomes
          WHERE status IN ('SUCCESS', 'FAILURE')
            AND recorded_at >= datetime('now', '-' || @lookbackDays || ' days')`
        )
        .get(input) ?? {};

    const totalSamples = Number(row.totalSamples ?? 0);
    return {
      totalSamples,
      wins: Number(row.wins ?? 0),
      losses: Number(row.losses ?? 0),
      winRate: totalSamples > 0 ? Number(row.winRate ?? 0) : 0,
      avgPnlUsd: totalSamples > 0 ? Number(row.avgPnlUsd ?? 0) : 0
    };
  }

  async getBucketOverview(input: { lookbackDays: number }): Promise<LearningBucketRow[]> {
    const rows = this.db
      .prepare(
        `SELECT
           timeframe,
           CASE
             WHEN horizon_minutes <= 10 THEN '1-10m'
             WHEN horizon_minutes <= 30 THEN '10-30m'
             WHEN horizon_minutes <= 90 THEN '30-90m'
             ELSE '90m+'
           END AS horizonBucket,
           COUNT(*) AS samples,
           SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) AS wins,
           SUM(CASE WHEN status = 'FAILURE' THEN 1 ELSE 0 END) AS losses,
           AVG(CASE WHEN status = 'SUCCESS' THEN 1.0 ELSE 0.0 END) AS winRate,
           AVG(COALESCE(pnl_usd, 0)) AS avgPnlUsd
         FROM learning_outcomes
         WHERE status IN ('SUCCESS', 'FAILURE')
           AND recorded_at >= datetime('now', '-' || @lookbackDays || ' days')
         GROUP BY timeframe, horizonBucket
         ORDER BY
           CASE
             WHEN horizonBucket = '1-10m' THEN 1
             WHEN horizonBucket = '10-30m' THEN 2
             WHEN horizonBucket = '30-90m' THEN 3
             ELSE 4
           END,
           timeframe`
      )
      .all(input);

    return rows.map((row) => ({
      timeframe: String(row.timeframe ?? "n/a"),
      horizonBucket: normalizeBucket(row.horizonBucket),
      samples: Number(row.samples ?? 0),
      wins: Number(row.wins ?? 0),
      losses: Number(row.losses ?? 0),
      winRate: Number(row.winRate ?? 0),
      avgPnlUsd: Number(row.avgPnlUsd ?? 0)
    }));
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all();
    const exists = columns.some((row) => String(row.name).toLowerCase() === column.toLowerCase());
    if (!exists) {
      this.db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
    }
  }
}

function toJsonString(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "{}";
  }
}

function normalizeFailureType(value: unknown): OutcomeFailureType {
  const normalized = String(value ?? "NONE").toUpperCase();
  if (
    normalized === "WRONG_DIRECTION" ||
    normalized === "STOP_TOO_TIGHT_REBOUND" ||
    normalized === "TIMEOUT_LOSS" ||
    normalized === "WHIPSAW_SL_TP"
  ) {
    return normalized;
  }
  return "NONE";
}

function normalizeBucket(value: unknown): LearningBucketRow["horizonBucket"] {
  const normalized = String(value ?? "");
  if (normalized === "1-10m" || normalized === "10-30m" || normalized === "30-90m" || normalized === "90m+") {
    return normalized;
  }
  return "90m+";
}
