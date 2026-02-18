import { describe, expect, it } from "vitest";
import { OpenAiAiAdvisor } from "../src/adapters/ai/openai-ai-advisor.js";
import type { HttpClient } from "../src/adapters/http/http-client.js";
import type { AiAdviceRequest } from "../src/ports/ai-advisor-port.js";

class FakeHttpClient implements HttpClient {
  public postResponse: unknown = {};
  public lastPostInput?: { url: string; body?: unknown; params?: Record<string, string | number>; headers?: Record<string, string> };

  async get<T>(): Promise<T> {
    throw new Error("not implemented");
  }

  async post<T>(input: {
    url: string;
    body?: unknown;
    params?: Record<string, string | number>;
    headers?: Record<string, string>;
  }): Promise<T> {
    this.lastPostInput = input;
    return this.postResponse as T;
  }
}

const baseRequest: AiAdviceRequest = {
  pair: "BTC-USD",
  signal: "LONG",
  modelSignal: "LONG",
  confidence: 66,
  setupGrade: "B",
  setupQuality: 64,
  marketRegime: "TREND",
  riskRewardRatio: 1.9,
  analysisInterval: "1m",
  analysisBiasInterval: "15m",
  objectiveHorizon: "30m",
  entry: 100,
  stopLoss: 99,
  takeProfit: 102,
  expectedLow: 98,
  expectedHigh: 103,
  indicators: {
    rsi14: 55,
    ema20: 101,
    ema50: 99,
    macdHistogram: 0.2,
    atr14: 0.8,
    adx14: 24,
    vwap: 100
  },
  perp: {
    fundingRate: 0,
    premiumPct: 0,
    openInterest: 1000
  },
  keyRationale: ["trend healthy", "momentum positive"]
};

describe("OpenAiAiAdvisor", () => {
  it("parses agreement/regime/overruledSignals from JSON response", async () => {
    const httpClient = new FakeHttpClient();
    httpClient.postResponse = {
      model: "gpt-5-mini",
      choices: [
        {
          message: {
            content: JSON.stringify({
              bias: "LONG",
              confidenceBand: "MEDIUM",
              agreement: "AGREE",
              regime: "TREND",
              overruledSignals: [],
              reasons: ["trend continuation likely"],
              invalidation: "close below 99",
              riskNote: "watch volatility spikes"
            })
          }
        }
      ]
    };
    const advisor = new OpenAiAiAdvisor({ apiKey: "test-key", model: "gpt-5-mini", httpClient });

    const advice = await advisor.advise(baseRequest);

    expect(advice.agreement).toBe("AGREE");
    expect(advice.regime).toBe("TREND");
    expect(advice.overruledSignals).toEqual([]);
    expect(advice.bias).toBe("LONG");
    const body = httpClient.lastPostInput?.body as Record<string, unknown>;
    expect(body.max_completion_tokens).toBe(160);
  });

  it("rejects invalid agreement field", async () => {
    const httpClient = new FakeHttpClient();
    httpClient.postResponse = {
      model: "gpt-5-mini",
      choices: [
        {
          message: {
            content: JSON.stringify({
              bias: "LONG",
              confidenceBand: "LOW",
              agreement: "MAYBE",
              regime: "TREND",
              overruledSignals: ["EMA cross"],
              reasons: ["weak setup"],
              invalidation: "below VWAP",
              riskNote: "high chop risk"
            })
          }
        }
      ]
    };
    const advisor = new OpenAiAiAdvisor({ apiKey: "test-key", httpClient });

    await expect(advisor.advise(baseRequest)).rejects.toThrow("AI response agreement is invalid.");
  });
});
