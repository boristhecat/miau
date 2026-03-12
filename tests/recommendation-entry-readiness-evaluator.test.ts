import { describe, expect, it } from "vitest";
import { RecommendationEntryReadinessEvaluator } from "../src/domain/recommendation-entry-readiness-evaluator.js";
import type { IndicatorSnapshot } from "../src/domain/types.js";

const evaluator = new RecommendationEntryReadinessEvaluator();

function baseIndicators(): IndicatorSnapshot {
  return {
    rsi14: 58,
    ema20: 100,
    ema50: 98,
    macd: 1.4,
    macdSignal: 0.9,
    macdHistogram: 0.5,
    atr14: 2,
    adx14: 26,
    bbUpper: 106,
    bbMiddle: 100,
    bbLower: 96,
    stochRsiK: 62,
    stochRsiD: 55,
    vwap: 100.5,
    nearestSupportLevel: 99.2,
    nearestResistanceLevel: 108,
    swingLow: 98.8,
    swingHigh: 108.4,
    sessionLevels: {
      currentOpen: 100.2,
      currentHigh: 104.2,
      currentLow: 99.1,
      priorHigh: 103.4,
      priorLow: 98.9
    },
    dailyLevels: {
      currentOpen: 99.8,
      currentHigh: 104.2,
      currentLow: 98.6,
      priorHigh: 105.1,
      priorLow: 97.9
    },
    recentCandleContext: {
      momentumPct3: 0.22,
      bullishCloseRatio5: 0.8,
      bearishCloseRatio5: 0.2,
      rangeExpansionRatio: 1.15,
      breakoutDirection: "UP"
    }
  };
}

describe("RecommendationEntryReadinessEvaluator", () => {
  it("marks extended trend continuations as WAIT_PULLBACK", () => {
    const result = evaluator.evaluate({
      signal: "LONG",
      lastPrice: 101.8,
      indicators: baseIndicators(),
      marketRegime: "TREND",
      setupPlaybook: "TREND_PULLBACK_CONTINUATION",
      pullbackEntryPrice: 101.2
    });

    expect(result.status).toBe("WAIT_PULLBACK");
    expect(result.preferredEntryPrice).toBe(101.2);
  });

  it("marks extended breakouts as WAIT_BREAKOUT_RETEST", () => {
    const result = evaluator.evaluate({
      signal: "LONG",
      lastPrice: 102,
      indicators: {
        ...baseIndicators(),
        ema20: 100,
        atr14: 2,
        nearestResistanceLevel: 110
      },
      marketRegime: "TREND",
      setupPlaybook: "BREAKOUT_CONTINUATION",
      pullbackEntryPrice: 101.5
    });

    expect(result.status).toBe("WAIT_BREAKOUT_RETEST");
    expect(result.preferredEntryPrice).toBe(101.5);
  });

  it("marks reversal setups near structure as READY_NOW", () => {
    const result = evaluator.evaluate({
      signal: "LONG",
      lastPrice: 99.25,
      indicators: {
        ...baseIndicators(),
        recentCandleContext: {
          momentumPct3: -0.05,
          bullishCloseRatio5: 0.4,
          bearishCloseRatio5: 0.6,
          rangeExpansionRatio: 1.05,
          breakoutDirection: "NONE"
        }
      },
      marketRegime: "RANGE",
      setupPlaybook: "RANGE_FADE"
    });

    expect(result.status).toBe("READY_NOW");
    expect(result.invalidationLevel).toBeDefined();
  });
});
