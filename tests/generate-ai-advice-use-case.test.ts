import { describe, expect, it } from "vitest";
import { GenerateAiAdviceUseCase } from "../src/application/generate-ai-advice-use-case.js";
import type { Recommendation } from "../src/domain/types.js";
import type { AiAdvice, AiAdviceRequest, AiAdvisorPort } from "../src/ports/ai-advisor-port.js";

const baseRecommendation: Recommendation = {
  pair: "BTC-USD",
  signal: "LONG",
  action: "LONG",
  regime: "TRADEABLE",
  marketRegime: "TREND",
  entry: 100,
  stopLoss: 99,
  takeProfit: 102,
  riskRewardRatio: 2,
  confidence: 68,
  setupGrade: "B",
  confidenceBreakdown: {
    trend: 70,
    momentum: 65,
    volatility: 60,
    structure: 62,
    context: 64,
    setupQuality: 66
  },
  rationale: ["test"],
  indicators: {
    rsi14: 55,
    ema20: 101,
    ema50: 99,
    macd: 1,
    macdSignal: 0.8,
    macdHistogram: 0.2,
    atr14: 0.9,
    adx14: 26,
    bbUpper: 103,
    bbMiddle: 100,
    bbLower: 97,
    stochRsiK: 60,
    stochRsiD: 55,
    vwap: 100
  },
  perp: {
    symbol: "BTC_USDC_PERP",
    fundingRate: 0,
    fundingRateAvg: 0,
    openInterest: 1000,
    markPrice: 100,
    indexPrice: 100,
    premiumPct: 0
  }
};

class FakeAiAdvisor implements AiAdvisorPort {
  public lastInput?: AiAdviceRequest;

  async advise(input: AiAdviceRequest): Promise<AiAdvice> {
    this.lastInput = input;
    return {
      bias: "LONG",
      confidenceBand: "MEDIUM",
      agreement: "AGREE",
      regime: "TREND",
      overruledSignals: [],
      reasons: ["trend aligned"],
      invalidation: "break below 99",
      riskNote: "volatile session"
    };
  }
}

describe("GenerateAiAdviceUseCase", () => {
  it("maps recommendation data into advisor request", async () => {
    const advisor = new FakeAiAdvisor();
    const useCase = new GenerateAiAdviceUseCase({ aiAdvisor: advisor });

    const result = await useCase.execute({
      recommendation: {
        ...baseRecommendation,
        analysisInterval: "1m",
        analysisBiasInterval: "15m",
        objectiveHorizon: "30m",
        expectedLow: 98,
        expectedHigh: 104
      }
    });

    expect(result.bias).toBe("LONG");
    expect(advisor.lastInput).toBeDefined();
    expect(advisor.lastInput?.pair).toBe("BTC-USD");
    expect(advisor.lastInput?.analysisInterval).toBe("1m");
    expect(advisor.lastInput?.expectedLow).toBe(98);
    expect(advisor.lastInput?.indicators.atr14).toBe(0.9);
  });
});
