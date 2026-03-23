import type { Recommendation } from "../domain/types.js";
import { parseIntervalToMinutes } from "../domain/interval-utils.js";
import { buildFibLevels } from "../domain/fib-levels.js";
import type { IndicatorCalculatorPort } from "../ports/indicator-calculator-port.js";
import type { MarketDataPort } from "../ports/market-data-port.js";
import type { RecommendationPolicyPort } from "../ports/recommendation-policy-port.js";
import { inferBiasContext } from "../domain/recommendation-signal-evaluator.js";
import { selectMtfTimeframes } from "../domain/mtf-context-analyzer.js";
import { resolveFibTimeframe } from "./timeframe-policy.js";

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
    const requestedLimit = input.limit ?? 180;
    const limit = resolveStructureAwareLimit(interval, requestedLimit);
    const intervalMins = parseIntervalToMinutes(interval);
    const biasIntervalMins = parseIntervalToMinutes(biasInterval);

    // Plan 8: Select MTF structure timeframe for cascade analysis
    const objectiveHorizonMinutes = input.objectiveHorizon ? Number(input.objectiveHorizon) : undefined;
    const mtfTimeframes = selectMtfTimeframes({
      executionInterval: interval,
      objectiveHorizonMinutes: Number.isFinite(objectiveHorizonMinutes) ? objectiveHorizonMinutes : undefined
    });
    const structureInterval = mtfTimeframes.structureInterval;
    const needsStructureCandles = structureInterval !== interval && structureInterval !== biasInterval;

    // Fib timeframe resolution
    const fibInterval = resolveFibTimeframe(input.objectiveHorizon);
    const needsFibCandles = fibInterval !== interval && fibInterval !== biasInterval
      && (!needsStructureCandles || fibInterval !== structureInterval);

    const [candles, biasCandles, btcCandles, structureCandles, fibCandles] = await Promise.all([
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
        : Promise.resolve(null),
      needsStructureCandles
        ? this.deps.marketData.getCandles({ pair: input.pair, interval: structureInterval, limit }).catch(() => null)
        : Promise.resolve(null),
      needsFibCandles
        ? this.deps.marketData.getCandles({ pair: input.pair, interval: fibInterval, limit }).catch(() => null)
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
    // Plan 8: Compute structure timeframe indicators for MTF cascade
    let structureIndicators: import("../domain/types.js").IndicatorSnapshot | undefined;
    let resolvedStructureInterval: string | undefined;
    if (structureCandles && structureCandles.length >= 60) {
      const structureIntervalMins = parseIntervalToMinutes(structureInterval);
      structureIndicators = this.deps.indicatorService.calculate(structureCandles, structureIntervalMins);
      resolvedStructureInterval = structureInterval;
    } else if (biasCandles && biasInterval !== interval) {
      // Fall back to bias candles as the structure TF if dedicated fetch failed
      structureIndicators = biasIndicators;
      resolvedStructureInterval = biasInterval;
    }

    // Fib levels: resolve candles for the fib interval, preferring dedicated fetch
    const resolvedFibCandles = fibCandles
      ?? (fibInterval === biasInterval ? biasCandles : null)
      ?? (fibInterval === interval ? candles : null)
      ?? (fibInterval === structureInterval ? structureCandles : null);
    const lastPrice = candles[candles.length - 1]!.close;
    const fibLevels = resolvedFibCandles && resolvedFibCandles.length >= 5
      ? buildFibLevels(resolvedFibCandles, lastPrice, fibInterval)
      : null;

    const perp = await this.deps.marketData.getPerpSnapshot({ pair: input.pair });

    const baseRec = this.deps.recommendationEngine.build({
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
      btcContext,
      structureIndicators: resolvedStructureInterval ? structureIndicators : undefined,
      structureInterval: resolvedStructureInterval
    });

    return fibLevels ? { ...baseRec, fibLevels } : baseRec;
  }
}

function resolveStructureAwareLimit(interval: string, requestedLimit: number): number {
  const intervalMinutes = parseIntervalToMinutes(interval);
  const targetLookbackMinutes = 24 * 60;
  const requiredForStructure = Math.ceil(targetLookbackMinutes / Math.max(intervalMinutes, 1));
  return Math.max(requestedLimit, Math.min(requiredForStructure, 720));
}
