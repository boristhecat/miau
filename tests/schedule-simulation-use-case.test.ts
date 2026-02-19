import { afterEach, describe, expect, it, vi } from "vitest";
import { ScheduleSimulationUseCase } from "../src/application/schedule-simulation-use-case.js";
import type { EvaluateSimulationUseCase } from "../src/application/evaluate-simulation-use-case.js";
import type { Recommendation } from "../src/domain/types.js";

function makeRecommendation(): Recommendation {
  return {
    pair: "BTC-USD",
    signal: "LONG",
    action: "LONG",
    regime: "TRADEABLE",
    marketRegime: "TREND",
    entry: 100,
    stopLoss: 99,
    takeProfit: 102,
    confidence: 80,
    setupGrade: "A",
    confidenceBreakdown: {
      trend: 80,
      momentum: 70,
      volatility: 65,
      structure: 75,
      context: 72,
      setupQuality: 74
    },
    rationale: [],
    riskRewardRatio: 2,
    indicators: {
      rsi14: 55,
      ema20: 101,
      ema50: 99,
      macd: 1,
      macdSignal: 0.8,
      macdHistogram: 0.2,
      atr14: 1,
      adx14: 25,
      bbUpper: 103,
      bbMiddle: 100,
      bbLower: 97,
      stochRsiK: 60,
      stochRsiD: 58,
      vwap: 100
    },
    perp: {
      symbol: "BTC_USDC_PERP",
      fundingRate: 0,
      fundingRateAvg: 0,
      openInterest: 1000,
      markPrice: 100,
      indexPrice: 100,
      premiumPct: 0
    }
  };
}

describe("ScheduleSimulationUseCase", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("anchors delay and evaluation to openedAtMs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:30.000Z"));

    const execute = vi.fn(async () => ({
      status: "SUCCESS" as const,
      failureType: "NONE" as const,
      directionalCorrect: true,
      maxFavorableExcursionPct: 1,
      maxAdverseExcursionPct: 0.5,
      pnlPct: 0.9,
      exitPrice: 101,
      reason: "ok"
    }));
    const simulationUseCase = { execute } as unknown as EvaluateSimulationUseCase;
    const scheduler = new ScheduleSimulationUseCase(simulationUseCase);
    const onResult = vi.fn();
    const timerRegistry = new Set<NodeJS.Timeout>();
    const openedAtMs = new Date("2026-01-01T00:00:00.000Z").getTime();

    scheduler.schedule({
      recommendation: makeRecommendation(),
      interval: "1m",
      horizonMinutes: 1,
      openedAtMs,
      timerRegistry,
      onResult
    });

    expect(timerRegistry.size).toBe(1);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(execute).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith({
      recommendation: expect.objectContaining({ pair: "BTC-USD" }),
      interval: "1m",
      horizonMinutes: 1,
      openedAtMs
    });
    expect(onResult).toHaveBeenCalledOnce();
    expect(timerRegistry.size).toBe(0);
  });
});
