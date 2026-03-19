import type { HttpClient } from "../http/http-client.js";
import type { VenuePerpData } from "./binance-perp-data-client.js";

interface BybitTickerItem {
  fundingRate?: string | number;
  openInterestValue?: string | number;
}

interface BybitTickerResponse {
  result?: {
    list?: BybitTickerItem[];
  };
}

interface BybitFundingHistItem {
  fundingRate?: string | number;
}

interface BybitFundingHistResponse {
  result?: {
    list?: BybitFundingHistItem[];
  };
}

interface BybitOiHistItem {
  openInterestValue?: string | number;
}

interface BybitOiHistResponse {
  result?: {
    list?: BybitOiHistItem[];
  };
}

export class BybitPerpDataClient {
  constructor(private readonly httpClient: HttpClient) {}

  async fetchPerpData(symbol: string): Promise<VenuePerpData> {
    const [tickerResult, fundingHistResult, oiHistResult] = await Promise.allSettled([
      this.httpClient.get<BybitTickerResponse>("/v5/market/tickers", {
        category: "linear",
        symbol
      }),
      this.httpClient.get<BybitFundingHistResponse>("/v5/market/funding/history", {
        category: "linear",
        symbol,
        limit: 8
      }),
      this.httpClient.get<BybitOiHistResponse>("/v5/market/open-interest", {
        category: "linear",
        symbol,
        intervalTime: "5min",
        limit: 2
      })
    ]);

    const ticker =
      tickerResult.status === "fulfilled"
        ? tickerResult.value?.result?.list?.[0]
        : undefined;
    const fundingRate = safeNum(ticker?.fundingRate);

    const fundingRates =
      fundingHistResult.status === "fulfilled"
        ? (fundingHistResult.value?.result?.list ?? [])
            .map((r) => safeNum(r.fundingRate))
            .filter((n): n is number => n !== undefined)
        : [];
    const fundingRateAvg =
      fundingRates.length > 0
        ? fundingRates.reduce((sum, r) => sum + r, 0) / fundingRates.length
        : undefined;

    const oiList =
      oiHistResult.status === "fulfilled"
        ? (oiHistResult.value?.result?.list ?? [])
        : [];
    const openInterestDeltaPct = computeDeltaPct(
      safeNum(oiList[0]?.openInterestValue),
      safeNum(oiList[1]?.openInterestValue)
    );

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
