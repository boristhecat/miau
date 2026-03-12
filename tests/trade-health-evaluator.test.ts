import { describe, expect, it } from "vitest";
import { TradeHealthEvaluator } from "../src/domain/trade-health-evaluator.js";
import type { TradeMonitorBaseline, TradeMonitorMetrics } from "../src/domain/trade-monitor-types.js";
import type { Recommendation } from "../src/domain/types.js";

describe("TradeHealthEvaluator", () => {
  const evaluator = new TradeHealthEvaluator();

  it("marks the thesis broken when tradeability flips and sequence fails", () => {
    const result = evaluator.evaluate({
      baseline: makeBaseline(),
      analysisRecommendation: makeRecommendation({
        marketTradeability: "DO_NOT_TRADE",
        sequenceStatus: "FAILED",
        sequenceReasons: ["Breakout attempt was rejected back inside the range."]
      }),
      metrics: makeMetrics()
    });

    expect(result.status).toBe("BROKEN");
    expect(result.rationale.join(" ")).toContain("DO_NOT_TRADE");
  });

  it("marks the thesis degrading when the setup loses confirmation", () => {
    const result = evaluator.evaluate({
      baseline: makeBaseline(),
      analysisRecommendation: makeRecommendation({
        signal: "NO_TRADE",
        entryReadiness: "WAIT_CONFIRMATION",
        entryReadinessReasons: ["Price is only testing the key level."],
        sequenceStatus: "FORMING",
        sequenceReasons: ["Continuation sequence is improving but not confirmed."]
      }),
      metrics: {
        ...makeMetrics(),
        currentR: -0.2
      }
    });

    expect(result.status).toBe("DEGRADING");
    expect(result.rationale.length).toBeGreaterThan(0);
  });

  it("stays INTACT during grace period when only low-severity signals degrade", () => {
    // Within first 20% of 60-min holding period = 12 min = 720s
    const result = evaluator.evaluate({
      baseline: makeBaseline({ baselineHoldingPeriodMinutes: 60, baselineSequenceStatus: "CONFIRMED" }),
      analysisRecommendation: makeRecommendation({
        sequenceStatus: "FORMING",
        sequenceReasons: ["Continuation sequence is improving but not confirmed."],
        levelInteractionStatus: "TESTING",
        levelInteractionReasons: ["Price is testing nearest support."]
      }),
      metrics: {
        ...makeMetrics(),
        timeInTradeSeconds: 60, // 1 min — well within grace period
        currentR: 0.1
      }
    });

    expect(result.status).toBe("INTACT");
  });

  it("flags DEGRADING after grace period when confirmed sequence regresses and trade is underwater", () => {
    const result = evaluator.evaluate({
      baseline: makeBaseline({ baselineHoldingPeriodMinutes: 60, baselineSequenceStatus: "CONFIRMED" }),
      analysisRecommendation: makeRecommendation({
        sequenceStatus: "FORMING",
        sequenceReasons: ["The trigger sequence is no longer firmly confirmed."],
        levelInteractionStatus: "TESTING",
        levelInteractionReasons: ["Price is testing nearest support."]
      }),
      metrics: {
        ...makeMetrics(),
        timeInTradeSeconds: 900, // 15 min — past 20% grace period
        currentR: -0.3 // underwater adds severity-2 reason
      }
    });

    expect(result.status).toBe("DEGRADING");
  });

  it("still flags DEGRADING during grace period for high-severity reasons", () => {
    const result = evaluator.evaluate({
      baseline: makeBaseline({ baselineHoldingPeriodMinutes: 60 }),
      analysisRecommendation: makeRecommendation({
        signal: "NO_TRADE"
      }),
      metrics: {
        ...makeMetrics(),
        timeInTradeSeconds: 30, // within grace period
        currentR: -0.5
      }
    });

    expect(result.status).toBe("DEGRADING");
  });

  it("marks BROKEN at 120% holding window with no positive progress", () => {
    const result = evaluator.evaluate({
      baseline: makeBaseline({ baselineHoldingPeriodMinutes: 10 }),
      analysisRecommendation: makeRecommendation(),
      metrics: {
        ...makeMetrics(),
        holdingProgressPct: 125,
        grossUnrealizedPnlPct: -0.5,
        currentR: -0.3
      }
    });

    expect(result.status).toBe("BROKEN");
    expect(result.rationale.join(" ")).toContain("holding window");
  });
});

function makeBaseline(overrides?: Partial<TradeMonitorBaseline>): TradeMonitorBaseline {
  return {
    trade: {
      pair: "BTC-USD",
      side: "LONG",
      entry: 100,
      stopLoss: 95,
      takeProfit: 110,
      openedAtMs: Date.now() - 60_000,
      objectiveHorizon: "60",
      analysisInterval: "5m",
      analysisBiasInterval: "30m"
    },
    baselineRecommendation: {} as Recommendation,
    baselineAtr: 2,
    baselinePlaybook: "TREND_PULLBACK_CONTINUATION",
    baselineMarketRegime: "TREND",
    baselineBuiltAtMs: Date.now() - 60_000,
    ...overrides
  };
}

function makeMetrics(): TradeMonitorMetrics {
  return {
    markPrice: 101,
    estimatedExitPrice: 100.9,
    grossUnrealizedPnlPct: 1,
    netUnrealizedPnlPct: 0.8,
    currentR: 0.2,
    distanceToStopPrice: 6,
    distanceToTargetPrice: 9,
    distanceToStopPct: 6,
    distanceToTargetPct: 9,
    maxFavorableExcursionPct: 1,
    maxAdverseExcursionPct: 0.4,
    timeInTradeSeconds: 120,
    stopHit: false,
    targetHit: false,
    premiumPct: 0.1,
    slippageEstimatePct: 0.02,
    totalExecutionCostPct: 0.18
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
    },
    ...overrides
  } as Recommendation;
}
