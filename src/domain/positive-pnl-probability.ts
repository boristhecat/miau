import type { Recommendation } from "./types.js";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function estimatePositivePnlProbability(
  rec: Recommendation,
  calibratedWinRate?: number
): number {
  if (calibratedWinRate !== undefined) {
    const empirical = calibratedWinRate * 100;
    const heuristic = computeHeuristicProbability(rec);
    const blended = empirical * 0.7 + heuristic * 0.3;
    return Math.round(clamp(blended, 1, 99));
  }

  return Math.round(clamp(computeHeuristicProbability(rec), 1, 99));
}

function computeHeuristicProbability(rec: Recommendation): number {
  // Improvement #3: Start from 50% base (coin flip) instead of confidence.
  // Confidence measures indicator agreement, not actual win probability.
  // Only deviate from 50% based on structural quality factors.
  let probability = 50;

  if (rec.signal === "NO_TRADE") {
    probability -= 30;
  }

  if (rec.regime === "CHOPPY") {
    probability -= 14;
  }

  if (rec.marketRegime === "TREND") {
    probability += 4;
  } else if (rec.marketRegime === "VOLATILE_SPIKE") {
    probability -= 5;
  } else if (rec.marketRegime === "LOW_LIQ_CHOP") {
    probability -= 10;
  }

  if (rec.riskRewardRatio >= 2) {
    probability += 9;
  } else if (rec.riskRewardRatio >= 1.5) {
    probability += 5;
  } else if (rec.riskRewardRatio < 1.2) {
    probability -= 16;
  } else if (rec.riskRewardRatio < 1.4) {
    probability -= 8;
  }

  if (rec.setupDetected) {
    probability += 6;
  } else {
    probability -= 4;
  }

  if (rec.feeBurdenPct !== undefined && rec.feeBurdenPct > 0.2) {
    probability -= 8;
  }

  // Bonus for strong independent channel agreement
  if (rec.independentChannelAgreement !== undefined) {
    if (rec.independentChannelAgreement >= 4) {
      probability += 6;
    } else if (rec.independentChannelAgreement >= 3) {
      probability += 3;
    } else {
      probability -= 8;
    }
  }

  return probability;
}
