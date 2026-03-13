import type { PerpMarketSnapshot } from "../domain/types.js";

export interface LivePerpStream {
  getLatestSnapshot(): PerpMarketSnapshot | undefined;
  waitForSnapshot(timeoutMs?: number): Promise<PerpMarketSnapshot>;
  close(): void;
}

export interface LiveMarketDataPort {
  openPerpStream(input: {
    pair: string;
    initialSnapshot?: PerpMarketSnapshot;
  }): Promise<LivePerpStream>;
}
