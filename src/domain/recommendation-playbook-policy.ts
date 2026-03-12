import type { MarketRegime, SetupPlaybook } from "./types.js";

export interface PlaybookPolicy {
  readonly playbook?: SetupPlaybook;
  readonly allowedRegimes: readonly MarketRegime[];
  readonly minRiskReward: number;
  readonly atrScale: {
    readonly sl: number;
    readonly tp: number;
    readonly tpFallback: number;
  };
  readonly holdingPeriodMultiplier: number;
  readonly minHoldingCandles: number;
  readonly maxHoldingCandles: number;
  readonly timeStopFraction: number;
  readonly heuristicProbabilityAdjustment: number;
  readonly rationale: string;
}

const DEFAULT_POLICY: PlaybookPolicy = {
  playbook: undefined,
  allowedRegimes: ["TREND", "RANGE", "VOLATILE_SPIKE"],
  minRiskReward: 1.2,
  atrScale: { sl: 1, tp: 1, tpFallback: 1 },
  holdingPeriodMultiplier: 1,
  minHoldingCandles: 2,
  maxHoldingCandles: 120,
  timeStopFraction: 0.6,
  heuristicProbabilityAdjustment: 0,
  rationale: "Playbook policy: generic risk/holding profile."
};

export function resolvePlaybookPolicy(playbook?: SetupPlaybook): PlaybookPolicy {
  switch (playbook) {
    case "TREND_PULLBACK_CONTINUATION":
      return {
        playbook,
        allowedRegimes: ["TREND"],
        minRiskReward: 1.5,
        atrScale: { sl: 1.05, tp: 1.15, tpFallback: 1.1 },
        holdingPeriodMultiplier: 1.2,
        minHoldingCandles: 3,
        maxHoldingCandles: 140,
        timeStopFraction: 0.72,
        heuristicProbabilityAdjustment: 4,
        rationale: "Playbook policy: trend pullback continuation favors trend regime, wider runway, and slower decay."
      };
    case "BREAKOUT_CONTINUATION":
      return {
        playbook,
        allowedRegimes: ["TREND"],
        minRiskReward: 1.8,
        atrScale: { sl: 0.95, tp: 1.05, tpFallback: 1.0 },
        holdingPeriodMultiplier: 0.8,
        minHoldingCandles: 2,
        maxHoldingCandles: 60,
        timeStopFraction: 0.45,
        heuristicProbabilityAdjustment: 2,
        rationale: "Playbook policy: breakout continuation requires cleaner R/R and fast follow-through."
      };
    case "DIVERGENCE_REVERSAL":
      return {
        playbook,
        allowedRegimes: ["RANGE", "VOLATILE_SPIKE"],
        minRiskReward: 1.35,
        atrScale: { sl: 0.95, tp: 0.9, tpFallback: 0.9 },
        holdingPeriodMultiplier: 0.7,
        minHoldingCandles: 2,
        maxHoldingCandles: 50,
        timeStopFraction: 0.5,
        heuristicProbabilityAdjustment: 1,
        rationale: "Playbook policy: divergence reversal is valid in mean-reverting or exhaustion regimes and should resolve quickly."
      };
    case "LIQUIDATION_REVERSAL":
      return {
        playbook,
        allowedRegimes: ["VOLATILE_SPIKE", "RANGE"],
        minRiskReward: 1.35,
        atrScale: { sl: 1.0, tp: 0.95, tpFallback: 0.9 },
        holdingPeriodMultiplier: 0.65,
        minHoldingCandles: 2,
        maxHoldingCandles: 40,
        timeStopFraction: 0.42,
        heuristicProbabilityAdjustment: 3,
        rationale: "Playbook policy: liquidation reversal is an exhaustion trade and should pay quickly or be abandoned."
      };
    case "RANGE_FADE":
      return {
        playbook,
        allowedRegimes: ["RANGE"],
        minRiskReward: 1.25,
        atrScale: { sl: 0.95, tp: 0.9, tpFallback: 0.9 },
        holdingPeriodMultiplier: 0.75,
        minHoldingCandles: 2,
        maxHoldingCandles: 55,
        timeStopFraction: 0.5,
        heuristicProbabilityAdjustment: 2,
        rationale: "Playbook policy: range fade only belongs in range structure and should not linger."
      };
    default:
      return DEFAULT_POLICY;
  }
}

export function isPlaybookRegimeAligned(playbook: SetupPlaybook | undefined, marketRegime: MarketRegime): boolean {
  return resolvePlaybookPolicy(playbook).allowedRegimes.includes(marketRegime);
}
