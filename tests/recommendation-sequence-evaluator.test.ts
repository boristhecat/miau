import { describe, expect, it } from "vitest";
import { RecommendationSequenceEvaluator } from "../src/domain/recommendation-sequence-evaluator.js";
import type { IndicatorSnapshot } from "../src/domain/types.js";

const evaluator = new RecommendationSequenceEvaluator();

function baseIndicators(): IndicatorSnapshot {
  return {
    rsi14: 58,
    ema20: 100,
    ema50: 98,
    macd: 1.2,
    macdSignal: 0.8,
    macdHistogram: 0.4,
    atr14: 2,
    adx14: 27,
    bbUpper: 106,
    bbMiddle: 100,
    bbLower: 96,
    stochRsiK: 60,
    stochRsiD: 54,
    vwap: 99.9,
    recentCandleContext: {
      momentumPct3: 0.28,
      bullishCloseRatio5: 0.8,
      bearishCloseRatio5: 0.2,
      rangeExpansionRatio: 1.25,
      breakoutDirection: "UP",
      lastOpen: 100.1,
      lastHigh: 101.4,
      lastLow: 99.9,
      lastClose: 101.2,
      previousClose: 99.7,
      lastClosePositionInRange: 0.86,
      upperWickPct: 0.12,
      lowerWickPct: 0.08,
      sweptPrevHigh: false,
      sweptPrevLow: false,
      closedBackInsidePrevRange: false
    }
  };
}

describe("RecommendationSequenceEvaluator", () => {
  it("confirms breakout acceptance for breakout continuation playbooks", () => {
    const result = evaluator.evaluate({
      signal: "LONG",
      indicators: baseIndicators(),
      setupPlaybook: "BREAKOUT_CONTINUATION"
    });

    expect(result.status).toBe("CONFIRMED");
    expect(result.pattern).toBe("BREAKOUT_ACCEPTANCE");
  });

  it("flags breakout failure when price sweeps and closes back inside range", () => {
    const result = evaluator.evaluate({
      signal: "LONG",
      indicators: {
        ...baseIndicators(),
        recentCandleContext: {
          ...baseIndicators().recentCandleContext!,
          breakoutDirection: "NONE",
          sweptPrevHigh: true,
          closedBackInsidePrevRange: true,
          lastClosePositionInRange: 0.22,
          upperWickPct: 0.4,
          lowerWickPct: 0.05
        }
      },
      setupPlaybook: "BREAKOUT_CONTINUATION"
    });

    expect(result.status).toBe("FAILED");
    expect(result.pattern).toBe("BREAKOUT_FAILURE");
  });

  it("confirms sweep rejection for range fade reversals", () => {
    const result = evaluator.evaluate({
      signal: "LONG",
      indicators: {
        ...baseIndicators(),
        recentCandleContext: {
          ...baseIndicators().recentCandleContext!,
          breakoutDirection: "NONE",
          sweptPrevLow: true,
          sweptPrevHigh: false,
          lastClosePositionInRange: 0.78,
          upperWickPct: 0.1,
          lowerWickPct: 0.12
        }
      },
      setupPlaybook: "RANGE_FADE"
    });

    expect(result.status).toBe("CONFIRMED");
    expect(result.pattern).toBe("SWEEP_REJECTION");
  });
});
