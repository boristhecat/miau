export type OutcomeStatus = "SUCCESS" | "FAILURE";

export interface LearningOutcomeRecord {
  pair: string;
  symbol: string;
  timeframe: string;
  horizonMinutes: number;
  marketRegime: string;
  signal: string;
  confidence: number;
  setupQuality: number;
  status: OutcomeStatus;
  pnlUsd?: number;
}

export interface LearningStatsQuery {
  pair: string;
  timeframe: string;
  marketRegime: string;
  lookbackDays: number;
  limit: number;
}

export interface LearningStatsResult {
  samples: number;
  winRate: number;
  avgPnlUsd: number;
  recentStatuses: OutcomeStatus[];
}

export interface LearningOverview {
  totalSamples: number;
  wins: number;
  losses: number;
  winRate: number;
  avgPnlUsd: number;
}

export interface LearningStorePort {
  recordOutcome(input: LearningOutcomeRecord): Promise<void>;
  getStats(input: LearningStatsQuery): Promise<LearningStatsResult>;
  getOverview(input: { lookbackDays: number }): Promise<LearningOverview>;
}
