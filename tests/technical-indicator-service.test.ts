import { beforeAll, describe, expect, it } from "vitest";
import { TalibWasmIndicatorService } from "../src/adapters/indicators/talib-wasm-indicator-service.js";
import { initializeTalibWasm } from "../src/adapters/indicators/talib-wasm-runtime.js";
import type { Candle } from "../src/domain/types.js";

function makeCandles(count: number, stepMs = 60_000): Candle[] {
  const candles: Candle[] = [];
  let price = 100;
  for (let i = 0; i < count; i += 1) {
    const drift = i % 2 === 0 ? 0.35 : -0.1;
    const open = price;
    const close = Math.max(1, price + drift);
    const high = Math.max(open, close) + 0.25;
    const low = Math.min(open, close) - 0.25;
    candles.push({
      timestamp: 1_700_000_000_000 + i * stepMs,
      open,
      high,
      low,
      close,
      volume: 1000 + i * 5
    });
    price = close;
  }
  return candles;
}

describe("TalibWasmIndicatorService", () => {
  beforeAll(async () => {
    await initializeTalibWasm();
  });

  it("computes extended volume and flow features", () => {
    const snapshot = new TalibWasmIndicatorService().calculate(makeCandles(120));

    expect(snapshot.obv).toBeDefined();
    expect(snapshot.obvSlope5).toBeDefined();
    expect(snapshot.mfi14).toBeDefined();
    expect(snapshot.cmf20).toBeDefined();
    expect(snapshot.volumeZScore20).toBeDefined();
    expect(snapshot.cvdDeltaPct5).toBeDefined();
    expect(Number.isFinite(snapshot.cmf20 ?? Number.NaN)).toBe(true);
  });

  it("computes session and daily structure levels when broader history is available", () => {
    const snapshot = new TalibWasmIndicatorService().calculate(makeCandles(600, 5 * 60_000), 5);

    expect(snapshot.sessionLevels).toBeDefined();
    expect(snapshot.dailyLevels).toBeDefined();
    expect(snapshot.sessionLevels?.currentHigh).toBeGreaterThan(snapshot.sessionLevels?.currentLow ?? Number.NEGATIVE_INFINITY);
    expect(
      snapshot.dailyLevels?.priorHigh !== undefined || snapshot.dailyLevels?.priorLow !== undefined
    ).toBe(true);
    expect(snapshot.nearestSupportLevel ?? snapshot.nearestResistanceLevel).toBeDefined();
  });

  it("rejects non-finite candle values before wasm execution", () => {
    const candles = makeCandles(120);
    candles[10] = {
      ...candles[10]!,
      close: Number.POSITIVE_INFINITY
    };

    expect(() => new TalibWasmIndicatorService().calculate(candles)).toThrow(
      "Invalid candle data at index 10: non-finite numeric field."
    );
  });
});
