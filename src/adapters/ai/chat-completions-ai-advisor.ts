import OpenAI from "openai";
import type { AiAdvice, AiAdviceRequest, AiAdvisorPort } from "../../ports/ai-advisor-port.js";

function isOSeriesModel(model: string): boolean {
  return /^o\d/i.test(model);
}

export class ChatCompletionsAiAdvisor implements AiAdvisorPort {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(input?: { apiKey?: string; model?: string; baseUrl?: string; fetch?: typeof globalThis.fetch }) {
    const apiKey = input?.apiKey ?? process.env.OPENAI_API_KEY ?? "";
    this.model = input?.model ?? "";
    this.client = new OpenAI({
      apiKey,
      baseURL: input?.baseUrl,
      maxRetries: 2,
      timeout: 45_000,
      fetch: input?.fetch
    });
  }

  async advise(input: AiAdviceRequest): Promise<AiAdvice> {
    if (!this.client.apiKey) {
      throw new Error("API key is not configured.");
    }
    if (!this.model) {
      throw new Error("AI model is not configured. Set it in Settings.");
    }

    const startedAt = Date.now();

    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(input);

    const requestParams: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model: this.model,
      max_completion_tokens: 1024,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    };

    if (isOSeriesModel(this.model)) {
      (requestParams as unknown as Record<string, unknown>).reasoning_effort = "low";
    } else {
      requestParams.temperature = 0;
    }

    let completion: OpenAI.Chat.ChatCompletion;
    try {
      completion = await this.client.chat.completions.create(requestParams);
    } catch (error) {
      throw this.toAdvisorError(error);
    }

    const choice = completion.choices[0];
    const raw = choice?.message?.content?.trim();
    if (!raw) {
      const finishReason = choice?.finish_reason ?? "unknown";
      const refusal = (choice?.message as unknown as Record<string, unknown>)?.refusal;
      throw new Error(
        `AI response was empty. finish_reason=${finishReason}` +
          (refusal ? ` refusal=${String(refusal)}` : "")
      );
    }

    const parsed = this.parseResponse(raw);
    return {
      ...parsed,
      model: completion.model ?? this.model,
      latencyMs: Date.now() - startedAt
    };
  }

  private buildSystemPrompt(): string {
    return [
      "You are an experienced crypto market structure trader reviewing another trader's setup. Provide a peer-level second opinion — validate, challenge, or reframe. The trader is technical; use precise market structure language.",
      "",
      "How to read the snapshot context:",
      "- oiContext: NEW_LONGS/NEW_SHORTS = fresh directional positioning (squeeze risk if price reverses); SHORT_COVERING/LONG_LIQUIDATION = unwind in progress (fade, not trend)",
      "- cvdDivergence: BULLISH/BEARISH = cumulative delta contradicts price momentum — signals absorption or exhaustion, weight this heavily against the signal direction",
      "- structureBreak: BOS = trend continuation, assess if genuine or liquidity grab; ChoCH = potential reversal, check for confirmation",
      "- session: Asia = range/accumulation, low-conviction breakouts; London = expansion and fakeouts into stops; New York = real directional moves and volatile closes",
      "- tpAnchor: TP is capped at a volume node (VPOC/VAH/VAL) — the path to target has a natural ceiling, factor into R:R quality",
      "- independentChannelAgreement: fraction of scoring channels aligned — below 0.6 means the setup is contested across indicators",
      "",
      "Reasoning priorities (address what's relevant, skip what isn't):",
      "1. Liquidity — who is trapped, where are stop clusters, is there a sweep before the move?",
      "2. Positioning — does OI context + funding + CVD confirm or contradict the signal direction?",
      "3. Structure — is the break genuine or a stop hunt? Is the trend intact?",
      "4. Session — does the session support this setup type right now?",
      "5. R:R — given structure, TP anchor, and invalidation, is the risk worth taking?",
      "",
      "Output rules:",
      "- reasons: up to 4, technical and specific — no generic filler like 'trend is strong'",
      "- overruledSignals: signals or assumptions you disagree with, stated precisely (e.g. 'BOS flagged but looks like stop hunt into equal highs')",
      "- altThesis: your alternative read if agreement is DISAGREE or PARTIAL — what is the market actually doing? Set to null when AGREE",
      "- invalidation: the exact price action or level that kills the thesis, not a vague statement",
      "- riskNote: the single biggest risk the trader may be underweighting",
      "- Only include suggestedEntry/suggestedStopLoss/suggestedTakeProfit when you see a meaningfully better level",
      "",
      "Output only valid compact JSON:",
      '{ "bias":"LONG|SHORT|NO_TRADE", "confidenceBand":"LOW|MEDIUM|HIGH", "suggestedEntry":number|null, "suggestedStopLoss":number|null, "suggestedTakeProfit":number|null, "agreement":"AGREE|DISAGREE|PARTIAL", "regime":"TREND|RANGE|CHOPPY|VOLATILE", "overruledSignals":["..."], "reasons":["...","...","...","..."], "altThesis":"...|null", "invalidation":"...", "riskNote":"..." }'
    ].join("\n");
  }

  private buildUserPrompt(input: AiAdviceRequest): string {
    const snapshot: Record<string, unknown> = {
      pair: input.pair,
      signal: input.signal,
      modelSignal: input.modelSignal,
      requestedDirection: input.requestedDirection,
      confidence: input.confidence,
      setupGrade: input.setupGrade,
      setupQuality: input.setupQuality,
      marketRegime: input.marketRegime,
      marketTradeability: input.marketTradeability,
      riskRewardRatio: input.riskRewardRatio,
      timeframes: `${input.analysisInterval ?? "n/a"} / ${input.analysisBiasInterval ?? "n/a"}`,
      objectiveHorizon: input.objectiveHorizon ?? "n/a",
      levels: {
        entry: input.entry,
        stopLoss: input.stopLoss,
        takeProfit: input.takeProfit,
        tpAnchor: input.tpAnchor,
        expectedLow: input.expectedLow,
        expectedHigh: input.expectedHigh
      },
      indicators: input.indicators,
      perp: input.perp,
      oiContext: input.oiContext,
      cvdDivergence: input.cvdDivergence,
      structureBreak: input.structureBreak,
      session: input.currentSession,
      independentChannelAgreement: input.independentChannelAgreement,
      keyRationale: input.keyRationale
    };

    // Strip undefined/null keys to keep payload compact
    for (const key of Object.keys(snapshot)) {
      if (snapshot[key] === undefined || snapshot[key] === null) {
        delete snapshot[key];
      }
    }
    if (snapshot.levels && typeof snapshot.levels === "object") {
      for (const [k, v] of Object.entries(snapshot.levels as Record<string, unknown>)) {
        if (v === undefined || v === null) {
          delete (snapshot.levels as Record<string, unknown>)[k];
        }
      }
    }

    return `Analyze this trading snapshot and provide a secondary opinion.\n${JSON.stringify(snapshot)}`;
  }

  private toAdvisorError(error: unknown): Error {
    if (error instanceof OpenAI.APIError) {
      const detail = this.extractOpenAiErrorDetail(error.error) ?? error.message;
      return new Error(`OpenAI API ${error.status}: ${detail}`);
    }
    if (error instanceof Error) {
      return error;
    }
    return new Error("AI request failed.");
  }

  private extractOpenAiErrorDetail(errorBody: unknown): string | undefined {
    if (!errorBody || typeof errorBody !== "object") return undefined;
    const rec = errorBody as Record<string, unknown>;
    const msg = rec.message ?? (rec.error as Record<string, unknown> | undefined)?.message;
    if (typeof msg === "string" && msg.trim()) return msg.trim();
    return undefined;
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
      .slice(0, 4);
    if (reasons.length === 0) {
      throw new Error("AI response reasons are missing.");
    }
    const altThesisRaw = candidate.altThesis;
    const altThesis =
      altThesisRaw !== null && altThesisRaw !== undefined && String(altThesisRaw).trim().length > 0
        ? String(altThesisRaw).trim()
        : undefined;
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
      altThesis,
      invalidation,
      riskNote
    };
  }

  private toOptionalFiniteNumber(value: unknown): number | undefined {
    if (value === null || value === undefined || value === "") return undefined;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : undefined;
  }
}
