import type { Recommendation } from "./types.js";
import type {
  TradeHealthAssessment,
  TradeManagementAssessment,
  TradeMonitorBaseline,
  TradeMonitorMetrics
} from "./trade-monitor-types.js";

export class TradeManagementEvaluator {
  evaluate(input: {
    baseline: TradeMonitorBaseline;
    analysisRecommendation: Recommendation;
    metrics: TradeMonitorMetrics;
    health: TradeHealthAssessment;
    /** Number of consecutive ticks where health was DEGRADING (caller tracks this). */
    consecutiveDegradingTicks?: number;
  }): TradeManagementAssessment {
    if (input.metrics.stopHit) {
      return {
        action: "STOP_HIT",
        rationale: ["Stop-loss threshold has been reached; the trade thesis is invalidated."]
      };
    }
    if (input.metrics.targetHit) {
      return {
        action: "TARGET_HIT",
        rationale: ["Take-profit threshold has been reached."]
      };
    }
    if (input.health.status === "BROKEN") {
      return {
        action: "EXIT_EARLY",
        rationale: input.health.rationale
      };
    }

    // MFE retracement: if trade reached 1.5R+ and has retraced to <0.5R, exit early
    const mfeR = this.computeMfeR(input.metrics, input.baseline);
    if (mfeR >= 1.5 && input.metrics.currentR < 0.5) {
      return {
        action: "EXIT_EARLY",
        rationale: [
          `Trade reached ${mfeR.toFixed(1)}R but has retraced to ${input.metrics.currentR.toFixed(1)}R; gave back too much favorable excursion.`
        ]
      };
    }

    // Consecutive degradation escalation: if DEGRADING for too many ticks, escalate to EXIT_EARLY
    const degradingThreshold = 6;
    if (
      input.health.status === "DEGRADING" &&
      input.consecutiveDegradingTicks !== undefined &&
      input.consecutiveDegradingTicks >= degradingThreshold
    ) {
      return {
        action: "EXIT_EARLY",
        rationale: [
          `Trade has been DEGRADING for ${input.consecutiveDegradingTicks} consecutive evaluations without recovery.`,
          ...input.health.rationale.slice(0, 2)
        ]
      };
    }

    if (
      input.metrics.currentR >= 1.5 ||
      (input.metrics.holdingProgressPct !== undefined &&
        input.metrics.holdingProgressPct >= 75 &&
        input.metrics.currentR >= 0.8)
    ) {
      return {
        action: "TAKE_PARTIAL",
        rationale: ["Trade has delivered meaningful progress; partial de-risking is justified."]
      };
    }

    // MFE retracement warning: reached 1R+ but retraced below 0.5R
    if (mfeR >= 1 && input.metrics.currentR < 0.5) {
      return {
        action: "TAKE_PARTIAL",
        rationale: [
          `Trade reached ${mfeR.toFixed(1)}R peak but has retraced to ${input.metrics.currentR.toFixed(1)}R; lock in remaining gains.`
        ]
      };
    }

    if (input.metrics.currentR >= 1) {
      return {
        action: "MOVE_TO_BREAKEVEN",
        rationale: ["Trade has moved at least 1R in favor; breakeven protection is reasonable."]
      };
    }
    if (input.health.status === "DEGRADING") {
      return {
        action: "AT_RISK",
        rationale: input.health.rationale
      };
    }
    return {
      action: "HOLD",
      rationale: ["Thesis remains intact and the trade has not yet earned an active management change."]
    };
  }

  /** Convert MFE percentage into R units using the trade's risk distance. */
  private computeMfeR(metrics: TradeMonitorMetrics, baseline: TradeMonitorBaseline): number {
    const trade = baseline.trade;
    const riskDistance =
      trade.side === "LONG"
        ? Math.max(trade.entry - trade.stopLoss, 1e-8)
        : Math.max(trade.stopLoss - trade.entry, 1e-8);
    const riskPct = (riskDistance / trade.entry) * 100;
    if (riskPct <= 0) return 0;
    return metrics.maxFavorableExcursionPct / riskPct;
  }
}
