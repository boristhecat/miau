export type OutcomeStatus = "SUCCESS" | "FAILURE";
export type OutcomeFailureType =
  | "NONE"
  | "WRONG_DIRECTION"
  | "STOP_TOO_TIGHT_REBOUND"
  | "TIMEOUT_LOSS"
  | "WHIPSAW_SL_TP";

export interface LearningOutcomeSummary {
  status: OutcomeStatus;
  failureType: OutcomeFailureType;
}

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
  failureType?: OutcomeFailureType;
  directionalCorrect?: boolean;
  maxFavorableExcursionPct?: number;
  maxAdverseExcursionPct?: number;
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
  recentOutcomes: LearningOutcomeSummary[];
}

export interface LearningOverview {
  totalSamples: number;
  wins: number;
  losses: number;
  winRate: number;
  avgPnlUsd: number;
}

export interface LearningBucketRow {
  timeframe: string;
  horizonBucket: "1-10m" | "10-30m" | "30-90m" | "90m+";
  samples: number;
  wins: number;
  losses: number;
  winRate: number;
  avgPnlUsd: number;
}

export interface LearningStorePort {
  recordOutcome(input: LearningOutcomeRecord): Promise<void>;
  getStats(input: LearningStatsQuery): Promise<LearningStatsResult>;
  getOverview(input: { lookbackDays: number }): Promise<LearningOverview>;
  getBucketOverview(input: { lookbackDays: number }): Promise<LearningBucketRow[]>;
}
