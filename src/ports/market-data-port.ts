import type { Candle, PerpMarketSnapshot } from "../domain/types.js";

export interface MarketDataPort {
  getCandles(params: {
    pair: string;
    interval: string;
    limit: number;
  }): Promise<Candle[]>;

  getPerpSnapshot(params: { pair: string }): Promise<PerpMarketSnapshot>;
}
