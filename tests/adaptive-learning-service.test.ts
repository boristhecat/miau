import { describe, expect, it } from "vitest";
import { AdaptiveLearningService } from "../src/application/adaptive-learning-service.js";
import type {
  LearningBucketRow,
  LearningOverview,
  LearningOutcomeRecord,
  LearningStatsQuery,
  LearningStatsResult,
  LearningStorePort
} from "../src/ports/learning-store-port.js";
import type { IndicatorSnapshot, PerpMarketSnapshot, Recommendation } from "../src/domain/types.js";

const indicators: IndicatorSnapshot = {
  rsi14: 55,
  ema20: 100,
  ema50: 99,
  macd: 2,
  macdSignal: 1,
  macdHistogram: 1,
  atr14: 0.8,
  adx14: 25,
  bbUpper: 102,
  bbMiddle: 100,
  bbLower: 98,
  stochRsiK: 65,
  stochRsiD: 50,
  vwap: 100
};

const perp: PerpMarketSnapshot = {
  symbol: "BTC_USDC_PERP",
  fundingRate: 0,
  fundingRateAvg: 0,
  openInterest: 1_000,
  markPrice: 100,
  indexPrice: 100,
  premiumPct: 0
};

function baseRecommendation(): Recommendation {
  return {
    pair: "BTC-USD",
    signal: "LONG",
    action: "LONG",
    regime: "TRADEABLE",
    marketRegime: "TREND",
    entry: 100,
    stopLoss: 99,
    takeProfit: 102,
    confidence: 58,
    setupGrade: "B",
    confidenceBreakdown: {
      trend: 70,
      momentum: 62,
      volatility: 58,
      structure: 64,
      context: 60,
      setupQuality: 56
    },
    rationale: [],
    riskRewardRatio: 2,
    indicators,
    perp
  };
}

class FakeLearningStore implements LearningStorePort {
  constructor(
    private readonly stats: {
      specific: LearningStatsResult;
      pairTimeframe?: LearningStatsResult;
      timeframeRegime?: LearningStatsResult;
      global?: LearningStatsResult;
    },
    private readonly overview?: LearningOverview
  ) {}

  public lastRecord?: LearningOutcomeRecord;

  async recordOutcome(input: LearningOutcomeRecord): Promise<void> {
    this.lastRecord = input;
  }

  async getStats(input: LearningStatsQuery): Promise<LearningStatsResult> {
    if (input.pair && input.timeframe && input.marketRegime) {
      return this.stats.specific;
    }
    if (input.pair && input.timeframe) {
      return this.stats.pairTimeframe ?? this.stats.specific;
    }
    if (input.timeframe && input.marketRegime) {
      return this.stats.timeframeRegime ?? this.stats.specific;
    }
    return this.stats.global ?? this.stats.specific;
  }

  async getOverview(_input: { lookbackDays: number }): Promise<LearningOverview> {
    return (
      this.overview ?? {
        totalSamples: this.stats.specific.samples,
        wins: Math.round(this.stats.specific.winRate * this.stats.specific.samples),
        losses: Math.max(0, this.stats.specific.samples - Math.round(this.stats.specific.winRate * this.stats.specific.samples)),
        winRate: this.stats.specific.winRate,
        avgPnlUsd: this.stats.specific.avgPnlUsd
      }
    );
  }

  async getBucketOverview(_input: { lookbackDays: number }): Promise<LearningBucketRow[]> {
    return [];
  }
}

describe("AdaptiveLearningService", () => {
  const emptyStats: LearningStatsResult = {
    samples: 0,
    winRate: 0,
    avgPnlUsd: 0,
    recentOutcomes: []
  };

  it("raises confidence and relaxes gates for strong historical performance", async () => {
    const service = new AdaptiveLearningService(
      new FakeLearningStore({
        specific: {
          samples: 40,
          winRate: 0.66,
          avgPnlUsd: 7.5,
          recentOutcomes: [
            { status: "SUCCESS", failureType: "NONE" },
            { status: "SUCCESS", failureType: "NONE" },
            { status: "SUCCESS", failureType: "NONE" },
            { status: "FAILURE", failureType: "WRONG_DIRECTION" },
            { status: "SUCCESS", failureType: "NONE" }
          ]
        }
      })
    );

    const rec = await service.applyPolicy({
      recommendation: baseRecommendation(),
      timeframe: "1m"
    });

    expect(rec.confidence).toBeGreaterThan(58);
    expect(rec.signal).toBe("LONG");
    expect(rec.rationale.some((line) => line.startsWith("Learning:"))).toBe(true);
  });

  it("blocks trade when learned floors are not met", async () => {
    const service = new AdaptiveLearningService(
      new FakeLearningStore({
        specific: {
          samples: 35,
          winRate: 0.33,
          avgPnlUsd: -8.5,
          recentOutcomes: [
            { status: "FAILURE", failureType: "WRONG_DIRECTION" },
            { status: "FAILURE", failureType: "WRONG_DIRECTION" },
            { status: "FAILURE", failureType: "TIMEOUT_LOSS" },
            { status: "FAILURE", failureType: "WRONG_DIRECTION" },
            { status: "SUCCESS", failureType: "NONE" }
          ]
        }
      })
    );

    const rec = await service.applyPolicy({
      recommendation: baseRecommendation(),
      timeframe: "1m"
    });

    expect(rec.signal).toBe("NO_TRADE");
    expect(rec.action).toBe("NO TRADE");
    expect(rec.rationale.some((line) => line.includes("learning"))).toBe(true);
  });

  it("records simulation outcomes for persistence", async () => {
    const store = new FakeLearningStore({
      specific: emptyStats
    });
    const service = new AdaptiveLearningService(store);
    const rec = baseRecommendation();

    await service.recordSimulationOutcome({
      recommendation: rec,
      timeframe: "1m",
      horizonMinutes: 15,
      status: "SUCCESS",
      failureType: "NONE",
      directionalCorrect: true,
      maxFavorableExcursionPct: 1.2,
      maxAdverseExcursionPct: 0.5,
      pnlUsd: 12.3
    });

    expect(store.lastRecord).toBeDefined();
    expect(store.lastRecord?.pair).toBe("BTC-USD");
    expect(store.lastRecord?.status).toBe("SUCCESS");
    expect(store.lastRecord?.failureType).toBe("NONE");
    expect(store.lastRecord?.directionalCorrect).toBe(true);
    expect(store.lastRecord?.pnlUsd).toBe(12.3);
    expect(store.lastRecord?.recommendationSnapshot?.entry).toBe(100);
    expect(store.lastRecord?.recommendationSnapshot?.setupGrade).toBe("B");
    expect(store.lastRecord?.recommendationSnapshot?.confidenceBreakdown.setupQuality).toBe(56);
    expect(store.lastRecord?.recommendationSnapshot?.indicators).toBeDefined();
    expect(store.lastRecord?.recommendationSnapshot?.perp).toBeDefined();
  });

  it("records single-query observations as pending samples", async () => {
    const store = new FakeLearningStore({
      specific: emptyStats
    });
    const service = new AdaptiveLearningService(store);
    const rec = baseRecommendation();

    await service.recordQueryObservation({
      recommendation: rec,
      timeframe: "1m",
      horizonMinutes: 15
    });

    expect(store.lastRecord).toBeDefined();
    expect(store.lastRecord?.pair).toBe("BTC-USD");
    expect(store.lastRecord?.status).toBe("PENDING");
    expect(store.lastRecord?.horizonMinutes).toBe(15);
    expect(store.lastRecord?.recommendationSnapshot?.entry).toBe(100);
  });

  it("does not apply learning adjustments when effective sample size is too low", async () => {
    const service = new AdaptiveLearningService(
      new FakeLearningStore({
        specific: {
          samples: 5,
          winRate: 0.2,
          avgPnlUsd: -10,
          recentOutcomes: [
            { status: "FAILURE", failureType: "WRONG_DIRECTION" },
            { status: "FAILURE", failureType: "WRONG_DIRECTION" }
          ]
        },
        pairTimeframe: emptyStats,
        timeframeRegime: emptyStats,
        global: emptyStats
      })
    );
    const rec = baseRecommendation();
    const originalConfidence = rec.confidence;

    const adjusted = await service.applyPolicy({
      recommendation: rec,
      timeframe: "1m"
    });

    expect(adjusted.confidence).toBe(originalConfidence);
    expect(adjusted.signal).toBe("LONG");
  });

  it("does not over-penalize tight-stop rebound failures", async () => {
    const service = new AdaptiveLearningService(
      new FakeLearningStore({
        specific: {
          samples: 36,
          winRate: 0.4,
          avgPnlUsd: -1.2,
          recentOutcomes: [
            { status: "FAILURE", failureType: "STOP_TOO_TIGHT_REBOUND" },
            { status: "FAILURE", failureType: "STOP_TOO_TIGHT_REBOUND" },
            { status: "SUCCESS", failureType: "NONE" },
            { status: "SUCCESS", failureType: "NONE" },
            { status: "SUCCESS", failureType: "NONE" }
          ]
        }
      })
    );

    const rec = await service.applyPolicy({
      recommendation: baseRecommendation(),
      timeframe: "1m"
    });

    expect(rec.signal).toBe("LONG");
    expect(rec.stopLoss).toBeLessThan(99);
    expect(rec.riskRewardRatio).toBeLessThan(2);
    expect(rec.rationale.some((line) => line.includes("tight-stop"))).toBe(true);
    expect(rec.rationale.some((line) => line.includes("widened stop"))).toBe(true);
  });

  it("uses broader fallback buckets with shrinkage when pair bucket is sparse", async () => {
    const service = new AdaptiveLearningService(
      new FakeLearningStore({
        specific: {
          samples: 6,
          winRate: 0.34,
          avgPnlUsd: -4.2,
          recentOutcomes: [
            { status: "FAILURE", failureType: "WRONG_DIRECTION" },
            { status: "SUCCESS", failureType: "NONE" }
          ]
        },
        pairTimeframe: {
          samples: 20,
          winRate: 0.52,
          avgPnlUsd: 0.8,
          recentOutcomes: [
            { status: "SUCCESS", failureType: "NONE" },
            { status: "SUCCESS", failureType: "NONE" },
            { status: "FAILURE", failureType: "TIMEOUT_LOSS" }
          ]
        },
        timeframeRegime: {
          samples: 35,
          winRate: 0.6,
          avgPnlUsd: 2.1,
          recentOutcomes: [
            { status: "SUCCESS", failureType: "NONE" },
            { status: "SUCCESS", failureType: "NONE" },
            { status: "SUCCESS", failureType: "NONE" },
            { status: "FAILURE", failureType: "STOP_TOO_TIGHT_REBOUND" }
          ]
        },
        global: {
          samples: 90,
          winRate: 0.62,
          avgPnlUsd: 2.9,
          recentOutcomes: [
            { status: "SUCCESS", failureType: "NONE" },
            { status: "SUCCESS", failureType: "NONE" },
            { status: "FAILURE", failureType: "WRONG_DIRECTION" },
            { status: "SUCCESS", failureType: "NONE" }
          ]
        }
      })
    );
    const rec = baseRecommendation();

    const adjusted = await service.applyPolicy({
      recommendation: rec,
      timeframe: "1m"
    });

    expect(adjusted.confidence).toBeGreaterThan(58);
    expect(adjusted.rationale.some((line) => line.includes("blended"))).toBe(true);
  });
});
