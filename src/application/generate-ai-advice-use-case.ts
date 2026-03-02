import type { Recommendation } from "../domain/types.js";
import type { AiAdvice, AiAdvisorPort } from "../ports/ai-advisor-port.js";
import { toAiAdviceRequest } from "./recommendation-mappers.js";

interface Deps {
  aiAdvisor: AiAdvisorPort;
}

export class GenerateAiAdviceUseCase {
  constructor(private readonly deps: Deps) {}

  async execute(input: { recommendation: Recommendation }): Promise<AiAdvice> {
    const advice = await this.deps.aiAdvisor.advise(toAiAdviceRequest(input.recommendation));
    return advice;
  }
}
