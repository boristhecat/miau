import type {
  MarketRegime,
  SetupGrade,
  SetupPlaybook,
  TradeFailureReason,
  TradeJournalEntry
} from "../domain/types.js";

export interface TradeJournalStats {
  readonly totalTrades: number;
  readonly wins: number;
  readonly losses: number;
  readonly winRate: number;
  readonly avgPnlPct: number;
  readonly avgWinPct: number;
  readonly avgLossPct: number;
  readonly avgDurationMinutes: number;
  readonly mostCommonFailure: TradeFailureReason;
  readonly bestPlaybook?: { playbook: SetupPlaybook; winRate: number; count: number };
  readonly worstPlaybook?: { playbook: SetupPlaybook; winRate: number; count: number };
}

export interface TradeJournalStorePort {
  save(entry: TradeJournalEntry): void;
  getBySessionId(sessionId: string): TradeJournalEntry | undefined;
  getRecent(limit: number): readonly TradeJournalEntry[];
  getBySymbol(symbol: string, limit: number): readonly TradeJournalEntry[];
  getSimilarTrades(criteria: {
    setupPlaybook?: SetupPlaybook;
    marketRegime?: MarketRegime;
    setupGrade?: SetupGrade;
    symbol?: string;
    limit?: number;
  }): readonly TradeJournalEntry[];
  getStats(lookbackDays?: number): TradeJournalStats;
}
