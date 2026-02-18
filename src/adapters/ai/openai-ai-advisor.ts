import type { AiAdvice, AiAdviceRequest, AiAdvisorPort } from "../../ports/ai-advisor-port.js";
import type { HttpClient } from "../http/http-client.js";
import { AxiosHttpClient } from "../http/axios-http-client.js";

interface OpenAiChatCompletionResponse {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
}

export class OpenAiAiAdvisor implements AiAdvisorPort {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly httpClient: HttpClient;

  constructor(input?: { apiKey?: string; model?: string; httpClient?: HttpClient }) {
    this.apiKey = input?.apiKey ?? process.env.OPENAI_API_KEY ?? "";
    this.model = input?.model ?? process.env.MIAU_AI_MODEL ?? "gpt-4o-mini";
    this.httpClient = input?.httpClient ?? new AxiosHttpClient("https://api.openai.com");
  }

  async advise(input: AiAdviceRequest): Promise<AiAdvice> {
    if (!this.apiKey) {
      throw new Error("OPENAI_API_KEY is not configured.");
    }

    const startedAt = Date.now();
    const prompt = this.buildPrompt(input);
    const response = await this.httpClient.post<OpenAiChatCompletionResponse>({
      url: "/v1/chat/completions",
      body: {
        model: this.model,
        temperature: 0.1,
        max_completion_tokens: 160,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are a cautious crypto assistant. Return compact JSON only with keys: bias, confidenceBand, agreement, regime, overruledSignals, reasons, invalidation, riskNote."
          },
          {
            role: "user",
            content: prompt
          }
        ]
      },
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`
      }
    });

    const raw = response.choices?.[0]?.message?.content;
    if (!raw) {
      throw new Error("AI response was empty.");
    }

    const parsed = this.parseResponse(raw);
    return {
      ...parsed,
      model: response.model ?? this.model,
      latencyMs: Date.now() - startedAt
    };
  }

  private buildPrompt(input: AiAdviceRequest): string {
    const compact = {
      pair: input.pair,
      signal: input.signal,
      modelSignal: input.modelSignal,
      requestedDirection: input.requestedDirection,
      confidence: input.confidence,
      setupGrade: input.setupGrade,
      setupQuality: input.setupQuality,
      marketRegime: input.marketRegime,
      riskRewardRatio: input.riskRewardRatio,
      timeframes: `${input.analysisInterval ?? "n/a"} / ${input.analysisBiasInterval ?? "n/a"}`,
      objectiveHorizon: input.objectiveHorizon ?? "n/a",
      levels: {
        entry: input.entry,
        stopLoss: input.stopLoss,
        takeProfit: input.takeProfit,
        expectedLow: input.expectedLow,
        expectedHigh: input.expectedHigh
      },
      indicators: input.indicators,
      perp: input.perp,
      keyRationale: input.keyRationale
    };

    return [
      "Analyze this trading snapshot and provide a secondary opinion.",
      "Rules:",
      "- Keep reasons simple for average crypto traders.",
      "- Be conservative when setup quality is weak.",
      "- Compare your view with the model signal and state agreement clearly.",
      "- Output only valid JSON.",
      "Schema:",
      '{ "bias":"LONG|SHORT|NO_TRADE", "confidenceBand":"LOW|MEDIUM|HIGH", "agreement":"AGREE|DISAGREE|PARTIAL", "regime":"TREND|RANGE|CHOPPY|VOLATILE", "overruledSignals":["..."], "reasons":["...","...","..."], "invalidation":"...", "riskNote":"..." }',
      "Snapshot:",
      JSON.stringify(compact)
    ].join("\n");
  }

  private parseResponse(raw: string): Omit<AiAdvice, "model" | "latencyMs"> {
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error("AI response was not valid JSON.");
    }

    if (!value || typeof value !== "object") {
      throw new Error("AI response object is invalid.");
    }
    const candidate = value as Record<string, unknown>;
    const bias = String(candidate.bias ?? "").toUpperCase();
    if (bias !== "LONG" && bias !== "SHORT" && bias !== "NO_TRADE") {
      throw new Error("AI response bias is invalid.");
    }
    const confidenceBand = String(candidate.confidenceBand ?? "").toUpperCase();
    if (confidenceBand !== "LOW" && confidenceBand !== "MEDIUM" && confidenceBand !== "HIGH") {
      throw new Error("AI response confidence band is invalid.");
    }
    const agreement = String(candidate.agreement ?? "").toUpperCase();
    if (agreement !== "AGREE" && agreement !== "DISAGREE" && agreement !== "PARTIAL") {
      throw new Error("AI response agreement is invalid.");
    }
    const regime = String(candidate.regime ?? "").toUpperCase();
    if (regime !== "TREND" && regime !== "RANGE" && regime !== "CHOPPY" && regime !== "VOLATILE") {
      throw new Error("AI response regime is invalid.");
    }
    const overruledSignalsRaw = Array.isArray(candidate.overruledSignals) ? candidate.overruledSignals : [];
    const overruledSignals = overruledSignalsRaw
      .map((item) => String(item ?? "").trim())
      .filter((item) => item.length > 0)
      .slice(0, 4);
    const reasonsRaw = Array.isArray(candidate.reasons) ? candidate.reasons : [];
    const reasons = reasonsRaw
      .map((item) => String(item ?? "").trim())
      .filter((item) => item.length > 0)
      .slice(0, 3);
    if (reasons.length === 0) {
      throw new Error("AI response reasons are missing.");
    }
    const invalidation = String(candidate.invalidation ?? "").trim();
    const riskNote = String(candidate.riskNote ?? "").trim();
    if (!invalidation || !riskNote) {
      throw new Error("AI response invalidation/risk note missing.");
    }

    return {
      bias,
      confidenceBand,
      agreement,
      regime,
      overruledSignals,
      reasons,
      invalidation,
      riskNote
    };
  }
}
