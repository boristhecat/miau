import type { Recommendation } from "./types.js";
import type { TradeHealthAssessment, TradeMonitorBaseline, TradeMonitorMetrics } from "./trade-monitor-types.js";

/** Weighted degradation reason: higher severity = more likely to escalate. */
interface WeightedReason {
  readonly message: string;
  readonly severity: number;
}

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
      input.metrics.holdingProgressPct > 120 &&
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

    // Grace period: first 20% of expected holding period allows structural signals to settle
    const gracePeriodSeconds = (input.baseline.baselineHoldingPeriodMinutes ?? 15) * 60 * 0.2;
    const inGracePeriod = input.metrics.timeInTradeSeconds < gracePeriodSeconds;

    const degradingReasons: WeightedReason[] = [];

    // Severity 3 — strong thesis deterioration
    if (input.analysisRecommendation.signal === "NO_TRADE") {
      degradingReasons.push({
        message: "Fresh analysis no longer sees an actionable setup in this direction.",
        severity: 3
      });
    }
    if (
      input.analysisRecommendation.setupPlaybook !== undefined &&
      input.baseline.baselinePlaybook !== undefined &&
      input.analysisRecommendation.setupPlaybook !== input.baseline.baselinePlaybook
    ) {
      degradingReasons.push({
        message: `Setup classification has shifted from ${input.baseline.baselinePlaybook} to ${input.analysisRecommendation.setupPlaybook}.`,
        severity: 3
      });
    }

    // Severity 2 — meaningful structural change
    if (
      !inGracePeriod &&
      input.analysisRecommendation.entryReadiness !== undefined &&
      input.analysisRecommendation.entryReadiness !== "READY_NOW"
    ) {
      degradingReasons.push({
        message:
          input.analysisRecommendation.entryReadinessReasons?.[0] ??
          `Entry-readiness has deteriorated to ${input.analysisRecommendation.entryReadiness}.`,
        severity: 2
      });
    }
    if (input.metrics.currentR < 0) {
      degradingReasons.push({
        message: "Trade is currently underwater relative to the initial risk.",
        severity: 2
      });
    }
    if (input.metrics.holdingProgressPct !== undefined && input.metrics.holdingProgressPct > 100) {
      degradingReasons.push({
        message: "Trade is past its expected holding window and now needs tighter review.",
        severity: 2
      });
    }

    // Severity 1 — expected to resolve, especially during grace period
    // Skip low-severity sequence/level checks entirely during grace period
    if (!inGracePeriod) {
      if (
        input.analysisRecommendation.sequenceStatus === "FORMING" ||
        input.analysisRecommendation.sequenceStatus === "NONE"
      ) {
        // Only flag if sequence was CONFIRMED at baseline — if it was already FORMING at entry, this is expected
        const wasConfirmedAtBaseline = input.baseline.baselineSequenceStatus === "CONFIRMED";
        if (wasConfirmedAtBaseline) {
          degradingReasons.push({
            message:
              input.analysisRecommendation.sequenceReasons?.[0] ??
              "The trigger sequence is no longer firmly confirmed.",
            severity: 1
          });
        }
      }
      if (input.analysisRecommendation.levelInteractionStatus === "TESTING") {
        degradingReasons.push({
          message:
            input.analysisRecommendation.levelInteractionReasons?.[0] ??
            "Price is still testing the active key level.",
          severity: 1
        });
      }
    }

    // Only flag DEGRADING if there is at least one severity ≥ 2 reason, or multiple severity 1 reasons
    const maxSeverity = degradingReasons.reduce((max, r) => Math.max(max, r.severity), 0);
    const totalSeverity = degradingReasons.reduce((sum, r) => sum + r.severity, 0);
    if (maxSeverity >= 2 || totalSeverity >= 3) {
      return {
        status: "DEGRADING",
        rationale: degradingReasons
          .sort((a, b) => b.severity - a.severity)
          .slice(0, 3)
          .map((r) => r.message)
      };
    }

    return {
      status: "INTACT",
      rationale: ["Regime, sequence, and structure still support the active trade thesis."]
    };
  }
}
