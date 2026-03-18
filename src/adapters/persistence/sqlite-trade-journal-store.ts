import type { TradeJournalEntry, TradeFailureReason, SetupPlaybook, MarketRegime, SetupGrade } from "../../domain/types.js";
import type { TradeJournalStorePort, TradeJournalStats } from "../../ports/trade-journal-store-port.js";

type SqliteDatabase = {
  pragma(sql: string): unknown;
  prepare(sql: string): {
    run(params?: unknown): unknown;
    get(params?: unknown): Record<string, unknown> | undefined;
    all(params?: unknown): Array<Record<string, unknown>>;
  };
};

export class SqliteTradeJournalStore implements TradeJournalStorePort {
  constructor(private readonly db: SqliteDatabase) {}

  initialize(): void {
    this.db.prepare(
      `CREATE TABLE IF NOT EXISTS trade_journal (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        entry REAL NOT NULL,
        stop_loss REAL NOT NULL,
        take_profit REAL NOT NULL,
        leverage REAL,
        position_size_usd REAL,
        opened_at_ms INTEGER NOT NULL,
        closed_at_ms INTEGER NOT NULL,
        duration_minutes REAL NOT NULL,
        exit_price REAL NOT NULL,
        pnl_pct REAL NOT NULL,
        pnl_usd REAL,
        mfe_pct REAL NOT NULL,
        mae_pct REAL NOT NULL,
        setup_grade TEXT NOT NULL,
        setup_playbook TEXT,
        market_regime TEXT NOT NULL,
        confidence INTEGER NOT NULL,
        analysis_interval TEXT NOT NULL,
        management_action TEXT NOT NULL,
        consecutive_degrading_ticks INTEGER NOT NULL DEFAULT 0,
        outcome_classification TEXT NOT NULL,
        failure_reason TEXT NOT NULL DEFAULT 'NONE',
        notes TEXT,
        execution_rating INTEGER,
        created_at_ms INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      )`
    ).run();

    this.db.prepare("CREATE INDEX IF NOT EXISTS idx_journal_symbol ON trade_journal(symbol)").run();
    this.db.prepare("CREATE INDEX IF NOT EXISTS idx_journal_playbook ON trade_journal(setup_playbook)").run();
    this.db.prepare("CREATE INDEX IF NOT EXISTS idx_journal_regime ON trade_journal(market_regime)").run();
    this.db.prepare("CREATE INDEX IF NOT EXISTS idx_journal_grade ON trade_journal(setup_grade)").run();
    this.db.prepare("CREATE INDEX IF NOT EXISTS idx_journal_created ON trade_journal(created_at_ms)").run();
    this.db.prepare("CREATE INDEX IF NOT EXISTS idx_journal_session ON trade_journal(session_id)").run();
  }

  save(entry: TradeJournalEntry): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO trade_journal (
        id, session_id, symbol, side, entry, stop_loss, take_profit,
        leverage, position_size_usd, opened_at_ms, closed_at_ms, duration_minutes,
        exit_price, pnl_pct, pnl_usd, mfe_pct, mae_pct,
        setup_grade, setup_playbook, market_regime, confidence, analysis_interval,
        management_action, consecutive_degrading_ticks,
        outcome_classification, failure_reason, notes, execution_rating
      ) VALUES (
        $id, $sessionId, $symbol, $side, $entry, $stopLoss, $takeProfit,
        $leverage, $positionSizeUsd, $openedAtMs, $closedAtMs, $durationMinutes,
        $exitPrice, $pnlPct, $pnlUsd, $mfePct, $maePct,
        $setupGrade, $setupPlaybook, $marketRegime, $confidence, $analysisInterval,
        $managementAction, $consecutiveDegradingTicks,
        $outcomeClassification, $failureReason, $notes, $executionRating
      )`
    ).run({
      $id: entry.id,
      $sessionId: entry.sessionId,
      $symbol: entry.symbol,
      $side: entry.side,
      $entry: entry.entry,
      $stopLoss: entry.stopLoss,
      $takeProfit: entry.takeProfit,
      $leverage: entry.leverage ?? null,
      $positionSizeUsd: entry.positionSizeUsd ?? null,
      $openedAtMs: entry.openedAtMs,
      $closedAtMs: entry.closedAtMs,
      $durationMinutes: entry.durationMinutes,
      $exitPrice: entry.exitPrice,
      $pnlPct: entry.pnlPct,
      $pnlUsd: entry.pnlUsd ?? null,
      $mfePct: entry.maxFavorableExcursionPct,
      $maePct: entry.maxAdverseExcursionPct,
      $setupGrade: entry.setupGrade,
      $setupPlaybook: entry.setupPlaybook ?? null,
      $marketRegime: entry.marketRegime,
      $confidence: entry.confidence,
      $analysisInterval: entry.analysisInterval,
      $managementAction: entry.managementAction,
      $consecutiveDegradingTicks: entry.consecutiveDegradingTicks,
      $outcomeClassification: entry.outcomeClassification,
      $failureReason: entry.failureReason,
      $notes: entry.notes ?? null,
      $executionRating: entry.executionRating ?? null
    });
  }

  getBySessionId(sessionId: string): TradeJournalEntry | undefined {
    const row = this.db.prepare("SELECT * FROM trade_journal WHERE session_id = $sessionId").get({ $sessionId: sessionId });
    return row ? this.mapRow(row) : undefined;
  }

  getRecent(limit: number): readonly TradeJournalEntry[] {
    const rows = this.db.prepare("SELECT * FROM trade_journal ORDER BY closed_at_ms DESC LIMIT $limit").all({ $limit: limit });
    return rows.map((r) => this.mapRow(r));
  }

  getBySymbol(symbol: string, limit: number): readonly TradeJournalEntry[] {
    const rows = this.db.prepare(
      "SELECT * FROM trade_journal WHERE symbol = $symbol ORDER BY closed_at_ms DESC LIMIT $limit"
    ).all({ $symbol: symbol, $limit: limit });
    return rows.map((r) => this.mapRow(r));
  }

  getSimilarTrades(criteria: {
    setupPlaybook?: SetupPlaybook;
    marketRegime?: MarketRegime;
    setupGrade?: SetupGrade;
    symbol?: string;
    limit?: number;
  }): readonly TradeJournalEntry[] {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (criteria.setupPlaybook) {
      conditions.push("setup_playbook = $playbook");
      params.$playbook = criteria.setupPlaybook;
    }
    if (criteria.marketRegime) {
      conditions.push("market_regime = $regime");
      params.$regime = criteria.marketRegime;
    }
    if (criteria.setupGrade) {
      conditions.push("setup_grade = $grade");
      params.$grade = criteria.setupGrade;
    }
    if (criteria.symbol) {
      conditions.push("symbol = $symbol");
      params.$symbol = criteria.symbol;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = criteria.limit ?? 20;
    params.$limit = limit;

    const rows = this.db.prepare(
      `SELECT * FROM trade_journal ${where} ORDER BY closed_at_ms DESC LIMIT $limit`
    ).all(params);
    return rows.map((r) => this.mapRow(r));
  }

  getStats(lookbackDays = 90): TradeJournalStats {
    const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
    const rows = this.db.prepare(
      "SELECT * FROM trade_journal WHERE closed_at_ms >= $cutoff ORDER BY closed_at_ms DESC"
    ).all({ $cutoff: cutoff });

    const entries = rows.map((r) => this.mapRow(r));
    const wins = entries.filter((e) => e.pnlPct > 0);
    const losses = entries.filter((e) => e.pnlPct <= 0);

    // Most common failure
    const failureCounts = new Map<TradeFailureReason, number>();
    for (const e of losses) {
      if (e.failureReason !== "NONE") {
        failureCounts.set(e.failureReason, (failureCounts.get(e.failureReason) ?? 0) + 1);
      }
    }
    let mostCommonFailure: TradeFailureReason = "NONE";
    let maxCount = 0;
    for (const [reason, count] of failureCounts) {
      if (count > maxCount) {
        mostCommonFailure = reason;
        maxCount = count;
      }
    }

    // Playbook stats
    const playbookStats = new Map<string, { wins: number; total: number }>();
    for (const e of entries) {
      if (!e.setupPlaybook) continue;
      const stat = playbookStats.get(e.setupPlaybook) ?? { wins: 0, total: 0 };
      stat.total++;
      if (e.pnlPct > 0) stat.wins++;
      playbookStats.set(e.setupPlaybook, stat);
    }

    let bestPlaybook: TradeJournalStats["bestPlaybook"];
    let worstPlaybook: TradeJournalStats["worstPlaybook"];
    let bestWinRate = -1;
    let worstWinRate = 2;
    for (const [playbook, stat] of playbookStats) {
      if (stat.total < 3) continue; // minimum sample
      const wr = stat.wins / stat.total;
      if (wr > bestWinRate) {
        bestWinRate = wr;
        bestPlaybook = { playbook: playbook as SetupPlaybook, winRate: wr, count: stat.total };
      }
      if (wr < worstWinRate) {
        worstWinRate = wr;
        worstPlaybook = { playbook: playbook as SetupPlaybook, winRate: wr, count: stat.total };
      }
    }

    return {
      totalTrades: entries.length,
      wins: wins.length,
      losses: losses.length,
      winRate: entries.length > 0 ? wins.length / entries.length : 0,
      avgPnlPct: entries.length > 0 ? entries.reduce((s, e) => s + e.pnlPct, 0) / entries.length : 0,
      avgWinPct: wins.length > 0 ? wins.reduce((s, e) => s + e.pnlPct, 0) / wins.length : 0,
      avgLossPct: losses.length > 0 ? losses.reduce((s, e) => s + e.pnlPct, 0) / losses.length : 0,
      avgDurationMinutes: entries.length > 0 ? entries.reduce((s, e) => s + e.durationMinutes, 0) / entries.length : 0,
      mostCommonFailure,
      bestPlaybook,
      worstPlaybook
    };
  }

  private mapRow(row: Record<string, unknown>): TradeJournalEntry {
    return {
      id: row.id as string,
      sessionId: row.session_id as string,
      symbol: row.symbol as string,
      side: row.side as "LONG" | "SHORT",
      entry: row.entry as number,
      stopLoss: row.stop_loss as number,
      takeProfit: row.take_profit as number,
      leverage: row.leverage as number | undefined,
      positionSizeUsd: row.position_size_usd as number | undefined,
      openedAtMs: row.opened_at_ms as number,
      closedAtMs: row.closed_at_ms as number,
      durationMinutes: row.duration_minutes as number,
      exitPrice: row.exit_price as number,
      pnlPct: row.pnl_pct as number,
      pnlUsd: row.pnl_usd as number | undefined,
      maxFavorableExcursionPct: row.mfe_pct as number,
      maxAdverseExcursionPct: row.mae_pct as number,
      setupGrade: row.setup_grade as SetupGrade,
      setupPlaybook: row.setup_playbook as SetupPlaybook | undefined,
      marketRegime: row.market_regime as MarketRegime,
      confidence: row.confidence as number,
      analysisInterval: row.analysis_interval as string,
      managementAction: row.management_action as TradeJournalEntry["managementAction"],
      consecutiveDegradingTicks: row.consecutive_degrading_ticks as number,
      outcomeClassification: row.outcome_classification as TradeJournalEntry["outcomeClassification"],
      failureReason: row.failure_reason as TradeFailureReason,
      notes: row.notes as string | undefined,
      executionRating: row.execution_rating as number | undefined
    };
  }
}

export function createTradeJournalStore(db: SqliteDatabase): TradeJournalStorePort {
  const store = new SqliteTradeJournalStore(db);
  store.initialize();
  return store;
}
