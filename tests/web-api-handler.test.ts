import { describe, expect, it, vi } from "vitest";
import { WebApiHandler, HttpError } from "../src/adapters/web/web-api-handler.js";
import type { Recommendation } from "../src/domain/types.js";
import type { TradeMonitorBaseline } from "../src/domain/trade-monitor-types.js";
import type { TradeDefaults } from "../src/ports/trade-defaults-store-port.js";

describe("WebApiHandler", () => {
  it("uses per-request analyze overrides instead of saved defaults", async () => {
    const ctx = createHandlerContext();

    await ctx.handler.handleAnalyze({
      symbol: "btc",
      direction: "long",
      horizon: "30",
      leverage: 33,
      positionSizeUsd: 777
    });

    expect(ctx.recommendationUseCase.execute).toHaveBeenCalledWith({
      pair: "BTC-USD",
      forcedDirection: "LONG",
      interval: "3m",
      biasInterval: "15m",
      leverage: 33,
      positionSizeUsd: 777,
      objectiveHorizon: "30",
      expectedRangeHorizon: undefined
    });
  });

  it("falls back to saved analyze defaults when override inputs are blank", async () => {
    const ctx = createHandlerContext();

    await ctx.handler.handleAnalyze({
      symbol: "btc",
      horizon: "   ",
      leverage: "",
      positionSizeUsd: undefined
    });

    expect(ctx.recommendationUseCase.execute).toHaveBeenCalledWith({
      pair: "BTC-USD",
      forcedDirection: undefined,
      interval: "5m",
      biasInterval: "30m",
      leverage: 20,
      positionSizeUsd: 250,
      objectiveHorizon: "60",
      expectedRangeHorizon: undefined
    });
  });

  it("rejects invalid analyze overrides", async () => {
    const ctx = createHandlerContext();

    await expect(
      ctx.handler.handleAnalyze({
        symbol: "btc",
        leverage: 0
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "Invalid leverage."
    } satisfies Partial<HttpError>);
  });

  it("uses monitor overrides instead of saved defaults", async () => {
    const ctx = createHandlerContext();

    await ctx.handler.buildMonitorBaseline({
      symbol: "btc",
      side: "long",
      entry: "100",
      stopLoss: "95",
      takeProfit: "110",
      leverage: "11",
      positionSizeUsd: "321",
      objectiveHorizon: "15"
    });

    expect(ctx.buildBaselineUseCase.execute).toHaveBeenCalledWith({
      pair: "BTC-USD",
      side: "LONG",
      entry: 100,
      stopLoss: 95,
      takeProfit: 110,
      leverage: 11,
      positionSizeUsd: 321,
      objectiveHorizon: "15",
      intervalOverride: undefined,
      openedAtMs: undefined
    });
  });

  it("falls back to saved monitor defaults when overrides are blank", async () => {
    const ctx = createHandlerContext();

    await ctx.handler.buildMonitorBaseline({
      symbol: "btc",
      side: "short",
      entry: "100",
      stopLoss: "105",
      takeProfit: "90",
      leverage: "",
      positionSizeUsd: "",
      objectiveHorizon: "   "
    });

    expect(ctx.buildBaselineUseCase.execute).toHaveBeenCalledWith({
      pair: "BTC-USD",
      side: "SHORT",
      entry: 100,
      stopLoss: 105,
      takeProfit: 90,
      leverage: 20,
      positionSizeUsd: 250,
      objectiveHorizon: "60",
      intervalOverride: undefined,
      openedAtMs: undefined
    });
  });

  it("rejects invalid monitor overrides", async () => {
    const ctx = createHandlerContext();

    await expect(
      ctx.handler.buildMonitorBaseline({
        symbol: "btc",
        side: "long",
        entry: "100",
        stopLoss: "95",
        takeProfit: "110",
        positionSizeUsd: "abc"
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "Invalid position size."
    } satisfies Partial<HttpError>);
  });
});

function createHandlerContext(defaults: TradeDefaults = makeDefaults()) {
  const recommendation = makeRecommendation();
  const recommendationUseCase = {
    execute: vi.fn().mockResolvedValue(recommendation)
  };
  const rankingUseCase = { execute: vi.fn() };
  const learning = {
    applyPolicy: vi.fn().mockImplementation(async ({ recommendation: current }) => current),
    recordSimulationOutcome: vi.fn(),
    recordQueryObservation: vi.fn(),
    getOverview: vi.fn(),
    getBucketOverview: vi.fn(),
    getPolicy: vi.fn()
  };
  const learningBucketReportUseCase = { execute: vi.fn() };
  const buildBaselineUseCase = {
    execute: vi.fn().mockResolvedValue({} as TradeMonitorBaseline)
  };
  const evaluateOpenTradeUseCase = { execute: vi.fn() };
  const tradeDefaultsStore = {
    load: vi.fn().mockResolvedValue(defaults),
    save: vi.fn()
  };

  const handler = new WebApiHandler({
    recommendationUseCase,
    rankingUseCase,
    learning: learning as never,
    learningBucketReportUseCase,
    buildBaselineUseCase,
    evaluateOpenTradeUseCase,
    tradeDefaultsStore,
    aiEnabled: false
  });

  return {
    handler,
    recommendationUseCase,
    buildBaselineUseCase,
    tradeDefaultsStore
  };
}

function makeDefaults(): TradeDefaults {
  return {
    leverage: 20,
    positionSizeUsd: 250,
    objectiveHorizon: "60",
    aiModel: "gpt-5.4"
  };
}

function makeRecommendation(): Recommendation {
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
    confidence: 70,
    setupGrade: "B",
    confidenceBreakdown: {
      trend: 20,
      momentum: 20,
      volatility: 10,
      structure: 10,
      context: 10,
      setupQuality: 70
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
    }
  };
}
