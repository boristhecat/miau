import type { Recommendation } from "../domain/types.js";
import type { AiAdvice, AiAdvisorPort } from "../ports/ai-advisor-port.js";

interface Deps {
  aiAdvisor: AiAdvisorPort;
}

export class GenerateAiAdviceUseCase {
  constructor(private readonly deps: Deps) {}

  async execute(input: { recommendation: Recommendation }): Promise<AiAdvice> {
    const rec = input.recommendation;
    const advice = await this.deps.aiAdvisor.advise({
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
    this.assertConsistency(advice, rec);
    return advice;
  }

  private assertConsistency(advice: AiAdvice, rec: Recommendation): void {
    if (!advice.veto && advice.bias === "NO_TRADE") {
      throw new Error("AI response is inconsistent: veto=false requires bias LONG or SHORT.");
    }
    if (advice.veto) {
      if (advice.bias !== "NO_TRADE") {
        throw new Error("AI response is inconsistent: veto=true requires bias NO_TRADE.");
      }
      if (advice.changeDirection || advice.changeEntry || advice.changeStopLoss || advice.changeTakeProfit) {
        throw new Error("AI response is inconsistent: veto=true requires all change flags to be false.");
      }
    }

    if (advice.changeDirection) {
      if (!advice.suggestedDirection) {
        throw new Error("AI response is inconsistent: changeDirection=true requires suggestedDirection.");
      }
      if (advice.suggestedDirection === rec.signal) {
        throw new Error("AI response is inconsistent: changeDirection=true but suggestedDirection equals current signal.");
      }
    } else if (advice.suggestedDirection && advice.suggestedDirection !== rec.signal) {
      throw new Error("AI response is inconsistent: changeDirection=false but suggestedDirection differs from current signal.");
    }

    this.assertLevelConsistency("Entry", advice.changeEntry, advice.suggestedEntry, rec.entry);
    this.assertLevelConsistency("StopLoss", advice.changeStopLoss, advice.suggestedStopLoss, rec.stopLoss);
    this.assertLevelConsistency("TakeProfit", advice.changeTakeProfit, advice.suggestedTakeProfit, rec.takeProfit);
  }

  private assertLevelConsistency(
    label: "Entry" | "StopLoss" | "TakeProfit",
    changeFlag: boolean,
    suggested: number | undefined,
    current: number
  ): void {
    const sameValue = suggested !== undefined && Math.abs(suggested - current) <= 1e-9;
    if (changeFlag && (suggested === undefined || sameValue)) {
      throw new Error(`AI response is inconsistent: change${label}=true requires a different suggested${label} value.`);
    }
    if (!changeFlag && suggested !== undefined && !sameValue) {
      throw new Error(`AI response is inconsistent: change${label}=false but suggested${label} differs from current level.`);
    }
  }
}
