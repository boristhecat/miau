import nock from "nock";
import { afterEach, describe, expect, it } from "vitest";
import { BackpackMarketDataClient } from "../src/adapters/backpack/backpack-market-data-client.js";
import { AxiosHttpClient } from "../src/adapters/http/axios-http-client.js";

describe("BackpackMarketDataClient", () => {
  const baseUrl = "https://api.backpack.exchange";

  afterEach(() => {
    nock.cleanAll();
  });

  it("retrieves and parses klines array payload", async () => {
    const scope = nock(baseUrl)
      .get("/api/v1/klines")
      .query({ symbol: "BTC-USD", interval: "1h", limit: 3 })
      .reply(200, [
        [1700000000000, "100", "110", "90", "105", "1200"],
        [1700003600000, "105", "120", "100", "115", "1500"],
        [1700007200000, "115", "125", "110", "122", "900"]
      ]);

    const client = new BackpackMarketDataClient(new AxiosHttpClient(baseUrl));
    const candles = await client.getCandles({ pair: "BTC-USD", interval: "1h", limit: 3 });

    expect(candles).toHaveLength(3);
    expect(candles[0]).toEqual({
      timestamp: 1700000000000,
      open: 100,
      high: 110,
      low: 90,
      close: 105,
      volume: 1200
    });
    expect(scope.isDone()).toBe(true);
  });

  it("throws when payload is not array", async () => {
    nock(baseUrl)
      .get("/api/v1/klines")
      .query(true)
      .reply(200, { invalid: true });

    const client = new BackpackMarketDataClient(new AxiosHttpClient(baseUrl));

    await expect(
      client.getCandles({ pair: "BTC-USD", interval: "1h", limit: 10 })
    ).rejects.toThrowError("not an array");
  });
});
