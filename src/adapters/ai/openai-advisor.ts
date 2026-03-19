import OpenAI from "openai";
import type { AiAdvice, AiAdviceRequest, AiAdvisorPort } from "../../ports/ai-advisor-port.js";
import { buildSystemPrompt, buildUserPrompt } from "./ai-prompt-builder.js";
import { parseAiResponse } from "./ai-response-parser.js";

const OPENAI_BASE_URL = "https://api.openai.com/v1";

function isOSeriesModel(model: string): boolean {
  return /^o\d/i.test(model);
}

export class OpenAiAdvisor implements AiAdvisorPort {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(input: { apiKey?: string; model: string; fetch?: typeof globalThis.fetch }) {
    this.model = input.model;
    this.client = new OpenAI({
      apiKey: input.apiKey ?? "",
      baseURL: OPENAI_BASE_URL,
      maxRetries: 2,
      timeout: 45_000,
      fetch: input.fetch
    });
  }

  async advise(input: AiAdviceRequest): Promise<AiAdvice> {
    if (!this.client.apiKey) throw new Error("OpenAI API key is not configured.");
    if (!this.model) throw new Error("AI model is not configured. Set it in Settings.");

    const startedAt = Date.now();

    const requestParams: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model: this.model,
      max_completion_tokens: 1024,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: buildUserPrompt(input) }
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
      throw toOpenAiError(error);
    }

    const choice = completion.choices[0];
    const raw = choice?.message?.content?.trim();
    if (!raw) {
      const finishReason = choice?.finish_reason ?? "unknown";
      const refusal = (choice?.message as unknown as Record<string, unknown>)?.refusal;
      throw new Error(
        `OpenAI response was empty. finish_reason=${finishReason}` +
          (refusal ? ` refusal=${String(refusal)}` : "")
      );
    }

    return {
      ...parseAiResponse(raw),
      model: completion.model ?? this.model,
      latencyMs: Date.now() - startedAt
    };
  }
}

function toOpenAiError(error: unknown): Error {
  if (error instanceof OpenAI.APIError) {
    const detail = extractOpenAiErrorDetail(error.error) ?? error.message;
    return new Error(`OpenAI API ${error.status}: ${detail}`);
  }
  return error instanceof Error ? error : new Error("OpenAI request failed.");
}

function extractOpenAiErrorDetail(errorBody: unknown): string | undefined {
  if (!errorBody || typeof errorBody !== "object") return undefined;
  const rec = errorBody as Record<string, unknown>;
  const msg = rec.message ?? (rec.error as Record<string, unknown> | undefined)?.message;
  return typeof msg === "string" && msg.trim() ? msg.trim() : undefined;
}
