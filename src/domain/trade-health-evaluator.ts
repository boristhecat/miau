import type { Recommendation } from "./types.js";
import type { TradeHealthAssessment, TradeMonitorBaseline, TradeMonitorMetrics } from "./trade-monitor-types.js";

export class TradeHealthEvaluator {
  evaluate(input: {
    baseline: TradeMonitorBaseline;
    analysisRecommendation: Recommendation;
    metrics: TradeMonitorMetrics;
  }): TradeHealthAssessment {
    if (input.metrics.stopHit) {
      return {
        status: "COMPLETED",
        rationale: ["Price has reached or crossed the stop-loss level."]
      };
    }
    if (input.metrics.targetHit) {
      return {
        status: "COMPLETED",
        rationale: ["Price has reached or crossed the take-profit level."]
      };
    }

    const brokenReasons: string[] = [];
    if (input.analysisRecommendation.marketTradeability === "DO_NOT_TRADE") {
      brokenReasons.push("Market tradeability has flipped to DO_NOT_TRADE.");
    }
    if (input.analysisRecommendation.playbookRegimeAligned === false) {
      brokenReasons.push("Current market regime no longer supports the active playbook.");
    }
    if (input.analysisRecommendation.sequenceStatus === "FAILED") {
      brokenReasons.push(
        input.analysisRecommendation.sequenceReasons?.[0] ?? "The short-term trigger sequence has failed."
      );
    }
    if (
      input.analysisRecommendation.modelSignal !== undefined &&
      input.analysisRecommendation.modelSignal !== input.baseline.trade.side
    ) {
      brokenReasons.push(`Directional model now opposes the active ${input.baseline.trade.side} thesis.`);
    }
    if (
      input.metrics.holdingProgressPct !== undefined &&
      input.metrics.holdingProgressPct > 140 &&
      input.metrics.grossUnrealizedPnlPct <= 0
    ) {
      brokenReasons.push("Trade has exceeded the expected holding window without positive progress.");
    }
    if (brokenReasons.length > 0) {
      return {
        status: "BROKEN",
        rationale: brokenReasons.slice(0, 3)
      };
    }

    const degradingReasons: string[] = [];
    if (input.analysisRecommendation.signal === "NO_TRADE") {
      degradingReasons.push("Fresh analysis no longer sees an actionable setup in this direction.");
    }
    if (
      input.analysisRecommendation.entryReadiness !== undefined &&
      input.analysisRecommendation.entryReadiness !== "READY_NOW"
    ) {
      degradingReasons.push(
        input.analysisRecommendation.entryReadinessReasons?.[0] ??
          `Entry-readiness has deteriorated to ${input.analysisRecommendation.entryReadiness}.`
      );
    }
    if (
      input.analysisRecommendation.sequenceStatus === "FORMING" ||
      input.analysisRecommendation.sequenceStatus === "NONE"
    ) {
      degradingReasons.push(
        input.analysisRecommendation.sequenceReasons?.[0] ?? "The trigger sequence is no longer firmly confirmed."
      );
    }
    if (input.analysisRecommendation.levelInteractionStatus === "TESTING") {
      degradingReasons.push(
        input.analysisRecommendation.levelInteractionReasons?.[0] ??
          "Price is still testing the active key level."
      );
    }
    if (
      input.analysisRecommendation.setupPlaybook !== undefined &&
      input.baseline.baselinePlaybook !== undefined &&
      input.analysisRecommendation.setupPlaybook !== input.baseline.baselinePlaybook
    ) {
      degradingReasons.push(
        `Setup classification has shifted from ${input.baseline.baselinePlaybook} to ${input.analysisRecommendation.setupPlaybook}.`
      );
    }
    if (input.metrics.currentR < 0) {
      degradingReasons.push("Trade is currently underwater relative to the initial risk.");
    }
    if (input.metrics.holdingProgressPct !== undefined && input.metrics.holdingProgressPct > 100) {
      degradingReasons.push("Trade is past its expected holding window and now needs tighter review.");
    }

    if (degradingReasons.length > 0) {
      return {
        status: "DEGRADING",
        rationale: degradingReasons.slice(0, 3)
      };
    }

    return {
      status: "INTACT",
      rationale: ["Regime, sequence, and structure still support the active trade thesis."]
    };
  }
}
