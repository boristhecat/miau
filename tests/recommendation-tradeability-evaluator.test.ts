import { afterEach, describe, expect, it, vi } from "vitest";
import { RecommendationTradeabilityEvaluator } from "../src/domain/recommendation-tradeability-evaluator.js";
import type { IndicatorSnapshot, PerpMarketSnapshot } from "../src/domain/types.js";

const evaluator = new RecommendationTradeabilityEvaluator();

const basePerp: PerpMarketSnapshot = {
  symbol: "BTC_USDC_PERP",
  fundingRate: 0,
  fundingRateAvg: 0,
  openInterest: 1000,
  markPrice: 50000,
  indexPrice: 50000,
  premiumPct: 0
};

const trendIndicators: IndicatorSnapshot = {
  rsi14: 60,
  ema20: 50500,
  ema50: 50000,
  macd: 12,
  macdSignal: 8,
  macdHistogram: 4,
  atr14: 120,
  adx14: 30,
  bbUpper: 51000,
  bbMiddle: 50000,
  bbLower: 49000,
  stochRsiK: 60,
  stochRsiD: 52,
  vwap: 50200
};

describe("RecommendationTradeabilityEvaluator", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns DO_NOT_TRADE for low-liquidity chop", () => {
    const assessment = evaluator.evaluate({
      indicators: {
        ...trendIndicators,
        ema20: 50001,
        ema50: 50000,
        macd: 0,
        macdSignal: 0,
        macdHistogram: 0,
        atr14: 10,
        adx14: 12,
        bbUpper: 50020,
        bbMiddle: 50000,
        bbLower: 49980,
        vwap: 50000
      },
      perp: basePerp,
      lastPrice: 50000
    });

    expect(assessment.status).toBe("DO_NOT_TRADE");
    expect(assessment.reasonCodes).toContain("LOW_LIQUIDITY_CHOP");
  });

  it("returns DO_NOT_TRADE for wide spread", () => {
    const assessment = evaluator.evaluate({
      indicators: trendIndicators,
      perp: { ...basePerp, bidAskSpreadPct: 0.13 },
      lastPrice: 50600
    });

    expect(assessment.status).toBe("DO_NOT_TRADE");
    expect(assessment.reasonCodes).toContain("WIDE_SPREAD");
  });

  it("returns DO_NOT_TRADE for VWAP chop using the inherited filter", () => {
    const assessment = evaluator.evaluate({
      indicators: {
        ...trendIndicators,
        ema20: 50010,
        ema50: 50000,
        macd: 5,
        macdSignal: 4,
        macdHistogram: 1,
        atr14: 110,
        adx14: 27,
        bbUpper: 50300,
        bbMiddle: 50000,
        bbLower: 49700,
        vwap: 50000
      },
      perp: basePerp,
      lastPrice: 50001
    });

    expect(assessment.status).toBe("DO_NOT_TRADE");
    expect(assessment.reasonCodes).toContain("VWAP_CHOP");
  });

  it("returns CAUTION in the dead session without blocking the market", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-05T22:00:00.000Z"));

    const assessment = evaluator.evaluate({
      indicators: trendIndicators,
      perp: basePerp,
      lastPrice: 50600,
      trendOnlyMode: false
    });

    expect(assessment.status).toBe("CAUTION");
    expect(assessment.reasonCodes).toEqual(["SESSION_DEAD_ZONE"]);
    expect(assessment.blocked).toBe(false);
  });

  it("returns TRADEABLE for a clean trend setup in active hours", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-05T14:00:00.000Z"));

    const assessment = evaluator.evaluate({
      indicators: trendIndicators,
      perp: basePerp,
      lastPrice: 50600,
      trendOnlyMode: false
    });

    expect(assessment.status).toBe("TRADEABLE");
    expect(assessment.reasonCodes).toEqual([]);
  });

  it("does not hard-block range regime when trend-only mode is disabled", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-05T14:00:00.000Z"));

    const assessment = evaluator.evaluate({
      indicators: {
        ...trendIndicators,
        ema20: 50030,
        ema50: 50000,
        macd: 1,
        macdSignal: 1,
        macdHistogram: 0.1,
        adx14: 17,
        atr14: 130,
        bbUpper: 50380,
        bbMiddle: 50000,
        bbLower: 49620,
        vwap: 49850
      },
      perp: basePerp,
      lastPrice: 50090,
      trendOnlyMode: false
    });

    expect(assessment.marketRegime).toBe("RANGE");
    expect(assessment.status).toBe("TRADEABLE");
    expect(assessment.blocked).toBe(false);
  });
});
