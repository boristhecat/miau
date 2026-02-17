import { describe, expect, it } from "vitest";
import { evaluatePaperTrade } from "../src/domain/simulation-evaluator.js";
import type { Candle } from "../src/domain/types.js";

function candle(timestamp: number, open: number, high: number, low: number, close: number): Candle {
  return { timestamp, open, high, low, close, volume: 1 };
}

describe("evaluatePaperTrade", () => {
  it("returns SUCCESS when take-profit is hit first on LONG", () => {
    const outcome = evaluatePaperTrade({
      trade: {
        signal: "LONG",
        entry: 100,
        stopLoss: 98,
        takeProfit: 102,
        openedAtMs: 1_000
      },
      candles: [candle(61_000, 100, 102.5, 99.5, 102)],
      horizonEndMs: 901_000
    });

    expect(outcome.status).toBe("SUCCESS");
    expect(outcome.failureType).toBe("NONE");
    expect(outcome.directionalCorrect).toBe(true);
    expect(outcome.exitPrice).toBe(102);
    expect(outcome.pnlPct).toBeGreaterThan(0);
  });

  it("returns FAILURE when stop-loss is hit first on SHORT", () => {
    const outcome = evaluatePaperTrade({
      trade: {
        signal: "SHORT",
        entry: 100,
        stopLoss: 101,
        takeProfit: 98,
        openedAtMs: 1_000
      },
      candles: [candle(61_000, 100, 101.2, 99.7, 101)],
      horizonEndMs: 901_000
    });

    expect(outcome.status).toBe("FAILURE");
    expect(outcome.failureType).toBe("WRONG_DIRECTION");
    expect(outcome.directionalCorrect).toBe(false);
    expect(outcome.exitPrice).toBe(101);
    expect(outcome.pnlPct).toBeLessThan(0);
  });

  it("closes at horizon and marks SUCCESS/FAILURE by pnl when SL/TP are not hit", () => {
    const win = evaluatePaperTrade({
      trade: {
        signal: "LONG",
        entry: 100,
        stopLoss: 95,
        takeProfit: 110,
        openedAtMs: 1_000
      },
      candles: [candle(61_000, 100, 101, 99, 100.6)],
      horizonEndMs: 901_000
    });
    const loss = evaluatePaperTrade({
      trade: {
        signal: "LONG",
        entry: 100,
        stopLoss: 95,
        takeProfit: 110,
        openedAtMs: 1_000
      },
      candles: [candle(61_000, 100, 101, 99, 99.4)],
      horizonEndMs: 901_000
    });

    expect(win.status).toBe("SUCCESS");
    expect(win.failureType).toBe("NONE");
    expect(loss.status).toBe("FAILURE");
    expect(loss.failureType).toBe("TIMEOUT_LOSS");
  });

  it("classifies stop-hit then rebound as tight-stop rebound failure", () => {
    const outcome = evaluatePaperTrade({
      trade: {
        signal: "LONG",
        entry: 100,
        stopLoss: 99,
        takeProfit: 103,
        openedAtMs: 1_000
      },
      candles: [
        candle(61_000, 100, 100.4, 98.9, 99.2),
        candle(121_000, 99.3, 101.4, 99.1, 101.2)
      ],
      horizonEndMs: 901_000
    });

    expect(outcome.status).toBe("FAILURE");
    expect(outcome.failureType).toBe("STOP_TOO_TIGHT_REBOUND");
    expect(outcome.directionalCorrect).toBe(true);
    expect(outcome.maxFavorableExcursionPct).toBeGreaterThan(1);
    expect(outcome.maxAdverseExcursionPct).toBeGreaterThan(1);
  });
});
