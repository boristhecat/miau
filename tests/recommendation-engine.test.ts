import { describe, expect, it } from "vitest";
import { RecommendationEngine } from "../src/domain/recommendation-engine.js";
import type { IndicatorSnapshot, PerpMarketSnapshot } from "../src/domain/types.js";

const basePerp: PerpMarketSnapshot = {
  symbol: "BTC_USDC_PERP",
  fundingRate: 0,
  fundingRateAvg: 0,
  openInterest: 1000,
  markPrice: 50000,
  indexPrice: 50000,
  premiumPct: 0
};

describe("RecommendationEngine", () => {
  it("applies percent SL/TP overrides", () => {
    const indicators: IndicatorSnapshot = {
      rsi14: 58,
      ema20: 50500,
      ema50: 50000,
      macd: 20,
      macdSignal: 10,
      macdHistogram: 5,
      atr14: 150,
      adx14: 30,
      bbUpper: 51000,
      bbMiddle: 50000,
      bbLower: 49000,
      stochRsiK: 60,
      stochRsiD: 50,
      vwap: 50200
    };

    const rec = new RecommendationEngine().build({
      pair: "BTC-USD",
      lastPrice: 50000,
      indicators,
      perp: basePerp,
      slPct: 1,
      tpPct: 2
    });

    expect(rec.stopLoss).toBe(49500);
    expect(rec.takeProfit).toBe(51000);
  });

  it("applies usd SL/TP overrides", () => {
    const indicators: IndicatorSnapshot = {
      rsi14: 40,
      ema20: 49000,
      ema50: 50000,
      macd: -20,
      macdSignal: -10,
      macdHistogram: -5,
      atr14: 150,
      adx14: 30,
      bbUpper: 51000,
      bbMiddle: 50000,
      bbLower: 49000,
      stochRsiK: 30,
      stochRsiD: 40,
      vwap: 49500
    };

    const rec = new RecommendationEngine().build({
      pair: "BTC-USD",
      lastPrice: 50000,
      indicators,
      perp: basePerp,
      slUsd: 250,
      tpUsd: 500
    });

    if (rec.signal === "SHORT") {
      expect(rec.stopLoss).toBe(50250);
      expect(rec.takeProfit).toBe(49500);
    } else {
      expect(rec.stopLoss).toBe(49750);
      expect(rec.takeProfit).toBe(50500);
    }
  });
});
