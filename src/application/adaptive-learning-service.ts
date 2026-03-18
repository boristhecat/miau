import type { Recommendation, TradeJournalEntry } from "../domain/types.js";
import type {
  LearningBucketRow,
  LearningOutcomeRecord,
  LearningOverview,
  LearningStorePort,
  OutcomeFailureType,
  OutcomeStatus
} from "../ports/learning-store-port.js";
import { RecommendationTradeCalculator } from "../domain/recommendation-trade-calculator.js";
import { clamp } from "../domain/interval-utils.js";
import { LearningPolicyService, type LearningPolicy } from "./learning-policy-service.js";
import { toLearningRecommendationSnapshot } from "./recommendation-mappers.js";

export type { LearningPolicy };

const tradeCalculator = new RecommendationTradeCalculator();

export class AdaptiveLearningService {
  private readonly policyService: LearningPolicyService;

  constructor(private readonly store: LearningStorePort) {
    this.policyService = new LearningPolicyService(store);
  }

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
    return this.policyService.getPolicy(input);
  }

  async getCalibratedWinRate(input: {
    pair?: string;
    timeframe?: string;
    marketRegime?: string;
  }): Promise<number | undefined> {
    if (!this.store.getCalibrationWinRate) {
      return undefined;
    }
    const result = await this.store.getCalibrationWinRate({
      pair: input.pair,
      timeframe: input.timeframe,
      marketRegime: input.marketRegime,
      minSamples: 20,
      lookbackDays: 30
    });
    return result.sufficient ? result.winRate : undefined;
  }

  async applyPolicy(input: {
    recommendation: Recommendation;
    timeframe: string;
  }): Promise<Recommendation> {
    const policy = await this.policyService.getPolicy({
      pair: input.recommendation.pair,
      timeframe: input.timeframe,
      marketRegime: input.recommendation.marketRegime
    });
    if (!policy.active) {
      return input.recommendation;
    }

    let rec: Recommendation = {
      ...input.recommendation,
      confidence: clamp(input.recommendation.confidence + policy.confidenceDelta, 1, 99)
    };

    if (policy.note) {
      rec = { ...rec, rationale: [`Learning: ${policy.note}.`, ...rec.rationale] };
    }

    if (policy.stopWideningFactor > 0 && rec.signal !== "NO_TRADE") {
      const patch = applyStopWideningPatch(rec, policy.stopWideningFactor);
      if (patch) {
        rec = {
          ...rec,
          ...patch,
          rationale: [
            `Learning: widened stop by ${Math.round(policy.stopWideningFactor * 100)}% from tight-stop rebound history.`,
            ...rec.rationale
          ]
        };
      }
    }

    if (policy.tpNarrowingFactor > 0 && rec.signal !== "NO_TRADE") {
      const patch = applyTpNarrowingPatch(rec, policy.tpNarrowingFactor);
      if (patch) {
        rec = {
          ...rec,
          ...patch,
          rationale: [
            `Learning: narrowed TP by ${Math.round(policy.tpNarrowingFactor * 100)}% from timeout-loss history.`,
            ...rec.rationale
          ]
        };
      }
    }

    if (rec.signal !== "NO_TRADE") {
      if (rec.confidence < policy.minConfidence) {
        rec = {
          ...rec,
          signal: "NO_TRADE",
          action: "NO TRADE",
          rationale: [...rec.rationale, `No-trade guard: learning confidence floor ${policy.minConfidence}% not met.`]
        };
      } else if (rec.confidenceBreakdown.setupQuality < policy.minSetupQuality) {
        rec = {
          ...rec,
          signal: "NO_TRADE",
          action: "NO TRADE",
          rationale: [...rec.rationale, `No-trade guard: learning setup-quality floor ${policy.minSetupQuality}% not met.`]
        };
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
    const recommendationSnapshot = toLearningRecommendationSnapshot(input.recommendation);
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
    const recommendationSnapshot = toLearningRecommendationSnapshot(input.recommendation);
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

  /**
   * Bridge: map a completed TradeJournalEntry into the learning system so
   * monitored trades actually improve adaptive policy (win-rate, stop widening, etc.).
   */
  async recordJournalOutcome(entry: TradeJournalEntry): Promise<void> {
    const symbol = entry.symbol.split("-")[0] ?? entry.symbol;
    const pair = entry.symbol.includes("-") ? entry.symbol : `${entry.symbol}-USD`;

    const status: OutcomeStatus =
      entry.outcomeClassification === "AS_PLANNED" ||
      entry.outcomeClassification === "EARLY_EXIT_PROFIT"
        ? "SUCCESS"
        : "FAILURE";

    const failureType: OutcomeFailureType = mapJournalFailureToLearning(entry.failureReason);

    const directionalCorrect =
      entry.pnlPct > 0 ||
      entry.outcomeClassification === "AS_PLANNED" ||
      entry.outcomeClassification === "BREAKEVEN";

    const record: LearningOutcomeRecord = {
      pair,
      symbol,
      timeframe: entry.analysisInterval,
      horizonMinutes: entry.durationMinutes,
      marketRegime: entry.marketRegime,
      signal: entry.side,
      confidence: entry.confidence,
      setupQuality: entry.confidence, // best proxy available from journal data
      status,
      failureType,
      directionalCorrect,
      maxFavorableExcursionPct: entry.maxFavorableExcursionPct,
      maxAdverseExcursionPct: entry.maxAdverseExcursionPct,
      pnlUsd: entry.pnlUsd
    };
    await this.store.recordOutcome(record);
  }
}

function mapJournalFailureToLearning(reason: TradeJournalEntry["failureReason"]): OutcomeFailureType {
  switch (reason) {
    case "WRONG_DIRECTION":
      return "WRONG_DIRECTION";
    case "STOP_TOO_TIGHT":
      return "STOP_TOO_TIGHT_REBOUND";
    case "BAD_TIMING":
    case "SESSION_FAKEOUT":
      return "WHIPSAW_SL_TP";
    case "FUNDING_DRAIN":
    case "EXTERNAL_EVENT":
      return "TIMEOUT_LOSS";
    case "NONE":
    default:
      return "NONE";
  }
}

function applyTpNarrowingPatch(rec: Recommendation, factor: number): Partial<Recommendation> | null {
  if (factor <= 0 || rec.signal === "NO_TRADE") {
    return null;
  }
  const tpDistance = Math.abs(rec.takeProfit - rec.entry);
  const narrowedDistance = tpDistance * (1 - factor);
  if (!Number.isFinite(narrowedDistance) || narrowedDistance <= 0) {
    return null;
  }

  const newTakeProfit = rec.signal === "LONG" ? rec.entry + narrowedDistance : rec.entry - narrowedDistance;
  const newRiskReward = tradeCalculator.computeRiskReward(rec.entry, rec.stopLoss, newTakeProfit);
  return { takeProfit: newTakeProfit, riskRewardRatio: newRiskReward };
}

function applyStopWideningPatch(rec: Recommendation, factor: number): Partial<Recommendation> | null {
  if (factor <= 0 || rec.signal === "NO_TRADE") {
    return null;
  }
  const stopDistance = Math.abs(rec.entry - rec.stopLoss);
  const widenedDistance = stopDistance * (1 + factor);
  if (!Number.isFinite(widenedDistance) || widenedDistance <= 0) {
    return null;
  }

  const newStopLoss = rec.signal === "LONG" ? rec.entry - widenedDistance : rec.entry + widenedDistance;
  return tradeCalculator.rebuildAfterStopChange(rec, newStopLoss);
}
