import { IndicatorService } from "../domain/indicator-service.js";
import { RecommendationEngine } from "../domain/recommendation-engine.js";
import type { Recommendation } from "../domain/types.js";
import type { MarketDataPort } from "../ports/market-data-port.js";

interface UseCaseDeps {
  marketData: MarketDataPort;
  indicatorService: IndicatorService;
  recommendationEngine: RecommendationEngine;
}

export class GenerateRecommendationUseCase {
  constructor(private readonly deps: UseCaseDeps) {}

  async execute(input: {
    pair: string;
    interval?: string;
    limit?: number;
    leverage?: number;
    positionSizeUsd?: number;
  }): Promise<Recommendation> {
    const interval = input.interval ?? "1h";
    const limit = input.limit ?? 120;

    const candles = await this.deps.marketData.getCandles({
      pair: input.pair,
      interval,
      limit
    });

    if (candles.length === 0) {
      throw new Error("No candle data returned from market source.");
    }

    const indicators = this.deps.indicatorService.calculate(candles);
    const lastPrice = candles[candles.length - 1]!.close;
    const perp = await this.deps.marketData.getPerpSnapshot({ pair: input.pair });

    return this.deps.recommendationEngine.build({
      pair: input.pair,
      lastPrice,
      indicators,
      perp,
      leverage: input.leverage,
      positionSizeUsd: input.positionSizeUsd
    });
  }
}
