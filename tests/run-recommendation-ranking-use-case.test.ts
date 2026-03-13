import { describe, expect, it, vi } from "vitest";
import { RunRecommendationRankingUseCase } from "../src/application/run-recommendation-ranking-use-case.js";
import type { Recommendation } from "../src/domain/types.js";

describe("RunRecommendationRankingUseCase", () => {
  it("uses the learning-aware generator and serial rec scanning", async () => {
    const rawRecommendation = makeRecommendation({ confidence: 61 });
    const learnedRecommendation = makeRecommendation({ confidence: 73 });
    const recommendationUseCase = {
      execute: vi.fn().mockResolvedValue(rawRecommendation)
    };
    const learning = {
      applyPolicy: vi.fn().mockResolvedValue(learnedRecommendation)
    };
    const marketData = {
      getTopPerpSymbolsByVolumeWithOpenInterest: vi.fn().mockResolvedValue([
        { symbol: "BTC", quoteVolume24h: 1000, openInterest: 500 },
        { symbol: "DOGE", quoteVolume24h: 900, openInterest: 400 }
      ])
    };
    const rankExecute = vi.fn().mockImplementation(async (input) => {
      const recommendation = await capturedGenerator!.execute({
        pair: "BTC-USD",
        interval: input.interval,
        biasInterval: input.biasInterval,
        leverage: input.leverage,
        positionSizeUsd: input.positionSizeUsd,
        objectiveHorizon: input.objectiveHorizon
      });
      return {
        scannedSymbols: 1,
        ranked: [{ symbol: "BTC", pair: "BTC-USD", probabilityPositivePnl: 60, recommendation }],
        skipped: []
      };
    });
    let capturedGenerator:
      | {
          execute(input: {
            pair: string;
            interval?: string;
            biasInterval?: string;
            leverage?: number;
            positionSizeUsd?: number;
            objectiveHorizon?: string;
          }): Promise<Recommendation>;
        }
      | undefined;

    const useCase = new RunRecommendationRankingUseCase(
      recommendationUseCase,
      learning as never,
      marketData as never,
      (generator) => {
        capturedGenerator = generator;
        return { execute: rankExecute };
      }
    );

    const result = await useCase.execute({
      defaults: { leverage: 20, positionSizeUsd: 250, objectiveHorizon: "60" }
    });

    expect(recommendationUseCase.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        pair: "BTC-USD",
        interval: result.adaptiveTimeframes.timeframe,
        biasInterval: result.adaptiveTimeframes.biasTimeframe,
        leverage: 20,
        positionSizeUsd: 250,
        objectiveHorizon: "60"
      })
    );
    expect(learning.applyPolicy).toHaveBeenCalledWith({
      recommendation: rawRecommendation,
      timeframe: result.adaptiveTimeframes.timeframe
    });
    expect(rankExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        symbols: ["BTC"],
        concurrency: 1
      })
    );
    expect(result.opportunities.ranked[0]?.recommendation.confidence).toBe(73);
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
