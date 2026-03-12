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
}
