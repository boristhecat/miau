import type { AiAdvisorPort } from "../../ports/ai-advisor-port.js";
import { OpenAiAdvisor } from "./openai-advisor.js";
import { AnthropicAdvisor } from "./anthropic-advisor.js";

export type AiProviderType = "openai" | "anthropic";

export interface AiProviderConfig {
  provider: AiProviderType;
  model: string;
  apiKey?: string;
}

export function createAiAdvisor(config: AiProviderConfig): AiAdvisorPort {
  switch (config.provider) {
    case "openai":
      return new OpenAiAdvisor({ model: config.model, apiKey: config.apiKey });
    case "anthropic":
      return new AnthropicAdvisor({ model: config.model, apiKey: config.apiKey });
  }
}
