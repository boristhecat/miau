import type { HttpClient } from "../http/http-client.js";

export interface VenuePerpData {
  fundingRate?: number;
  fundingRateAvg?: number;
  openInterestDeltaPct?: number;
}

interface BinancePremiumIndex {
  lastFundingRate?: string | number;
}

interface BinanceFundingRate {
  fundingRate?: string | number;
}

interface BinanceOiHistRow {
  sumOpenInterestValue?: string | number;
}

export class BinancePerpDataClient {
  constructor(private readonly httpClient: HttpClient) {}

  async fetchPerpData(symbol: string): Promise<VenuePerpData> {
    const [premiumResult, fundingResult, oiHistResult] = await Promise.allSettled([
      this.httpClient.get<BinancePremiumIndex>("/fapi/v1/premiumIndex", { symbol }),
      this.httpClient.get<BinanceFundingRate[]>("/fapi/v1/fundingRate", { symbol, limit: 8 }),
      this.httpClient.get<BinanceOiHistRow[]>("/futures/data/openInterestHist", {
        symbol,
        period: "5m",
        limit: 2
      })
    ]);

    const fundingRate =
      premiumResult.status === "fulfilled"
        ? safeNum(premiumResult.value?.lastFundingRate)
        : undefined;

    const fundingRates =
      fundingResult.status === "fulfilled" && Array.isArray(fundingResult.value)
        ? fundingResult.value
            .map((r) => safeNum(r.fundingRate))
            .filter((n): n is number => n !== undefined)
        : [];
    const fundingRateAvg =
      fundingRates.length > 0
        ? fundingRates.reduce((sum, r) => sum + r, 0) / fundingRates.length
        : undefined;

    const openInterestDeltaPct =
      oiHistResult.status === "fulfilled" && Array.isArray(oiHistResult.value)
        ? computeDeltaPct(
            safeNum(oiHistResult.value[0]?.sumOpenInterestValue),
            safeNum(oiHistResult.value[1]?.sumOpenInterestValue)
          )
        : undefined;

    return { fundingRate, fundingRateAvg, openInterestDeltaPct };
  }
}

function safeNum(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function computeDeltaPct(latest: number | undefined, previous: number | undefined): number | undefined {
  if (latest === undefined || previous === undefined || Math.abs(previous) < 1e-8) {
    return undefined;
  }
  return ((latest - previous) / Math.abs(previous)) * 100;
}
