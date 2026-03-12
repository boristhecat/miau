import { describe, expect, it } from "vitest";
import { RecommendationTradeCalculator } from "../src/domain/recommendation-trade-calculator.js";
import { TradeMonitorMetricsEvaluator } from "../src/domain/trade-monitor-metrics.js";
import type { TradeMonitorBaseline, TradeMonitorSnapshot } from "../src/domain/trade-monitor-types.js";
import type { Recommendation } from "../src/domain/types.js";

describe("TradeMonitorMetricsEvaluator", () => {
  const evaluator = new TradeMonitorMetricsEvaluator(new RecommendationTradeCalculator());

  it("computes long-trade pnl and distance metrics", () => {
    const baseline = makeBaseline({
      side: "LONG",
      entry: 100,
      stopLoss: 95,
      takeProfit: 110,
      leverage: 10,
      positionSizeUsd: 200
    });

    const metrics = evaluator.evaluate({
      baseline,
      perp: {
        symbol: "BTC_USDC_PERP",
        fundingRate: 0,
        fundingRateAvg: 0,
        openInterest: 1000,
        markPrice: 103,
        indexPrice: 103,
        premiumPct: 0.1,
        bidAskSpreadPct: 0.04
      }
    });

    expect(metrics.grossUnrealizedPnlPct).toBe(3);
    expect(metrics.currentR).toBeGreaterThan(0.5);
    expect(metrics.stopHit).toBe(false);
    expect(metrics.targetHit).toBe(false);
    expect(metrics.maxFavorableExcursionPct).toBe(3);
    expect(metrics.distanceToTargetPrice).toBe(7);
  });

  it("carries forward excursions and detects short target hits", () => {
    const baseline = makeBaseline({
      side: "SHORT",
      entry: 100,
      stopLoss: 105,
      takeProfit: 92
    });
    const previousSnapshot = {
      trade: baseline.trade,
      metrics: {
        markPrice: 98,
        estimatedExitPrice: 98,
        grossUnrealizedPnlPct: 2,
        netUnrealizedPnlPct: 1.8,
        currentR: 0.4,
        distanceToStopPrice: 7,
        distanceToTargetPrice: 6,
        distanceToStopPct: 7,
        distanceToTargetPct: 6,
        maxFavorableExcursionPct: 4,
        maxAdverseExcursionPct: 1,
        timeInTradeSeconds: 10,
        stopHit: false,
        targetHit: false,
        premiumPct: 0,
        slippageEstimatePct: 0.02,
        totalExecutionCostPct: 0.18
      },
      analysisSignal: "SHORT",
      analysisConfidence: 70,
      analysisSetupGrade: "B",
      marketRegime: "TREND",
      healthStatus: "INTACT",
      managementAction: "HOLD",
      healthReasons: [],
      managementReasons: [],
      analysisUpdatedAtMs: Date.now()
    } as TradeMonitorSnapshot;

    const metrics = evaluator.evaluate({
      baseline,
      perp: {
        symbol: "BTC_USDC_PERP",
        fundingRate: 0,
        fundingRateAvg: 0,
        openInterest: 1000,
        markPrice: 91.5,
        indexPrice: 91.5,
        premiumPct: -0.1,
        bidAskSpreadPct: 0.06
      },
      previousSnapshot
    });

    expect(metrics.targetHit).toBe(true);
    expect(metrics.maxFavorableExcursionPct).toBeGreaterThanOrEqual(4);
    expect(metrics.maxAdverseExcursionPct).toBe(1);
  });
});

function makeBaseline(input: {
  side: "LONG" | "SHORT";
  entry: number;
  stopLoss: number;
  takeProfit: number;
  leverage?: number;
  positionSizeUsd?: number;
}): TradeMonitorBaseline {
  return {
    trade: {
      pair: "BTC-USD",
      side: input.side,
      entry: input.entry,
      stopLoss: input.stopLoss,
      takeProfit: input.takeProfit,
      leverage: input.leverage,
      positionSizeUsd: input.positionSizeUsd,
      openedAtMs: Date.now() - 30_000,
      objectiveHorizon: "60",
      analysisInterval: "5m",
      analysisBiasInterval: "30m"
    },
    baselineRecommendation: {} as Recommendation,
    baselineAtr: 2,
    baselineMarketRegime: "TREND",
    baselineBuiltAtMs: Date.now() - 30_000
  };
}
