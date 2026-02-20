import type { AdaptiveLearningService } from "./adaptive-learning-service.js";
import type { GenerateRecommendationUseCase } from "./generate-recommendation-use-case.js";
import { RankTopOpportunitiesUseCase } from "./rank-top-opportunities-use-case.js";
import { resolveAdaptiveTimeframes } from "./timeframe-policy.js";
import type { LoggerPort } from "../ports/logger-port.js";
import type { MarketDataPort } from "../ports/market-data-port.js";
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
    private readonly marketData: MarketDataPort,
    private readonly learning: AdaptiveLearningService
  ) {}

  async execute(input: {
    horizonsMinutes: readonly number[];
    leverage: number;
    positionSizeUsd: number;
    active: () => boolean;
  }): Promise<{ symbols: string[]; candidates: LearningSimulationCandidate[] }> {
    const symbols = await this.getLearningSymbols();
    const candidates: LearningSimulationCandidate[] = [];

    for (const symbol of symbols) {
      const pair = `${symbol}-USD`;
      for (const horizonMinutes of input.horizonsMinutes) {
        if (!input.active()) {
          return { symbols, candidates };
        }
        try {
          const adaptiveTimeframes = resolveAdaptiveTimeframes(String(horizonMinutes));
          let recommendation = await this.recommendationUseCase.execute({
            pair,
            interval: adaptiveTimeframes.timeframe,
            biasInterval: adaptiveTimeframes.biasTimeframe,
            leverage: input.leverage,
            positionSizeUsd: input.positionSizeUsd,
            objectiveHorizon: String(horizonMinutes)
          });
          recommendation = await this.learning.applyPolicy({
            recommendation,
            timeframe: adaptiveTimeframes.timeframe
          });

          candidates.push({
            pair,
            recommendation,
            interval: adaptiveTimeframes.timeframe,
            horizonMinutes,
            openedAtMs: Date.now()
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Learning cycle candidate failed";
          this.logger.error(`[learn] ${message}`);
        }
      }
    }

    return { symbols, candidates };
  }

  private async getLearningSymbols(): Promise<string[]> {
    const rankUseCase = new RankTopOpportunitiesUseCase(this.recommendationUseCase, this.marketData);
    const selected = await this.marketData.getTopPerpSymbolsByVolumeWithOpenInterest(15);
    const result = await rankUseCase.execute({
      symbols: selected.map((item) => item.symbol),
      top: 5
    });
    const ranked = result.ranked.map((row) => row.symbol);
    if (ranked.length > 0) {
      return ranked;
    }
    return selected.slice(0, 5).map((item) => item.symbol);
  }
}
