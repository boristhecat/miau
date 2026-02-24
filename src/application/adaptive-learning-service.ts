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
  stopWideningFactor: number;
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
    const lookbackDays = 14;
    const limit = 120;
    const [specific, pairTimeframe, timeframeRegime, global] = await Promise.all([
      this.store.getStats({
        pair: input.pair,
        timeframe: input.timeframe,
        marketRegime: input.marketRegime,
        lookbackDays,
        limit
      }),
      this.store.getStats({
        pair: input.pair,
        timeframe: input.timeframe,
        lookbackDays,
        limit
      }),
      this.store.getStats({
        timeframe: input.timeframe,
        marketRegime: input.marketRegime,
        lookbackDays,
        limit
      }),
      this.store.getStats({
        lookbackDays,
        limit
      })
    ]);

    const broaderPriorWinRate = weightedMean(
      [pairTimeframe.winRate, timeframeRegime.winRate, global.winRate],
      [pairTimeframe.samples, timeframeRegime.samples, global.samples]
    );
    const broaderPriorPnl = weightedMean(
      [pairTimeframe.avgPnlUsd, timeframeRegime.avgPnlUsd, global.avgPnlUsd],
      [pairTimeframe.samples, timeframeRegime.samples, global.samples]
    );
    const shrinkage = computeShrinkage(specific.samples, 30);
    const blendedWinRate = blendValue(specific.winRate, broaderPriorWinRate, shrinkage);
    const blendedAvgPnlUsd = blendValue(specific.avgPnlUsd, broaderPriorPnl, shrinkage);
    const effectiveSamples = Math.round(
      specific.samples +
        pairTimeframe.samples * 0.5 +
        timeframeRegime.samples * 0.35 +
        global.samples * 0.2
    );
    if (effectiveSamples < 18) {
      return {
        confidenceDelta: 0,
        minConfidence: 45,
        minSetupQuality: 52,
        stopWideningFactor: 0,
        sampleSize: specific.samples,
        active: false
      };
    }

    const failureContext =
      [specific, pairTimeframe, timeframeRegime, global].find((item) => item.recentOutcomes.length >= 8) ?? global;
    const weightedWinRate = computeWeightedWinRate(failureContext.recentOutcomes, blendedWinRate);
    const pnlBias = blendedAvgPnlUsd >= 0 ? Math.min(5, blendedAvgPnlUsd / 4) : -Math.min(5, Math.abs(blendedAvgPnlUsd) / 4);
    const confidenceDelta = clamp(Math.round((weightedWinRate - 0.5) * 24 + pnlBias), -15, 15);
    const minConfidence =
      weightedWinRate < 0.45 ? 50 : weightedWinRate > 0.58 ? 43 : 45;
    const minSetupQuality =
      weightedWinRate < 0.45 ? 58 : weightedWinRate > 0.58 ? 49 : 52;
    const recentFailures = failureContext.recentOutcomes.filter(
      (outcome) => outcome.status === "FAILURE" && outcome.failureType !== "STOP_TOO_TIGHT_REBOUND"
    ).length;
    const tightStopFailures = failureContext.recentOutcomes.filter(
      (outcome) => outcome.status === "FAILURE" && outcome.failureType === "STOP_TOO_TIGHT_REBOUND"
    ).length;
    const failureCount = failureContext.recentOutcomes.filter((outcome) => outcome.status === "FAILURE").length;
    const tightStopRate = failureCount > 0 ? tightStopFailures / failureCount : 0;
    const stopWideningFactor =
      tightStopFailures >= 2
        ? clamp(
            (tightStopRate - 0.28) * 0.42 * clamp(effectiveSamples / 80, 0.3, 1),
            0,
            0.16
          )
        : 0;
    const strictnessBump = recentFailures >= 4 ? 3 : 0;

    return {
      confidenceDelta,
      minConfidence: clamp(minConfidence + strictnessBump, 35, 70),
      minSetupQuality: clamp(minSetupQuality + strictnessBump, 40, 75),
      stopWideningFactor,
      sampleSize: specific.samples,
      active: true,
      note:
        `learning win ${Math.round(weightedWinRate * 100)}% (specific ${Math.round(specific.winRate * 100)}%, blended ${Math.round(blendedWinRate * 100)}%, tight-stop ${tightStopFailures}) / avg ${blendedAvgPnlUsd.toFixed(2)} USDC (specific ${specific.samples}, effective ${effectiveSamples}, shrink ${Math.round((1 - shrinkage) * 100)}%, sl+${Math.round(stopWideningFactor * 100)}%)`
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
    if (policy.stopWideningFactor > 0 && rec.signal !== "NO_TRADE") {
      const applied = applyStopWidening(rec, policy.stopWideningFactor);
      if (applied) {
        rec.rationale.unshift(
          `Learning: widened stop by ${Math.round(policy.stopWideningFactor * 100)}% from tight-stop rebound history.`
        );
      }
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

function computeShrinkage(samples: number, priorStrength: number): number {
  if (samples <= 0) {
    return 0;
  }
  return samples / (samples + Math.max(1, priorStrength));
}

function blendValue(primary: number, prior: number, primaryWeight: number): number {
  return primary * primaryWeight + prior * (1 - primaryWeight);
}

function weightedMean(values: number[], weights: number[]): number {
  let weightedSum = 0;
  let totalWeight = 0;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    const weight = weights[i] ?? 0;
    if (!Number.isFinite(value) || weight <= 0) {
      continue;
    }
    weightedSum += value * weight;
    totalWeight += weight;
  }
  if (totalWeight <= 0) {
    return 0;
  }
  return weightedSum / totalWeight;
}

function applyStopWidening(rec: Recommendation, factor: number): boolean {
  if (factor <= 0 || rec.signal === "NO_TRADE") {
    return false;
  }
  const stopDistance = Math.abs(rec.entry - rec.stopLoss);
  const widenedDistance = stopDistance * (1 + factor);
  if (!Number.isFinite(widenedDistance) || widenedDistance <= 0) {
    return false;
  }

  if (rec.signal === "LONG") {
    rec.stopLoss = rec.entry - widenedDistance;
  } else {
    rec.stopLoss = rec.entry + widenedDistance;
  }
  rec.riskRewardRatio = computeRiskReward(rec.entry, rec.stopLoss, rec.takeProfit);
  recomputePnlMetrics(rec);
  return true;
}

function computeRiskReward(entry: number, stopLoss: number, takeProfit: number): number {
  const risk = Math.abs(entry - stopLoss);
  const reward = Math.abs(takeProfit - entry);
  if (risk <= 0) {
    return 0;
  }
  return reward / risk;
}

function recomputePnlMetrics(rec: Recommendation): void {
  if (rec.signal === "NO_TRADE" || !rec.leverage || !rec.positionSizeUsd || rec.entry <= 0) {
    return;
  }
  const notional = rec.leverage * rec.positionSizeUsd;
  const slReturn =
    rec.signal === "LONG"
      ? (rec.stopLoss - rec.entry) / rec.entry
      : (rec.entry - rec.stopLoss) / rec.entry;
  const tpReturn =
    rec.signal === "LONG"
      ? (rec.takeProfit - rec.entry) / rec.entry
      : (rec.entry - rec.takeProfit) / rec.entry;
  rec.estimatedPnLAtStopLoss = round(notional * slReturn);
  rec.estimatedPnLAtTakeProfit = round(notional * tpReturn);

  const roundTripCostRate = 0.0014;
  const totalCosts = notional * roundTripCostRate;
  const netTp = (rec.estimatedPnLAtTakeProfit ?? 0) - totalCosts;
  const netSl = (rec.estimatedPnLAtStopLoss ?? 0) - totalCosts;
  rec.netEstimatedPnLAtTakeProfit = round(netTp);
  rec.netEstimatedPnLAtStopLoss = round(netSl);
  rec.netRiskRewardRatio = round(Math.abs(netSl) > 0 ? Math.abs(netTp / netSl) : 0);
  const winProbability = Math.min(0.95, Math.max(0.05, rec.confidence / 100));
  const expectedValueUsd = winProbability * netTp + (1 - winProbability) * netSl;
  rec.expectedValueUsd = round(expectedValueUsd);
  rec.expectedValuePerMarginPct = rec.positionSizeUsd > 0 ? round((expectedValueUsd / rec.positionSizeUsd) * 100) : undefined;
}

function round(value: number): number {
  return Number(value.toFixed(4));
}
