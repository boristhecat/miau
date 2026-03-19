import Anthropic from "@anthropic-ai/sdk";
import type { AiAdvice, AiAdviceRequest, AiAdvisorPort } from "../../ports/ai-advisor-port.js";
import { buildSystemPrompt, buildUserPrompt } from "./ai-prompt-builder.js";
import { parseAiResponse } from "./ai-response-parser.js";

const THINKING_BUDGET_TOKENS = 1024;
const MAX_TOKENS = 3072; // must exceed thinking budget when extended thinking is enabled

function isThinkingModel(model: string): boolean {
  // claude-3-7-* and future models that support extended thinking
  return /claude-3-7/i.test(model);
}

export class AnthropicAdvisor implements AiAdvisorPort {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(input: { apiKey?: string; model: string }) {
    this.model = input.model;
    this.client = new Anthropic({
      apiKey: input.apiKey ?? "",
      maxRetries: 2,
      timeout: 45_000
    });
  }

  async advise(input: AiAdviceRequest): Promise<AiAdvice> {
    if (!this.client.apiKey) throw new Error("Anthropic API key is not configured.");
    if (!this.model) throw new Error("AI model is not configured. Set it in Settings.");

    const startedAt = Date.now();

    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: this.model,
      max_tokens: MAX_TOKENS,
      system: buildSystemPrompt(),
      messages: [{ role: "user", content: buildUserPrompt(input) }]
    };

    if (isThinkingModel(this.model)) {
      (params as unknown as Record<string, unknown>).thinking = {
        type: "enabled",
        budget_tokens: THINKING_BUDGET_TOKENS
      };
    }

    let message: Anthropic.Message;
    try {
      message = await this.client.messages.create(params);
    } catch (error) {
      throw toAnthropicError(error);
    }

    const raw = extractTextContent(message);
    if (!raw) {
      throw new Error(`Anthropic response was empty. stop_reason=${message.stop_reason ?? "unknown"}`);
    }

    return {
      ...parseAiResponse(raw),
      model: message.model ?? this.model,
      latencyMs: Date.now() - startedAt
    };
  }
}

function extractTextContent(message: Anthropic.Message): string | undefined {
  for (const block of message.content) {
    if (block.type === "text") return block.text.trim() || undefined;
  }
  return undefined;
}

function toAnthropicError(error: unknown): Error {
  if (error instanceof Anthropic.APIError) {
    return new Error(`Anthropic API ${error.status}: ${error.message}`);
  }
  return error instanceof Error ? error : new Error("Anthropic request failed.");
}
