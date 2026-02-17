import type { Recommendation } from "../domain/types.js";
import type { AiAdvice, AiAdvisorPort } from "../ports/ai-advisor-port.js";

interface Deps {
  aiAdvisor: AiAdvisorPort;
}

export class GenerateAiAdviceUseCase {
  constructor(private readonly deps: Deps) {}

  async execute(input: { recommendation: Recommendation }): Promise<AiAdvice> {
    const rec = input.recommendation;
    return this.deps.aiAdvisor.advise({
      pair: rec.pair,
      signal: rec.signal,
      modelSignal: rec.modelSignal,
      requestedDirection: rec.requestedDirection,
      confidence: rec.confidence,
      setupGrade: rec.setupGrade,
      setupQuality: rec.confidenceBreakdown.setupQuality,
      marketRegime: rec.marketRegime,
      riskRewardRatio: rec.riskRewardRatio,
      analysisInterval: rec.analysisInterval,
      analysisBiasInterval: rec.analysisBiasInterval,
      objectiveHorizon: rec.objectiveHorizon,
      entry: rec.entry,
      stopLoss: rec.stopLoss,
      takeProfit: rec.takeProfit,
      expectedLow: rec.expectedLow,
      expectedHigh: rec.expectedHigh,
      indicators: {
        rsi14: rec.indicators.rsi14,
        ema20: rec.indicators.ema20,
        ema50: rec.indicators.ema50,
        macdHistogram: rec.indicators.macdHistogram,
        atr14: rec.indicators.atr14,
        adx14: rec.indicators.adx14,
        vwap: rec.indicators.vwap
      },
      perp: {
        fundingRate: rec.perp.fundingRate,
        premiumPct: rec.perp.premiumPct,
        openInterest: rec.perp.openInterest
      },
      keyRationale: rec.rationale.slice(0, 5)
    });
  }
}
