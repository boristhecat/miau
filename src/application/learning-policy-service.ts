import type { LearningOutcomeSummary, LearningStorePort } from "../ports/learning-store-port.js";
import { clamp } from "../domain/interval-utils.js";

export interface LearningPolicy {
  confidenceDelta: number;
  minConfidence: number;
  minSetupQuality: number;
  stopWideningFactor: number;
  note?: string;
  sampleSize: number;
  active: boolean;
}

export class LearningPolicyService {
  constructor(private readonly store: LearningStorePort) {}

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
    const pnlBias =
      blendedAvgPnlUsd >= 0 ? Math.min(5, blendedAvgPnlUsd / 4) : -Math.min(5, Math.abs(blendedAvgPnlUsd) / 4);
    const confidenceDelta = clamp(Math.round((weightedWinRate - 0.5) * 24 + pnlBias), -15, 15);
    const minConfidence = weightedWinRate < 0.45 ? 50 : weightedWinRate > 0.58 ? 43 : 45;
    const minSetupQuality = weightedWinRate < 0.45 ? 58 : weightedWinRate > 0.58 ? 49 : 52;
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
