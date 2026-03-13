import type { Recommendation } from "../domain/types.js";
import type { IAdaptiveLearningService, IGenerateRecommendationUseCase } from "./use-case-interfaces.js";
import { resolveAdaptiveTimeframes } from "./timeframe-policy.js";

export class LearningAwareRecommendationGenerator {
  constructor(
    private readonly recommendationUseCase: IGenerateRecommendationUseCase,
    private readonly learning: IAdaptiveLearningService
  ) {}

  async execute(
    input: Parameters<IGenerateRecommendationUseCase["execute"]>[0]
  ): Promise<Recommendation> {
    const recommendation = await this.recommendationUseCase.execute(input);
    const timeframe =
      input.interval ??
      resolveAdaptiveTimeframes(input.expectedRangeHorizon ?? input.objectiveHorizon).timeframe;

    return this.learning.applyPolicy({
      recommendation,
      timeframe
    });
  }
}
