import { describe, expect, it } from "vitest";
import {
  applyObjectiveTargeting,
  defaultHorizonForObjective,
  deriveObjectiveFromHorizon,
  parseHorizonMinutes,
  parseDurationToMinutes,
  toCandleCount
} from "../src/domain/targeting-policy.js";

describe("targeting-policy", () => {
  it("computes tp fraction for objective=10, margin=250, leverage=10", () => {
    const result = applyObjectiveTargeting({
      signal: "LONG",
      entry: 100,
      atr: 0.6,
      baseInterval: "1m",
      leverage: 10,
      positionSizeUsd: 250,
      objectiveUsdc: 10
    });

    expect(result.targetTpFraction).toBeCloseTo(0.004, 6);
    expect(result.targetTpPct).toBeCloseTo(0.4, 6);
    expect(result.expectedPnlAtTakeProfit).toBeCloseTo(10, 6);
  });

  it("computes tp fraction for objective=30, margin=250, leverage=10", () => {
    const result = applyObjectiveTargeting({
      signal: "LONG",
      entry: 100,
      atr: 0.6,
      baseInterval: "1m",
      leverage: 10,
      positionSizeUsd: 250,
      objectiveUsdc: 30
    });

    expect(result.targetTpFraction).toBeCloseTo(0.012, 6);
    expect(result.targetTpPct).toBeCloseTo(1.2, 6);
  });

  it("treats provided objective as notional pnl target (not multiplied by leverage)", () => {
    const lowLev = applyObjectiveTargeting({
      signal: "LONG",
      entry: 100,
      atr: 0.6,
      baseInterval: "1m",
      leverage: 5,
      positionSizeUsd: 250,
      objectiveUsdc: 10
    });
    const highLev = applyObjectiveTargeting({
      signal: "LONG",
      entry: 100,
      atr: 0.6,
      baseInterval: "1m",
      leverage: 10,
      positionSizeUsd: 250,
      objectiveUsdc: 10
    });

    expect(lowLev.expectedPnlAtTakeProfit).toBe(10);
    expect(highLev.expectedPnlAtTakeProfit).toBe(10);
    expect(highLev.targetTpPct).toBeLessThan(lowLev.targetTpPct);
  });

  it("applies long vs short price math correctly", () => {
    const longResult = applyObjectiveTargeting({
      signal: "LONG",
      entry: 100,
      atr: 1.0,
      baseInterval: "1m",
      leverage: 10,
      positionSizeUsd: 250,
      objectiveUsdc: 10
    });
    const shortResult = applyObjectiveTargeting({
      signal: "SHORT",
      entry: 100,
      atr: 1.0,
      baseInterval: "1m",
      leverage: 10,
      positionSizeUsd: 250,
      objectiveUsdc: 10
    });

    expect(longResult.takeProfit).toBeGreaterThan(100);
    expect(longResult.stopLoss).toBeLessThan(100);
    expect(shortResult.takeProfit).toBeLessThan(100);
    expect(shortResult.stopLoss).toBeGreaterThan(100);
  });

  it("parses durations and converts to candle counts", () => {
    expect(parseDurationToMinutes("15m")).toBe(15);
    expect(parseDurationToMinutes("75m")).toBe(75);
    expect(parseDurationToMinutes("90m")).toBe(90);
    expect(parseHorizonMinutes("15")).toBe(15);
    expect(parseHorizonMinutes("75")).toBe(75);
    expect(parseHorizonMinutes("90")).toBe(90);
    expect(toCandleCount(15, 1)).toBe(15);
    expect(toCandleCount(75, 5)).toBe(15);
    expect(toCandleCount(90, 15)).toBe(6);
  });

  it("defaults horizon by objective", () => {
    expect(defaultHorizonForObjective(10)).toBe("15");
    expect(defaultHorizonForObjective(30)).toBe("75");
  });

  it("derives a realistic objective when only horizon is provided", () => {
    const objective = deriveObjectiveFromHorizon({
      entry: 100,
      atr: 0.2,
      baseInterval: "1m",
      horizon: "60",
      notionalUsd: 2500
    });
    expect(objective).toBeGreaterThan(0);

    const result = applyObjectiveTargeting({
      signal: "LONG",
      entry: 100,
      atr: 0.2,
      baseInterval: "1m",
      leverage: 10,
      positionSizeUsd: 250,
      horizon: "60"
    });
    expect(result.objectiveUsdc).toBe(objective);
    expect(result.horizon).toBe("60m");
  });

  it("triggers plausibility warning when ATR is too low for the target distance", () => {
    const result = applyObjectiveTargeting({
      signal: "LONG",
      entry: 100,
      atr: 0.02,
      baseInterval: "1m",
      leverage: 10,
      positionSizeUsd: 250,
      objectiveUsdc: 30,
      horizon: "15"
    });
    expect(result.plausibilityWarning).toBeDefined();
  });
});
