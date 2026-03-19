import type { Recommendation } from "../../domain/types.js";
import type { AiAdvice } from "../../ports/ai-advisor-port.js";
import type { IGenerateAiAdviceUseCase } from "../../application/use-case-interfaces.js";
import { GenerateAiAdviceUseCase } from "../../application/generate-ai-advice-use-case.js";
import { ChatCompletionsAiAdvisor } from "./chat-completions-ai-advisor.js";

export interface AiProviderConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
}

export class ReconfigurableAiAdviceService implements IGenerateAiAdviceUseCase {
  private inner: GenerateAiAdviceUseCase;
  private config: AiProviderConfig;

  constructor(config: AiProviderConfig) {
    this.config = config;
    this.inner = this.build(config);
  }

  setModel(model: string): void {
    this.config = { ...this.config, model };
    this.inner = this.build(this.config);
  }

  setProvider(config: AiProviderConfig): void {
    this.config = config;
    this.inner = this.build(config);
  }

  async execute(input: { recommendation: Recommendation }): Promise<AiAdvice> {
    return this.inner.execute(input);
  }

  private build(config: AiProviderConfig): GenerateAiAdviceUseCase {
    return new GenerateAiAdviceUseCase({
      aiAdvisor: new ChatCompletionsAiAdvisor({
        model: config.model,
        baseUrl: config.baseUrl,
        apiKey: config.apiKey
      })
    });
  }
}
