import type { Recommendation } from "../domain/types.js";
import type { AiAdviceRequest } from "../ports/ai-advisor-port.js";
import type { LearningRecommendationSnapshot } from "../ports/learning-store-port.js";

export function toAiAdviceRequest(recommendation: Recommendation): AiAdviceRequest {
  return {
    pair: recommendation.pair,
    signal: recommendation.signal,
    modelSignal: recommendation.modelSignal,
    requestedDirection: recommendation.requestedDirection,
    confidence: recommendation.confidence,
    setupGrade: recommendation.setupGrade,
    setupQuality: recommendation.confidenceBreakdown.setupQuality,
    marketRegime: recommendation.marketRegime,
    riskRewardRatio: recommendation.riskRewardRatio,
    analysisInterval: recommendation.analysisInterval,
    analysisBiasInterval: recommendation.analysisBiasInterval,
    objectiveHorizon: recommendation.objectiveHorizon,
    entry: recommendation.entry,
    stopLoss: recommendation.stopLoss,
    takeProfit: recommendation.takeProfit,
    expectedLow: recommendation.expectedLow,
    expectedHigh: recommendation.expectedHigh,
    indicators: {
      rsi14: recommendation.indicators.rsi14,
      ema20: recommendation.indicators.ema20,
      ema50: recommendation.indicators.ema50,
      macdHistogram: recommendation.indicators.macdHistogram,
      atr14: recommendation.indicators.atr14,
      adx14: recommendation.indicators.adx14,
      vwap: recommendation.indicators.vwap
    },
    perp: {
      fundingRate: recommendation.perp.fundingRate,
      premiumPct: recommendation.perp.premiumPct,
      openInterest: recommendation.perp.openInterest
    },
    keyRationale: recommendation.rationale.slice(0, 5)
  };
}

export function toLearningRecommendationSnapshot(
  recommendation: Recommendation
): LearningRecommendationSnapshot {
  return {
    analysisInterval: recommendation.analysisInterval,
    analysisBiasInterval: recommendation.analysisBiasInterval,
    modelSignal: recommendation.modelSignal,
    requestedDirection: recommendation.requestedDirection,
    qualityVerdict: recommendation.qualityVerdict,
    setupGrade: recommendation.setupGrade,
    entry: recommendation.entry,
    stopLoss: recommendation.stopLoss,
    takeProfit: recommendation.takeProfit,
    riskRewardRatio: recommendation.riskRewardRatio,
    expectedLow: recommendation.expectedLow,
    expectedHigh: recommendation.expectedHigh,
    objectiveHorizon: recommendation.objectiveHorizon,
    objectiveHorizonMinutes: recommendation.objectiveHorizonMinutes,
    objectiveHorizonCandles: recommendation.objectiveHorizonCandles,
    confidenceBreakdown: { ...recommendation.confidenceBreakdown },
    indicators: recommendation.indicators as unknown as Record<string, unknown>,
    perp: recommendation.perp as unknown as Record<string, unknown>,
    rationale: [...recommendation.rationale]
  };
}

