import type { Recommendation } from "../domain/types.js";
import type {
  LearningOutcomeRecord,
  LearningOverview,
  LearningStorePort,
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

    const pnlBias = stats.avgPnlUsd >= 0 ? Math.min(5, stats.avgPnlUsd / 4) : -Math.min(5, Math.abs(stats.avgPnlUsd) / 4);
    const confidenceDelta = clamp(Math.round((stats.winRate - 0.5) * 24 + pnlBias), -15, 15);
    const minConfidence =
      stats.winRate < 0.45 ? 50 : stats.winRate > 0.58 ? 43 : 45;
    const minSetupQuality =
      stats.winRate < 0.45 ? 58 : stats.winRate > 0.58 ? 49 : 52;
    const recentFailures = stats.recentStatuses.filter((status) => status === "FAILURE").length;
    const strictnessBump = recentFailures >= 4 ? 3 : 0;

    return {
      confidenceDelta,
      minConfidence: clamp(minConfidence + strictnessBump, 35, 70),
      minSetupQuality: clamp(minSetupQuality + strictnessBump, 40, 75),
      sampleSize: stats.samples,
      active: stats.samples >= 30,
      note:
        `learning win ${Math.round(stats.winRate * 100)}% / avg ${stats.avgPnlUsd.toFixed(2)} USDC (${stats.samples} samples)`
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
    pnlUsd?: number;
  }): Promise<void> {
    const symbol = input.recommendation.pair.split("-")[0] ?? input.recommendation.pair;
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
      pnlUsd: input.pnlUsd
    };
    await this.store.recordOutcome(record);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
