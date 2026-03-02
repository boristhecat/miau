import { describe, expect, it } from "vitest";
import { RunLearningCycleUseCase } from "../src/application/run-learning-cycle-use-case.js";
import type { GenerateRecommendationUseCase } from "../src/application/generate-recommendation-use-case.js";
import type { AdaptiveLearningService } from "../src/application/adaptive-learning-service.js";
import type { LoggerPort } from "../src/ports/logger-port.js";
import type { Recommendation } from "../src/domain/types.js";

function recommendation(pair: string): Recommendation {
  return {
    pair,
    signal: "LONG",
    action: "LONG",
    regime: "TRADEABLE",
    marketRegime: "TREND",
    entry: 100,
    stopLoss: 99,
    takeProfit: 102,
    confidence: 80,
    setupGrade: "A",
    confidenceBreakdown: {
      trend: 80,
      momentum: 75,
      volatility: 70,
      structure: 78,
      context: 74,
      setupQuality: 76
    },
    rationale: [],
    riskRewardRatio: 2,
    indicators: {
      rsi14: 55,
      ema20: 101,
      ema50: 100,
      macd: 1,
      macdSignal: 0.8,
      macdHistogram: 0.2,
      atr14: 1,
      adx14: 25,
      bbUpper: 103,
      bbMiddle: 100,
      bbLower: 97,
      stochRsiK: 60,
      stochRsiD: 58,
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
    }
  };
}

describe("RunLearningCycleUseCase", () => {
  it("uses adaptive timeframe mapping and runtime defaults for learning candidates", async () => {
    const executeCalls: Array<{
      pair: string;
      interval?: string;
      biasInterval?: string;
      leverage?: number;
      positionSizeUsd?: number;
      objectiveHorizon?: string;
    }> = [];
    const applyPolicyCalls: Array<{ timeframe: string; pair: string }> = [];

    const recommendationUseCase = {
      async execute(input: {
        pair: string;
        interval?: string;
        biasInterval?: string;
        leverage?: number;
        positionSizeUsd?: number;
        objectiveHorizon?: string;
      }) {
        executeCalls.push(input);
        return recommendation(input.pair);
      }
    } as GenerateRecommendationUseCase;

    const learning = {
      async applyPolicy(input: { recommendation: Recommendation; timeframe: string }) {
        applyPolicyCalls.push({ timeframe: input.timeframe, pair: input.recommendation.pair });
        return input.recommendation;
      }
    } as AdaptiveLearningService;

    const logger = {
      error() {
        // no-op
      }
    } as LoggerPort;

    const learningSymbolSelector = {
      async execute() {
        return ["BTC"];
      }
    };

    const useCase = new RunLearningCycleUseCase(
      logger,
      recommendationUseCase,
      learning,
      learningSymbolSelector
    );
    const result = await useCase.execute({
      horizonsMinutes: [5, 30, 90],
      leverage: 33,
      positionSizeUsd: 777,
      active: () => true
    });

    const candidateCalls = executeCalls.filter(
      (call) => call.objectiveHorizon !== undefined && call.leverage === 33 && call.positionSizeUsd === 777
    );
    expect(candidateCalls).toEqual([
      {
        pair: "BTC-USD",
        interval: "1m",
        biasInterval: "15m",
        leverage: 33,
        positionSizeUsd: 777,
        objectiveHorizon: "5"
      },
      {
        pair: "BTC-USD",
        interval: "3m",
        biasInterval: "15m",
        leverage: 33,
        positionSizeUsd: 777,
        objectiveHorizon: "30"
      },
      {
        pair: "BTC-USD",
        interval: "5m",
        biasInterval: "30m",
        leverage: 33,
        positionSizeUsd: 777,
        objectiveHorizon: "90"
      }
    ]);
    expect(applyPolicyCalls).toEqual([
      { timeframe: "1m", pair: "BTC-USD" },
      { timeframe: "3m", pair: "BTC-USD" },
      { timeframe: "5m", pair: "BTC-USD" }
    ]);
    expect(result.candidates.map((row) => ({ interval: row.interval, horizon: row.horizonMinutes }))).toEqual([
      { interval: "1m", horizon: 5 },
      { interval: "3m", horizon: 30 },
      { interval: "5m", horizon: 90 }
    ]);
  });

  it("keeps NO_TRADE recommendations as learning candidates for counterfactual simulation", async () => {
    const recommendationUseCase = {
      async execute(input: { pair: string }) {
        return recommendation(input.pair);
      }
    } as GenerateRecommendationUseCase;

    const learning = {
      async applyPolicy(input: { recommendation: Recommendation }) {
        return {
          ...input.recommendation,
          signal: "NO_TRADE" as const,
          action: "NO TRADE" as const,
          confidence: 20,
          confidenceBreakdown: {
            ...input.recommendation.confidenceBreakdown,
            setupQuality: 50
          }
        };
      }
    } as AdaptiveLearningService;

    const logger = {
      error() {
        // no-op
      }
    } as LoggerPort;

    const useCase = new RunLearningCycleUseCase(logger, recommendationUseCase, learning, {
      async execute() {
        return ["BTC"];
      }
    });
    const result = await useCase.execute({
      horizonsMinutes: [15],
      leverage: 20,
      positionSizeUsd: 250,
      active: () => true
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.recommendation.signal).toBe("NO_TRADE");
  });

  it("does not pre-filter low-quality or low-confidence setups in learning cycle", async () => {
    const recommendationUseCase = {
      async execute(input: { pair: string }) {
        return recommendation(input.pair);
      }
    } as GenerateRecommendationUseCase;

    const learning = {
      async applyPolicy(input: { recommendation: Recommendation }) {
        return {
          ...input.recommendation,
          marketRegime: "LOW_LIQ_CHOP" as const,
          confidence: 5,
          confidenceBreakdown: {
            ...input.recommendation.confidenceBreakdown,
            setupQuality: 10
          }
        };
      }
    } as AdaptiveLearningService;

    const logger = {
      error() {
        // no-op
      }
    } as LoggerPort;

    const useCase = new RunLearningCycleUseCase(logger, recommendationUseCase, learning, {
      async execute() {
        return ["BTC"];
      }
    });
    const result = await useCase.execute({
      horizonsMinutes: [15],
      leverage: 20,
      positionSizeUsd: 250,
      active: () => true
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.recommendation.marketRegime).toBe("LOW_LIQ_CHOP");
    expect(result.candidates[0]?.recommendation.confidence).toBe(5);
    expect(result.candidates[0]?.recommendation.confidenceBreakdown.setupQuality).toBe(10);
  });
});
