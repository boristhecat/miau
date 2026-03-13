import { describe, expect, it, vi } from "vitest";
import { BackpackLiveMarketStreamClient } from "../src/adapters/backpack/backpack-live-market-stream-client.js";
import type { MarketDataPort } from "../src/ports/market-data-port.js";

describe("BackpackLiveMarketStreamClient", () => {
  it("subscribes to the monitor streams and updates the latest snapshot from websocket messages", async () => {
    const socket = new FakeWebSocket();
    const marketData = makeMarketData();
    const client = new BackpackLiveMarketStreamClient(
      marketData,
      () => socket,
      "wss://ws.backpack.exchange"
    );

    const stream = await client.openPerpStream({
      pair: "BTC-USD",
      initialSnapshot: makePerpSnapshot()
    });

    socket.emit("open");

    expect(socket.sentMessages).toEqual([
      JSON.stringify({
        method: "SUBSCRIBE",
        params: ["bookTicker.BTC_USDC_PERP", "markPrice.BTC_USDC_PERP", "openInterest.BTC_USDC_PERP"]
      })
    ]);

    socket.emit("message", {
      data: JSON.stringify({
        stream: "bookTicker.BTC_USDC_PERP",
        data: { a: "101.0", A: "5", b: "100.8", B: "7" }
      })
    });
    socket.emit("message", {
      data: JSON.stringify({
        stream: "markPrice.BTC_USDC_PERP",
        data: { p: "100.9", i: "100.7", f: "0.0004" }
      })
    });
    socket.emit("message", {
      data: JSON.stringify({
        stream: "openInterest.BTC_USDC_PERP",
        data: { o: "1450" }
      })
    });

    expect(stream.getLatestSnapshot()).toMatchObject({
      symbol: "BTC_USDC_PERP",
      markPrice: 100.9,
      indexPrice: 100.7,
      fundingRate: 0.0004,
      openInterest: 1450,
      bidAskSpreadPct: 0.19821606,
      orderBookImbalance: 0.16666667,
      microPricePremiumPct: 0.016518
    });

    stream.close();
    expect(socket.closed).toBe(true);
  });

  it("bootstraps from REST when no initial snapshot is provided", async () => {
    const socket = new FakeWebSocket();
    const marketData = makeMarketData();
    const client = new BackpackLiveMarketStreamClient(marketData, () => socket);

    const stream = await client.openPerpStream({ pair: "BTC-USD" });

    expect(marketData.getPerpSnapshot).toHaveBeenCalledWith({ pair: "BTC-USD" });
    expect(stream.getLatestSnapshot()).toMatchObject({
      symbol: "BTC_USDC_PERP",
      markPrice: 100
    });
  });
});

class FakeWebSocket {
  readonly sentMessages: string[] = [];
  closed = false;
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.closed = true;
    this.emit("close");
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)?.add(listener);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, event: unknown = {}): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

function makeMarketData(): MarketDataPort {
  return {
    getCandles: vi.fn(),
    getPerpSnapshot: vi.fn().mockResolvedValue(makePerpSnapshot()),
    getTopPerpSymbolsByVolume: vi.fn(),
    getTopPerpSymbolsByVolumeWithOpenInterest: vi.fn()
  };
}

function makePerpSnapshot() {
  return {
    symbol: "BTC_USDC_PERP",
    fundingRate: 0,
    fundingRateAvg: 0,
    openInterest: 1000,
    markPrice: 100,
    indexPrice: 99.9,
    premiumPct: 0.1,
    bidAskSpreadPct: 0.04,
    orderBookImbalance: 0.1,
    microPricePremiumPct: 0.02
  };
}
