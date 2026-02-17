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

  for (const candle of relevant) {
    if (params.trade.signal === "LONG") {
      const slHit = candle.low <= params.trade.stopLoss;
      const tpHit = candle.high >= params.trade.takeProfit;
      if (slHit && tpHit) {
        return buildOutcome({
          signal: params.trade.signal,
          entry: params.trade.entry,
          exitPrice: params.trade.stopLoss,
          status: "failure",
          failureType: "WHIPSAW_SL_TP",
          directionalCorrect: false,
          reason: "Both SL and TP were touched in the same candle; counted as stop-loss.",
          excursions
        });
      }
      if (slHit) {
        // Heuristic: if price reclaims entry after SL within the same horizon, treat it as a tight-stop failure.
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
          excursions
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
          excursions
        });
      }
      continue;
    }

    const slHit = candle.high >= params.trade.stopLoss;
    const tpHit = candle.low <= params.trade.takeProfit;
    if (slHit && tpHit) {
      return buildOutcome({
        signal: params.trade.signal,
        entry: params.trade.entry,
        exitPrice: params.trade.stopLoss,
        status: "failure",
        failureType: "WHIPSAW_SL_TP",
        directionalCorrect: false,
        reason: "Both SL and TP were touched in the same candle; counted as stop-loss.",
        excursions
      });
    }
    if (slHit) {
      // Symmetric short-side heuristic: touching entry again after SL implies stop was likely too tight.
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
        excursions
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
        excursions
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
    maxAdverseExcursionPct: excursions.maxAdverseExcursionPct
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
}): SimulationOutcome {
  return {
    status: input.status === "success" ? "SUCCESS" : "FAILURE",
    failureType: input.failureType,
    directionalCorrect: input.directionalCorrect,
    reason: input.reason,
    exitPrice: input.exitPrice,
    pnlPct: computePnlPct(input.signal, input.entry, input.exitPrice),
    maxFavorableExcursionPct: input.excursions.maxFavorableExcursionPct,
    maxAdverseExcursionPct: input.excursions.maxAdverseExcursionPct
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
