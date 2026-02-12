import type { Candle } from "../../domain/types.js";
import type { MarketDataPort } from "../../ports/market-data-port.js";
import type { HttpClient } from "../http/http-client.js";

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
    const payload = await this.httpClient.get<RawKline[]>("/api/v1/klines", {
      symbol: params.pair,
      interval: params.interval,
      limit: params.limit
    });

    if (!Array.isArray(payload)) {
      throw new Error("Backpack response is not an array of candles.");
    }

    return payload
      .map((row) => this.parseRow(row))
      .filter((candle): candle is Candle => candle !== null)
      .sort((a, b) => a.timestamp - b.timestamp);
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
      timestamp: Number(timestamp),
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
}
