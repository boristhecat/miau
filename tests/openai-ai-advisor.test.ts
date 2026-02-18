import { describe, expect, it } from "vitest";
import { OpenAiAiAdvisor } from "../src/adapters/ai/openai-ai-advisor.js";
import type { HttpClient } from "../src/adapters/http/http-client.js";
import type { AiAdviceRequest } from "../src/ports/ai-advisor-port.js";

class FakeHttpClient implements HttpClient {
  public postResponse: unknown = {};
  public postQueue: Array<unknown> = [];
  public lastPostInput?: { url: string; body?: unknown; params?: Record<string, string | number>; headers?: Record<string, string> };
  public postInputs: Array<{ url: string; body?: unknown; params?: Record<string, string | number>; headers?: Record<string, string> }> = [];

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
    this.postInputs.push(input);
    const queued = this.postQueue.shift();
    if (queued instanceof Error) {
      throw queued;
    }
    if (queued !== undefined) {
      return queued as T;
    }
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
    expect(body.max_completion_tokens).toBe(1024);
    expect(body.reasoning_effort).toBe("low");
    expect(body.temperature).toBeUndefined();
  });

  it("parses JSON when message content is returned as content parts", async () => {
    const httpClient = new FakeHttpClient();
    httpClient.postResponse = {
      model: "gpt-5-mini",
      choices: [
        {
          message: {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  bias: "SHORT",
                  confidenceBand: "LOW",
                  agreement: "DISAGREE",
                  regime: "VOLATILE",
                  overruledSignals: ["Breakout continuation"],
                  reasons: ["volatility regime is unstable"],
                  invalidation: "close above 101",
                  riskNote: "news spike risk"
                })
              }
            ]
          }
        }
      ]
    };
    const advisor = new OpenAiAiAdvisor({ apiKey: "test-key", model: "gpt-5-mini", httpClient });

    const advice = await advisor.advise(baseRequest);

    expect(advice.bias).toBe("SHORT");
    expect(advice.regime).toBe("VOLATILE");
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

  it("surfaces OpenAI response error details in thrown message", async () => {
    const httpClient = new FakeHttpClient();
    const apiError = new Error("Request failed with status code 400") as Error & {
      response?: { status: number; data: { error: { message: string } } };
    };
    apiError.response = {
      status: 400,
      data: {
        error: {
          message: "Unsupported parameter: 'max_completion_tokens' is not allowed for this model."
        }
      }
    };
    httpClient.postQueue = [apiError];
    const advisor = new OpenAiAiAdvisor({ apiKey: "test-key", model: "gpt-5-mini", httpClient });

    await expect(advisor.advise(baseRequest)).rejects.toThrow(
      "OpenAI API 400: Unsupported parameter: 'max_completion_tokens' is not allowed for this model."
    );
    expect(httpClient.postInputs.length).toBe(1);
  });

  it("includes finish reason when content is empty", async () => {
    const httpClient = new FakeHttpClient();
    httpClient.postResponse = {
      model: "gpt-5-mini",
      choices: [
        {
          finish_reason: "length",
          message: {
            content: null,
            refusal: "Safety refusal"
          }
        }
      ]
    };
    const advisor = new OpenAiAiAdvisor({ apiKey: "test-key", model: "gpt-5-mini", httpClient });

    await expect(advisor.advise(baseRequest)).rejects.toThrow(
      "AI response was empty. finish_reason=length refusal=Safety refusal"
    );
  });

  it("uses a single request and surfaces model access errors", async () => {
    const httpClient = new FakeHttpClient();
    const apiError = new Error("Request failed with status code 400") as Error & {
      response?: { status: number; data: { error: { message: string } } };
    };
    apiError.response = {
      status: 400,
      data: {
        error: {
          message: "The model `gpt-5-mini` does not exist or you do not have access to it."
        }
      }
    };
    httpClient.postQueue = [apiError];
    const advisor = new OpenAiAiAdvisor({ apiKey: "test-key", model: "gpt-5-mini", httpClient });

    await expect(advisor.advise(baseRequest)).rejects.toThrow(
      "OpenAI API 400: The model `gpt-5-mini` does not exist or you do not have access to it."
    );
    expect(httpClient.postInputs.length).toBe(1);
    const firstBody = httpClient.postInputs[0]?.body as Record<string, unknown>;
    expect(firstBody.max_completion_tokens).toBe(1024);
  });
});
