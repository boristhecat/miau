import type { FundingAnalysis, FundingSignal, FundingTrend } from "./types.js";

/**
 * Analyze funding rate as a positioning signal: crowded long/short detection,
 * trend/flip detection, cost projection, and settlement timing.
 */
export function analyzeFunding(input: {
  fundingRate: number;
  fundingRateAvg: number;
  side?: "LONG" | "SHORT";
  leverage?: number;
  positionSizeUsd?: number;
  holdingPeriodMinutes?: number;
  now?: Date;
}): FundingAnalysis {
  const { fundingRate, fundingRateAvg } = input;
  const deviation = fundingRate - fundingRateAvg;

  // Signal classification based on absolute funding rate
  let signal: FundingSignal;
  if (fundingRate > 0.0003) signal = "STRONG_CONTRA_LONG";
  else if (fundingRate > 0.0001) signal = "WEAK_CONTRA_LONG";
  else if (fundingRate < -0.0003) signal = "STRONG_CONTRA_SHORT";
  else if (fundingRate < -0.0001) signal = "WEAK_CONTRA_SHORT";
  else signal = "NEUTRAL";

  // Trend classification
  let trend: FundingTrend;
  if (Math.sign(fundingRate) !== Math.sign(fundingRateAvg) && fundingRateAvg !== 0) {
    trend = fundingRate > 0 ? "FLIPPING_POSITIVE" : "FLIPPING_NEGATIVE";
  } else if (deviation > 0.00005) {
    trend = "RISING";
  } else if (deviation < -0.00005) {
    trend = "FALLING";
  } else {
    trend = "STABLE";
  }

  const now = input.now ?? new Date();
  const minutesToNextSettlement = computeMinutesToNextSettlement(now);

  // Cost projection
  let projectedFundingCostPct: number | undefined;
  let projectedFundingCostUsd: number | undefined;
  let settlementsInHoldPeriod: number | undefined;

  if (input.holdingPeriodMinutes !== undefined) {
    const fundingIntervalMinutes = 480;
    settlementsInHoldPeriod = Math.max(
      0,
      Math.floor((input.holdingPeriodMinutes + (fundingIntervalMinutes - minutesToNextSettlement)) / fundingIntervalMinutes)
    );

    if (input.side && input.leverage !== undefined) {
      const payingFunding =
        (input.side === "LONG" && fundingRate > 0) ||
        (input.side === "SHORT" && fundingRate < 0);
      const costPerSettlement = Math.abs(fundingRate) * input.leverage;
      const totalCost = costPerSettlement * settlementsInHoldPeriod;
      projectedFundingCostPct = payingFunding ? totalCost * 100 : -totalCost * 100;

      if (input.positionSizeUsd !== undefined) {
        projectedFundingCostUsd = (projectedFundingCostPct / 100) * input.positionSizeUsd;
      }
    }
  }

  const isExtreme = Math.abs(fundingRate) > 0.0003;
  const rationale = buildFundingRationale(fundingRate, signal, trend, isExtreme, projectedFundingCostPct, settlementsInHoldPeriod, minutesToNextSettlement);

  return {
    currentRate: fundingRate,
    averageRate: fundingRateAvg,
    deviationFromAvg: deviation,
    signal,
    trend,
    minutesToNextSettlement,
    projectedFundingCostPct,
    projectedFundingCostUsd,
    settlementsInHoldPeriod,
    isExtreme,
    rationale
  };
}

function computeMinutesToNextSettlement(now: Date): number {
  const utcHour = now.getUTCHours();
  const utcMinute = now.getUTCMinutes();
  const currentMinutes = utcHour * 60 + utcMinute;
  // Backpack settlements at 00:00, 08:00, 16:00 UTC
  const settlements = [0, 480, 960, 1440];
  for (const settlement of settlements) {
    if (settlement > currentMinutes) {
      return settlement - currentMinutes;
    }
  }
  return 1440 - currentMinutes;
}

function buildFundingRationale(
  fundingRate: number,
  signal: FundingSignal,
  trend: FundingTrend,
  isExtreme: boolean,
  projectedCostPct: number | undefined,
  settlements: number | undefined,
  minutesToNext: number
): string[] {
  const rationale: string[] = [];

  if (isExtreme) {
    const side = fundingRate > 0 ? "long" : "short";
    const contra = fundingRate > 0 ? "SHORT" : "LONG";
    rationale.push(
      `Extreme funding (${(fundingRate * 100).toFixed(4)}%): market heavily ${side} — contrarian ${contra} bias.`
    );
  }

  if (trend === "FLIPPING_POSITIVE" || trend === "FLIPPING_NEGATIVE") {
    rationale.push(
      `Funding flipping ${trend === "FLIPPING_POSITIVE" ? "positive" : "negative"} — positioning shift in progress.`
    );
  }

  if (projectedCostPct !== undefined && Math.abs(projectedCostPct) > 0.05) {
    const action = projectedCostPct > 0 ? "cost" : "income";
    rationale.push(
      `Projected funding ${action}: ${Math.abs(projectedCostPct).toFixed(2)}% over hold (${settlements ?? 0} settlement${settlements !== 1 ? "s" : ""}).`
    );
  }

  if (minutesToNext < 30) {
    rationale.push(
      `Next funding settlement in ${minutesToNext}min — consider timing entry around settlement.`
    );
  }

  return rationale;
}
