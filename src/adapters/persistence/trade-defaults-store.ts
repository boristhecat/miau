import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  FALLBACK_TRADE_DEFAULTS,
  type TradeDefaults,
  type TradeDefaultsStorePort
} from "../../ports/trade-defaults-store-port.js";

type SqliteDatabase = {
  pragma(sql: string): unknown;
  prepare(sql: string): {
    run(params?: unknown): unknown;
    get(params?: unknown): Record<string, unknown> | undefined;
  };
  close(): void;
};

export class SqliteTradeDefaultsStore implements TradeDefaultsStorePort {
  constructor(
    private readonly dbFilePath: string = path.join(process.cwd(), "data", "learning.sqlite"),
    private readonly legacyFilePath: string = path.join(process.cwd(), "data", "trade-defaults.json")
  ) {}

  async load(): Promise<TradeDefaults> {
    const db = await this.openDatabase();
    try {
      this.initialize(db);
      const existing = this.selectDefaults(db);
      if (existing) {
        return existing;
      }

      const migrated = await this.loadLegacyDefaults();
      if (migrated) {
        this.persist(db, migrated);
        return migrated;
      }

      this.persist(db, FALLBACK_TRADE_DEFAULTS);
      return { ...FALLBACK_TRADE_DEFAULTS };
    } finally {
      db.close();
    }
  }

  async save(defaults: TradeDefaults): Promise<void> {
    const db = await this.openDatabase();
    try {
      this.initialize(db);
      this.persist(db, sanitizeTradeDefaults(defaults));
    } finally {
      db.close();
    }
  }

  private async openDatabase(): Promise<SqliteDatabase> {
    const directory = path.dirname(this.dbFilePath);
    await mkdir(directory, { recursive: true });
    const moduleName = "better-sqlite3";
    const mod = (await import(moduleName)) as { default: new (file: string) => SqliteDatabase };
    return new mod.default(this.dbFilePath);
  }

  private initialize(db: SqliteDatabase): void {
    db.pragma("journal_mode = WAL");
    db.prepare(
      `CREATE TABLE IF NOT EXISTS trade_defaults (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        leverage REAL NOT NULL,
        position_size_usd REAL NOT NULL,
        objective_horizon TEXT NOT NULL,
        ai_model TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    ).run();
  }

  private selectDefaults(db: SqliteDatabase): TradeDefaults | null {
    const row =
      db
        .prepare(
          `SELECT leverage, position_size_usd, objective_horizon, ai_model
           FROM trade_defaults
           WHERE id = 1`
        )
        .get() as
        | {
            leverage?: unknown;
            position_size_usd?: unknown;
            objective_horizon?: unknown;
            ai_model?: unknown;
          }
        | undefined;
    if (!row) {
      return null;
    }

    return sanitizeTradeDefaults({
      leverage: row.leverage,
      positionSizeUsd: row.position_size_usd,
      objectiveHorizon: row.objective_horizon,
      aiModel: row.ai_model
    });
  }

  private persist(db: SqliteDatabase, defaults: TradeDefaults): void {
    db.prepare(
      `INSERT INTO trade_defaults (id, leverage, position_size_usd, objective_horizon, ai_model, updated_at)
       VALUES (1, @leverage, @positionSizeUsd, @objectiveHorizon, @aiModel, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         leverage = excluded.leverage,
         position_size_usd = excluded.position_size_usd,
         objective_horizon = excluded.objective_horizon,
         ai_model = excluded.ai_model,
         updated_at = datetime('now')`
    ).run(defaults);
  }

  private async loadLegacyDefaults(): Promise<TradeDefaults | null> {
    try {
      await access(this.legacyFilePath);
      const raw = await readFile(this.legacyFilePath, "utf8");
      const parsed = JSON.parse(raw) as {
        leverage?: unknown;
        positionSizeUsd?: unknown;
        objectiveHorizon?: unknown;
        aiModel?: unknown;
      };
      return sanitizeTradeDefaults(parsed);
    } catch {
      return null;
    }
  }
}

function sanitizeTradeDefaults(input: {
  leverage?: unknown;
  positionSizeUsd?: unknown;
  objectiveHorizon?: unknown;
  aiModel?: unknown;
}): TradeDefaults {
  return {
    leverage: Number.isFinite(input.leverage) ? Number(input.leverage) : FALLBACK_TRADE_DEFAULTS.leverage,
    positionSizeUsd: Number.isFinite(input.positionSizeUsd)
      ? Number(input.positionSizeUsd)
      : FALLBACK_TRADE_DEFAULTS.positionSizeUsd,
    objectiveHorizon:
      typeof input.objectiveHorizon === "string" &&
      /^\d+$/.test(input.objectiveHorizon) &&
      Number(input.objectiveHorizon) > 0
        ? input.objectiveHorizon
        : FALLBACK_TRADE_DEFAULTS.objectiveHorizon,
    aiModel:
      typeof input.aiModel === "string" && input.aiModel.trim().length > 0
        ? input.aiModel.trim()
        : FALLBACK_TRADE_DEFAULTS.aiModel
  };
}
