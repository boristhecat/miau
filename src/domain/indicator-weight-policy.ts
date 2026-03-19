import type { MarketRegime } from "./types.js";

export type WeightChannel =
  | "trend"
  | "momentum"
  | "meanReversion"
  | "microstructure"
  | "volatility";

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
    multipliers.trend *= 0.85;
  } else if (input.marketRegime === "LOW_LIQ_CHOP") {
    multipliers.microstructure *= 1.25;
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
        trend: 0.98,
        momentum: 1.82,
        meanReversion: 1.11,
        microstructure: 1.56,
        volatility: 1.30
      }
    };
  }

  if (intervalMinutes <= 30) {
    return {
      horizonBucket: "10-30m",
      multipliers: {
        trend: 1.37,
        momentum: 1.43,
        meanReversion: 1.17,
        microstructure: 1.30,
        volatility: 1.30
      }
    };
  }

  if (intervalMinutes <= 90) {
    return {
      horizonBucket: "30-90m",
      multipliers: {
        trend: 1.50,
        momentum: 1.30,
        meanReversion: 1.30,
        microstructure: 1.17,
        volatility: 1.37
      }
    };
  }

  return {
    horizonBucket: "90m+",
    multipliers: {
      trend: 1.56,
      momentum: 1.17,
      meanReversion: 1.43,
      microstructure: 1.04,
      volatility: 1.50
    }
  };
}
