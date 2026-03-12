import { describe, expect, it } from "vitest";
import { RecommendationLevelInteractionEvaluator } from "../src/domain/recommendation-level-interaction-evaluator.js";
import type { IndicatorSnapshot } from "../src/domain/types.js";

const evaluator = new RecommendationLevelInteractionEvaluator();

function baseIndicators(): IndicatorSnapshot {
  return {
    rsi14: 58,
    ema20: 100,
    ema50: 98,
    macd: 1.1,
    macdSignal: 0.7,
    macdHistogram: 0.4,
    atr14: 2,
    adx14: 26,
    bbUpper: 106,
    bbMiddle: 100,
    bbLower: 96,
    stochRsiK: 61,
    stochRsiD: 55,
    vwap: 100.1,
    sessionLevels: {
      currentOpen: 100,
      currentHigh: 101.5,
      currentLow: 99.2,
      priorHigh: 100.4,
      priorLow: 98.7
    },
    dailyLevels: {
      currentOpen: 99.8,
      currentHigh: 101.6,
      currentLow: 98.6,
      priorHigh: 100.8,
      priorLow: 97.9
    },
    nearestSupportLevel: 99.4,
    nearestResistanceLevel: 100.6,
    recentCandleContext: {
      momentumPct3: 0.22,
      bullishCloseRatio5: 0.8,
      bearishCloseRatio5: 0.2,
      rangeExpansionRatio: 1.15,
      breakoutDirection: "UP",
      lastOpen: 99.9,
      lastHigh: 101.2,
      lastLow: 99.8,
      lastClose: 101,
      previousClose: 100,
      lastClosePositionInRange: 0.86,
      upperWickPct: 0.08,
      lowerWickPct: 0.07,
      sweptPrevHigh: false,
      sweptPrevLow: false,
      closedBackInsidePrevRange: false
    }
  };
}

describe("RecommendationLevelInteractionEvaluator", () => {
  it("detects accepted breakout through the prior session high", () => {
    const result = evaluator.evaluate({
      signal: "LONG",
      lastPrice: 101,
      indicators: baseIndicators(),
      setupPlaybook: "BREAKOUT_CONTINUATION"
    });

    expect(result.status).toBe("ACCEPTED");
    expect(result.reference).toBe("PRIOR_SESSION_HIGH");
  });

  it("detects bearish acceptance back below a key resistance for range fade", () => {
    const result = evaluator.evaluate({
      signal: "SHORT",
      lastPrice: 100.2,
      indicators: {
        ...baseIndicators(),
        recentCandleContext: {
          ...baseIndicators().recentCandleContext!,
          breakoutDirection: "NONE",
          lastHigh: 101.1,
          lastClose: 100.2,
          previousClose: 100.95,
          lastClosePositionInRange: 0.18
        }
      },
      setupPlaybook: "RANGE_FADE"
    });

    expect(result.status).toBe("ACCEPTED");
    expect(result.reference).toBe("PRIOR_SESSION_HIGH");
  });

  it("marks a nearby unresolved level as TESTING", () => {
    const result = evaluator.evaluate({
      signal: "LONG",
      lastPrice: 100.03,
      indicators: {
        ...baseIndicators(),
        recentCandleContext: {
          ...baseIndicators().recentCandleContext!,
          breakoutDirection: "NONE",
          lastClose: 100.03,
          previousClose: 100.01,
          lastClosePositionInRange: 0.51
        }
      },
      setupPlaybook: "TREND_PULLBACK_CONTINUATION"
    });

    expect(result.status).toBe("TESTING");
    expect(result.reference).toBe("CURRENT_SESSION_OPEN");
  });
});
