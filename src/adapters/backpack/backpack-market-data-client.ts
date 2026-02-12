import type { Candle } from "../../domain/types.js";
import type { MarketDataPort } from "../../ports/market-data-port.js";
import type { HttpClient } from "../http/http-client.js";

interface Market {
  symbol?: string;
  baseSymbol?: string;
  quoteSymbol?: string;
  marketType?: string;
  orderBookState?: string;
  visible?: boolean;
}

type RawKline =
  | [number | string, number | string, number | string, number | string, number | string, number | string]
  | {
      start?: number | string;
      open?: number | string;
      high?: number | string;
      low?: number | string;
      close?: number | string;
      volume?: number | string;
      timestamp?: number | string;
    };

export class BackpackMarketDataClient implements MarketDataPort {
  constructor(private readonly httpClient: HttpClient) {}

  async getCandles(params: {
    pair: string;
    interval: string;
    limit: number;
  }): Promise<Candle[]> {
    const symbols = await this.resolvePerpSymbols(params.pair);
    const intervals = this.buildIntervalCandidates(params.interval);
    let lastError: unknown;

    for (const symbol of symbols) {
      for (const interval of intervals) {
        const intervalSeconds = this.intervalToSeconds(interval);
        if (intervalSeconds === null) {
          continue;
        }

        const endTime = Math.floor(Date.now() / 1000);
        const startTime = endTime - intervalSeconds * (params.limit + 5);

        try {
          const payload = await this.httpClient.get<RawKline[]>("/api/v1/klines", {
            symbol,
            interval,
            startTime,
            endTime
          });

          if (!Array.isArray(payload)) {
            throw new Error("Backpack response is not an array of candles.");
          }

          const candles = payload
            .map((row) => this.parseRow(row))
            .filter((candle): candle is Candle => candle !== null)
            .sort((a, b) => a.timestamp - b.timestamp);

          if (candles.length > 0) {
            return candles.slice(-params.limit);
          }
        } catch (error) {
          lastError = error;
          if (!this.isBadRequest(error)) {
            throw error;
          }
        }
      }
    }

    const reason = this.getErrorReason(lastError);
    throw new Error(
      `Backpack rejected candle request. Tried symbols [${symbols.join(", ")}] and intervals [${intervals.join(", ")}]. ${reason}`
    );
  }

  private parseRow(row: RawKline): Candle | null {
    if (Array.isArray(row)) {
      const [timestamp, open, high, low, close, volume] = row;
      return this.makeCandle(timestamp, open, high, low, close, volume);
    }

    const timestamp = row.start ?? row.timestamp;
    return this.makeCandle(timestamp, row.open, row.high, row.low, row.close, row.volume);
  }

  private makeCandle(
    timestamp: number | string | undefined,
    open: number | string | undefined,
    high: number | string | undefined,
    low: number | string | undefined,
    close: number | string | undefined,
    volume: number | string | undefined
  ): Candle | null {
    if (
      timestamp === undefined ||
      open === undefined ||
      high === undefined ||
      low === undefined ||
      close === undefined ||
      volume === undefined
    ) {
      return null;
    }

    const candle: Candle = {
      timestamp: this.parseTimestamp(timestamp),
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume)
    };

    if (Object.values(candle).some((v) => Number.isNaN(v))) {
      return null;
    }

    return candle;
  }

  private async resolvePerpSymbols(pair: string): Promise<string[]> {
    const markets = await this.httpClient.get<Market[]>("/api/v1/markets");
    if (!Array.isArray(markets)) {
      throw new Error("Backpack markets response is invalid.");
    }

    const normalizedPair = pair.toUpperCase();
    const [base, quoteInput] = normalizedPair.split("-");
    if (!base || !quoteInput) {
      throw new Error(`Invalid pair '${pair}'. Expected BASE-QUOTE format.`);
    }

    const quote = quoteInput === "USD" ? "USDC" : quoteInput;
    const perpMarkets = markets.filter((market) => {
      const symbol = market.symbol?.toUpperCase();
      const marketType = market.marketType?.toUpperCase();
      return symbol?.endsWith("_PERP") && (marketType === "PERP" || marketType === "FUTURE");
    });

    if (perpMarkets.length === 0) {
      throw new Error("No PERP markets returned from Backpack.");
    }

    const exact = perpMarkets.find((market) => {
      return (
        market.baseSymbol?.toUpperCase() === base &&
        market.quoteSymbol?.toUpperCase() === quote &&
        market.symbol?.toUpperCase().endsWith("_PERP")
      );
    });

    if (exact?.symbol) {
      return [exact.symbol.toUpperCase()];
    }

    const bySymbol = perpMarkets.find((market) => {
      return market.symbol?.toUpperCase() === `${base}_${quote}_PERP`;
    });
    if (bySymbol?.symbol) {
      return [bySymbol.symbol.toUpperCase()];
    }

    const baseFallbacks = perpMarkets
      .filter((market) => market.baseSymbol?.toUpperCase() === base)
      .map((market) => market.symbol?.toUpperCase())
      .filter((symbol): symbol is string => typeof symbol === "string");

    if (baseFallbacks.length > 0) {
      return this.unique(baseFallbacks);
    }

    const available = perpMarkets
      .slice(0, 10)
      .map((market) => market.symbol)
      .filter((symbol): symbol is string => typeof symbol === "string")
      .join(", ");
    throw new Error(`No PERP symbol found for ${normalizedPair}. Available examples: ${available}`);
  }

  private parseTimestamp(timestamp: number | string): number {
    const numeric = Number(timestamp);
    if (!Number.isNaN(numeric)) {
      return numeric;
    }

    const parsed = Date.parse(String(timestamp));
    if (!Number.isNaN(parsed)) {
      return parsed;
    }

    return Number.NaN;
  }

  private buildIntervalCandidates(interval: string): string[] {
    const normalized = interval.trim();
    const values = [normalized, normalized.toUpperCase()];

    const hourMatch = normalized.match(/^(\d+)h$/i);
    if (hourMatch) {
      const hours = Number(hourMatch[1]);
      if (!Number.isNaN(hours) && hours > 0) {
        values.push(`${hours * 60}m`);
      }
    }

    return this.unique(values);
  }

  private unique(values: string[]): string[] {
    return [...new Set(values.filter((value) => value.length > 0))];
  }

  private intervalToSeconds(interval: string): number | null {
    const normalized = interval.trim().toLowerCase();
    const match = normalized.match(/^(\d+)([mhd])$/);
    if (!match) {
      return null;
    }

    const amount = Number(match[1]);
    if (Number.isNaN(amount) || amount <= 0) {
      return null;
    }

    const unit = match[2];
    if (unit === "m") {
      return amount * 60;
    }
    if (unit === "h") {
      return amount * 60 * 60;
    }
    return amount * 24 * 60 * 60;
  }

  private isBadRequest(error: unknown): boolean {
    if (typeof error !== "object" || error === null) {
      return false;
    }

    const withResponse = error as { response?: { status?: number } };
    return withResponse.response?.status === 400;
  }

  private getErrorReason(error: unknown): string {
    if (error instanceof Error) {
      return `Last error: ${error.message}`;
    }
    return "Last error: unknown failure";
  }
}
