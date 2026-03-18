import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { MonitorSession, MonitorSessionStorePort, MonitorSessionUpdate } from "../../ports/monitor-session-store-port.js";

type SqliteDatabase = {
  pragma(sql: string): unknown;
  prepare(sql: string): {
    run(params?: unknown): unknown;
    get(params?: unknown): Record<string, unknown> | undefined;
    all(params?: unknown): Record<string, unknown>[];
  };
  close(): void;
};

export class SqliteMonitorSessionStore implements MonitorSessionStorePort {
  constructor(
    private readonly dbFilePath: string = path.join(process.cwd(), "data", "learning.sqlite")
  ) {}

  async listActive(): Promise<readonly MonitorSession[]> {
    const db = await this.openDatabase();
    try {
      this.initialize(db);
      const rows = db.prepare(
        `SELECT id, symbol, side, entry, stop_loss, take_profit, leverage, position_size_usd, objective_horizon, created_at_ms
         FROM monitor_sessions
         ORDER BY created_at_ms ASC`
      ).all();
      return rows.map(toMonitorSession);
    } finally {
      db.close();
    }
  }

  async create(input: Omit<MonitorSession, "id" | "createdAtMs">): Promise<MonitorSession> {
    const db = await this.openDatabase();
    try {
      this.initialize(db);
      const id = randomUUID();
      const createdAtMs = Date.now();
      db.prepare(
        `INSERT INTO monitor_sessions (id, symbol, side, entry, stop_loss, take_profit, leverage, position_size_usd, objective_horizon, created_at_ms)
         VALUES (@id, @symbol, @side, @entry, @stopLoss, @takeProfit, @leverage, @positionSizeUsd, @objectiveHorizon, @createdAtMs)`
      ).run({
        id,
        symbol: input.symbol,
        side: input.side,
        entry: input.entry,
        stopLoss: input.stopLoss,
        takeProfit: input.takeProfit,
        leverage: input.leverage,
        positionSizeUsd: input.positionSizeUsd,
        objectiveHorizon: input.objectiveHorizon,
        createdAtMs
      });
      return { id, ...input, createdAtMs };
    } finally {
      db.close();
    }
  }

  async update(id: string, fields: MonitorSessionUpdate): Promise<MonitorSession> {
    const db = await this.openDatabase();
    try {
      this.initialize(db);
      const sets: string[] = [];
      const params: Record<string, unknown> = { id };
      if (fields.entry !== undefined) { sets.push("entry = @entry"); params.entry = fields.entry; }
      if (fields.stopLoss !== undefined) { sets.push("stop_loss = @stopLoss"); params.stopLoss = fields.stopLoss; }
      if (fields.takeProfit !== undefined) { sets.push("take_profit = @takeProfit"); params.takeProfit = fields.takeProfit; }
      if (fields.leverage !== undefined) { sets.push("leverage = @leverage"); params.leverage = fields.leverage; }
      if (fields.positionSizeUsd !== undefined) { sets.push("position_size_usd = @positionSizeUsd"); params.positionSizeUsd = fields.positionSizeUsd; }
      if (fields.objectiveHorizon !== undefined) { sets.push("objective_horizon = @objectiveHorizon"); params.objectiveHorizon = fields.objectiveHorizon; }
      if (sets.length > 0) {
        db.prepare(`UPDATE monitor_sessions SET ${sets.join(", ")} WHERE id = @id`).run(params);
      }
      const row = db.prepare(
        `SELECT id, symbol, side, entry, stop_loss, take_profit, leverage, position_size_usd, objective_horizon, created_at_ms
         FROM monitor_sessions WHERE id = @id`
      ).get({ id });
      if (!row) throw new Error(`Monitor session ${id} not found.`);
      return toMonitorSession(row);
    } finally {
      db.close();
    }
  }

  async remove(id: string): Promise<void> {
    const db = await this.openDatabase();
    try {
      this.initialize(db);
      db.prepare(`DELETE FROM monitor_sessions WHERE id = @id`).run({ id });
    } finally {
      db.close();
    }
  }

  private async openDatabase(): Promise<SqliteDatabase> {
    const directory = path.dirname(this.dbFilePath);
    await mkdir(directory, { recursive: true });
    const moduleName = "better-sqlite3";
    const mod = (await import(moduleName)) as { default: new (file: string) => SqliteDatabase };
    const db = new mod.default(this.dbFilePath);
    db.pragma("journal_mode = WAL");
    return db;
  }

  private initialize(db: SqliteDatabase): void {
    db.prepare(
      `CREATE TABLE IF NOT EXISTS monitor_sessions (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL CHECK (side IN ('LONG', 'SHORT')),
        entry REAL NOT NULL,
        stop_loss REAL,
        take_profit REAL,
        leverage REAL,
        position_size_usd REAL,
        objective_horizon TEXT,
        created_at_ms INTEGER NOT NULL
      )`
    ).run();
    this.migrateNullableSlTp(db);
  }

  private migrateNullableSlTp(db: SqliteDatabase): void {
    // If the table was created with NOT NULL on stop_loss/take_profit, recreate it without the constraint.
    const info = db.prepare(`PRAGMA table_info(monitor_sessions)`).all() as Array<Record<string, unknown>>;
    const slCol = info.find(c => c["name"] === "stop_loss");
    if (!slCol || slCol["notnull"] !== 1) return; // already nullable, nothing to do
    db.prepare(`ALTER TABLE monitor_sessions RENAME TO monitor_sessions_old`).run();
    db.prepare(
      `CREATE TABLE monitor_sessions (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL CHECK (side IN ('LONG', 'SHORT')),
        entry REAL NOT NULL,
        stop_loss REAL,
        take_profit REAL,
        leverage REAL,
        position_size_usd REAL,
        objective_horizon TEXT,
        created_at_ms INTEGER NOT NULL
      )`
    ).run();
    db.prepare(
      `INSERT INTO monitor_sessions SELECT id, symbol, side, entry, stop_loss, take_profit, leverage, position_size_usd, objective_horizon, created_at_ms FROM monitor_sessions_old`
    ).run();
    db.prepare(`DROP TABLE monitor_sessions_old`).run();
  }
}

function toMonitorSession(row: Record<string, unknown>): MonitorSession {
  return {
    id: String(row.id),
    symbol: String(row.symbol),
    side: row.side === "SHORT" ? "SHORT" : "LONG",
    entry: Number(row.entry),
    stopLoss: row.stop_loss != null ? Number(row.stop_loss) : null,
    takeProfit: row.take_profit != null ? Number(row.take_profit) : null,
    leverage: row.leverage != null ? Number(row.leverage) : null,
    positionSizeUsd: row.position_size_usd != null ? Number(row.position_size_usd) : null,
    objectiveHorizon: row.objective_horizon != null ? String(row.objective_horizon) : null,
    createdAtMs: Number(row.created_at_ms)
  };
}
