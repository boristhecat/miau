import type { Recommendation } from "./types.js";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function estimatePositivePnlProbability(rec: Recommendation): number {
  let probability = rec.confidence;

  if (rec.signal === "NO_TRADE") {
    probability -= 30;
  } else {
    probability += 4;
  }

  if (rec.regime === "CHOPPY") {
    probability -= 14;
  } else {
    probability += 3;
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

  return Math.round(clamp(probability, 1, 99));
}
