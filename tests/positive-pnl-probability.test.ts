import { describe, expect, it } from "vitest";
import { estimatePositivePnlProbability } from "../src/domain/positive-pnl-probability.js";
import type { IndicatorSnapshot, PerpMarketSnapshot, Recommendation } from "../src/domain/types.js";

const indicators: IndicatorSnapshot = {
  rsi14: 55,
  ema20: 100,
  ema50: 99,
  macd: 2,
  macdSignal: 1,
  macdHistogram: 1,
  atr14: 0.8,
  adx14: 25,
  bbUpper: 102,
  bbMiddle: 100,
  bbLower: 98,
  stochRsiK: 65,
  stochRsiD: 50,
  vwap: 100
};

const perp: PerpMarketSnapshot = {
  symbol: "BTC_USDC_PERP",
  fundingRate: 0,
  fundingRateAvg: 0,
  openInterest: 1_000,
  markPrice: 100,
  indexPrice: 100,
  premiumPct: 0
};

function makeRecommendation(input: Partial<Recommendation>): Recommendation {
  return {
    pair: "BTC-USD",
    signal: "LONG",
    action: "LONG",
    regime: "TRADEABLE",
    entry: 100,
    stopLoss: 99,
    takeProfit: 102,
    confidence: 70,
    rationale: ["test"],
    riskRewardRatio: 2,
    dailyTargetUsd: 100,
    indicators,
    perp,
    ...input
  };
}

describe("estimatePositivePnlProbability", () => {
  it("gives higher probability to a tradeable high-quality setup than NO_TRADE setup", () => {
    const tradeable = makeRecommendation({
      signal: "LONG",
      action: "LONG",
      regime: "TRADEABLE",
      confidence: 75,
      riskRewardRatio: 2.1
    });
    const blocked = makeRecommendation({
      signal: "NO_TRADE",
      action: "NO TRADE",
      regime: "CHOPPY",
      confidence: 75,
      riskRewardRatio: 0.9
    });

    expect(estimatePositivePnlProbability(tradeable)).toBeGreaterThan(estimatePositivePnlProbability(blocked));
  });
});
