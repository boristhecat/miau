import { describe, expect, it } from "vitest";
import {
  RankTopOpportunitiesUseCase,
  type RecommendationGenerator
} from "../src/application/rank-top-opportunities-use-case.js";
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

class FakeRecommendationGenerator implements RecommendationGenerator {
  constructor(private readonly responses: Record<string, Recommendation | Error>) {}

  async execute(input: { pair: string }): Promise<Recommendation> {
    const response = this.responses[input.pair];
    if (!response) {
      throw new Error(`Missing fake response for ${input.pair}`);
    }
    if (response instanceof Error) {
      throw response;
    }
    return response;
  }
}

describe("RankTopOpportunitiesUseCase", () => {
  it("returns recommendations ordered from highest to lowest probability and excludes NO_TRADE", async () => {
    const generator = new FakeRecommendationGenerator({
      "BTC-USD": makeRecommendation({
        pair: "BTC-USD",
        confidence: 78,
        riskRewardRatio: 2.1
      }),
      "ETH-USD": makeRecommendation({
        pair: "ETH-USD",
        confidence: 72,
        riskRewardRatio: 1.6
      }),
      "SOL-USD": makeRecommendation({
        pair: "SOL-USD",
        signal: "NO_TRADE",
        action: "NO TRADE",
        regime: "CHOPPY",
        confidence: 80,
        riskRewardRatio: 0.9
      })
    });

    const result = await new RankTopOpportunitiesUseCase(generator).execute({
      symbols: ["BTC", "ETH", "SOL"],
      top: 5
    });

    expect(result.ranked.map((item) => item.symbol)).toEqual(["BTC", "ETH"]);
    expect(result.ranked[0]!.probabilityPositivePnl).toBeGreaterThan(result.ranked[1]!.probabilityPositivePnl);
  });

  it("tracks skipped symbols when recommendation generation fails", async () => {
    const generator = new FakeRecommendationGenerator({
      "BTC-USD": makeRecommendation({ pair: "BTC-USD", confidence: 70 }),
      "XRP-USD": new Error("mock fetch failure")
    });

    const result = await new RankTopOpportunitiesUseCase(generator).execute({
      symbols: ["BTC", "XRP"],
      top: 5
    });

    expect(result.scannedSymbols).toBe(2);
    expect(result.ranked).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.symbol).toBe("XRP");
  });
});
