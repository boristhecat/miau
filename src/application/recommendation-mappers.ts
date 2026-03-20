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
    marketTradeability: recommendation.marketTradeability,
    riskRewardRatio: recommendation.riskRewardRatio,
    analysisInterval: recommendation.analysisInterval,
    analysisBiasInterval: recommendation.analysisBiasInterval,
    objectiveHorizon: recommendation.objectiveHorizon,
    entry: recommendation.entry,
    stopLoss: recommendation.stopLoss,
    takeProfit: recommendation.takeProfit,
    tpAnchor: recommendation.tpAnchor,
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
    oiContext: recommendation.oiContext,
    cvdDivergence: recommendation.cvdDivergence,
    structureBreak: recommendation.structureBreak,
    currentSession: recommendation.sessionContext?.currentSession,
    independentChannelAgreement: recommendation.independentChannelAgreement,
    keyRationale: recommendation.rationale.slice(0, 8),
    learningContext:
      recommendation.learningContext?.active &&
      recommendation.learningContext.sampleSize >= 20 &&
      recommendation.learningContext.winRate !== undefined
        ? {
            winRatePct: Math.round(recommendation.learningContext.winRate * 100),
            sampleSize: recommendation.learningContext.sampleSize,
            dominantFailureType: recommendation.learningContext.dominantFailureType
          }
        : undefined
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

