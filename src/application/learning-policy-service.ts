import type { LearningOutcomeSummary, LearningStorePort } from "../ports/learning-store-port.js";
import { clamp } from "../domain/interval-utils.js";

export interface FailureBreakdown {
  wrongDirection: number;
  stopTooTight: number;
  timeoutLoss: number;
  whipsaw: number;
  total: number;
}

export interface LearningPolicy {
  confidenceDelta: number;
  minConfidence: number;
  minSetupQuality: number;
  stopWideningFactor: number;
  tpNarrowingFactor: number;
  note?: string;
  sampleSize: number;
  active: boolean;
  winRate?: number;
  dominantFailureType?: string;
  failureBreakdown?: FailureBreakdown;
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
    const shrinkage = computeShrinkage(specific.samples, 50);
    const blendedWinRate = blendValue(specific.winRate, broaderPriorWinRate, shrinkage);
    const blendedAvgPnlUsd = blendValue(specific.avgPnlUsd, broaderPriorPnl, shrinkage);
    const effectiveSamples = Math.round(
      specific.samples +
        pairTimeframe.samples * 0.5 +
        timeframeRegime.samples * 0.35 +
        global.samples * 0.2
    );
    if (effectiveSamples < 12) {
      return {
        confidenceDelta: 0,
        minConfidence: 45,
        minSetupQuality: 52,
        stopWideningFactor: 0,
        tpNarrowingFactor: 0,
        sampleSize: specific.samples,
        active: false
      };
    }

    const failureContext =
      [specific, pairTimeframe, timeframeRegime, global].find((item) => item.recentOutcomes.length >= 8) ?? global;
    const weightedWinRate = computeWeightedWinRate(failureContext.recentOutcomes, blendedWinRate);
    const pnlBias =
      blendedAvgPnlUsd >= 0 ? Math.min(5, blendedAvgPnlUsd / 4) : -Math.min(8, Math.abs(blendedAvgPnlUsd) / 3);
    // Improvement #7: Asymmetric confidence delta — negative adjustments are 1.5x larger
    const rawDelta = (weightedWinRate - 0.5) * 24 + pnlBias;
    const confidenceDelta = clamp(Math.round(rawDelta < 0 ? rawDelta * 1.5 : rawDelta), -15, 15);
    const minConfidence = weightedWinRate < 0.45 ? 50 : weightedWinRate > 0.58 ? 43 : 45;
    const minSetupQuality = weightedWinRate < 0.45 ? 58 : weightedWinRate > 0.58 ? 49 : 52;
    // Per-failure-type analysis
    const failureBreakdown = computeFailureBreakdown(failureContext.recentOutcomes);
    const failureCount = failureBreakdown.total;
    const tightStopFailures = failureBreakdown.stopTooTight;
    const tightStopRate = failureCount > 0 ? tightStopFailures / failureCount : 0;
    const timeoutRate = failureCount > 0 ? failureBreakdown.timeoutLoss / failureCount : 0;
    const wrongDirRate = failureCount > 0 ? failureBreakdown.wrongDirection / failureCount : 0;

    // Adaptive stop widening from tight-stop rebound pattern
    const stopWideningFactor =
      tightStopFailures >= 2
        ? clamp(
            (tightStopRate - 0.28) * 0.42 * clamp(effectiveSamples / 80, 0.3, 1),
            0,
            0.16
          )
        : 0;

    // Adaptive TP narrowing from timeout loss pattern
    const tpNarrowingFactor =
      failureBreakdown.timeoutLoss >= 2 && timeoutRate > 0.3
        ? clamp(
            (timeoutRate - 0.3) * 0.3 * clamp(effectiveSamples / 80, 0.3, 1),
            0,
            0.12
          )
        : 0;

    // Strictness adjustments based on dominant failure type
    const recentFailures = failureCount - tightStopFailures;
    let strictnessBump = recentFailures >= 4 ? 3 : 0;
    if (wrongDirRate > 0.5 && failureCount >= 4) {
      strictnessBump += 4;
    }

    return {
      confidenceDelta,
      minConfidence: clamp(minConfidence + strictnessBump, 35, 70),
      minSetupQuality: clamp(minSetupQuality + strictnessBump, 40, 75),
      stopWideningFactor,
      tpNarrowingFactor,
      sampleSize: specific.samples,
      active: true,
      winRate: weightedWinRate,
      dominantFailureType: computeDominantFailureType(failureBreakdown),
      failureBreakdown,
      note:
        `learning win ${Math.round(weightedWinRate * 100)}% (specific ${Math.round(specific.winRate * 100)}%, blended ${Math.round(blendedWinRate * 100)}%) / failures: dir=${failureBreakdown.wrongDirection} tight=${tightStopFailures} timeout=${failureBreakdown.timeoutLoss} whip=${failureBreakdown.whipsaw} / avg ${blendedAvgPnlUsd.toFixed(2)} USDC (specific ${specific.samples}, effective ${effectiveSamples}, shrink ${Math.round((1 - shrinkage) * 100)}%, sl+${Math.round(stopWideningFactor * 100)}% tp-${Math.round(tpNarrowingFactor * 100)}%)`
    };
  }
}

// Trader threshold: only flag a dominant failure type if it represents >= 40% of
// failures AND has at least 3 instances — below that it's noise, not signal.
function computeDominantFailureType(breakdown: FailureBreakdown): string | undefined {
  if (breakdown.total === 0) return undefined;
  const candidates: Array<[string, number]> = [
    ["WRONG_DIRECTION", breakdown.wrongDirection],
    ["STOP_TOO_TIGHT_REBOUND", breakdown.stopTooTight],
    ["TIMEOUT_LOSS", breakdown.timeoutLoss],
    ["WHIPSAW_SL_TP", breakdown.whipsaw]
  ];
  for (const [type, count] of candidates) {
    if (count >= 3 && count / breakdown.total >= 0.4) return type;
  }
  return undefined;
}

function computeFailureBreakdown(recentOutcomes: LearningOutcomeSummary[]): FailureBreakdown {
  const breakdown: FailureBreakdown = {
    wrongDirection: 0,
    stopTooTight: 0,
    timeoutLoss: 0,
    whipsaw: 0,
    total: 0
  };
  for (const outcome of recentOutcomes) {
    if (outcome.status !== "FAILURE") continue;
    breakdown.total += 1;
    switch (outcome.failureType) {
      case "WRONG_DIRECTION":
        breakdown.wrongDirection += 1;
        break;
      case "STOP_TOO_TIGHT_REBOUND":
        breakdown.stopTooTight += 1;
        break;
      case "TIMEOUT_LOSS":
        breakdown.timeoutLoss += 1;
        break;
      case "WHIPSAW_SL_TP":
        breakdown.whipsaw += 1;
        break;
    }
  }
  return breakdown;
}

/**
 * Improvement #7: Asymmetric learning decay.
 * Losses weight 2x more than wins (except tight-stop rebounds at 0.35x).
 * This makes the system more cautious — a loss penalizes confidence
 * more than a win boosts it, which is appropriate for risk management.
 */
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
    // Asymmetric: full losses count 2x, tight-stop rebounds count 0.5x
    if (outcome.failureType === "STOP_TOO_TIGHT_REBOUND") {
      weightedLosses += 0.5;
    } else {
      weightedLosses += 2;
    }
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
