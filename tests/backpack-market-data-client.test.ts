import nock from "nock";
import { afterEach, describe, expect, it } from "vitest";
import { BackpackMarketDataClient } from "../src/adapters/backpack/backpack-market-data-client.js";
import { AxiosHttpClient } from "../src/adapters/http/axios-http-client.js";

describe("BackpackMarketDataClient", () => {
  const baseUrl = "https://api.backpack.exchange";

  afterEach(() => {
    nock.cleanAll();
  });

  it("resolves a PERP symbol and retrieves klines with time window", async () => {
    const marketsScope = nock(baseUrl).get("/api/v1/markets").reply(200, [
      { symbol: "BTC_USDC", baseSymbol: "BTC", quoteSymbol: "USDC", marketType: "SPOT" },
      { symbol: "BTC_USDC_PERP", baseSymbol: "BTC", quoteSymbol: "USDC", marketType: "PERP" }
    ]);

    const klinesScope = nock(baseUrl)
      .get("/api/v1/klines")
      .query((query) => {
        return (
          query.symbol === "BTC_USDC_PERP" &&
          query.interval === "1h" &&
          Number(query.startTime) > 0 &&
          Number(query.endTime) > Number(query.startTime)
        );
      })
      .reply(200, [
        { start: "2026-02-12 06:00:00", open: "100", high: "110", low: "90", close: "105", volume: "1200" },
        { start: "2026-02-12 07:00:00", open: "105", high: "120", low: "100", close: "115", volume: "1500" },
        { start: "2026-02-12 08:00:00", open: "115", high: "125", low: "110", close: "122", volume: "900" }
      ]);

    const client = new BackpackMarketDataClient(new AxiosHttpClient(baseUrl));
    const candles = await client.getCandles({ pair: "BTC-USD", interval: "1h", limit: 3 });

    expect(candles).toHaveLength(3);
    expect(candles[0]?.close).toBe(105);
    expect(candles[0]?.timestamp).toBeGreaterThan(0);
    expect(marketsScope.isDone()).toBe(true);
    expect(klinesScope.isDone()).toBe(true);
  });

  it("throws when markets payload is invalid", async () => {
    nock(baseUrl).get("/api/v1/markets").reply(200, { invalid: true });

    const client = new BackpackMarketDataClient(new AxiosHttpClient(baseUrl));

    await expect(client.getCandles({ pair: "BTC-USD", interval: "1h", limit: 10 })).rejects.toThrowError(
      "markets response is invalid"
    );
  });

  it("throws when no PERP symbol exists for the requested pair", async () => {
    nock(baseUrl).get("/api/v1/markets").reply(200, [
      { symbol: "ETH_USDC_PERP", baseSymbol: "ETH", quoteSymbol: "USDC", marketType: "PERP" }
    ]);

    const client = new BackpackMarketDataClient(new AxiosHttpClient(baseUrl));

    await expect(client.getCandles({ pair: "BTC-USD", interval: "1h", limit: 10 })).rejects.toThrowError(
      "No PERP symbol found"
    );
  });

  it("throws clear error after trying interval variants", async () => {
    nock(baseUrl).get("/api/v1/markets").reply(200, [
      { symbol: "BTC_USDC_PERP", baseSymbol: "BTC", quoteSymbol: "USDC", marketType: "PERP" }
    ]);
    nock(baseUrl).get("/api/v1/klines").query(true).times(3).reply(400, { message: "bad request" });

    const client = new BackpackMarketDataClient(new AxiosHttpClient(baseUrl));

    await expect(client.getCandles({ pair: "BTC-USD", interval: "1h", limit: 10 })).rejects.toThrowError(
      "Backpack rejected candle request"
    );
  });

  it("retrieves perp snapshot from mark, open interest, and funding endpoints", async () => {
    nock(baseUrl).get("/api/v1/markets").reply(200, [
      { symbol: "BTC_USDC_PERP", baseSymbol: "BTC", quoteSymbol: "USDC", marketType: "PERP" }
    ]);
    nock(baseUrl)
      .get("/api/v1/markPrices")
      .query({ symbol: "BTC_USDC_PERP" })
      .reply(200, [
        {
          fundingRate: "-0.00001029",
          indexPrice: "68030.79",
          markPrice: "67991.60",
          symbol: "BTC_USDC_PERP"
        }
      ]);
    nock(baseUrl)
      .get("/api/v1/openInterest")
      .query({ symbol: "BTC_USDC_PERP" })
      .reply(200, [{ openInterest: "1234.52128", symbol: "BTC_USDC_PERP" }]);
    nock(baseUrl)
      .get("/api/v1/fundingRates")
      .query({ symbol: "BTC_USDC_PERP" })
      .reply(200, [
        { fundingRate: "-0.00001029", symbol: "BTC_USDC_PERP" },
        { fundingRate: "0.00000500", symbol: "BTC_USDC_PERP" }
      ]);

    const client = new BackpackMarketDataClient(new AxiosHttpClient(baseUrl));
    const snapshot = await client.getPerpSnapshot({ pair: "BTC-USD" });

    expect(snapshot.symbol).toBe("BTC_USDC_PERP");
    expect(snapshot.openInterest).toBe(1234.52128);
    expect(snapshot.markPrice).toBe(67991.6);
    expect(snapshot.indexPrice).toBe(68030.79);
    expect(snapshot.fundingRate).toBe(-0.00001029);
  });
});
