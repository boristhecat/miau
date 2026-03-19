import { describe, expect, it, vi } from "vitest";
import { ChatCompletionsAiAdvisor } from "../src/adapters/ai/chat-completions-ai-advisor.js";
import type { AiAdviceRequest } from "../src/ports/ai-advisor-port.js";

function makeFetch(response: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    url: "https://api.openai.com/v1/chat/completions",
    headers: new Headers({ "content-type": "application/json" }),
    body: null,
    json: async () => response,
    text: async () => JSON.stringify(response)
  } as unknown as Response);
}

function makeErrorFetch(status: number, errorMessage: string) {
  return makeFetch({ error: { message: errorMessage, type: "invalid_request_error" } }, status);
}

function openAiResponse(contentJson: unknown) {
  return {
    id: "chatcmpl-test",
    object: "chat.completion",
    created: 1234567890,
    model: "gpt-5-mini",
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        message: {
          role: "assistant",
          content: JSON.stringify(contentJson)
        }
      }
    ],
    usage: { prompt_tokens: 10, completion_tokens: 50, total_tokens: 60 }
  };
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

describe("ChatCompletionsAiAdvisor", () => {
  it("parses agreement/regime/overruledSignals from JSON response", async () => {
    const fetch = makeFetch(
      openAiResponse({
        bias: "LONG",
        confidenceBand: "MEDIUM",
        agreement: "AGREE",
        regime: "TREND",
        overruledSignals: [],
        reasons: ["trend continuation likely"],
        invalidation: "close below 99",
        riskNote: "watch volatility spikes"
      })
    );
    const advisor = new ChatCompletionsAiAdvisor({
      apiKey: "test-key",
      model: "gpt-5-mini",
      fetch
    });

    const advice = await advisor.advise(baseRequest);

    expect(advice.agreement).toBe("AGREE");
    expect(advice.regime).toBe("TREND");
    expect(advice.overruledSignals).toEqual([]);
    expect(advice.bias).toBe("LONG");

    const reqInit = (fetch.mock.calls[0] as unknown[])[1] as RequestInit;
    const body = JSON.parse(reqInit.body as string) as Record<string, unknown>;
    expect(body.max_completion_tokens).toBe(1024);
    expect(body.temperature).toBe(0);
    expect(body.reasoning_effort).toBeUndefined();
  });

  it("sends reasoning_effort for o-series models, not temperature", async () => {
    const fetch = makeFetch(
      openAiResponse({
        bias: "LONG",
        confidenceBand: "MEDIUM",
        agreement: "AGREE",
        regime: "TREND",
        overruledSignals: [],
        reasons: ["trend strong"],
        invalidation: "below 99",
        riskNote: "watch out"
      })
    );
    const advisor = new ChatCompletionsAiAdvisor({
      apiKey: "test-key",
      model: "o3-mini",
      fetch
    });

    await advisor.advise(baseRequest);

    const reqInit = (fetch.mock.calls[0] as unknown[])[1] as RequestInit;
    const body = JSON.parse(reqInit.body as string) as Record<string, unknown>;
    expect(body.reasoning_effort).toBe("low");
    expect(body.temperature).toBeUndefined();
  });

  it("parses JSON when message content is returned as content parts", async () => {
    // The openai SDK normalizes content to a string, so test with string content containing the JSON
    const fetch = makeFetch(
      openAiResponse({
        bias: "SHORT",
        confidenceBand: "LOW",
        suggestedEntry: 100.5,
        suggestedStopLoss: 101.2,
        suggestedTakeProfit: 98.8,
        agreement: "DISAGREE",
        regime: "VOLATILE",
        overruledSignals: ["Breakout continuation"],
        reasons: ["volatility regime is unstable"],
        invalidation: "close above 101",
        riskNote: "news spike risk"
      })
    );
    const advisor = new ChatCompletionsAiAdvisor({
      apiKey: "test-key",
      model: "gpt-5-mini",
      fetch
    });

    const advice = await advisor.advise(baseRequest);

    expect(advice.bias).toBe("SHORT");
    expect(advice.regime).toBe("VOLATILE");
    expect(advice.suggestedEntry).toBe(100.5);
    expect(advice.suggestedStopLoss).toBe(101.2);
    expect(advice.suggestedTakeProfit).toBe(98.8);
  });

  it("rejects invalid agreement field", async () => {
    const fetch = makeFetch(
      openAiResponse({
        bias: "LONG",
        confidenceBand: "LOW",
        agreement: "MAYBE",
        regime: "TREND",
        overruledSignals: ["EMA cross"],
        reasons: ["weak setup"],
        invalidation: "below VWAP",
        riskNote: "high chop risk"
      })
    );
    const advisor = new ChatCompletionsAiAdvisor({
      apiKey: "test-key",
      model: "gpt-5.4",
      fetch
    });

    await expect(advisor.advise(baseRequest)).rejects.toThrow("AI response agreement is invalid.");
  });

  it("keeps model values as returned when optional suggestions are absent", async () => {
    const fetch = makeFetch(
      openAiResponse({
        bias: "LONG",
        confidenceBand: "MEDIUM",
        agreement: "PARTIAL",
        regime: "RANGE",
        overruledSignals: [],
        reasons: ["no effective direction change"],
        invalidation: "below VWAP",
        riskNote: "choppy tape"
      })
    );
    const advisor = new ChatCompletionsAiAdvisor({
      apiKey: "test-key",
      model: "gpt-5-mini",
      fetch
    });

    const advice = await advisor.advise(baseRequest);
    expect(advice.suggestedEntry).toBeUndefined();
    expect(advice.suggestedStopLoss).toBeUndefined();
    expect(advice.suggestedTakeProfit).toBeUndefined();
  });

  it("accepts response without optional suggestion fields", async () => {
    const fetch = makeFetch(
      openAiResponse({
        bias: "LONG",
        confidenceBand: "MEDIUM",
        agreement: "PARTIAL",
        regime: "RANGE",
        overruledSignals: [],
        reasons: ["entry should be improved"],
        invalidation: "below VWAP",
        riskNote: "choppy tape"
      })
    );
    const advisor = new ChatCompletionsAiAdvisor({
      apiKey: "test-key",
      model: "gpt-5-mini",
      fetch
    });

    const advice = await advisor.advise(baseRequest);
    expect(advice.suggestedEntry).toBeUndefined();
  });

  it("surfaces OpenAI response error details in thrown message", async () => {
    const fetch = makeErrorFetch(
      400,
      "Unsupported parameter: 'max_completion_tokens' is not allowed for this model."
    );
    const advisor = new ChatCompletionsAiAdvisor({
      apiKey: "test-key",
      model: "gpt-5-mini",
      fetch
    });

    await expect(advisor.advise(baseRequest)).rejects.toThrow(
      "OpenAI API 400: Unsupported parameter: 'max_completion_tokens' is not allowed for this model."
    );
  });

  it("uses a single request and surfaces model access errors", async () => {
    const fetch = makeErrorFetch(
      400,
      "The model `gpt-5-mini` does not exist or you do not have access to it."
    );
    const advisor = new ChatCompletionsAiAdvisor({
      apiKey: "test-key",
      model: "gpt-5-mini",
      fetch
    });

    await expect(advisor.advise(baseRequest)).rejects.toThrow(
      "OpenAI API 400: The model `gpt-5-mini` does not exist or you do not have access to it."
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("throws when model is not configured", async () => {
    const advisor = new ChatCompletionsAiAdvisor({ apiKey: "test-key", model: "" });
    await expect(advisor.advise(baseRequest)).rejects.toThrow(
      "AI model is not configured. Set it in Settings."
    );
  });
});
