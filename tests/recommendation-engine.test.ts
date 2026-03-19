import { afterEach, describe, expect, it, vi } from "vitest";
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
  afterEach(() => {
    vi.useRealTimers();
  });

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

    const effectiveDirection = rec.signal === "NO_TRADE" ? (rec.takeProfit < rec.entry ? "SHORT" : "LONG") : rec.signal;
    if (effectiveDirection === "SHORT") {
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
      biasContext: { trend: "LONG", rsiZone: "NEUTRAL", macdDirection: "POSITIVE", bbPosition: "INSIDE" },
      biasInterval: "15m"
    });
    const recShortBias = new RecommendationEngine().build({
      pair: "BTC-USD",
      lastPrice: 50000,
      indicators,
      perp: basePerp,
      biasContext: { trend: "SHORT", rsiZone: "NEUTRAL", macdDirection: "NEGATIVE", bbPosition: "INSIDE" },
      biasInterval: "15m"
    });

    expect(recLongBias.rationale.some((line) => line.includes("15m") && line.includes("bullish"))).toBe(true);
    expect(recShortBias.rationale.some((line) => line.includes("15m") && line.includes("bearish"))).toBe(true);
  });

  it("emits horizon/regime weight profile rationale", () => {
    const indicators: IndicatorSnapshot = {
      rsi14: 50,
      ema20: 50010,
      ema50: 50000,
      macd: 1,
      macdSignal: 1,
      macdHistogram: 0,
      atr14: 120,
      adx14: 24,
      bbUpper: 50200,
      bbMiddle: 50000,
      bbLower: 49800,
      stochRsiK: 50,
      stochRsiD: 50,
      vwap: 50000
    };

    const rec = new RecommendationEngine().build({
      pair: "BTC-USD",
      lastPrice: 50000,
      indicators,
      perp: basePerp,
      baseInterval: "1m"
    });

    expect(rec.rationale.some((line) => line.startsWith("Weight profile"))).toBe(true);
  });

  it("computes position-based recommendation when leverage and size are provided", () => {
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
    });

    if (rec.signal === "NO_TRADE") {
      expect(rec.rationale.some((line) => line.startsWith("No-trade guard:"))).toBe(true);
    } else {
      expect(rec.estimatedPnLAtTakeProfit).toBeDefined();
    }
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
    expect(rec.marketRegime).toBe("LOW_LIQ_CHOP");
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
    if (rec.signal === "NO_TRADE") {
      expect(rec.rationale.some((line) => line.startsWith("No-trade guard:"))).toBe(true);
    } else {
      expect(rec.estimatedPnLAtTakeProfit).toBeCloseTo(10, 6);
    }
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
    expect(rec.marketTradeability).toBe("DO_NOT_TRADE");
    expect(rec.marketTradeabilityReasons).toContain("VWAP_CHOP");
    expect(rec.rationale.some((line) => line.includes("VWAP filter"))).toBe(true);
    expect(rec.rationale.some((line) => line.startsWith("No-trade guard:"))).toBe(true);
  });

  it("keeps CAUTION tradeability informational-only in the dead session", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-05T22:00:00.000Z"));

    const indicators: IndicatorSnapshot = {
      rsi14: 61,
      ema20: 50500,
      ema50: 50000,
      macd: 14,
      macdSignal: 9,
      macdHistogram: 4,
      atr14: 130,
      adx14: 32,
      bbUpper: 50800,
      bbMiddle: 50300,
      bbLower: 49800,
      stochRsiK: 62,
      stochRsiD: 54,
      vwap: 50150,
      obvSlope5: 0.03,
      mfi14: 64,
      cmf20: 0.12,
      volumeZScore20: 1.4,
      cvdDeltaPct5: 22,
      recentCandleContext: {
        momentumPct3: 0.42,
        bullishCloseRatio5: 0.8,
        bearishCloseRatio5: 0.2,
        rangeExpansionRatio: 1.35,
        breakoutDirection: "UP"
      }
    };

    const rec = new RecommendationEngine().build({
      pair: "BTC-USD",
      lastPrice: 50620,
      indicators,
      perp: {
        ...basePerp,
        openInterestDeltaPct: 0.5,
        orderBookImbalance: 0.1,
        microPricePremiumPct: 0.02
      },
      baseInterval: "15m"
    });

    expect(rec.marketTradeability).toBe("CAUTION");
    expect(rec.marketTradeabilityReasons).toEqual(["SESSION_DEAD_ZONE"]);
    expect(rec.rationale).not.toContain("No-trade guard: dead zone session; treat fresh entries cautiously.");
  });

  it("preserves forced-direction advisory behavior on market-level tradeability blocks", () => {
    const indicators: IndicatorSnapshot = {
      rsi14: 60,
      ema20: 50500,
      ema50: 50000,
      macd: 10,
      macdSignal: 7,
      macdHistogram: 3,
      atr14: 140,
      adx14: 28,
      bbUpper: 51000,
      bbMiddle: 50000,
      bbLower: 49000,
      stochRsiK: 58,
      stochRsiD: 50,
      vwap: 50200
    };

    const rec = new RecommendationEngine().build({
      pair: "BTC-USD",
      lastPrice: 50600,
      indicators,
      perp: { ...basePerp, bidAskSpreadPct: 0.2 },
      forcedDirection: "LONG"
    });

    expect(rec.signal).toBe("LONG");
    expect(rec.marketTradeability).toBe("DO_NOT_TRADE");
    expect(rec.marketTradeabilityReasons).toContain("WIDE_SPREAD");
    expect(rec.qualityVerdict).toBe("WEAK");
    expect(rec.rationale).toContain("Guard advisory: orderbook spread is too wide for clean execution.");
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

  it("computes net PnL and expected value using execution realism costs", () => {
    const indicators: IndicatorSnapshot = {
      rsi14: 60,
      ema20: 50500,
      ema50: 50000,
      macd: 12,
      macdSignal: 8,
      macdHistogram: 4,
      atr14: 130,
      adx14: 30,
      bbUpper: 51000,
      bbMiddle: 50000,
      bbLower: 49000,
      stochRsiK: 62,
      stochRsiD: 55,
      vwap: 50300
    };

    const rec = new RecommendationEngine().build({
      pair: "BTC-USD",
      lastPrice: 50000,
      indicators,
      perp: basePerp,
      leverage: 20,
      positionSizeUsd: 250
    });

    if (rec.signal === "NO_TRADE") {
      expect(rec.rationale.some((line) => line.startsWith("No-trade guard:"))).toBe(true);
    } else {
      expect(rec.netEstimatedPnLAtTakeProfit).toBeDefined();
      expect(rec.netEstimatedPnLAtStopLoss).toBeDefined();
      expect(rec.netRiskRewardRatio).toBeGreaterThan(0);
      expect(rec.expectedValueUsd).toBeDefined();
    }
  });

  it("does not produce SHORT when recent candles show a strong bullish impulse", () => {
    const indicators: IndicatorSnapshot = {
      rsi14: 42,
      ema20: 49800,
      ema50: 50200,
      macd: -18,
      macdSignal: -10,
      macdHistogram: -6,
      atr14: 180,
      adx14: 30,
      bbUpper: 50700,
      bbMiddle: 50000,
      bbLower: 49300,
      stochRsiK: 35,
      stochRsiD: 45,
      vwap: 49900,
      recentCandleContext: {
        momentumPct3: 0.65,
        bullishCloseRatio5: 0.8,
        bearishCloseRatio5: 0.2,
        rangeExpansionRatio: 1.45,
        breakoutDirection: "UP"
      }
    };

    const rec = new RecommendationEngine().build({
      pair: "BTC-USD",
      lastPrice: 50000,
      indicators,
      perp: basePerp
    });

    // With predictive-input-focused scoring, strong bullish impulse context
    // correctly produces LONG (or NO_TRADE), never SHORT against the impulse
    expect(rec.signal).not.toBe("SHORT");
  });

  it("keeps forced direction as a weak setup when guards would block it", () => {
    const indicators: IndicatorSnapshot = {
      rsi14: 42,
      ema20: 49800,
      ema50: 50200,
      macd: -18,
      macdSignal: -10,
      macdHistogram: -6,
      atr14: 180,
      adx14: 30,
      bbUpper: 50700,
      bbMiddle: 50000,
      bbLower: 49300,
      stochRsiK: 35,
      stochRsiD: 45,
      vwap: 49900,
      recentCandleContext: {
        momentumPct3: 0.65,
        bullishCloseRatio5: 0.8,
        bearishCloseRatio5: 0.2,
        rangeExpansionRatio: 1.45,
        breakoutDirection: "UP"
      }
    };

    const rec = new RecommendationEngine().build({
      pair: "BTC-USD",
      lastPrice: 50000,
      indicators,
      perp: basePerp,
      forcedDirection: "SHORT"
    });

    expect(rec.signal).toBe("SHORT");
    expect(rec.requestedDirection).toBe("SHORT");
    expect(rec.modelSignal).toBeDefined();
    expect(rec.qualityVerdict).toBe("WEAK");
    expect(rec.rationale.some((line) => line.startsWith("Guard advisory:"))).toBe(true);
  });

  it("blocks extended trend entries until pullback", () => {
    const indicators: IndicatorSnapshot = {
      rsi14: 62,
      ema20: 51000,
      ema50: 50000,
      macd: 20,
      macdSignal: 14,
      macdHistogram: 6,
      atr14: 180,
      adx14: 32,
      bbUpper: 51380,
      bbMiddle: 51000,
      bbLower: 50620,
      stochRsiK: 68,
      stochRsiD: 60,
      vwap: 50500
    };

    const rec = new RecommendationEngine().build({
      pair: "BTC-USD",
      lastPrice: 51480,
      indicators,
      perp: basePerp
    });

    expect(rec.signal).toBe("NO_TRADE");
    expect(rec.rationale.some((line) => line.toLowerCase().includes("pullback") || line.toLowerCase().includes("extended"))).toBe(true);
  });

  it("exposes confidence breakdown with setup quality", () => {
    const indicators: IndicatorSnapshot = {
      rsi14: 56,
      ema20: 50300,
      ema50: 50050,
      macd: 6,
      macdSignal: 4,
      macdHistogram: 2,
      atr14: 120,
      adx14: 24,
      bbUpper: 50700,
      bbMiddle: 50200,
      bbLower: 49700,
      stochRsiK: 58,
      stochRsiD: 52,
      vwap: 50150
    };

    const rec = new RecommendationEngine().build({
      pair: "BTC-USD",
      lastPrice: 50320,
      indicators,
      perp: basePerp
    });

    expect(rec.confidenceBreakdown.setupQuality).toBeGreaterThanOrEqual(0);
    expect(rec.confidenceBreakdown.setupQuality).toBeLessThanOrEqual(100);
    expect(["A", "B", "C", "D"]).toContain(rec.setupGrade);
    expect(rec.rationale.some((line) => line.startsWith("Setup grade"))).toBe(true);
  });

  it("estimates wider expected low/high range for longer horizon", () => {
    const indicators: IndicatorSnapshot = {
      rsi14: 58,
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

    const shortHorizon = new RecommendationEngine().build({
      pair: "BTC-USD",
      lastPrice: 50000,
      indicators,
      perp: basePerp,
      leverage: 20,
      positionSizeUsd: 250,
      objectiveHorizon: "15",
      baseInterval: "1m"
    });
    const longHorizon = new RecommendationEngine().build({
      pair: "BTC-USD",
      lastPrice: 50000,
      indicators,
      perp: basePerp,
      leverage: 20,
      positionSizeUsd: 250,
      objectiveHorizon: "60",
      baseInterval: "1m"
    });

    const shortWidth = (shortHorizon.expectedHigh ?? shortHorizon.entry) - (shortHorizon.expectedLow ?? shortHorizon.entry);
    const longWidth = (longHorizon.expectedHigh ?? longHorizon.entry) - (longHorizon.expectedLow ?? longHorizon.entry);
    expect(longWidth).toBeGreaterThan(shortWidth);
    expect(longHorizon.expectedRangeHorizonMinutes).toBe(60);
    expect(shortHorizon.expectedRangeHorizonMinutes).toBe(15);
  });

  it("uses explicit expected-range horizon instead of resolved objective horizon minutes", () => {
    const indicators: IndicatorSnapshot = {
      rsi14: 58,
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
      leverage: 20,
      positionSizeUsd: 250,
      objectiveHorizon: "15",
      expectedRangeHorizon: "240",
      baseInterval: "1m"
    });

    expect(rec.expectedRangeHorizonMinutes).toBe(240);
    expect(rec.expectedRangeCandles).toBe(240);
  });

  it("keeps obvious bullish structure as LONG instead of flipping contrarian short", () => {
    const indicators: IndicatorSnapshot = {
      rsi14: 74,
      ema20: 50080,
      ema50: 49750,
      macd: 16,
      macdSignal: 10,
      macdHistogram: 6,
      atr14: 120,
      adx14: 29,
      bbUpper: 50450,
      bbMiddle: 50000,
      bbLower: 49550,
      stochRsiK: 72,
      stochRsiD: 68,
      vwap: 50020,
      recentCandleContext: {
        momentumPct3: 0.38,
        bullishCloseRatio5: 0.8,
        bearishCloseRatio5: 0.2,
        rangeExpansionRatio: 1.32,
        breakoutDirection: "UP"
      }
    };

    const rec = new RecommendationEngine().build({
      pair: "BTC-USD",
      lastPrice: 50120,
      indicators,
      perp: {
        ...basePerp,
        fundingRate: 0.00012,
        fundingRateAvg: 0.00008,
        premiumPct: 0.2,
        orderBookImbalance: 0.25,
        microPricePremiumPct: 0.02
      },
      baseInterval: "1m"
    });

    expect(rec.signal).toBe("LONG");
  });

  it("does not auto-block bearish continuation when failed breakout was against the trade direction", () => {
    const indicators: IndicatorSnapshot = {
      rsi14: 42,
      ema20: 49800,
      ema50: 50200,
      macd: -14,
      macdSignal: -9,
      macdHistogram: -5,
      atr14: 120,
      adx14: 27,
      bbUpper: 50300,
      bbMiddle: 50000,
      bbLower: 49500,
      stochRsiK: 35,
      stochRsiD: 45,
      vwap: 50200,
      swingHigh: 49980,
      nearestResistanceLevel: 49990,
      obvSlope5: -0.05,
      cmf20: -0.12,
      cvdDeltaPct5: -15,
      volumeZScore20: 1.2,
      recentCandleContext: {
        momentumPct3: -0.18,
        bullishCloseRatio5: 0.2,
        bearishCloseRatio5: 0.6,
        rangeExpansionRatio: 1.05,
        breakoutDirection: "UP"
      }
    };

    const rec = new RecommendationEngine().build({
      pair: "BTC-USD",
      lastPrice: 49900,
      indicators,
      perp: {
        ...basePerp,
        orderBookImbalance: -0.25,
        microPricePremiumPct: -0.02
      },
      baseInterval: "15m"
    });

    expect(rec.signal).toBe("SHORT");
    expect(rec.rationale.some((line) => line.includes("breakout follow-through warning"))).toBe(true);
  });

  it("uses positive orderbook imbalance as an additional bullish input", () => {
    const indicators: IndicatorSnapshot = {
      rsi14: 54,
      ema20: 50040,
      ema50: 50000,
      macd: 4,
      macdSignal: 3,
      macdHistogram: 1,
      atr14: 120,
      adx14: 24,
      bbUpper: 50400,
      bbMiddle: 50000,
      bbLower: 49600,
      stochRsiK: 57,
      stochRsiD: 52,
      vwap: 50010,
      mfi14: 58,
      cmf20: 0.1,
      obvSlope5: 0.04,
      volumeZScore20: 1.2,
      cvdDeltaPct5: 14
    };

    const rec = new RecommendationEngine().build({
      pair: "BTC-USD",
      lastPrice: 50050,
      indicators,
      perp: {
        ...basePerp,
        orderBookImbalance: 0.22,
        microPricePremiumPct: 0.03
      },
      baseInterval: "5m"
    });

    expect(rec.rationale.some((line) => line.includes("Orderbook imbalance favors bids"))).toBe(true);
  });

  it("blocks setups with overly wide spread when not forced", () => {
    const indicators: IndicatorSnapshot = {
      rsi14: 57,
      ema20: 50200,
      ema50: 50000,
      macd: 8,
      macdSignal: 6,
      macdHistogram: 2,
      atr14: 130,
      adx14: 28,
      bbUpper: 50700,
      bbMiddle: 50100,
      bbLower: 49500,
      stochRsiK: 60,
      stochRsiD: 54,
      vwap: 50100
    };

    const rec = new RecommendationEngine().build({
      pair: "BTC-USD",
      lastPrice: 50220,
      indicators,
      perp: {
        ...basePerp,
        bidAskSpreadPct: 0.2
      },
      baseInterval: "1m"
    });

    expect(rec.signal).toBe("NO_TRADE");
    expect(rec.rationale.some((line) => line.includes("orderbook spread is too wide"))).toBe(true);
  });

  it("blocks extended continuation setups until pullback entry is reached", () => {
    const indicators: IndicatorSnapshot = {
      rsi14: 60,
      ema20: 49900,
      ema50: 49780,
      macd: 10,
      macdSignal: 7,
      macdHistogram: 3,
      atr14: 120,
      adx14: 29,
      bbUpper: 50750,
      bbMiddle: 49920,
      bbLower: 49450,
      stochRsiK: 64,
      stochRsiD: 57,
      vwap: 49940,
      nearestSupportLevel: 49860,
      nearestResistanceLevel: 50950,
      swingLow: 49820,
      recentCandleContext: {
        momentumPct3: 0.21,
        bullishCloseRatio5: 0.8,
        bearishCloseRatio5: 0.2,
        rangeExpansionRatio: 1.1,
        breakoutDirection: "NONE"
      }
    };

    const rec = new RecommendationEngine().build({
      pair: "BTC-USD",
      lastPrice: 50140,
      indicators,
      perp: basePerp,
      baseInterval: "5m"
    });

    expect(rec.entryReadiness).toBe("WAIT_PULLBACK");
    expect(rec.preferredEntryPrice).toBeDefined();
    expect(rec.signal).toBe("NO_TRADE");
    expect(
      rec.rationale.some((line) => line.toLowerCase().includes("pullback") || line.toLowerCase().includes("preferred entry"))
    ).toBe(true);
  });

  it("classifies breakout setups into the breakout continuation playbook", () => {
    const indicators: IndicatorSnapshot = {
      rsi14: 63,
      ema20: 50120,
      ema50: 49940,
      macd: 12,
      macdSignal: 8,
      macdHistogram: 4,
      atr14: 140,
      adx14: 31,
      bbUpper: 51050,
      bbMiddle: 50150,
      bbLower: 49500,
      stochRsiK: 72,
      stochRsiD: 61,
      vwap: 50180,
      nearestSupportLevel: 50080,
      nearestResistanceLevel: 51280,
      recentCandleContext: {
        momentumPct3: 0.38,
        bullishCloseRatio5: 0.8,
        bearishCloseRatio5: 0.2,
        rangeExpansionRatio: 1.4,
        breakoutDirection: "UP",
        lastOpen: 50210,
        lastHigh: 50390,
        lastLow: 50190,
        lastClose: 50340,
        previousClose: 50140,
        lastClosePositionInRange: 0.75,
        upperWickPct: 0.12,
        lowerWickPct: 0.1,
        sweptPrevHigh: false,
        sweptPrevLow: false,
        closedBackInsidePrevRange: false
      }
    };

    const rec = new RecommendationEngine().build({
      pair: "BTC-USD",
      lastPrice: 50340,
      indicators,
      perp: {
        ...basePerp,
        fundingRate: -0.0002
      },
      baseInterval: "5m"
    });

    expect(rec.setupType).toBe("BREAKOUT");
    expect(rec.setupPlaybook).toBe("BREAKOUT_CONTINUATION");
    expect(rec.sequenceStatus).toBe("CONFIRMED");
    expect(rec.sequencePattern).toBe("BREAKOUT_ACCEPTANCE");
  });

  it("gives breakout playbooks a faster time-based exit than trend pullback playbooks", () => {
    const breakoutIndicators: IndicatorSnapshot = {
      rsi14: 63,
      ema20: 50120,
      ema50: 49940,
      macd: 12,
      macdSignal: 8,
      macdHistogram: 4,
      atr14: 140,
      adx14: 31,
      bbUpper: 51050,
      bbMiddle: 50150,
      bbLower: 49500,
      stochRsiK: 72,
      stochRsiD: 61,
      vwap: 50180,
      nearestSupportLevel: 50080,
      nearestResistanceLevel: 51280,
      recentCandleContext: {
        momentumPct3: 0.38,
        bullishCloseRatio5: 0.8,
        bearishCloseRatio5: 0.2,
        rangeExpansionRatio: 1.4,
        breakoutDirection: "UP"
      }
    };
    const pullbackIndicators: IndicatorSnapshot = {
      rsi14: 59,
      ema20: 50120,
      ema50: 49940,
      macd: 11,
      macdSignal: 8,
      macdHistogram: 3,
      atr14: 140,
      adx14: 30,
      bbUpper: 51050,
      bbMiddle: 50150,
      bbLower: 49500,
      stochRsiK: 66,
      stochRsiD: 58,
      vwap: 50170,
      nearestSupportLevel: 50280,
      nearestResistanceLevel: 51280,
      swingLow: 50190,
      recentCandleContext: {
        momentumPct3: 0.12,
        bullishCloseRatio5: 0.6,
        bearishCloseRatio5: 0.4,
        rangeExpansionRatio: 1.05,
        breakoutDirection: "NONE"
      }
    };

    const breakout = new RecommendationEngine().build({
      pair: "BTC-USD",
      lastPrice: 50340,
      indicators: breakoutIndicators,
      perp: {
        ...basePerp,
        fundingRate: -0.0002
      },
      baseInterval: "5m"
    });
    const pullback = new RecommendationEngine().build({
      pair: "BTC-USD",
      lastPrice: 50340,
      indicators: pullbackIndicators,
      perp: basePerp,
      baseInterval: "5m"
    });

    expect(breakout.setupPlaybook).toBe("BREAKOUT_CONTINUATION");
    expect(pullback.setupPlaybook).toBe("TREND_PULLBACK_CONTINUATION");
    expect((breakout.timeBasedExitCandles ?? 0)).toBeLessThan(pullback.timeBasedExitCandles ?? Number.POSITIVE_INFINITY);
  });

  it("surfaces key-level interaction status for accepted intraday levels", () => {
    const indicators: IndicatorSnapshot = {
      rsi14: 63,
      ema20: 100,
      ema50: 98,
      macd: 12,
      macdSignal: 8,
      macdHistogram: 4,
      atr14: 2,
      adx14: 30,
      bbUpper: 106,
      bbMiddle: 100,
      bbLower: 96,
      stochRsiK: 70,
      stochRsiD: 60,
      vwap: 100.2,
      sessionLevels: {
        currentOpen: 99.8,
        currentHigh: 101.4,
        currentLow: 99.2,
        priorHigh: 100.4,
        priorLow: 98.8
      },
      dailyLevels: {
        currentOpen: 99.7,
        currentHigh: 101.5,
        currentLow: 98.9,
        priorHigh: 100.8,
        priorLow: 97.9
      },
      nearestSupportLevel: 99.5,
      nearestResistanceLevel: 100.7,
      recentCandleContext: {
        momentumPct3: 0.3,
        bullishCloseRatio5: 0.8,
        bearishCloseRatio5: 0.2,
        rangeExpansionRatio: 1.3,
        breakoutDirection: "UP",
        lastOpen: 100.0,
        lastHigh: 101.2,
        lastLow: 99.9,
        lastClose: 101.0,
        previousClose: 100.0,
        lastClosePositionInRange: 0.85,
        upperWickPct: 0.1,
        lowerWickPct: 0.08,
        sweptPrevHigh: false,
        sweptPrevLow: false,
        closedBackInsidePrevRange: false
      }
    };

    const rec = new RecommendationEngine().build({
      pair: "BTC-USD",
      lastPrice: 101,
      indicators,
      perp: {
        ...basePerp,
        fundingRate: -0.0002,
        markPrice: 101,
        indexPrice: 101
      },
      baseInterval: "5m"
    });

    expect(rec.levelInteractionStatus).toBeDefined();
    expect(rec.levelInteractionStatus).not.toBe("NONE");
    expect(rec.levelInteractionReference).toBeDefined();
    expect(rec.levelInteractionReference).not.toBe("NONE");
  });
});
