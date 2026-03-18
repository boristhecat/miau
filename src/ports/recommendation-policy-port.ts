import type { BiasContext, Recommendation } from "../domain/types.js";

export interface RecommendationBuildInput {
  pair: string;
  lastPrice: number;
  indicators: import("../domain/types.js").IndicatorSnapshot;
  perp: import("../domain/types.js").PerpMarketSnapshot;
  forcedDirection?: "LONG" | "SHORT";
  biasContext?: BiasContext;
  biasInterval?: string;
  btcContext?: { emaAbove: boolean; momentumPositive: boolean };
  leverage?: number;
  positionSizeUsd?: number;
  slPct?: number;
  tpPct?: number;
  slUsd?: number;
  tpUsd?: number;
  objectiveUsdc?: number;
  objectiveHorizon?: string;
  expectedRangeHorizon?: string;
  baseInterval?: string;
  riskBudgetUsd?: number;
  calibratedWinRate?: number;
  /** Plan 8: Structure timeframe indicators for MTF cascade */
  structureIndicators?: import("../domain/types.js").IndicatorSnapshot;
  structureInterval?: string;
  /** Plan 9: Journal insight for similar trades */
  journalInsight?: import("../domain/types.js").Recommendation["journalInsight"];
}

export interface RecommendationPolicyPort {
  build(input: RecommendationBuildInput): Recommendation;
}
