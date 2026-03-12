import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTradeGuards } from "../src/domain/recommendation-guards.js";

const baseInput = {
  signal: "LONG" as const,
  interval: "1m",
  setupGrade: "A" as const,
  regime: "TRADEABLE" as const,
  marketRegime: "TREND" as const,
  impulseBias: "NONE" as const,
  pullbackExtended: false,
  breakoutValidationFailed: false,
  breakoutFailureDirection: "NONE" as const,
  lowAbsoluteConviction: false,
  winnerRatioInsufficient: false,
  htfContradictionCount: 0,
  regimeSignalMismatch: false,
  setupQuality: 75,
  confidence: 70,
  riskRewardRatio: 2,
  rationale: [] as readonly string[]
};

describe("applyTradeGuards", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("blocks when winner ratio is insufficient", () => {
    const result = applyTradeGuards({
      ...baseInput,
      winnerRatioInsufficient: true
    });
    expect(result.signal).toBe("NO_TRADE");
    expect(result.rationale.some((line) => line.includes("winner ratio is below 0.60"))).toBe(true);
  });

  it("uses DEAD-zone confidence floor", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-05T22:00:00.000Z"));
    const result = applyTradeGuards({
      ...baseInput,
      confidence: 54
    });
    expect(result.signal).toBe("NO_TRADE");
    expect(result.rationale.some((line) => line.includes("DEAD session threshold (55)"))).toBe(true);
  });

  it("blocks on partial HTF contradiction when confidence is below 60", () => {
    const result = applyTradeGuards({
      ...baseInput,
      confidence: 59,
      htfContradictionCount: 2
    });
    expect(result.signal).toBe("NO_TRADE");
    expect(result.rationale.some((line) => line.includes("HTF context partially contradicts"))).toBe(true);
  });

  it("blocks low-conviction setups below confidence 55", () => {
    const result = applyTradeGuards({
      ...baseInput,
      confidence: 54,
      lowAbsoluteConviction: true
    });
    expect(result.signal).toBe("NO_TRADE");
    expect(result.rationale.some((line) => line.includes("low-conviction threshold (55)"))).toBe(true);
  });

  it("applies stricter mismatch risk/reward threshold", () => {
    const result = applyTradeGuards({
      ...baseInput,
      regimeSignalMismatch: true,
      marketRegime: "RANGE",
      riskRewardRatio: 1.45
    });
    expect(result.signal).toBe("NO_TRADE");
    expect(result.rationale.some((line) => line.includes("requires risk/reward >= 1.6"))).toBe(true);
  });

  it("blocks when entry readiness says to wait for pullback", () => {
    const result = applyTradeGuards({
      ...baseInput,
      entryReadinessStatus: "WAIT_PULLBACK",
      preferredEntryPrice: 99.25,
      entryReadinessRationale: ["Trend setup is valid, but market entry is extended; wait for pullback toward the preferred entry."]
    });
    expect(result.signal).toBe("NO_TRADE");
    expect(result.rationale.some((line) => line.includes("wait for a cleaner trigger"))).toBe(true);
    expect(result.rationale.some((line) => line.includes("99.2500"))).toBe(true);
  });

  it("can skip legacy market-level checks when tradeability was handled earlier", () => {
    const result = applyTradeGuards({
      ...baseInput,
      marketRegime: "LOW_LIQ_CHOP",
      regime: "CHOPPY",
      bidAskSpreadPct: 0.2,
      skipLegacyTradeabilityChecks: true
    });
    expect(result.signal).toBe("LONG");
    expect(result.rationale.some((line) => line.startsWith("No-trade guard:"))).toBe(false);
  });
});
