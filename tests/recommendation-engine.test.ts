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
    expect(rec.riskRewardRatio).toBeGreaterThan(0);
    expect(rec.dailyTargetUsd).toBe(100);
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
    expect(rec.regime).toBeDefined();
  });

  it("uses higher timeframe bias in scoring", () => {
    const indicators: IndicatorSnapshot = {
      rsi14: 50,
      ema20: 50010,
      ema50: 50000,
      macd: 1,
      macdSignal: 1,
      macdHistogram: 0,
      atr14: 120,
      adx14: 18,
      bbUpper: 50200,
      bbMiddle: 50000,
      bbLower: 49800,
      stochRsiK: 50,
      stochRsiD: 50,
      vwap: 50000
    };

    const recLongBias = new RecommendationEngine().build({
      pair: "BTC-USD",
      lastPrice: 50000,
      indicators,
      perp: basePerp,
      biasTrend: "LONG",
      biasInterval: "15m"
    });
    const recShortBias = new RecommendationEngine().build({
      pair: "BTC-USD",
      lastPrice: 50000,
      indicators,
      perp: basePerp,
      biasTrend: "SHORT",
      biasInterval: "15m"
    });

    expect(recLongBias.rationale.some((line) => line.includes("15m") && line.includes("bullish"))).toBe(true);
    expect(recShortBias.rationale.some((line) => line.includes("15m") && line.includes("bearish"))).toBe(true);
  });

  it("computes trades needed to daily target when position sizing is provided", () => {
    const indicators: IndicatorSnapshot = {
      rsi14: 60,
      ema20: 50500,
      ema50: 50000,
      macd: 10,
      macdSignal: 8,
      macdHistogram: 2,
      atr14: 140,
      adx14: 28,
      bbUpper: 51000,
      bbMiddle: 50000,
      bbLower: 49000,
      stochRsiK: 58,
      stochRsiD: 50,
      vwap: 50300
    };

    const rec = new RecommendationEngine().build({
      pair: "BTC-USD",
      lastPrice: 50000,
      indicators,
      perp: basePerp,
      leverage: 5,
      positionSizeUsd: 250,
      dailyTargetUsd: 100
    });

    expect(rec.tradesToDailyTarget).toBeDefined();
  });

  it("returns NO_TRADE with NO TRADE action in choppy low-quality regime", () => {
    const indicators: IndicatorSnapshot = {
      rsi14: 50,
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
      stochRsiK: 50,
      stochRsiD: 50,
      vwap: 50000
    };

    const rec = new RecommendationEngine().build({
      pair: "BTC-USD",
      lastPrice: 50000,
      indicators,
      perp: basePerp
    });

    expect(rec.signal).toBe("NO_TRADE");
    expect(rec.action).toBe("NO TRADE");
  });

  it("applies objective-driven targeting and adds time-stop metadata", () => {
    const indicators: IndicatorSnapshot = {
      rsi14: 58,
      ema20: 50500,
      ema50: 50000,
      macd: 20,
      macdSignal: 10,
      macdHistogram: 5,
      atr14: 120,
      adx14: 28,
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
      leverage: 10,
      positionSizeUsd: 250,
      objectiveUsdc: 10,
      baseInterval: "1m"
    });

    expect(rec.objectiveUsdc).toBe(10);
    expect(rec.objectiveHorizon).toBe("15m");
    expect(rec.objectiveTargetTpPct).toBeCloseTo(0.4, 6);
    expect(rec.objectiveTargetSlPct).toBeCloseTo(0.2857, 3);
    expect(rec.timeStopRule).toContain("close at market");
    expect(rec.estimatedPnLAtTakeProfit).toBeCloseTo(10, 6);
  });

  it("supports horizon-only targeting and derives objective", () => {
    const indicators: IndicatorSnapshot = {
      rsi14: 58,
      ema20: 50500,
      ema50: 50000,
      macd: 20,
      macdSignal: 10,
      macdHistogram: 5,
      atr14: 120,
      adx14: 28,
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
      leverage: 10,
      positionSizeUsd: 250,
      objectiveHorizon: "60",
      baseInterval: "1m"
    });

    expect(rec.objectiveHorizon).toBe("60m");
    expect(rec.objectiveUsdc).toBeDefined();
    expect(rec.timeStopRule).toContain("60m");
  });

  it("applies VWAP no-trade filter when price is too close to VWAP", () => {
    const indicators: IndicatorSnapshot = {
      rsi14: 57,
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
      stochRsiK: 56,
      stochRsiD: 50,
      vwap: 50000
    };

    const rec = new RecommendationEngine().build({
      pair: "BTC-USD",
      lastPrice: 50001,
      indicators,
      perp: basePerp
    });

    expect(rec.signal).toBe("NO_TRADE");
    expect(rec.rationale.some((line) => line.includes("VWAP filter"))).toBe(true);
  });

  it("adapts TP/SL width by ATR regime", () => {
    const lowVolIndicators: IndicatorSnapshot = {
      rsi14: 58,
      ema20: 50000,
      ema50: 49900,
      macd: 12,
      macdSignal: 8,
      macdHistogram: 4,
      atr14: 70,
      adx14: 30,
      bbUpper: 50300,
      bbMiddle: 50000,
      bbLower: 49700,
      stochRsiK: 60,
      stochRsiD: 54,
      vwap: 49800
    };
    const highVolIndicators: IndicatorSnapshot = {
      ...lowVolIndicators,
      atr14: 650
    };

    const lowVolRec = new RecommendationEngine().build({
      pair: "BTC-USD",
      lastPrice: 50000,
      indicators: lowVolIndicators,
      perp: basePerp
    });
    const highVolRec = new RecommendationEngine().build({
      pair: "BTC-USD",
      lastPrice: 50000,
      indicators: highVolIndicators,
      perp: basePerp
    });

    const lowVolDistance = Math.abs(lowVolRec.takeProfit - lowVolRec.entry);
    const highVolDistance = Math.abs(highVolRec.takeProfit - highVolRec.entry);
    expect(highVolDistance).toBeGreaterThan(lowVolDistance);
  });
});
