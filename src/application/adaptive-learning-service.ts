import type { Recommendation } from "../domain/types.js";
import type {
  LearningBucketRow,
  LearningOutcomeRecord,
  LearningRecommendationSnapshot,
  LearningOverview,
  LearningOutcomeSummary,
  LearningStorePort,
  OutcomeFailureType,
  OutcomeStatus
} from "../ports/learning-store-port.js";

export interface LearningPolicy {
  confidenceDelta: number;
  minConfidence: number;
  minSetupQuality: number;
  note?: string;
  sampleSize: number;
  active: boolean;
}

export class AdaptiveLearningService {
  constructor(private readonly store: LearningStorePort) {}

  async getOverview(lookbackDays = 14): Promise<LearningOverview> {
    return this.store.getOverview({ lookbackDays });
  }

  async getBucketOverview(lookbackDays = 14): Promise<LearningBucketRow[]> {
    return this.store.getBucketOverview({ lookbackDays });
  }

  async getPolicy(input: {
    pair: string;
    timeframe: string;
    marketRegime: string;
  }): Promise<LearningPolicy> {
    const stats = await this.store.getStats({
      pair: input.pair,
      timeframe: input.timeframe,
      marketRegime: input.marketRegime,
      lookbackDays: 14,
      limit: 120
    });
    if (stats.samples < 15) {
      return {
        confidenceDelta: 0,
        minConfidence: 45,
        minSetupQuality: 52,
        sampleSize: stats.samples,
        active: false
      };
    }

    const weightedWinRate = computeWeightedWinRate(stats.recentOutcomes, stats.winRate);
    const pnlBias = stats.avgPnlUsd >= 0 ? Math.min(5, stats.avgPnlUsd / 4) : -Math.min(5, Math.abs(stats.avgPnlUsd) / 4);
    const confidenceDelta = clamp(Math.round((weightedWinRate - 0.5) * 24 + pnlBias), -15, 15);
    const minConfidence =
      weightedWinRate < 0.45 ? 50 : weightedWinRate > 0.58 ? 43 : 45;
    const minSetupQuality =
      weightedWinRate < 0.45 ? 58 : weightedWinRate > 0.58 ? 49 : 52;
    const recentFailures = stats.recentOutcomes.filter(
      (outcome) => outcome.status === "FAILURE" && outcome.failureType !== "STOP_TOO_TIGHT_REBOUND"
    ).length;
    const tightStopFailures = stats.recentOutcomes.filter(
      (outcome) => outcome.status === "FAILURE" && outcome.failureType === "STOP_TOO_TIGHT_REBOUND"
    ).length;
    const strictnessBump = recentFailures >= 4 ? 3 : 0;

    return {
      confidenceDelta,
      minConfidence: clamp(minConfidence + strictnessBump, 35, 70),
      minSetupQuality: clamp(minSetupQuality + strictnessBump, 40, 75),
      sampleSize: stats.samples,
      active: stats.samples >= 30,
      note:
        `learning win ${Math.round(weightedWinRate * 100)}% (raw ${Math.round(stats.winRate * 100)}%, tight-stop ${tightStopFailures}) / avg ${stats.avgPnlUsd.toFixed(2)} USDC (${stats.samples} samples)`
    };
  }

  async applyPolicy(input: {
    recommendation: Recommendation;
    timeframe: string;
  }): Promise<Recommendation> {
    const rec = input.recommendation;
    const policy = await this.getPolicy({
      pair: rec.pair,
      timeframe: input.timeframe,
      marketRegime: rec.marketRegime
    });
    if (!policy.active) {
      return rec;
    }
    rec.confidence = clamp(rec.confidence + policy.confidenceDelta, 1, 99);
    if (policy.note) {
      rec.rationale.unshift(`Learning: ${policy.note}.`);
    }

    if (rec.signal !== "NO_TRADE") {
      if (rec.confidence < policy.minConfidence) {
        rec.signal = "NO_TRADE";
        rec.action = "NO TRADE";
        rec.rationale.push(`No-trade guard: learning confidence floor ${policy.minConfidence}% not met.`);
      } else if (rec.confidenceBreakdown.setupQuality < policy.minSetupQuality) {
        rec.signal = "NO_TRADE";
        rec.action = "NO TRADE";
        rec.rationale.push(`No-trade guard: learning setup-quality floor ${policy.minSetupQuality}% not met.`);
      }
    }
    return rec;
  }

  async recordSimulationOutcome(input: {
    recommendation: Recommendation;
    timeframe: string;
    horizonMinutes: number;
    status: OutcomeStatus;
    failureType?: OutcomeFailureType;
    directionalCorrect?: boolean;
    maxFavorableExcursionPct?: number;
    maxAdverseExcursionPct?: number;
    pnlUsd?: number;
  }): Promise<void> {
    const symbol = input.recommendation.pair.split("-")[0] ?? input.recommendation.pair;
    const recommendationSnapshot: LearningRecommendationSnapshot = {
      analysisInterval: input.recommendation.analysisInterval,
      analysisBiasInterval: input.recommendation.analysisBiasInterval,
      modelSignal: input.recommendation.modelSignal,
      requestedDirection: input.recommendation.requestedDirection,
      qualityVerdict: input.recommendation.qualityVerdict,
      setupGrade: input.recommendation.setupGrade,
      entry: input.recommendation.entry,
      stopLoss: input.recommendation.stopLoss,
      takeProfit: input.recommendation.takeProfit,
      riskRewardRatio: input.recommendation.riskRewardRatio,
      expectedLow: input.recommendation.expectedLow,
      expectedHigh: input.recommendation.expectedHigh,
      objectiveHorizon: input.recommendation.objectiveHorizon,
      objectiveHorizonMinutes: input.recommendation.objectiveHorizonMinutes,
      objectiveHorizonCandles: input.recommendation.objectiveHorizonCandles,
      confidenceBreakdown: input.recommendation.confidenceBreakdown,
      indicators: input.recommendation.indicators as unknown as Record<string, unknown>,
      perp: input.recommendation.perp as unknown as Record<string, unknown>,
      rationale: [...input.recommendation.rationale]
    };
    const record: LearningOutcomeRecord = {
      pair: input.recommendation.pair,
      symbol,
      timeframe: input.timeframe,
      horizonMinutes: input.horizonMinutes,
      marketRegime: input.recommendation.marketRegime,
      signal: input.recommendation.signal,
      confidence: input.recommendation.confidence,
      setupQuality: input.recommendation.confidenceBreakdown.setupQuality,
      status: input.status,
      failureType: input.failureType,
      directionalCorrect: input.directionalCorrect,
      maxFavorableExcursionPct: input.maxFavorableExcursionPct,
      maxAdverseExcursionPct: input.maxAdverseExcursionPct,
      pnlUsd: input.pnlUsd,
      recommendationSnapshot
    };
    await this.store.recordOutcome(record);
  }

  async recordQueryObservation(input: {
    recommendation: Recommendation;
    timeframe: string;
    horizonMinutes: number;
  }): Promise<void> {
    const symbol = input.recommendation.pair.split("-")[0] ?? input.recommendation.pair;
    const recommendationSnapshot: LearningRecommendationSnapshot = {
      analysisInterval: input.recommendation.analysisInterval,
      analysisBiasInterval: input.recommendation.analysisBiasInterval,
      modelSignal: input.recommendation.modelSignal,
      requestedDirection: input.recommendation.requestedDirection,
      qualityVerdict: input.recommendation.qualityVerdict,
      setupGrade: input.recommendation.setupGrade,
      entry: input.recommendation.entry,
      stopLoss: input.recommendation.stopLoss,
      takeProfit: input.recommendation.takeProfit,
      riskRewardRatio: input.recommendation.riskRewardRatio,
      expectedLow: input.recommendation.expectedLow,
      expectedHigh: input.recommendation.expectedHigh,
      objectiveHorizon: input.recommendation.objectiveHorizon,
      objectiveHorizonMinutes: input.recommendation.objectiveHorizonMinutes,
      objectiveHorizonCandles: input.recommendation.objectiveHorizonCandles,
      confidenceBreakdown: input.recommendation.confidenceBreakdown,
      indicators: input.recommendation.indicators as unknown as Record<string, unknown>,
      perp: input.recommendation.perp as unknown as Record<string, unknown>,
      rationale: [...input.recommendation.rationale]
    };
    const record: LearningOutcomeRecord = {
      pair: input.recommendation.pair,
      symbol,
      timeframe: input.timeframe,
      horizonMinutes: input.horizonMinutes,
      marketRegime: input.recommendation.marketRegime,
      signal: input.recommendation.signal,
      confidence: input.recommendation.confidence,
      setupQuality: input.recommendation.confidenceBreakdown.setupQuality,
      status: "PENDING",
      recommendationSnapshot
    };
    await this.store.recordOutcome(record);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function computeWeightedWinRate(recentOutcomes: LearningOutcomeSummary[], fallbackWinRate: number): number {
  if (recentOutcomes.length === 0) {
    return fallbackWinRate;
  }
  let weightedWins = 0;
  let weightedLosses = 0;
  for (const outcome of recentOutcomes) {
    if (outcome.status === "SUCCESS") {
      weightedWins += 1;
      continue;
    }
    weightedLosses += outcome.failureType === "STOP_TOO_TIGHT_REBOUND" ? 0.35 : 1;
  }
  const total = weightedWins + weightedLosses;
  if (total <= 0) {
    return fallbackWinRate;
  }
  return weightedWins / total;
}
