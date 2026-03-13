import { describe, expect, it, vi } from "vitest";
import { LearningAwareRecommendationGenerator } from "../src/application/learning-aware-recommendation-generator.js";
import type { Recommendation } from "../src/domain/types.js";

describe("LearningAwareRecommendationGenerator", () => {
  it("applies learning policy on top of the raw recommendation", async () => {
    const recommendationUseCase = {
      execute: vi.fn().mockResolvedValue(makeRecommendation({ confidence: 62 }))
    };
    const learning = {
      applyPolicy: vi.fn().mockImplementation(async ({ recommendation }) => ({
        ...recommendation,
        confidence: 71
      }))
    };

    const generator = new LearningAwareRecommendationGenerator(
      recommendationUseCase,
      learning as never
    );

    const result = await generator.execute({
      pair: "BTC-USD",
      interval: "5m",
      objectiveHorizon: "60"
    });

    expect(recommendationUseCase.execute).toHaveBeenCalledWith({
      pair: "BTC-USD",
      interval: "5m",
      objectiveHorizon: "60"
    });
    expect(learning.applyPolicy).toHaveBeenCalledWith({
      recommendation: expect.objectContaining({ pair: "BTC-USD", confidence: 62 }),
      timeframe: "5m"
    });
    expect(result.confidence).toBe(71);
  });
});

function makeRecommendation(overrides: Partial<Recommendation>): Recommendation {
  return {
    pair: "BTC-USD",
    signal: "LONG",
    action: "LONG",
    regime: "TRADEABLE",
    marketRegime: "TREND",
    entry: 100,
    stopLoss: 95,
    takeProfit: 110,
    riskRewardRatio: 2,
    confidence: 75,
    setupGrade: "B",
    confidenceBreakdown: {
      trend: 20,
      momentum: 20,
      volatility: 10,
      structure: 10,
      context: 10,
      setupQuality: 75
    },
    rationale: [],
    indicators: {
      rsi14: 50,
      ema20: 100,
      ema50: 99,
      macd: 1,
      macdSignal: 0.8,
      macdHistogram: 0.2,
      atr14: 2,
      adx14: 20,
      bbUpper: 110,
      bbMiddle: 100,
      bbLower: 90,
      stochRsiK: 50,
      stochRsiD: 50,
      vwap: 100
    },
    perp: {
      symbol: "BTC_USDC_PERP",
      fundingRate: 0,
      fundingRateAvg: 0,
      openInterest: 1000,
      markPrice: 100,
      indexPrice: 100,
      premiumPct: 0
    },
    ...overrides
  };
}
