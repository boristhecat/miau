import type { Candle, PerpMarketSnapshot } from "../../domain/types.js";
import type { MarketDataPort } from "../../ports/market-data-port.js";
import type { BinancePerpDataClient } from "./binance-perp-data-client.js";
import type { BybitPerpDataClient } from "./bybit-perp-data-client.js";
import { toLinearSymbol } from "./cross-venue-symbol-mapper.js";

const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  snapshot: PerpMarketSnapshot;
  expiresAtMs: number;
}

export class AggregatedMarketDataClient implements MarketDataPort {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly primary: MarketDataPort,
    private readonly binance: BinancePerpDataClient,
    private readonly bybit: BybitPerpDataClient
  ) {}

  getCandles(params: { pair: string; interval: string; limit: number }): Promise<Candle[]> {
    return this.primary.getCandles(params);
  }

  getTopPerpSymbolsByVolume(limit: number): Promise<string[]> {
    return this.primary.getTopPerpSymbolsByVolume(limit);
  }

  getTopPerpSymbolsByVolumeWithOpenInterest(
    limit: number
  ): Promise<Array<{ symbol: string; quoteVolume24h: number; openInterest: number }>> {
    return this.primary.getTopPerpSymbolsByVolumeWithOpenInterest(limit);
  }

  async getPerpSnapshot(params: { pair: string }): Promise<PerpMarketSnapshot> {
    const cached = this.cache.get(params.pair);
    if (cached && cached.expiresAtMs > Date.now()) {
      return cached.snapshot;
    }

    const linearSymbol = toLinearSymbol(params.pair);

    const [base, binanceResult, bybitResult] = await Promise.all([
      this.primary.getPerpSnapshot(params),
      Promise.allSettled([this.binance.fetchPerpData(linearSymbol)]).then((r) => r[0]),
      Promise.allSettled([this.bybit.fetchPerpData(linearSymbol)]).then((r) => r[0])
    ]);

    const binanceData = binanceResult?.status === "fulfilled" ? binanceResult.value : undefined;
    const bybitData = bybitResult?.status === "fulfilled" ? bybitResult.value : undefined;

    const fundingRates = [
      base.fundingRate,
      binanceData?.fundingRate,
      bybitData?.fundingRate
    ].filter((r): r is number => r !== undefined);

    const fundingRateAvgs = [
      base.fundingRateAvg,
      binanceData?.fundingRateAvg,
      bybitData?.fundingRateAvg
    ].filter((r): r is number => r !== undefined);

    const oiDeltas = [
      base.openInterestDeltaPct,
      binanceData?.openInterestDeltaPct,
      bybitData?.openInterestDeltaPct
    ].filter((r): r is number => r !== undefined);

    const snapshot: PerpMarketSnapshot = {
      ...base,
      fundingRate: round(avg(fundingRates) ?? base.fundingRate),
      fundingRateAvg: round(avg(fundingRateAvgs) ?? base.fundingRateAvg),
      openInterestDeltaPct: oiDeltas.length > 0 ? round(avg(oiDeltas)!) : base.openInterestDeltaPct
    };

    this.cache.set(params.pair, { snapshot, expiresAtMs: Date.now() + CACHE_TTL_MS });
    return snapshot;
  }
}

function avg(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function round(value: number): number {
  return Number(value.toFixed(8));
}
