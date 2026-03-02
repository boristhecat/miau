import type { Recommendation } from "../domain/types.js";
import type { AiAdvice } from "../ports/ai-advisor-port.js";
import type { LearningOverview, LearningBucketRow } from "../ports/learning-store-port.js";
import type { LearningPolicy } from "./learning-policy-service.js";
import type { EvaluatedWatchSymbol } from "./evaluate-watch-symbol-use-case.js";
import type { RecommendationRankingResult } from "./run-recommendation-ranking-use-case.js";
import type { LearningBucketReport } from "./run-learning-bucket-report-use-case.js";
import type { LearningSimulationCandidate } from "./run-learning-cycle-use-case.js";
import type { SimulationEvaluationResult } from "./evaluate-simulation-use-case.js";
import type { OutcomeFailureType, OutcomeStatus } from "../ports/learning-store-port.js";

export interface IGenerateRecommendationUseCase {
  execute(input: {
    pair: string;
    forcedDirection?: "LONG" | "SHORT";
    expectedRangeHorizon?: string;
    interval?: string;
    biasInterval?: string;
    limit?: number;
    leverage?: number;
    positionSizeUsd?: number;
    slPct?: number;
    tpPct?: number;
    slUsd?: number;
    tpUsd?: number;
    objectiveHorizon?: string;
  }): Promise<Recommendation>;
}

export interface IAdaptiveLearningService {
  applyPolicy(input: { recommendation: Recommendation; timeframe: string }): Promise<Recommendation>;
  recordSimulationOutcome(input: {
    recommendation: Recommendation;
    timeframe: string;
    horizonMinutes: number;
    status: OutcomeStatus;
    failureType?: OutcomeFailureType;
    directionalCorrect?: boolean;
    maxFavorableExcursionPct?: number;
    maxAdverseExcursionPct?: number;
    pnlUsd?: number;
  }): Promise<void>;
  recordQueryObservation(input: {
    recommendation: Recommendation;
    timeframe: string;
    horizonMinutes: number;
  }): Promise<void>;
  getOverview(lookbackDays?: number): Promise<LearningOverview>;
  getBucketOverview(lookbackDays?: number): Promise<LearningBucketRow[]>;
  getPolicy(input: { pair: string; timeframe: string; marketRegime: string }): Promise<LearningPolicy>;
}

export interface IRankingUseCase {
  execute(input: {
    defaults: { leverage: number; positionSizeUsd: number; objectiveHorizon: string };
    top?: number;
    universeLimit?: number;
  }): Promise<RecommendationRankingResult>;
}

export interface ILearningBucketReportUseCase {
  execute(input?: { lookbackDays?: number }): Promise<LearningBucketReport>;
}

export interface ILearningCycleUseCase {
  execute(input: {
    horizonsMinutes: readonly number[];
    leverage: number;
    positionSizeUsd: number;
    active: () => boolean;
  }): Promise<{ symbols: string[]; candidates: LearningSimulationCandidate[] }>;
}

export interface IWatchSymbolUseCase {
  execute(input: {
    symbol: string;
    objectiveHorizon: string;
    requestedDirection?: "LONG" | "SHORT";
    leverage: number;
    positionSizeUsd: number;
    cooldownAdvisory?: string;
    calibration: (pair: string, confidence: number) => number;
  }): Promise<EvaluatedWatchSymbol>;
}

export interface ISimulationScheduler {
  schedule(input: {
    recommendation: Recommendation;
    interval: string;
    horizonMinutes: number;
    openedAtMs?: number;
    timerRegistry?: Set<NodeJS.Timeout>;
    onResult?: (result: SimulationEvaluationResult) => void | Promise<void>;
    onError?: (error: unknown) => void | Promise<void>;
  }): NodeJS.Timeout;
}

export interface IGenerateAiAdviceUseCase {
  execute(input: { recommendation: Recommendation }): Promise<AiAdvice>;
}
