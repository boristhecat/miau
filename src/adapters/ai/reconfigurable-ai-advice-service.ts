import type { Recommendation } from "../../domain/types.js";
import type { AiAdvice } from "../../ports/ai-advisor-port.js";
import type { IGenerateAiAdviceUseCase } from "../../application/use-case-interfaces.js";
import { GenerateAiAdviceUseCase } from "../../application/generate-ai-advice-use-case.js";
import { OpenAiAiAdvisor } from "./openai-ai-advisor.js";
import { AxiosHttpClient } from "../http/axios-http-client.js";

export class ReconfigurableAiAdviceService implements IGenerateAiAdviceUseCase {
  private inner: GenerateAiAdviceUseCase;

  constructor(
    private readonly baseUrl: string,
    private model: string
  ) {
    this.inner = this.build(model);
  }

  setModel(model: string): void {
    this.model = model;
    this.inner = this.build(model);
  }

  async execute(input: { recommendation: Recommendation }): Promise<AiAdvice> {
    return this.inner.execute(input);
  }

  private build(model: string): GenerateAiAdviceUseCase {
    return new GenerateAiAdviceUseCase({
      aiAdvisor: new OpenAiAiAdvisor({
        model,
        httpClient: new AxiosHttpClient(this.baseUrl, undefined, { timeoutMs: 45_000 })
      })
    });
  }
}
