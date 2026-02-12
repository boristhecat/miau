import type { Candle, Signal } from "./types.js";

export interface PaperTrade {
  signal: Exclude<Signal, "NO_TRADE">;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  openedAtMs: number;
}

export interface SimulationOutcome {
  status: "SUCCESS" | "FAILURE";
  reason: string;
  exitPrice: number;
  pnlPct: number;
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

  for (const candle of relevant) {
    if (params.trade.signal === "LONG") {
      const slHit = candle.low <= params.trade.stopLoss;
      const tpHit = candle.high >= params.trade.takeProfit;
      if (slHit && tpHit) {
        return buildOutcome(params.trade.signal, params.trade.entry, params.trade.stopLoss, "failure", "Both SL and TP were touched in the same candle; counted as stop-loss.");
      }
      if (slHit) {
        return buildOutcome(params.trade.signal, params.trade.entry, params.trade.stopLoss, "failure", "Stop-loss was hit within the simulation window.");
      }
      if (tpHit) {
        return buildOutcome(params.trade.signal, params.trade.entry, params.trade.takeProfit, "success", "Take-profit was hit within the simulation window.");
      }
      continue;
    }

    const slHit = candle.high >= params.trade.stopLoss;
    const tpHit = candle.low <= params.trade.takeProfit;
    if (slHit && tpHit) {
      return buildOutcome(params.trade.signal, params.trade.entry, params.trade.stopLoss, "failure", "Both SL and TP were touched in the same candle; counted as stop-loss.");
    }
    if (slHit) {
      return buildOutcome(params.trade.signal, params.trade.entry, params.trade.stopLoss, "failure", "Stop-loss was hit within the simulation window.");
    }
    if (tpHit) {
      return buildOutcome(params.trade.signal, params.trade.entry, params.trade.takeProfit, "success", "Take-profit was hit within the simulation window.");
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
    reason,
    exitPrice: finalPrice,
    pnlPct
  };
}

function buildOutcome(
  signal: Exclude<Signal, "NO_TRADE">,
  entry: number,
  exitPrice: number,
  status: "success" | "failure",
  reason: string
): SimulationOutcome {
  return {
    status: status === "success" ? "SUCCESS" : "FAILURE",
    reason,
    exitPrice,
    pnlPct: computePnlPct(signal, entry, exitPrice)
  };
}

function computePnlPct(signal: Exclude<Signal, "NO_TRADE">, entry: number, exitPrice: number): number {
  if (signal === "LONG") {
    return ((exitPrice - entry) / entry) * 100;
  }
  return ((entry - exitPrice) / entry) * 100;
}
