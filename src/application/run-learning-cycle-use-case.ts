import type { AdaptiveLearningService } from "./adaptive-learning-service.js";
import type { GenerateRecommendationUseCase } from "./generate-recommendation-use-case.js";
import type { SelectLearningSymbolsUseCase } from "./select-learning-symbols-use-case.js";
import { resolveAdaptiveTimeframes } from "./timeframe-policy.js";
import { mapWithConcurrency } from "./map-with-concurrency.js";
import type { LoggerPort } from "../ports/logger-port.js";
import type { Recommendation } from "../domain/types.js";

export interface LearningSimulationCandidate {
  pair: string;
  recommendation: Recommendation;
  interval: string;
  horizonMinutes: number;
  openedAtMs: number;
}

export class RunLearningCycleUseCase {
  constructor(
    private readonly logger: LoggerPort,
    private readonly recommendationUseCase: GenerateRecommendationUseCase,
    private readonly learning: AdaptiveLearningService,
    private readonly learningSymbolSelector: Pick<SelectLearningSymbolsUseCase, "execute">
  ) {}

  async execute(input: {
    horizonsMinutes: readonly number[];
    leverage: number;
    positionSizeUsd: number;
    active: () => boolean;
  }): Promise<{ symbols: string[]; candidates: LearningSimulationCandidate[] }> {
    const symbols = await this.learningSymbolSelector.execute({ universeLimit: 15, top: 5 });
    const candidates: LearningSimulationCandidate[] = [];
    const horizonConcurrency = 2;

    for (const symbol of symbols) {
      if (!input.active()) {
        return { symbols, candidates };
      }
      const pair = `${symbol}-USD`;
      const perSymbol = await mapWithConcurrency(
        input.horizonsMinutes,
        horizonConcurrency,
        async (horizonMinutes): Promise<LearningSimulationCandidate | null> => {
          if (!input.active()) {
            return null;
          }
          try {
            const adaptiveTimeframes = resolveAdaptiveTimeframes(String(horizonMinutes));
            // Store raw engine output — no learning policy, no AI.
            // The loop evaluates the engine's signal quality independently.
            const recommendation = await this.recommendationUseCase.execute({
              pair,
              interval: adaptiveTimeframes.timeframe,
              biasInterval: adaptiveTimeframes.biasTimeframe,
              leverage: input.leverage,
              positionSizeUsd: input.positionSizeUsd,
              objectiveHorizon: String(horizonMinutes)
            });

            return {
              pair,
              recommendation,
              interval: adaptiveTimeframes.timeframe,
              horizonMinutes,
              openedAtMs: Date.now()
            };
          } catch (error) {
            const message = error instanceof Error ? error.message : "Learning cycle candidate failed";
            this.logger.error(`[learn] ${message}`);
            return null;
          }
        }
      );
      for (const candidate of perSymbol) {
        if (candidate) {
          candidates.push(candidate);
        }
      }
    }

    return { symbols, candidates };
  }
}
