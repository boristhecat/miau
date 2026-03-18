import type { LiquidationMetrics, LiquidationRisk } from "./types.js";

/**
 * Compute liquidation price and distance metrics for a leveraged perpetual position.
 * Uses isolated margin model with configurable maintenance margin rate.
 */
export function computeLiquidationMetrics(input: {
  side: "LONG" | "SHORT";
  entry: number;
  currentPrice: number;
  stopLoss: number;
  leverage: number;
  maintenanceMarginRate?: number;
  atr?: number;
  fundingRate?: number;
  holdingPeriodMinutes?: number;
  fundingIntervalMinutes?: number;
}): LiquidationMetrics {
  const mmr = input.maintenanceMarginRate ?? 0.005;
  const marginRate = 1 / input.leverage;

  // Liquidation price calculation (isolated margin)
  let liquidationPrice: number;
  if (input.side === "LONG") {
    liquidationPrice = input.entry * (1 - marginRate + mmr);
  } else {
    liquidationPrice = input.entry * (1 + marginRate - mmr);
  }

  // Distance from CURRENT price to liquidation
  const distanceToLiquidation = Math.abs(input.currentPrice - liquidationPrice);
  const distanceToLiquidationPct = (distanceToLiquidation / Math.max(input.currentPrice, 1e-8)) * 100;
  const distanceToLiquidationAtr = input.atr
    ? distanceToLiquidation / input.atr
    : undefined;

  // SL distance from current price
  const distanceToStop = Math.abs(input.currentPrice - input.stopLoss);
  const liquidationToStopRatio = distanceToStop > 0
    ? distanceToLiquidation / distanceToStop
    : Infinity;

  // Risk classification
  let risk: LiquidationRisk;
  if (liquidationToStopRatio >= 3) risk = "SAFE";
  else if (liquidationToStopRatio >= 2) risk = "MODERATE";
  else if (liquidationToStopRatio >= 1.5) risk = "DANGEROUS";
  else risk = "CRITICAL";

  // Funding-adjusted liquidation price
  let projectedFundingCostPct: number | undefined;
  let fundingAdjustedLiquidationPrice: number | undefined;

  if (input.fundingRate !== undefined && input.holdingPeriodMinutes !== undefined) {
    const fundingIntervalMinutes = input.fundingIntervalMinutes ?? 480;
    const fundingPeriods = Math.max(0, Math.floor(input.holdingPeriodMinutes / fundingIntervalMinutes));
    const fundingDrain = Math.abs(input.fundingRate) * fundingPeriods;
    projectedFundingCostPct = fundingDrain * input.leverage * 100;

    // Funding drains margin → moves liquidation price closer to current price
    const isPayingFunding =
      (input.side === "LONG" && input.fundingRate > 0) ||
      (input.side === "SHORT" && input.fundingRate < 0);

    if (isPayingFunding) {
      if (input.side === "LONG") {
        fundingAdjustedLiquidationPrice = liquidationPrice + input.entry * fundingDrain;
      } else {
        fundingAdjustedLiquidationPrice = liquidationPrice - input.entry * fundingDrain;
      }
    } else {
      // Earning funding pushes liq price further away
      if (input.side === "LONG") {
        fundingAdjustedLiquidationPrice = liquidationPrice - input.entry * fundingDrain;
      } else {
        fundingAdjustedLiquidationPrice = liquidationPrice + input.entry * fundingDrain;
      }
    }
  }

  return {
    liquidationPrice: round(liquidationPrice),
    distanceToLiquidation: round(distanceToLiquidation),
    distanceToLiquidationPct: round(distanceToLiquidationPct),
    distanceToLiquidationAtr,
    liquidationToStopRatio: round(liquidationToStopRatio),
    risk,
    effectiveMarginRate: marginRate,
    maintenanceMarginRate: mmr,
    projectedFundingCostPct: projectedFundingCostPct !== undefined ? round(projectedFundingCostPct) : undefined,
    fundingAdjustedLiquidationPrice: fundingAdjustedLiquidationPrice !== undefined ? round(fundingAdjustedLiquidationPrice) : undefined
  };
}

function round(value: number): number {
  return Number(value.toFixed(4));
}
