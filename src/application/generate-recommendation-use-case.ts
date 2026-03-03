import type { Recommendation } from "../domain/types.js";
import { parseIntervalToMinutes } from "../domain/interval-utils.js";
import type { IndicatorCalculatorPort } from "../ports/indicator-calculator-port.js";
import type { MarketDataPort } from "../ports/market-data-port.js";
import type { RecommendationPolicyPort } from "../ports/recommendation-policy-port.js";
import { inferBiasContext } from "../domain/recommendation-signal-evaluator.js";

interface UseCaseDeps {
  marketData: MarketDataPort;
  indicatorService: IndicatorCalculatorPort;
  recommendationEngine: RecommendationPolicyPort;
}

export class GenerateRecommendationUseCase {
  constructor(private readonly deps: UseCaseDeps) {}

  async execute(input: {
    pair: string;
    forcedDirection?: "LONG" | "SHORT";
    expectedRangeHorizon?: string;
    interval?: string;
    biasInterval?: string;
    limit?: number;
    leverage?: number;
    positionSizeUsd?: number;
    slPct?: number;
    tpPct?: number;
    slUsd?: number;
    tpUsd?: number;
    objectiveHorizon?: string;
  }): Promise<Recommendation> {
    const interval = input.interval ?? "1m";
    const biasInterval = input.biasInterval ?? "15m";
    const limit = input.limit ?? 180;
    const intervalMins = parseIntervalToMinutes(interval);
    const biasIntervalMins = parseIntervalToMinutes(biasInterval);

    const [candles, biasCandles, btcCandles] = await Promise.all([
      this.deps.marketData.getCandles({
        pair: input.pair,
        interval,
        limit
      }),
      biasInterval === interval
        ? Promise.resolve(null)
        : this.deps.marketData.getCandles({
            pair: input.pair,
            interval: biasInterval,
            limit
          }),
      input.pair !== "BTC-USD"
        ? this.deps.marketData.getCandles({ pair: "BTC-USD", interval, limit }).catch(() => null)
        : Promise.resolve(null)
    ]);

    if (candles.length === 0) {
      throw new Error("No candle data returned from market source.");
    }

    const resolvedBiasCandles = biasCandles ?? candles;
    const indicators = this.deps.indicatorService.calculate(candles, intervalMins);
    const biasIndicators = this.deps.indicatorService.calculate(resolvedBiasCandles, biasIntervalMins);
    const biasContext = inferBiasContext(biasIndicators);
    let btcContext: { emaAbove: boolean; momentumPositive: boolean } | undefined;
    if (btcCandles && btcCandles.length >= 60) {
      const btcIndicators = this.deps.indicatorService.calculate(btcCandles, intervalMins);
      btcContext = {
        emaAbove: btcIndicators.ema20 >= btcIndicators.ema50,
        momentumPositive: btcIndicators.macdHistogram > 0
      };
    }
    const lastPrice = candles[candles.length - 1]!.close;
    const perp = await this.deps.marketData.getPerpSnapshot({ pair: input.pair });

    return this.deps.recommendationEngine.build({
      pair: input.pair,
      lastPrice,
      indicators,
      perp,
      leverage: input.leverage,
      positionSizeUsd: input.positionSizeUsd,
      slPct: input.slPct,
      tpPct: input.tpPct,
      slUsd: input.slUsd,
      tpUsd: input.tpUsd,
      objectiveHorizon: input.objectiveHorizon,
      expectedRangeHorizon: input.expectedRangeHorizon,
      forcedDirection: input.forcedDirection,
      baseInterval: interval,
      biasContext,
      biasInterval,
      btcContext
    });
  }
}
