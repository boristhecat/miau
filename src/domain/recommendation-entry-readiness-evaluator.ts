import type {
  EntryReadinessAssessment,
  IndicatorSnapshot,
  MarketRegime,
  SequenceAssessment,
  SetupPlaybook,
  Signal
} from "./types.js";

interface EvaluateEntryReadinessInput {
  signal: Exclude<Signal, "NO_TRADE">;
  lastPrice: number;
  indicators: IndicatorSnapshot;
  marketRegime: MarketRegime;
  setupPlaybook?: SetupPlaybook;
  pullbackEntryPrice?: number;
  sequenceAssessment?: SequenceAssessment;
}

export class RecommendationEntryReadinessEvaluator {
  evaluate(input: EvaluateEntryReadinessInput): EntryReadinessAssessment {
    const atr = Math.max(input.indicators.atr14, 1e-8);
    const extensionAtr = this.computeExtensionFromEma(input.signal, input.lastPrice, input.indicators.ema20, atr);
    const reactionZone = this.resolveReactionZone(input.signal, input.indicators);
    const obstacleLevel = this.resolveObstacleLevel(input.signal, input.lastPrice, input.indicators);
    const invalidationLevel = this.resolveInvalidationLevel(input.signal, input.lastPrice, input.indicators);
    const reactionZoneDistanceAtr =
      reactionZone === undefined ? undefined : Math.abs(input.lastPrice - reactionZone) / atr;
    const obstacleDistanceAtr =
      obstacleLevel === undefined ? undefined : Math.abs(obstacleLevel - input.lastPrice) / atr;
    const recent = input.indicators.recentCandleContext;

    const ready = (message: string, preferredEntryPrice?: number): EntryReadinessAssessment => ({
      status: "READY_NOW",
      rationale: [message],
      preferredEntryPrice: preferredEntryPrice ?? input.lastPrice,
      invalidationLevel
    });
    const wait = (
      status: Exclude<EntryReadinessAssessment["status"], "READY_NOW">,
      message: string,
      preferredEntryPrice?: number
    ): EntryReadinessAssessment => ({
      status,
      rationale: [message],
      preferredEntryPrice,
      invalidationLevel
    });

    switch (input.setupPlaybook) {
      case "BREAKOUT_CONTINUATION": {
        if (input.sequenceAssessment?.status === "FAILED") {
          return wait("TOO_LATE", input.sequenceAssessment.rationale[0] ?? "Breakout sequence failed.");
        }
        if (input.sequenceAssessment?.status === "FORMING") {
          return wait(
            "WAIT_CONFIRMATION",
            input.sequenceAssessment?.rationale[0] ?? "Breakout playbook selected, but breakout confirmation is incomplete."
          );
        }
        const breakoutConfirmed =
          recent !== undefined &&
          ((input.signal === "LONG" && recent.breakoutDirection === "UP" && recent.bullishCloseRatio5 >= 0.6) ||
            (input.signal === "SHORT" && recent.breakoutDirection === "DOWN" && recent.bearishCloseRatio5 >= 0.6));
        if (!breakoutConfirmed) {
          return wait("WAIT_CONFIRMATION", "Breakout playbook selected, but breakout confirmation is incomplete.");
        }
        if (obstacleDistanceAtr !== undefined && obstacleDistanceAtr < 0.35) {
          return wait("TOO_LATE", "Breakout is running directly into nearby structure; avoid chasing into the obstacle.");
        }
        if (extensionAtr > 0.85) {
          return wait(
            "WAIT_BREAKOUT_RETEST",
            "Breakout continuation is extended from EMA20; wait for retest instead of market chasing.",
            input.pullbackEntryPrice
          );
        }
        return ready("Breakout continuation is confirmed and not materially extended.");
      }
      case "DIVERGENCE_REVERSAL":
      case "LIQUIDATION_REVERSAL":
      case "RANGE_FADE": {
        if (input.sequenceAssessment?.status === "FAILED") {
          return wait("WAIT_CONFIRMATION", input.sequenceAssessment.rationale[0] ?? "Reversal sequence is not confirmed.");
        }
        if (input.sequenceAssessment?.status === "FORMING") {
          return wait(
            "WAIT_CONFIRMATION",
            input.sequenceAssessment?.rationale[0] ?? "Reversal setup exists, but confirmation sequence is still forming.",
            reactionZone
          );
        }
        if (reactionZoneDistanceAtr === undefined || reactionZoneDistanceAtr > 0.55) {
          return wait(
            "WAIT_CONFIRMATION",
            "Reversal setup exists, but price is not close enough to the reaction zone yet.",
            reactionZone
          );
        }
        if (extensionAtr > 1.0) {
          return wait("TOO_LATE", "Reversal move has already expanded too far from the mean; avoid late entry.");
        }
        if (
          recent &&
          ((input.signal === "LONG" && recent.momentumPct3 < -0.25) ||
            (input.signal === "SHORT" && recent.momentumPct3 > 0.25))
        ) {
          return wait("WAIT_CONFIRMATION", "Reversal level is present, but acceleration is still too one-sided.");
        }
        return ready("Reversal playbook is near structure and no longer needs a deeper reset.", reactionZone);
      }
      case "TREND_PULLBACK_CONTINUATION":
      default: {
        if (input.sequenceAssessment?.status === "FAILED") {
          return wait("WAIT_CONFIRMATION", input.sequenceAssessment.rationale[0] ?? "Continuation reclaim failed.");
        }
        if (input.sequenceAssessment?.status === "FORMING" && input.pullbackEntryPrice === undefined) {
          return wait(
            "WAIT_CONFIRMATION",
            input.sequenceAssessment.rationale[0] ?? "Continuation sequence is improving but not confirmed."
          );
        }
        if (obstacleDistanceAtr !== undefined && obstacleDistanceAtr < 0.3) {
          return wait("TOO_LATE", "Trend continuation would enter directly into nearby opposing structure.");
        }
        if (input.pullbackEntryPrice !== undefined && this.isMeaningfullyAway(input.signal, input.lastPrice, input.pullbackEntryPrice, atr)) {
          return wait(
            "WAIT_PULLBACK",
            "Trend setup is valid, but market entry is extended; wait for pullback toward the preferred entry.",
            input.pullbackEntryPrice
          );
        }
        if (reactionZoneDistanceAtr !== undefined && reactionZoneDistanceAtr > 0.95 && extensionAtr > 0.7) {
          return wait(
            "WAIT_PULLBACK",
            "Continuation setup is too far from its reaction zone; wait for price to reset.",
            input.pullbackEntryPrice ?? reactionZone
          );
        }
        if (input.marketRegime === "RANGE" && reactionZoneDistanceAtr !== undefined && reactionZoneDistanceAtr > 0.7) {
          return wait("WAIT_CONFIRMATION", "Range context requires cleaner level touch before entry.");
        }
        return ready("Continuation setup is close enough to structure for a timely entry.", input.pullbackEntryPrice);
      }
    }
  }

  private computeExtensionFromEma(
    signal: Exclude<Signal, "NO_TRADE">,
    lastPrice: number,
    ema20: number,
    atr: number
  ): number {
    return signal === "LONG" ? Math.max(0, lastPrice - ema20) / atr : Math.max(0, ema20 - lastPrice) / atr;
  }

  private isMeaningfullyAway(
    signal: Exclude<Signal, "NO_TRADE">,
    lastPrice: number,
    preferredEntryPrice: number,
    atr: number
  ): boolean {
    if (signal === "LONG") {
      return lastPrice - preferredEntryPrice > atr * 0.22;
    }
    return preferredEntryPrice - lastPrice > atr * 0.22;
  }

  private resolveReactionZone(
    signal: Exclude<Signal, "NO_TRADE">,
    indicators: IndicatorSnapshot
  ): number | undefined {
    if (signal === "LONG") {
      return [
        indicators.nearestSupportLevel,
        indicators.sessionLevels?.currentLow,
        indicators.sessionLevels?.priorLow,
        indicators.dailyLevels?.priorLow,
        indicators.swingLow,
        indicators.volumeProfile?.val,
        indicators.bbLower,
        indicators.ema20
      ].find((value): value is number => value !== undefined);
    }

    return [
      indicators.nearestResistanceLevel,
      indicators.sessionLevels?.currentHigh,
      indicators.sessionLevels?.priorHigh,
      indicators.dailyLevels?.priorHigh,
      indicators.swingHigh,
      indicators.volumeProfile?.vah,
      indicators.bbUpper,
      indicators.ema20
    ].find((value): value is number => value !== undefined);
  }

  private resolveObstacleLevel(
    signal: Exclude<Signal, "NO_TRADE">,
    lastPrice: number,
    indicators: IndicatorSnapshot
  ): number | undefined {
    if (signal === "LONG") {
      return [
        indicators.nearestResistanceLevel,
        indicators.sessionLevels?.currentHigh,
        indicators.sessionLevels?.priorHigh,
        indicators.dailyLevels?.priorHigh,
        indicators.swingHigh
      ].find((value): value is number => value !== undefined && value > lastPrice);
    }

    return [
      indicators.nearestSupportLevel,
      indicators.sessionLevels?.currentLow,
      indicators.sessionLevels?.priorLow,
      indicators.dailyLevels?.priorLow,
      indicators.swingLow
    ].find((value): value is number => value !== undefined && value < lastPrice);
  }

  private resolveInvalidationLevel(
    signal: Exclude<Signal, "NO_TRADE">,
    lastPrice: number,
    indicators: IndicatorSnapshot
  ): number | undefined {
    if (signal === "LONG") {
      return [
        indicators.swingLow,
        indicators.nearestSupportLevel,
        indicators.sessionLevels?.currentLow,
        indicators.sessionLevels?.priorLow,
        indicators.dailyLevels?.priorLow,
        indicators.bbLower
      ].find((value): value is number => value !== undefined && value < lastPrice);
    }

    return [
      indicators.swingHigh,
      indicators.nearestResistanceLevel,
      indicators.sessionLevels?.currentHigh,
      indicators.sessionLevels?.priorHigh,
      indicators.dailyLevels?.priorHigh,
      indicators.bbUpper
    ].find((value): value is number => value !== undefined && value > lastPrice);
  }
}
