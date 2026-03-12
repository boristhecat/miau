import { describe, expect, it } from "vitest";
import { resolveIndicatorWeightProfile } from "../src/domain/indicator-weight-policy.js";

describe("resolveIndicatorWeightProfile", () => {
  it("prioritizes momentum/flow/microstructure for short horizons", () => {
    const profile = resolveIndicatorWeightProfile({
      intervalMinutes: 1,
      marketRegime: "TREND"
    });

    expect(profile.horizonBucket).toBe("1-10m");
    expect(profile.multipliers.momentum).toBeGreaterThan(profile.multipliers.trend);
    expect(profile.multipliers.microstructure).toBeGreaterThanOrEqual(1);
    expect(profile.multipliers.trend).toBeCloseTo(0.75 * 1.25);
    expect(profile.multipliers.meanReversion).toBeCloseTo(0.85 * 0.75);
  });

  it("prioritizes trend and volatility for longer horizons", () => {
    const profile = resolveIndicatorWeightProfile({
      intervalMinutes: 180,
      marketRegime: "VOLATILE_SPIKE"
    });

    expect(profile.horizonBucket).toBe("90m+");
    expect(profile.multipliers.trend).toBeGreaterThan(profile.multipliers.momentum);
    expect(profile.multipliers.volatility).toBeCloseTo(1.15 * 1.35);
    expect(profile.multipliers.fastFilters).toBeCloseTo(0.8 * 1.2);
    expect(profile.multipliers.trend).toBeCloseTo(1.2 * 0.85);
  });

  it("boosts mean reversion in range regimes", () => {
    const profile = resolveIndicatorWeightProfile({
      intervalMinutes: 30,
      marketRegime: "RANGE"
    });

    expect(profile.multipliers.meanReversion).toBeGreaterThan(profile.multipliers.trend);
    expect(profile.multipliers.meanReversion).toBeCloseTo(0.9 * 1.3);
    expect(profile.multipliers.trend).toBeCloseTo(1.05 * 0.8);
  });

  it("discounts trend and momentum more aggressively in low-liquidity chop", () => {
    const profile = resolveIndicatorWeightProfile({
      intervalMinutes: 10,
      marketRegime: "LOW_LIQ_CHOP"
    });

    expect(profile.multipliers.microstructure).toBeCloseTo(1.2 * 1.25);
    expect(profile.multipliers.momentum).toBeCloseTo(1.4 * 0.8);
    expect(profile.multipliers.trend).toBeCloseTo(0.75 * 0.85);
  });
});
