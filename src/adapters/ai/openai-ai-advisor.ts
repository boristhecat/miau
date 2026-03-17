import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AiAdvice, AiAdviceRequest, AiAdvisorPort } from "../../ports/ai-advisor-port.js";
import type { HttpClient } from "../http/http-client.js";
import { AxiosHttpClient } from "../http/axios-http-client.js";

interface OpenAiChatCompletionResponse {
  model?: string;
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?:
        | string
        | Array<{
            type?: string;
            text?: string;
          }>
        | null;
      refusal?: string | null;
    };
  }>;
}

export class OpenAiAiAdvisor implements AiAdvisorPort {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly httpClient: HttpClient;
  private readonly errorLogFilePath: string;

  constructor(input?: { apiKey?: string; model?: string; httpClient?: HttpClient; errorLogFilePath?: string }) {
    this.apiKey = input?.apiKey ?? process.env.OPENAI_API_KEY ?? "";
    this.model = input?.model ?? process.env.MIAU_AI_MODEL ?? "gpt-5-mini";
    this.httpClient = input?.httpClient ?? new AxiosHttpClient("https://api.openai.com");
    this.errorLogFilePath = input?.errorLogFilePath ?? path.join(process.cwd(), "data", "openai-http-errors.log");
  }

  async advise(input: AiAdviceRequest): Promise<AiAdvice> {
    if (!this.apiKey) {
      throw new Error("OPENAI_API_KEY is not configured.");
    }

    const startedAt = Date.now();
    const prompt = this.buildPrompt(input);
    let response: OpenAiChatCompletionResponse;
    try {
      response = await this.requestChatCompletion({
        model: this.model,
        prompt
      });
    } catch (error) {
      throw this.toOpenAiError(error);
    }

    const raw = this.extractMessageText(response);
    if (!raw) {
      const choice = response.choices?.[0];
      const refusal = choice?.message?.refusal;
      const finishReason = choice?.finish_reason ?? "unknown";
      throw new Error(
        `AI response was empty. finish_reason=${finishReason}` + (refusal ? ` refusal=${refusal}` : "")
      );
    }

    const parsed = this.parseResponse(raw);
    return {
      ...parsed,
      model: response.model ?? this.model,
      latencyMs: Date.now() - startedAt
    };
  }

  private async requestChatCompletion(input: {
    model: string;
    prompt: string;
  }): Promise<OpenAiChatCompletionResponse> {
    const body: Record<string, unknown> = {
      model: input.model,
      reasoning_effort: "low",
      max_completion_tokens: 1024,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a cautious crypto assistant. Return compact JSON only with keys: bias, confidenceBand, suggestedEntry, suggestedStopLoss, suggestedTakeProfit, agreement, regime, overruledSignals, reasons, invalidation, riskNote."
        },
        {
          role: "user",
          content: input.prompt
        }
      ]
    };

    return this.httpClient.post<OpenAiChatCompletionResponse>({
      url: "/v1/chat/completions",
      body,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`
      }
    }).catch(async (error: unknown) => {
      await this.logHttpError({
        url: "/v1/chat/completions",
        body,
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer ***redacted***"
        },
        error
      });
      throw error;
    });
  }

  private toOpenAiError(error: unknown): Error {
    if (!error || typeof error !== "object") {
      return new Error("OpenAI request failed.");
    }
    const candidate = error as {
      message?: unknown;
      response?: {
        status?: unknown;
        data?: unknown;
      };
    };
    const status = typeof candidate.response?.status === "number" ? candidate.response.status : undefined;
    const detail = this.extractErrorDetail(candidate.response?.data);
    if (status !== undefined && detail) {
      return new Error(`OpenAI API ${status}: ${detail}`);
    }
    if (status !== undefined) {
      const fallbackMessage = typeof candidate.message === "string" ? candidate.message : "Request failed.";
      return new Error(`OpenAI API ${status}: ${fallbackMessage}`);
    }
    if (typeof candidate.message === "string" && candidate.message.trim().length > 0) {
      return new Error(candidate.message);
    }
    return new Error("OpenAI request failed.");
  }

  private extractErrorDetail(data: unknown): string | undefined {
    if (!data || typeof data !== "object") {
      return undefined;
    }
    const asRecord = data as Record<string, unknown>;
    const errorNode = asRecord.error;
    if (errorNode && typeof errorNode === "object") {
      const message = (errorNode as Record<string, unknown>).message;
      if (typeof message === "string" && message.trim().length > 0) {
        return message.trim();
      }
    }
    const message = asRecord.message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message.trim();
    }
    return undefined;
  }

  private async logHttpError(input: {
    url: string;
    body: Record<string, unknown>;
    headers: Record<string, string>;
    error: unknown;
  }): Promise<void> {
    const candidate = (input.error ?? {}) as {
      message?: unknown;
      name?: unknown;
      stack?: unknown;
      code?: unknown;
      response?: {
        status?: unknown;
        statusText?: unknown;
        data?: unknown;
        headers?: unknown;
      };
      config?: {
        baseURL?: unknown;
        url?: unknown;
        method?: unknown;
        timeout?: unknown;
      };
    };
    const sanitizedBody = this.sanitizeRequestBody(input.body);
    const entry = {
      timestamp: new Date().toISOString(),
      request: {
        url: input.url,
        headers: input.headers,
        body: sanitizedBody
      },
      error: {
        name: typeof candidate.name === "string" ? candidate.name : undefined,
        message: typeof candidate.message === "string" ? candidate.message : String(candidate.message ?? "Unknown error"),
        code: typeof candidate.code === "string" ? candidate.code : undefined,
        stack: typeof candidate.stack === "string" ? candidate.stack : undefined,
        response: {
          status: typeof candidate.response?.status === "number" ? candidate.response.status : undefined,
          statusText: typeof candidate.response?.statusText === "string" ? candidate.response.statusText : undefined,
          headers: candidate.response?.headers,
          data: candidate.response?.data
        },
        axiosConfig: {
          baseURL: typeof candidate.config?.baseURL === "string" ? candidate.config.baseURL : undefined,
          url: typeof candidate.config?.url === "string" ? candidate.config.url : undefined,
          method: typeof candidate.config?.method === "string" ? candidate.config.method : undefined,
          timeout: typeof candidate.config?.timeout === "number" ? candidate.config.timeout : undefined
        }
      }
    };
    try {
      await mkdir(path.dirname(this.errorLogFilePath), { recursive: true });
      await this.rotateErrorLogIfNeeded();
      await appendFile(this.errorLogFilePath, `${JSON.stringify(entry, null, 2)}\n\n`, "utf8");
    } catch {
      // Logging failures must never break runtime flow.
    }
  }

  private sanitizeRequestBody(body: Record<string, unknown>): Record<string, unknown> {
    const safe: Record<string, unknown> = {
      model: body.model,
      reasoning_effort: body.reasoning_effort,
      max_completion_tokens: body.max_completion_tokens,
      response_format: body.response_format
    };
    const messagesRaw = body.messages;
    if (Array.isArray(messagesRaw)) {
      safe.messages = messagesRaw.map((message) => {
        if (!message || typeof message !== "object") {
          return { role: "unknown" };
        }
        const asRecord = message as Record<string, unknown>;
        const role = typeof asRecord.role === "string" ? asRecord.role : "unknown";
        const content = typeof asRecord.content === "string" ? asRecord.content : JSON.stringify(asRecord.content ?? "");
        return {
          role,
          contentChars: content.length,
          contentPreview: content.slice(0, 240)
        };
      });
    }
    return safe;
  }

  private async rotateErrorLogIfNeeded(): Promise<void> {
    const maxBytes = 2 * 1024 * 1024;
    const keepBytes = 1 * 1024 * 1024;
    let size = 0;
    try {
      const info = await stat(this.errorLogFilePath);
      size = info.size;
    } catch {
      return;
    }
    if (size <= maxBytes) {
      return;
    }
    try {
      const current = await readFile(this.errorLogFilePath, "utf8");
      const trimmed = current.slice(-keepBytes);
      await writeFile(this.errorLogFilePath, trimmed, "utf8");
    } catch {
      // Ignore log rotation failures to keep runtime non-blocking.
    }
  }

  private extractMessageText(response: OpenAiChatCompletionResponse): string | undefined {
    const message = response.choices?.[0]?.message;
    const content = message?.content;
    if (typeof content === "string") {
      const trimmed = content.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }
    if (Array.isArray(content)) {
      const text = content
        .filter((part) => part && typeof part === "object")
        .map((part) => (typeof part.text === "string" ? part.text.trim() : ""))
        .filter((part) => part.length > 0)
        .join("\n")
        .trim();
      return text.length > 0 ? text : undefined;
    }
    return undefined;
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
      "- Compare your view with the final signal (not modelSignal) and state agreement clearly.",
      "- Do not echo snapshot fields verbatim (like modelSignal, pair, or unchanged levels) into reasons/overruledSignals unless essential.",
      "- Only include suggestedEntry/suggestedStopLoss/suggestedTakeProfit when you actually propose a changed value.",
      "- Output only valid JSON.",
      "Schema:",
      '{ "bias":"LONG|SHORT|NO_TRADE", "confidenceBand":"LOW|MEDIUM|HIGH", "suggestedEntry":number|null, "suggestedStopLoss":number|null, "suggestedTakeProfit":number|null, "agreement":"AGREE|DISAGREE|PARTIAL", "regime":"TREND|RANGE|CHOPPY|VOLATILE", "overruledSignals":["..."], "reasons":["...","...","..."], "invalidation":"...", "riskNote":"..." }',
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
    const suggestedEntry = this.toOptionalFiniteNumber(candidate.suggestedEntry);
    const suggestedStopLoss = this.toOptionalFiniteNumber(candidate.suggestedStopLoss);
    const suggestedTakeProfit = this.toOptionalFiniteNumber(candidate.suggestedTakeProfit);
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
      suggestedEntry,
      suggestedStopLoss,
      suggestedTakeProfit,
      agreement,
      regime,
      overruledSignals,
      reasons,
      invalidation,
      riskNote
    };
  }

  private toOptionalFiniteNumber(value: unknown): number | undefined {
    if (value === null || value === undefined || value === "") {
      return undefined;
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return undefined;
    }
    return numeric;
  }

}
