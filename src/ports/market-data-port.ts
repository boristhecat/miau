import type { Candle } from "../domain/types.js";

export interface MarketDataPort {
  getCandles(params: {
    pair: string;
    interval: string;
    limit: number;
  }): Promise<Candle[]>;
}
