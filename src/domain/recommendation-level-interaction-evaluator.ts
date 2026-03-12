import type {
  IndicatorSnapshot,
  LevelInteractionAssessment,
  LevelInteractionReference,
  SetupPlaybook,
  Signal
} from "./types.js";

interface EvaluateLevelInteractionInput {
  signal: Exclude<Signal, "NO_TRADE">;
  lastPrice: number;
  indicators: IndicatorSnapshot;
  setupPlaybook?: SetupPlaybook;
}

export class RecommendationLevelInteractionEvaluator {
  evaluate(input: EvaluateLevelInteractionInput): LevelInteractionAssessment {
    const recent = input.indicators.recentCandleContext;
    if (
      !recent ||
      recent.lastClose === undefined ||
      recent.previousClose === undefined ||
      recent.lastHigh === undefined ||
      recent.lastLow === undefined ||
      recent.lastClosePositionInRange === undefined
    ) {
      return this.result("NONE", "NONE", "No detailed key-level interaction context available.");
    }

    const atr = Math.max(input.indicators.atr14, 1e-8);
    const candidates = this.resolveCandidates(input.signal, input.indicators, input.setupPlaybook);

    for (const candidate of candidates) {
      const outcome = this.evaluateCandidate(input.signal, recent, candidate.reference, candidate.level, input.lastPrice, atr);
      if (outcome.status !== "NONE") {
        return outcome;
      }
    }

    return this.result("NONE", "NONE", "No meaningful session/day level interaction is active.");
  }

  private resolveCandidates(
    signal: Exclude<Signal, "NO_TRADE">,
    indicators: IndicatorSnapshot,
    playbook?: SetupPlaybook
  ): Array<{ reference: LevelInteractionReference; level: number }> {
    if (signal === "LONG") {
      switch (playbook) {
        case "BREAKOUT_CONTINUATION":
          return this.compact([
            ["PRIOR_SESSION_HIGH", indicators.sessionLevels?.priorHigh],
            ["PRIOR_DAY_HIGH", indicators.dailyLevels?.priorHigh],
            ["NEAREST_RESISTANCE", indicators.nearestResistanceLevel]
          ]);
        case "DIVERGENCE_REVERSAL":
        case "LIQUIDATION_REVERSAL":
        case "RANGE_FADE":
          return this.compact([
            ["PRIOR_SESSION_LOW", indicators.sessionLevels?.priorLow],
            ["PRIOR_DAY_LOW", indicators.dailyLevels?.priorLow],
            ["NEAREST_SUPPORT", indicators.nearestSupportLevel],
            ["VWAP", indicators.vwap]
          ]);
        case "TREND_PULLBACK_CONTINUATION":
        default:
          return this.compact([
            ["CURRENT_SESSION_OPEN", indicators.sessionLevels?.currentOpen],
            ["CURRENT_DAY_OPEN", indicators.dailyLevels?.currentOpen],
            ["VWAP", indicators.vwap],
            ["EMA20", indicators.ema20],
            ["NEAREST_SUPPORT", indicators.nearestSupportLevel]
          ]);
      }
    }

    switch (playbook) {
      case "BREAKOUT_CONTINUATION":
        return this.compact([
          ["PRIOR_SESSION_LOW", indicators.sessionLevels?.priorLow],
          ["PRIOR_DAY_LOW", indicators.dailyLevels?.priorLow],
          ["NEAREST_SUPPORT", indicators.nearestSupportLevel]
        ]);
      case "DIVERGENCE_REVERSAL":
      case "LIQUIDATION_REVERSAL":
      case "RANGE_FADE":
        return this.compact([
          ["PRIOR_SESSION_HIGH", indicators.sessionLevels?.priorHigh],
          ["PRIOR_DAY_HIGH", indicators.dailyLevels?.priorHigh],
          ["NEAREST_RESISTANCE", indicators.nearestResistanceLevel],
          ["VWAP", indicators.vwap]
        ]);
      case "TREND_PULLBACK_CONTINUATION":
      default:
        return this.compact([
          ["CURRENT_SESSION_OPEN", indicators.sessionLevels?.currentOpen],
          ["CURRENT_DAY_OPEN", indicators.dailyLevels?.currentOpen],
          ["VWAP", indicators.vwap],
          ["EMA20", indicators.ema20],
          ["NEAREST_RESISTANCE", indicators.nearestResistanceLevel]
        ]);
    }
  }

  private compact(entries: Array<[LevelInteractionReference, number | undefined]>): Array<{ reference: LevelInteractionReference; level: number }> {
    return entries
      .filter((entry): entry is [LevelInteractionReference, number] => entry[1] !== undefined)
      .map(([reference, level]) => ({ reference, level }));
  }

  private evaluateCandidate(
    signal: Exclude<Signal, "NO_TRADE">,
    recent: NonNullable<IndicatorSnapshot["recentCandleContext"]>,
    reference: LevelInteractionReference,
    level: number,
    lastPrice: number,
    atr: number
  ): LevelInteractionAssessment {
    const nearThreshold = atr * 0.22;
    const distance = Math.abs(lastPrice - level);
    const closePosition = recent.lastClosePositionInRange ?? 0.5;
    const previousClose = recent.previousClose ?? recent.lastClose ?? lastPrice;
    const lastClose = recent.lastClose ?? lastPrice;
    const lastLow = recent.lastLow ?? lastPrice;
    const lastHigh = recent.lastHigh ?? lastPrice;
    const strongBullClose = closePosition >= 0.6;
    const strongBearClose = closePosition <= 0.4;

    if (signal === "LONG") {
      const accepted = previousClose < level && lastClose > level && strongBullClose;
      const rejected = lastLow < level && lastClose > level && strongBullClose;
      const lost = previousClose > level && lastClose < level && strongBearClose;
      if (accepted) {
        return this.result("ACCEPTED", reference, `Price reclaimed ${this.label(reference)} with a strong close.`);
      }
      if (rejected) {
        return this.result("REJECTED", reference, `Price rejected below ${this.label(reference)} and closed back above it.`);
      }
      if (lost) {
        return this.result("REJECTED", reference, `Price lost ${this.label(reference)} on the last candle.`);
      }
      if (distance <= nearThreshold) {
        return this.result("TESTING", reference, `Price is testing ${this.label(reference)} but has not resolved acceptance yet.`);
      }
      return this.result("NONE", "NONE", "");
    }

    const accepted = previousClose > level && lastClose < level && strongBearClose;
    const rejected = lastHigh > level && lastClose < level && strongBearClose;
    const lost = previousClose < level && lastClose > level && strongBullClose;
    if (accepted) {
      return this.result("ACCEPTED", reference, `Price accepted back below ${this.label(reference)} with a strong close.`);
    }
    if (rejected) {
      return this.result("REJECTED", reference, `Price rejected above ${this.label(reference)} and closed back below it.`);
    }
    if (lost) {
      return this.result("REJECTED", reference, `Price lost rejection control at ${this.label(reference)} on the last candle.`);
    }
    if (distance <= nearThreshold) {
      return this.result("TESTING", reference, `Price is testing ${this.label(reference)} but has not resolved rejection yet.`);
    }
    return this.result("NONE", "NONE", "");
  }

  private label(reference: LevelInteractionReference): string {
    switch (reference) {
      case "CURRENT_SESSION_OPEN":
        return "the current session open";
      case "PRIOR_SESSION_HIGH":
        return "the prior session high";
      case "PRIOR_SESSION_LOW":
        return "the prior session low";
      case "CURRENT_DAY_OPEN":
        return "the current day open";
      case "PRIOR_DAY_HIGH":
        return "the prior day high";
      case "PRIOR_DAY_LOW":
        return "the prior day low";
      case "NEAREST_SUPPORT":
        return "nearest structural support";
      case "NEAREST_RESISTANCE":
        return "nearest structural resistance";
      case "VWAP":
        return "VWAP";
      case "EMA20":
        return "EMA20";
      case "NONE":
      default:
        return "the active level";
    }
  }

  private result(
    status: LevelInteractionAssessment["status"],
    reference: LevelInteractionReference,
    message: string
  ): LevelInteractionAssessment {
    return {
      status,
      reference,
      rationale: message ? [message] : []
    };
  }
}
