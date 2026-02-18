import type { AdaptiveLearningService } from "./adaptive-learning-service.js";
import type { GenerateRecommendationUseCase } from "./generate-recommendation-use-case.js";
import { resolveAdaptiveTimeframes } from "./timeframe-policy.js";

export interface EvaluatedWatchSymbol {
  signal: "LONG" | "SHORT" | "NO_TRADE";
  regime: string;
  confidence: number;
  setupQuality: number;
  reason: string;
  signature: string;
}

export class EvaluateWatchSymbolUseCase {
  constructor(
    private readonly recommendationUseCase: GenerateRecommendationUseCase,
    private readonly learning: AdaptiveLearningService
  ) {}

  async execute(input: {
    symbol: string;
    objectiveHorizon: string;
    requestedDirection?: "LONG" | "SHORT";
    leverage: number;
    positionSizeUsd: number;
    cooldownAdvisory?: string;
    calibration: (pair: string, confidence: number) => number;
  }): Promise<EvaluatedWatchSymbol> {
    const pair = `${input.symbol}-USD`;
    const adaptiveTimeframes = resolveAdaptiveTimeframes(input.objectiveHorizon);
    let recommendation = await this.recommendationUseCase.execute({
      pair,
      forcedDirection: input.requestedDirection,
      interval: adaptiveTimeframes.timeframe,
      biasInterval: adaptiveTimeframes.biasTimeframe,
      leverage: input.leverage,
      positionSizeUsd: input.positionSizeUsd,
      objectiveHorizon: input.objectiveHorizon
    });
    recommendation = await this.learning.applyPolicy({
      recommendation,
      timeframe: adaptiveTimeframes.timeframe
    });
    recommendation.confidence = input.calibration(pair, recommendation.confidence);

    const guardReason =
      recommendation.signal === "NO_TRADE"
        ? recommendation.rationale.find((line) => line.startsWith("No-trade guard:"))?.replace("No-trade guard: ", "")
        : "OK";
    const normalizedReason = guardReason ?? "OK";
    const reason = input.cooldownAdvisory
      ? `${normalizedReason ? `${normalizedReason}; ` : ""}${input.cooldownAdvisory}`
      : normalizedReason;
    const signature =
      `${recommendation.signal}|${recommendation.marketRegime}|${Math.round(recommendation.confidence / 5) * 5}|` +
      `${recommendation.rationale.find((line) => line.startsWith("No-trade guard:")) ?? ""}|${input.cooldownAdvisory ?? ""}`;

    return {
      signal: recommendation.signal,
      regime: recommendation.marketRegime,
      confidence: recommendation.confidence,
      setupQuality: recommendation.confidenceBreakdown.setupQuality,
      reason,
      signature
    };
  }
}
