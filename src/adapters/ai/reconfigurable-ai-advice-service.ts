import type { Recommendation } from "../../domain/types.js";
import type { AiAdvice } from "../../ports/ai-advisor-port.js";
import type { IGenerateAiAdviceUseCase } from "../../application/use-case-interfaces.js";
import { GenerateAiAdviceUseCase } from "../../application/generate-ai-advice-use-case.js";
import { createAiAdvisor, type AiProviderConfig } from "./ai-advisor-factory.js";

export type { AiProviderConfig };

export class ReconfigurableAiAdviceService implements IGenerateAiAdviceUseCase {
  private inner: GenerateAiAdviceUseCase;

  constructor(config: AiProviderConfig) {
    this.inner = this.build(config);
  }

  setProvider(config: AiProviderConfig): void {
    this.inner = this.build(config);
  }

  async execute(input: { recommendation: Recommendation }): Promise<AiAdvice> {
    return this.inner.execute(input);
  }

  private build(config: AiProviderConfig): GenerateAiAdviceUseCase {
    return new GenerateAiAdviceUseCase({ aiAdvisor: createAiAdvisor(config) });
  }
}
