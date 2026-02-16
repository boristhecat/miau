import { describe, expect, it } from "vitest";
import { AdaptiveLearningService } from "../src/application/adaptive-learning-service.js";
import type {
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
  constructor(private readonly stats: LearningStatsResult, private readonly overview?: LearningOverview) {}

  public lastRecord?: LearningOutcomeRecord;

  async recordOutcome(input: LearningOutcomeRecord): Promise<void> {
    this.lastRecord = input;
  }

  async getStats(_input: LearningStatsQuery): Promise<LearningStatsResult> {
    return this.stats;
  }

  async getOverview(_input: { lookbackDays: number }): Promise<LearningOverview> {
    return (
      this.overview ?? {
        totalSamples: this.stats.samples,
        wins: Math.round(this.stats.winRate * this.stats.samples),
        losses: Math.max(0, this.stats.samples - Math.round(this.stats.winRate * this.stats.samples)),
        winRate: this.stats.winRate,
        avgPnlUsd: this.stats.avgPnlUsd
      }
    );
  }
}

describe("AdaptiveLearningService", () => {
  it("raises confidence and relaxes gates for strong historical performance", async () => {
    const service = new AdaptiveLearningService(
      new FakeLearningStore({
        samples: 40,
        winRate: 0.66,
        avgPnlUsd: 7.5,
        recentStatuses: ["SUCCESS", "SUCCESS", "SUCCESS", "FAILURE", "SUCCESS"]
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
        samples: 35,
        winRate: 0.33,
        avgPnlUsd: -8.5,
        recentStatuses: ["FAILURE", "FAILURE", "FAILURE", "FAILURE", "SUCCESS"]
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
      samples: 0,
      winRate: 0,
      avgPnlUsd: 0,
      recentStatuses: []
    });
    const service = new AdaptiveLearningService(store);
    const rec = baseRecommendation();

    await service.recordSimulationOutcome({
      recommendation: rec,
      timeframe: "1m",
      horizonMinutes: 15,
      status: "SUCCESS",
      pnlUsd: 12.3
    });

    expect(store.lastRecord).toBeDefined();
    expect(store.lastRecord?.pair).toBe("BTC-USD");
    expect(store.lastRecord?.status).toBe("SUCCESS");
    expect(store.lastRecord?.pnlUsd).toBe(12.3);
  });

  it("does not apply learning adjustments below activation sample size", async () => {
    const service = new AdaptiveLearningService(
      new FakeLearningStore({
        samples: 20,
        winRate: 0.2,
        avgPnlUsd: -10,
        recentStatuses: ["FAILURE", "FAILURE", "FAILURE", "FAILURE", "FAILURE"]
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
});
