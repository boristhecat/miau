import type { Recommendation } from "../domain/types.js";

export interface RecommendationBuildInput {
  pair: string;
  lastPrice: number;
  indicators: import("../domain/types.js").IndicatorSnapshot;
  perp: import("../domain/types.js").PerpMarketSnapshot;
  forcedDirection?: "LONG" | "SHORT";
  biasTrend?: import("../domain/types.js").Signal;
  biasInterval?: string;
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
}

export interface RecommendationPolicyPort {
  build(input: RecommendationBuildInput): Recommendation;
}
