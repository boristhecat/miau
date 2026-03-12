import type { AdaptiveLearningService } from "./adaptive-learning-service.js";
import {
  RankTopOpportunitiesUseCase,
  type RecommendationGenerator,
  type SymbolUniverseProvider,
  type TopOpportunitiesResult
} from "./rank-top-opportunities-use-case.js";
import { resolveAdaptiveTimeframes } from "./timeframe-policy.js";
import type { MarketDataPort } from "../ports/market-data-port.js";

export interface RankingDefaults {
  leverage: number;
  positionSizeUsd: number;
  objectiveHorizon: string;
}

export interface RecommendationRankingResult {
  adaptiveTimeframes: { timeframe: string; biasTimeframe: string };
  universe: Array<{ symbol: string; quoteVolume24h: number; openInterest: number }>;
  opportunities: TopOpportunitiesResult;
}

export type RankTopOpportunitiesFactory = (
  recommendationGenerator: RecommendationGenerator,
  symbolUniverseProvider: SymbolUniverseProvider
) => Pick<RankTopOpportunitiesUseCase, "execute">;

/** Phase 3b: Liquid asset whitelist — focus on highest-liquidity assets for maximum edge */
export const LIQUID_ASSET_WHITELIST = new Set(["BTC", "ETH", "SOL", "AVAX"]);

export class RunRecommendationRankingUseCase {
  constructor(
    private readonly recommendationUseCase: RecommendationGenerator,
    private readonly learning: AdaptiveLearningService,
    private readonly marketData: MarketDataPort,
    private readonly rankTopOpportunitiesFactory: RankTopOpportunitiesFactory
  ) {}

  async execute(input: { defaults: RankingDefaults; top?: number; universeLimit?: number }): Promise<RecommendationRankingResult> {
    const universeLimit = input.universeLimit ?? 15;
    const top = input.top ?? 5;
    const adaptiveTimeframes = resolveAdaptiveTimeframes(input.defaults.objectiveHorizon);
    const allSelected = await this.marketData.getTopPerpSymbolsByVolumeWithOpenInterest(universeLimit);
    const selected = allSelected.filter((item) => LIQUID_ASSET_WHITELIST.has(item.symbol));

    const learningAwareGenerator: RecommendationGenerator = {
      execute: async (request) => {
        const recommendation = await this.recommendationUseCase.execute(request);
        return this.learning.applyPolicy({
          recommendation,
          timeframe: request.interval ?? adaptiveTimeframes.timeframe
        });
      }
    };

    const rankUseCase = this.rankTopOpportunitiesFactory(learningAwareGenerator, this.marketData);
    const opportunities = await rankUseCase.execute({
      symbols: selected.map((item) => item.symbol),
      interval: adaptiveTimeframes.timeframe,
      biasInterval: adaptiveTimeframes.biasTimeframe,
      leverage: input.defaults.leverage,
      positionSizeUsd: input.defaults.positionSizeUsd,
      objectiveHorizon: input.defaults.objectiveHorizon,
      top
    });

    return {
      adaptiveTimeframes: {
        timeframe: adaptiveTimeframes.timeframe,
        biasTimeframe: adaptiveTimeframes.biasTimeframe
      },
      universe: selected,
      opportunities
    };
  }
}
