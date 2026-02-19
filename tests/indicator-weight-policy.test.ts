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
  });

  it("prioritizes trend and volatility for longer horizons", () => {
    const profile = resolveIndicatorWeightProfile({
      intervalMinutes: 180,
      marketRegime: "VOLATILE_SPIKE"
    });

    expect(profile.horizonBucket).toBe("90m+");
    expect(profile.multipliers.trend).toBeGreaterThan(profile.multipliers.momentum);
    expect(profile.multipliers.volatility).toBeGreaterThan(1);
  });

  it("boosts mean reversion in range regimes", () => {
    const profile = resolveIndicatorWeightProfile({
      intervalMinutes: 30,
      marketRegime: "RANGE"
    });

    expect(profile.multipliers.meanReversion).toBeGreaterThan(profile.multipliers.trend);
  });
});
