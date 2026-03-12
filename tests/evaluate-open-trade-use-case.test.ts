import { describe, expect, it, vi } from "vitest";
import { EvaluateOpenTradeUseCase } from "../src/application/evaluate-open-trade-use-case.js";
import type { MarketDataPort } from "../src/ports/market-data-port.js";
import type { TradeMonitorBaseline } from "../src/domain/trade-monitor-types.js";
import type { Recommendation } from "../src/domain/types.js";

describe("EvaluateOpenTradeUseCase", () => {
  it("reuses the current analysis when refreshAnalysis is false", async () => {
    const getPerpSnapshot = vi.fn().mockResolvedValue({
      symbol: "BTC_USDC_PERP",
      fundingRate: 0,
      fundingRateAvg: 0,
      openInterest: 1000,
      markPrice: 103,
      indexPrice: 103,
      premiumPct: 0.1,
      bidAskSpreadPct: 0.04
    });
    const recommendationUseCase = {
      execute: vi.fn()
    };
    const useCase = new EvaluateOpenTradeUseCase(makeMarketData(getPerpSnapshot), recommendationUseCase);
    const baseline = makeBaseline();

    const result = await useCase.execute({
      baseline,
      currentAnalysisRecommendation: baseline.baselineRecommendation,
      refreshAnalysis: false
    });

    expect(recommendationUseCase.execute).not.toHaveBeenCalled();
    expect(getPerpSnapshot).toHaveBeenCalledTimes(1);
    expect(result.snapshot.marketRegime).toBe("TREND");
  });

  it("refreshes analysis on demand", async () => {
    const getPerpSnapshot = vi.fn().mockResolvedValue({
      symbol: "BTC_USDC_PERP",
      fundingRate: 0,
      fundingRateAvg: 0,
      openInterest: 1000,
      markPrice: 96,
      indexPrice: 96,
      premiumPct: -0.2,
      bidAskSpreadPct: 0.05
    });
    const refreshedRecommendation = makeRecommendation({
      signal: "NO_TRADE",
      marketTradeability: "DO_NOT_TRADE",
      sequenceStatus: "FAILED",
      sequenceReasons: ["Breakout attempt failed."]
    });
    const recommendationUseCase = {
      execute: vi.fn().mockResolvedValue(refreshedRecommendation)
    };
    const useCase = new EvaluateOpenTradeUseCase(makeMarketData(getPerpSnapshot), recommendationUseCase);
    const baseline = makeBaseline();

    const result = await useCase.execute({
      baseline,
      currentAnalysisRecommendation: baseline.baselineRecommendation,
      refreshAnalysis: true
    });

    expect(recommendationUseCase.execute).toHaveBeenCalledTimes(1);
    expect(result.analysisRecommendation.signal).toBe("NO_TRADE");
    expect(result.snapshot.healthStatus).toBe("BROKEN");
  });
});

function makeMarketData(getPerpSnapshot: ReturnType<typeof vi.fn>): MarketDataPort {
  return {
    getCandles: vi.fn(),
    getPerpSnapshot,
    getTopPerpSymbolsByVolume: vi.fn(),
    getTopPerpSymbolsByVolumeWithOpenInterest: vi.fn()
  };
}

function makeBaseline(): TradeMonitorBaseline {
  return {
    trade: {
      pair: "BTC-USD",
      side: "LONG",
      entry: 100,
      stopLoss: 95,
      takeProfit: 110,
      leverage: 10,
      positionSizeUsd: 100,
      openedAtMs: Date.now() - 30_000,
      objectiveHorizon: "60",
      analysisInterval: "5m",
      analysisBiasInterval: "30m"
    },
    baselineRecommendation: makeRecommendation({}),
    baselineAtr: 2,
    baselinePlaybook: "TREND_PULLBACK_CONTINUATION",
    baselineMarketRegime: "TREND",
    baselineBuiltAtMs: Date.now() - 30_000
  };
}

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
    setupPlaybook: "TREND_PULLBACK_CONTINUATION",
    entryReadiness: "READY_NOW",
    sequenceStatus: "CONFIRMED",
    sequencePattern: "VWAP_RECLAIM",
    levelInteractionStatus: "ACCEPTED",
    levelInteractionReference: "VWAP",
    ...overrides
  } as Recommendation;
}
