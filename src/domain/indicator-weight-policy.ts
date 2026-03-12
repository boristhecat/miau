import type { MarketRegime } from "./types.js";

export type WeightChannel =
  | "trend"
  | "momentum"
  | "meanReversion"
  | "flow"
  | "microstructure"
  | "volatility"
  | "consensus"
  | "fastFilters";

export interface IndicatorWeightProfile {
  horizonBucket: "1-10m" | "10-30m" | "30-90m" | "90m+";
  multipliers: Record<WeightChannel, number>;
}

export function resolveIndicatorWeightProfile(input: {
  intervalMinutes: number;
  marketRegime: MarketRegime;
}): IndicatorWeightProfile {
  const baseProfile = resolveBaseByHorizon(input.intervalMinutes);
  const multipliers = { ...baseProfile.multipliers };

  if (input.marketRegime === "TREND") {
    multipliers.trend *= 1.25;
    multipliers.momentum *= 1.1;
    multipliers.meanReversion *= 0.75;
  } else if (input.marketRegime === "RANGE") {
    multipliers.meanReversion *= 1.3;
    multipliers.trend *= 0.8;
  } else if (input.marketRegime === "VOLATILE_SPIKE") {
    multipliers.volatility *= 1.35;
    multipliers.fastFilters *= 1.2;
    multipliers.trend *= 0.85;
  } else if (input.marketRegime === "LOW_LIQ_CHOP") {
    multipliers.microstructure *= 1.25;
    multipliers.fastFilters *= 1.2;
    multipliers.momentum *= 0.8;
    multipliers.trend *= 0.85;
  }

  return {
    horizonBucket: baseProfile.horizonBucket,
    multipliers
  };
}

function resolveBaseByHorizon(intervalMinutes: number): IndicatorWeightProfile {
  if (intervalMinutes <= 10) {
    return {
      horizonBucket: "1-10m",
      multipliers: {
        trend: 0.75,
        momentum: 1.4,
        meanReversion: 0.85,
        flow: 1.15,
        microstructure: 1.2,
        volatility: 1,
        consensus: 1.15,
        fastFilters: 1.3
      }
    };
  }

  if (intervalMinutes <= 30) {
    return {
      horizonBucket: "10-30m",
      multipliers: {
        trend: 1.05,
        momentum: 1.1,
        meanReversion: 0.9,
        flow: 1.05,
        microstructure: 1,
        volatility: 1,
        consensus: 1.05,
        fastFilters: 1
      }
    };
  }

  if (intervalMinutes <= 90) {
    return {
      horizonBucket: "30-90m",
      multipliers: {
        trend: 1.15,
        momentum: 1,
        meanReversion: 1,
        flow: 1.05,
        microstructure: 0.9,
        volatility: 1.05,
        consensus: 1,
        fastFilters: 0.9
      }
    };
  }

  return {
    horizonBucket: "90m+",
    multipliers: {
      trend: 1.2,
      momentum: 0.9,
      meanReversion: 1.1,
      flow: 1.1,
      microstructure: 0.8,
      volatility: 1.15,
      consensus: 0.95,
      fastFilters: 0.8
    }
  };
}
