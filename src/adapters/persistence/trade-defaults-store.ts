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
    // Migrations: add columns if they don't exist yet
    for (const col of ["api_key_env_var TEXT", "ai_provider TEXT"]) {
      try {
        db.prepare(`ALTER TABLE trade_defaults ADD COLUMN ${col}`).run();
      } catch {
        // Column already exists — safe to ignore
      }
    }
  }

  private selectDefaults(db: SqliteDatabase): TradeDefaults | null {
    const row =
      db
        .prepare(
          `SELECT leverage, position_size_usd, objective_horizon, ai_provider, ai_model, api_key_env_var
           FROM trade_defaults
           WHERE id = 1`
        )
        .get() as
        | {
            leverage?: unknown;
            position_size_usd?: unknown;
            objective_horizon?: unknown;
            ai_provider?: unknown;
            ai_model?: unknown;
            api_key_env_var?: unknown;
          }
        | undefined;
    if (!row) {
      return null;
    }

    return sanitizeTradeDefaults({
      leverage: row.leverage,
      positionSizeUsd: row.position_size_usd,
      objectiveHorizon: row.objective_horizon,
      aiProvider: row.ai_provider,
      aiModel: row.ai_model,
      apiKeyEnvVar: row.api_key_env_var
    });
  }

  private persist(db: SqliteDatabase, defaults: TradeDefaults): void {
    db.prepare(
      `INSERT INTO trade_defaults (id, leverage, position_size_usd, objective_horizon, ai_provider, ai_model, api_key_env_var, updated_at)
       VALUES (1, @leverage, @positionSizeUsd, @objectiveHorizon, @aiProvider, @aiModel, @apiKeyEnvVar, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         leverage = excluded.leverage,
         position_size_usd = excluded.position_size_usd,
         objective_horizon = excluded.objective_horizon,
         ai_provider = excluded.ai_provider,
         ai_model = excluded.ai_model,
         api_key_env_var = excluded.api_key_env_var,
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

const VALID_AI_PROVIDERS = new Set(["openai", "anthropic"]);

function sanitizeTradeDefaults(input: {
  leverage?: unknown;
  positionSizeUsd?: unknown;
  objectiveHorizon?: unknown;
  aiProvider?: unknown;
  aiModel?: unknown;
  apiKeyEnvVar?: unknown;
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
    aiProvider:
      typeof input.aiProvider === "string" && VALID_AI_PROVIDERS.has(input.aiProvider.trim().toLowerCase())
        ? input.aiProvider.trim().toLowerCase()
        : FALLBACK_TRADE_DEFAULTS.aiProvider,
    aiModel:
      typeof input.aiModel === "string" && input.aiModel.trim().length > 0
        ? input.aiModel.trim()
        : FALLBACK_TRADE_DEFAULTS.aiModel,
    apiKeyEnvVar:
      typeof input.apiKeyEnvVar === "string" && /^[A-Z_][A-Z0-9_]*$/i.test(input.apiKeyEnvVar.trim())
        ? input.apiKeyEnvVar.trim()
        : FALLBACK_TRADE_DEFAULTS.apiKeyEnvVar
  };
}
