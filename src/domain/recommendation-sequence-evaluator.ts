import type {
  IndicatorSnapshot,
  SequenceAssessment,
  SequencePattern,
  SequenceStatus,
  SetupPlaybook,
  Signal
} from "./types.js";

interface EvaluateSequenceInput {
  signal: Exclude<Signal, "NO_TRADE">;
  indicators: IndicatorSnapshot;
  setupPlaybook?: SetupPlaybook;
}

export class RecommendationSequenceEvaluator {
  evaluate(input: EvaluateSequenceInput): SequenceAssessment {
    const recent = input.indicators.recentCandleContext;
    if (!recent) {
      return this.result("NONE", "NONE", "No recent candle sequence context available.");
    }
    if (
      recent.lastClose === undefined ||
      recent.previousClose === undefined ||
      recent.lastClosePositionInRange === undefined ||
      recent.upperWickPct === undefined ||
      recent.lowerWickPct === undefined
    ) {
      return this.result("NONE", "NONE", "Recent candles do not contain enough sequence detail yet.");
    }

    const aboveVwapNow = recent.lastClose > input.indicators.vwap;
    const aboveVwapPrev = recent.previousClose > input.indicators.vwap;
    const aboveEmaNow = recent.lastClose > input.indicators.ema20;
    const aboveEmaPrev = recent.previousClose > input.indicators.ema20;
    const strongBullClose = recent.lastClosePositionInRange >= 0.65 && recent.upperWickPct <= 0.25;
    const strongBearClose = recent.lastClosePositionInRange <= 0.35 && recent.lowerWickPct <= 0.25;

    if (input.signal === "LONG") {
      return this.evaluateLongSequence(input.setupPlaybook, recent, {
        aboveVwapNow,
        aboveVwapPrev,
        aboveEmaNow,
        aboveEmaPrev,
        strongBullClose,
        strongBearClose
      });
    }

    return this.evaluateShortSequence(input.setupPlaybook, recent, {
      aboveVwapNow,
      aboveVwapPrev,
      aboveEmaNow,
      aboveEmaPrev,
      strongBullClose,
      strongBearClose
    });
  }

  private evaluateLongSequence(
    setupPlaybook: SetupPlaybook | undefined,
    recent: NonNullable<IndicatorSnapshot["recentCandleContext"]>,
    derived: {
      aboveVwapNow: boolean;
      aboveVwapPrev: boolean;
      aboveEmaNow: boolean;
      aboveEmaPrev: boolean;
      strongBullClose: boolean;
      strongBearClose: boolean;
    }
  ): SequenceAssessment {
    const closePosition = recent.lastClosePositionInRange ?? 0.5;
    switch (setupPlaybook) {
      case "BREAKOUT_CONTINUATION":
        if (recent.breakoutDirection === "UP" && derived.strongBullClose && !Boolean(recent.closedBackInsidePrevRange)) {
          return this.result("CONFIRMED", "BREAKOUT_ACCEPTANCE", "Breakout candle closed strong above prior range.");
        }
        if (Boolean(recent.sweptPrevHigh) && Boolean(recent.closedBackInsidePrevRange) && derived.strongBearClose) {
          return this.result("FAILED", "BREAKOUT_FAILURE", "Breakout attempt was rejected back inside the prior range.");
        }
        if (recent.breakoutDirection === "UP" || (derived.aboveVwapNow && recent.bullishCloseRatio5 >= 0.6)) {
          return this.result("FORMING", "VWAP_RECLAIM", "Breakout sequence is forming but still needs clean acceptance.");
        }
        return this.result("NONE", "NONE", "No confirmed breakout sequence detected.");
      case "DIVERGENCE_REVERSAL":
      case "LIQUIDATION_REVERSAL":
      case "RANGE_FADE":
        if (Boolean(recent.sweptPrevLow) && derived.strongBullClose) {
          return this.result("CONFIRMED", "SWEEP_REJECTION", "Price swept the prior low and closed back strong into range.");
        }
        if (recent.breakoutDirection === "DOWN" && derived.strongBearClose && !Boolean(recent.closedBackInsidePrevRange)) {
          return this.result("FAILED", "BREAKOUT_FAILURE", "Downside acceptance is still active; reversal sequence is not confirmed.");
        }
        if (!derived.aboveVwapPrev && derived.aboveVwapNow && closePosition >= 0.55) {
          return this.result("FORMING", "VWAP_RECLAIM", "Reversal is reclaiming VWAP but still needs stronger acceptance.");
        }
        return this.result("FORMING", "NONE", "Reversal setup exists, but sweep/reclaim confirmation is still forming.");
      case "TREND_PULLBACK_CONTINUATION":
      default:
        if (Boolean(recent.sweptPrevLow) && derived.strongBullClose && derived.aboveEmaNow) {
          return this.result("CONFIRMED", "SWEEP_REJECTION", "Pullback swept local lows and reclaimed trend structure.");
        }
        if (!derived.aboveVwapPrev && derived.aboveVwapNow && derived.strongBullClose) {
          return this.result("CONFIRMED", "VWAP_RECLAIM", "Price reclaimed VWAP with a strong bullish close.");
        }
        if (!derived.aboveEmaPrev && derived.aboveEmaNow && derived.strongBullClose) {
          return this.result("CONFIRMED", "EMA_RECLAIM", "Price reclaimed EMA20 with a strong bullish close.");
        }
        if (recent.breakoutDirection === "DOWN" && derived.strongBearClose && !Boolean(recent.closedBackInsidePrevRange)) {
          return this.result("FAILED", "BREAKOUT_FAILURE", "Short-term sequence is still accepting lower prices.");
        }
        if (derived.aboveVwapNow || derived.aboveEmaNow) {
          return this.result("FORMING", "VWAP_RECLAIM", "Continuation sequence is improving but reclaim quality is incomplete.");
        }
        return this.result("NONE", "NONE", "No continuation reclaim sequence detected.");
    }
  }

  private evaluateShortSequence(
    setupPlaybook: SetupPlaybook | undefined,
    recent: NonNullable<IndicatorSnapshot["recentCandleContext"]>,
    derived: {
      aboveVwapNow: boolean;
      aboveVwapPrev: boolean;
      aboveEmaNow: boolean;
      aboveEmaPrev: boolean;
      strongBullClose: boolean;
      strongBearClose: boolean;
    }
  ): SequenceAssessment {
    const closePosition = recent.lastClosePositionInRange ?? 0.5;
    switch (setupPlaybook) {
      case "BREAKOUT_CONTINUATION":
        if (recent.breakoutDirection === "DOWN" && derived.strongBearClose && !Boolean(recent.closedBackInsidePrevRange)) {
          return this.result("CONFIRMED", "BREAKOUT_ACCEPTANCE", "Breakdown candle closed strong below prior range.");
        }
        if (Boolean(recent.sweptPrevLow) && Boolean(recent.closedBackInsidePrevRange) && derived.strongBullClose) {
          return this.result("FAILED", "BREAKOUT_FAILURE", "Breakdown attempt was rejected back inside the prior range.");
        }
        if (recent.breakoutDirection === "DOWN" || (!derived.aboveVwapNow && recent.bearishCloseRatio5 >= 0.6)) {
          return this.result("FORMING", "VWAP_RECLAIM", "Breakdown sequence is forming but still needs clean acceptance.");
        }
        return this.result("NONE", "NONE", "No confirmed breakdown sequence detected.");
      case "DIVERGENCE_REVERSAL":
      case "LIQUIDATION_REVERSAL":
      case "RANGE_FADE":
        if (Boolean(recent.sweptPrevHigh) && derived.strongBearClose) {
          return this.result("CONFIRMED", "SWEEP_REJECTION", "Price swept the prior high and closed back weak into range.");
        }
        if (recent.breakoutDirection === "UP" && derived.strongBullClose && !Boolean(recent.closedBackInsidePrevRange)) {
          return this.result("FAILED", "BREAKOUT_FAILURE", "Upside acceptance is still active; reversal sequence is not confirmed.");
        }
        if (derived.aboveVwapPrev && !derived.aboveVwapNow && closePosition <= 0.45) {
          return this.result("FORMING", "VWAP_RECLAIM", "Reversal is losing VWAP support but still needs stronger rejection.");
        }
        return this.result("FORMING", "NONE", "Reversal setup exists, but sweep/rejection confirmation is still forming.");
      case "TREND_PULLBACK_CONTINUATION":
      default:
        if (Boolean(recent.sweptPrevHigh) && derived.strongBearClose && !derived.aboveEmaNow) {
          return this.result("CONFIRMED", "SWEEP_REJECTION", "Pullback swept local highs and rejected back into trend.");
        }
        if (derived.aboveVwapPrev && !derived.aboveVwapNow && derived.strongBearClose) {
          return this.result("CONFIRMED", "VWAP_RECLAIM", "Price lost VWAP with a strong bearish close.");
        }
        if (derived.aboveEmaPrev && !derived.aboveEmaNow && derived.strongBearClose) {
          return this.result("CONFIRMED", "EMA_RECLAIM", "Price lost EMA20 with a strong bearish close.");
        }
        if (recent.breakoutDirection === "UP" && derived.strongBullClose && !Boolean(recent.closedBackInsidePrevRange)) {
          return this.result("FAILED", "BREAKOUT_FAILURE", "Short-term sequence is still accepting higher prices.");
        }
        if (!derived.aboveVwapNow || !derived.aboveEmaNow) {
          return this.result("FORMING", "VWAP_RECLAIM", "Continuation sequence is improving but rejection quality is incomplete.");
        }
        return this.result("NONE", "NONE", "No continuation rejection sequence detected.");
    }
  }

  private result(status: SequenceStatus, pattern: SequencePattern, message: string): SequenceAssessment {
    return {
      status,
      pattern,
      rationale: [message]
    };
  }
}
