import type { Candle, Signal } from "./types.js";

export type SimulationFailureType =
  | "NONE"
  | "WRONG_DIRECTION"
  | "STOP_TOO_TIGHT_REBOUND"
  | "TIMEOUT_LOSS"
  | "WHIPSAW_SL_TP";

export interface PaperTrade {
  signal: Exclude<Signal, "NO_TRADE">;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  openedAtMs: number;
  /** ATR at entry time — enables trailing stop when provided */
  atr?: number;
  /** Time-based exit: close position if TP not hit within this many candles */
  timeBasedExitCandles?: number;
}

export interface SimulationOutcome {
  status: "SUCCESS" | "FAILURE";
  failureType: SimulationFailureType;
  directionalCorrect: boolean;
  reason: string;
  exitPrice: number;
  pnlPct: number;
  maxFavorableExcursionPct: number;
  maxAdverseExcursionPct: number;
  /** True if the trailing stop mechanism was active and influenced the exit */
  trailingStopUsed?: boolean;
  /** Improvement #4: Which candle (1-indexed) the exit occurred on, for time-of-entry analysis */
  exitCandleIndex?: number;
  /** Total candles evaluated in the simulation window */
  totalCandles?: number;
}

export function evaluatePaperTrade(params: {
  trade: PaperTrade;
  candles: Candle[];
  horizonEndMs: number;
}): SimulationOutcome {
  const relevant = params.candles
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp)
    .filter((candle) => candle.timestamp > params.trade.openedAtMs && candle.timestamp <= params.horizonEndMs);
  const excursions = computeExcursions(params.trade.signal, params.trade.entry, relevant);

  const atr = params.trade.atr;
  const trailingEnabled = atr !== undefined && atr > 0;
  let currentStop = params.trade.stopLoss;
  let trailingStopUsed = false;
  let maxFavorableDistance = 0;

  for (let candleIdx = 0; candleIdx < relevant.length; candleIdx++) {
    const candle = relevant[candleIdx]!;
    // Update trailing stop based on max favorable excursion so far
    if (trailingEnabled) {
      const favorablePrice = params.trade.signal === "LONG" ? candle.high : candle.low;
      const favorableDistance = params.trade.signal === "LONG"
        ? favorablePrice - params.trade.entry
        : params.trade.entry - favorablePrice;

      if (favorableDistance > maxFavorableDistance) {
        maxFavorableDistance = favorableDistance;
      }

      // After 0.5 ATR favorable: trail stop to breakeven (entry)
      // After 1.0 ATR favorable: trail stop to 0.5 ATR profit
      if (maxFavorableDistance >= atr) {
        const trailTarget = params.trade.signal === "LONG"
          ? params.trade.entry + atr * 0.5
          : params.trade.entry - atr * 0.5;
        if (params.trade.signal === "LONG" && trailTarget > currentStop) {
          currentStop = trailTarget;
          trailingStopUsed = true;
        } else if (params.trade.signal === "SHORT" && trailTarget < currentStop) {
          currentStop = trailTarget;
          trailingStopUsed = true;
        }
      } else if (maxFavorableDistance >= atr * 0.5) {
        // Trail to breakeven
        if (params.trade.signal === "LONG" && params.trade.entry > currentStop) {
          currentStop = params.trade.entry;
          trailingStopUsed = true;
        } else if (params.trade.signal === "SHORT" && params.trade.entry < currentStop) {
          currentStop = params.trade.entry;
          trailingStopUsed = true;
        }
      }
    }

    // Phase 2c: Time-based exit — close at current price if TP not hit within timeBasedExitCandles
    if (params.trade.timeBasedExitCandles !== undefined && candleIdx + 1 >= params.trade.timeBasedExitCandles) {
      const exitPrice = candle.close;
      const pnl = computePnlPct(params.trade.signal, params.trade.entry, exitPrice);
      const favorable = pnl >= 0;
      return buildOutcome({
        signal: params.trade.signal,
        entry: params.trade.entry,
        exitPrice,
        status: favorable ? "success" : "failure",
        failureType: favorable ? "NONE" : "TIMEOUT_LOSS",
        directionalCorrect: favorable,
        reason: favorable
          ? "Time-based exit: TP not hit within holding period; closed with positive PnL."
          : "Time-based exit: TP not hit within holding period; closed with negative PnL.",
        excursions,
        trailingStopUsed,
        exitCandleIndex: candleIdx + 1,
        totalCandles: relevant.length
      });
    }

    if (params.trade.signal === "LONG") {
      const slHit = candle.low <= currentStop;
      const tpHit = candle.high >= params.trade.takeProfit;
      if (slHit && tpHit) {
        const closeAboveEntry = candle.close >= params.trade.entry;
        if (closeAboveEntry) {
          return buildOutcome({
            signal: params.trade.signal,
            entry: params.trade.entry,
            exitPrice: params.trade.takeProfit,
            status: "success",
            failureType: "NONE",
            directionalCorrect: true,
            reason: "Both SL and TP touched in same candle; close above entry suggests TP hit first.",
            excursions,
            trailingStopUsed,
            exitCandleIndex: candleIdx + 1,
            totalCandles: relevant.length
          });
        }
        const exitPrice = trailingStopUsed ? currentStop : params.trade.stopLoss;
        const isProfit = exitPrice >= params.trade.entry;
        return buildOutcome({
          signal: params.trade.signal,
          entry: params.trade.entry,
          exitPrice,
          status: isProfit ? "success" : "failure",
          failureType: isProfit ? "NONE" : "WHIPSAW_SL_TP",
          directionalCorrect: isProfit,
          reason: isProfit
            ? "Both SL and TP touched in same candle; trailing stop locked in profit."
            : "Both SL and TP touched in same candle; close below entry suggests SL hit first.",
          excursions,
          trailingStopUsed,
          exitCandleIndex: candleIdx + 1,
          totalCandles: relevant.length
        });
      }
      if (slHit) {
        const exitPrice = currentStop;
        const isTrailingProfit = trailingStopUsed && exitPrice >= params.trade.entry;
        if (isTrailingProfit) {
          return buildOutcome({
            signal: params.trade.signal,
            entry: params.trade.entry,
            exitPrice,
            status: "success",
            failureType: "NONE",
            directionalCorrect: true,
            reason: "Trailing stop locked in profit after favorable move.",
            excursions,
            trailingStopUsed: true,
            exitCandleIndex: candleIdx + 1,
            totalCandles: relevant.length
          });
        }
        const rebound = relevant
          .filter((next) => next.timestamp > candle.timestamp)
          .some((next) => next.high >= params.trade.entry);
        return buildOutcome({
          signal: params.trade.signal,
          entry: params.trade.entry,
          exitPrice: params.trade.stopLoss,
          status: "failure",
          failureType: rebound ? "STOP_TOO_TIGHT_REBOUND" : "WRONG_DIRECTION",
          directionalCorrect: rebound,
          reason: rebound
            ? "Stop-loss hit first, but price later reclaimed entry; likely tight-stop loss."
            : "Stop-loss was hit with no rebound to entry within the horizon.",
          excursions,
          trailingStopUsed,
          exitCandleIndex: candleIdx + 1,
          totalCandles: relevant.length
        });
      }
      if (tpHit) {
        return buildOutcome({
          signal: params.trade.signal,
          entry: params.trade.entry,
          exitPrice: params.trade.takeProfit,
          status: "success",
          failureType: "NONE",
          directionalCorrect: true,
          reason: "Take-profit was hit within the simulation window.",
          excursions,
          trailingStopUsed,
          exitCandleIndex: candleIdx + 1,
          totalCandles: relevant.length
        });
      }
      continue;
    }

    // SHORT
    const slHit = candle.high >= currentStop;
    const tpHit = candle.low <= params.trade.takeProfit;
    if (slHit && tpHit) {
      const closeBelowEntry = candle.close <= params.trade.entry;
      if (closeBelowEntry) {
        return buildOutcome({
          signal: params.trade.signal,
          entry: params.trade.entry,
          exitPrice: params.trade.takeProfit,
          status: "success",
          failureType: "NONE",
          directionalCorrect: true,
          reason: "Both SL and TP touched in same candle; close below entry suggests TP hit first.",
          excursions,
          trailingStopUsed,
          exitCandleIndex: candleIdx + 1,
          totalCandles: relevant.length
        });
      }
      const exitPrice = trailingStopUsed ? currentStop : params.trade.stopLoss;
      const isProfit = exitPrice <= params.trade.entry;
      return buildOutcome({
        signal: params.trade.signal,
        entry: params.trade.entry,
        exitPrice,
        status: isProfit ? "success" : "failure",
        failureType: isProfit ? "NONE" : "WHIPSAW_SL_TP",
        directionalCorrect: isProfit,
        reason: isProfit
          ? "Both SL and TP touched in same candle; trailing stop locked in profit."
          : "Both SL and TP touched in same candle; close above entry suggests SL hit first.",
        excursions,
        trailingStopUsed,
        exitCandleIndex: candleIdx + 1,
        totalCandles: relevant.length
      });
    }
    if (slHit) {
      const exitPrice = currentStop;
      const isTrailingProfit = trailingStopUsed && exitPrice <= params.trade.entry;
      if (isTrailingProfit) {
        return buildOutcome({
          signal: params.trade.signal,
          entry: params.trade.entry,
          exitPrice,
          status: "success",
          failureType: "NONE",
          directionalCorrect: true,
          reason: "Trailing stop locked in profit after favorable move.",
          excursions,
          trailingStopUsed: true,
          exitCandleIndex: candleIdx + 1,
          totalCandles: relevant.length
        });
      }
      const rebound = relevant
        .filter((next) => next.timestamp > candle.timestamp)
        .some((next) => next.low <= params.trade.entry);
      return buildOutcome({
        signal: params.trade.signal,
        entry: params.trade.entry,
        exitPrice: params.trade.stopLoss,
        status: "failure",
        failureType: rebound ? "STOP_TOO_TIGHT_REBOUND" : "WRONG_DIRECTION",
        directionalCorrect: rebound,
        reason: rebound
          ? "Stop-loss hit first, but price later reclaimed entry; likely tight-stop loss."
          : "Stop-loss was hit with no rebound to entry within the horizon.",
        excursions,
        trailingStopUsed,
        exitCandleIndex: candleIdx + 1,
        totalCandles: relevant.length
      });
    }
    if (tpHit) {
      return buildOutcome({
        signal: params.trade.signal,
        entry: params.trade.entry,
        exitPrice: params.trade.takeProfit,
        status: "success",
        failureType: "NONE",
        directionalCorrect: true,
        reason: "Take-profit was hit within the simulation window.",
        excursions,
        trailingStopUsed,
        exitCandleIndex: candleIdx + 1,
        totalCandles: relevant.length
      });
    }
  }

  const fallbackCandle =
    relevant[relevant.length - 1] ??
    params.candles
      .slice()
      .sort((a, b) => a.timestamp - b.timestamp)
      .filter((candle) => candle.timestamp <= params.horizonEndMs)
      .at(-1);

  if (!fallbackCandle) {
    throw new Error("Unable to evaluate simulation outcome because no candles were available.");
  }

  const finalPrice = fallbackCandle.close;
  const pnlPct = computePnlPct(params.trade.signal, params.trade.entry, finalPrice);
  const status = pnlPct >= 0 ? "SUCCESS" : "FAILURE";
  const reason =
    status === "SUCCESS"
      ? "No SL/TP hit; position closed at horizon with positive PnL."
      : "No SL/TP hit; position closed at horizon with negative PnL.";

  return {
    status,
    failureType: status === "SUCCESS" ? "NONE" : "TIMEOUT_LOSS",
    directionalCorrect: status === "SUCCESS",
    reason,
    exitPrice: finalPrice,
    pnlPct,
    maxFavorableExcursionPct: excursions.maxFavorableExcursionPct,
    maxAdverseExcursionPct: excursions.maxAdverseExcursionPct,
    trailingStopUsed
  };
}

function buildOutcome(input: {
  signal: Exclude<Signal, "NO_TRADE">;
  entry: number;
  exitPrice: number;
  status: "success" | "failure";
  failureType: SimulationFailureType;
  directionalCorrect: boolean;
  reason: string;
  excursions: { maxFavorableExcursionPct: number; maxAdverseExcursionPct: number };
  trailingStopUsed?: boolean;
  exitCandleIndex?: number;
  totalCandles?: number;
}): SimulationOutcome {
  return {
    status: input.status === "success" ? "SUCCESS" : "FAILURE",
    failureType: input.failureType,
    directionalCorrect: input.directionalCorrect,
    reason: input.reason,
    exitPrice: input.exitPrice,
    pnlPct: computePnlPct(input.signal, input.entry, input.exitPrice),
    maxFavorableExcursionPct: input.excursions.maxFavorableExcursionPct,
    maxAdverseExcursionPct: input.excursions.maxAdverseExcursionPct,
    trailingStopUsed: input.trailingStopUsed,
    exitCandleIndex: input.exitCandleIndex,
    totalCandles: input.totalCandles
  };
}

function computePnlPct(signal: Exclude<Signal, "NO_TRADE">, entry: number, exitPrice: number): number {
  if (signal === "LONG") {
    return ((exitPrice - entry) / entry) * 100;
  }
  return ((entry - exitPrice) / entry) * 100;
}

function computeExcursions(
  signal: Exclude<Signal, "NO_TRADE">,
  entry: number,
  candles: Candle[]
): { maxFavorableExcursionPct: number; maxAdverseExcursionPct: number } {
  if (candles.length === 0) {
    return { maxFavorableExcursionPct: 0, maxAdverseExcursionPct: 0 };
  }

  let maxFavorableExcursionPct = 0;
  let maxAdverseExcursionPct = 0;
  for (const candle of candles) {
    if (signal === "LONG") {
      const favorable = ((candle.high - entry) / entry) * 100;
      const adverse = ((entry - candle.low) / entry) * 100;
      maxFavorableExcursionPct = Math.max(maxFavorableExcursionPct, favorable);
      maxAdverseExcursionPct = Math.max(maxAdverseExcursionPct, adverse);
      continue;
    }

    const favorable = ((entry - candle.low) / entry) * 100;
    const adverse = ((candle.high - entry) / entry) * 100;
    maxFavorableExcursionPct = Math.max(maxFavorableExcursionPct, favorable);
    maxAdverseExcursionPct = Math.max(maxAdverseExcursionPct, adverse);
  }
  return {
    maxFavorableExcursionPct: Math.max(0, maxFavorableExcursionPct),
    maxAdverseExcursionPct: Math.max(0, maxAdverseExcursionPct)
  };
}
