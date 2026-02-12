import type { Signal } from "./types.js";

export interface ObjectiveTargetingRequest {
  signal: Exclude<Signal, "NO_TRADE">;
  entry: number;
  atr: number;
  baseInterval: string;
  leverage: number;
  positionSizeUsd: number;
  objectiveUsdc?: number;
  horizon?: string;
}

export interface ObjectiveTargetingResult {
  objectiveUsdc: number;
  horizon: string;
  horizonMinutes: number;
  horizonCandles: number;
  timeStopRule: string;
  notionalUsd: number;
  targetTpFraction: number;
  targetTpPct: number;
  targetSlPct: number;
  rr: number;
  takeProfit: number;
  stopLoss: number;
  expectedPnlAtTakeProfit: number;
  expectedPnlAtStopLoss: number;
  plausibilityWarning?: string;
}

const TP_EXPECTED_MOVE_THRESHOLD = 1.5;

export function applyObjectiveTargeting(request: ObjectiveTargetingRequest): ObjectiveTargetingResult {
  if (request.leverage <= 0 || request.positionSizeUsd <= 0) {
    throw new Error("Objective targeting requires positive leverage and position size.");
  }

  // Assumption: user-provided objective is a notional PnL target in USDC (not multiplied by leverage).
  const providedObjective = request.objectiveUsdc;
  if (providedObjective !== undefined && providedObjective <= 0) {
    throw new Error("Objective must be a positive USDC value.");
  }

  const notionalUsd = request.positionSizeUsd * request.leverage;
  const resolvedObjectiveUsdc =
    providedObjective ?? deriveObjectiveFromHorizon({ entry: request.entry, atr: request.atr, baseInterval: request.baseInterval, horizon: request.horizon, notionalUsd });
  const tpFraction = resolvedObjectiveUsdc / notionalUsd;
  const rr = defaultRiskRewardForObjective(resolvedObjectiveUsdc);
  const slFraction = tpFraction / rr;

  const targetTpPct = tpFraction * 100;
  const targetSlPct = slFraction * 100;

  const takeProfit =
    request.signal === "LONG" ? request.entry * (1 + tpFraction) : request.entry * (1 - tpFraction);
  const stopLoss =
    request.signal === "LONG" ? request.entry * (1 - slFraction) : request.entry * (1 + slFraction);

  const horizon = request.horizon ?? defaultHorizonForObjective(resolvedObjectiveUsdc);
  const horizonMinutes = parseHorizonMinutes(horizon);
  const horizonLabel = `${horizonMinutes}m`;
  const baseIntervalMinutes = parseDurationToMinutes(request.baseInterval);
  const horizonCandles = toCandleCount(horizonMinutes, baseIntervalMinutes);
  const expectedMove = request.atr * Math.sqrt(Math.max(horizonCandles, 1));
  const tpDistance = Math.abs(takeProfit - request.entry);
  const plausibilityWarning =
    tpDistance > expectedMove * TP_EXPECTED_MOVE_THRESHOLD
      ? `TP distance is ${tpDistance.toFixed(2)}, above ${TP_EXPECTED_MOVE_THRESHOLD}x expected move (${expectedMove.toFixed(
          2
        )}) for ${horizonLabel}. Consider a longer horizon or smaller objective.`
      : undefined;

  return {
    objectiveUsdc: round(resolvedObjectiveUsdc, 2),
    horizon: horizonLabel,
    horizonMinutes,
    horizonCandles,
    timeStopRule: `If TP/SL is not hit within ${horizonLabel}, close at market (time-stop).`,
    notionalUsd: round(notionalUsd, 2),
    targetTpFraction: round(tpFraction, 6),
    targetTpPct: round(targetTpPct, 4),
    targetSlPct: round(targetSlPct, 4),
    rr: round(rr, 4),
    takeProfit: round(takeProfit, 4),
    stopLoss: round(stopLoss, 4),
    expectedPnlAtTakeProfit: round(resolvedObjectiveUsdc, 4),
    expectedPnlAtStopLoss: round(-(notionalUsd * slFraction), 4),
    plausibilityWarning
  };
}

export function deriveObjectiveFromHorizon(input: {
  entry: number;
  atr: number;
  baseInterval: string;
  horizon?: string;
  notionalUsd: number;
}): number {
  if (!input.horizon) {
    throw new Error("Provide either objective or horizon for objective targeting.");
  }
  if (input.entry <= 0 || input.notionalUsd <= 0) {
    throw new Error("Invalid entry or notional for horizon-based objective.");
  }

  const horizonMinutes = parseHorizonMinutes(input.horizon);
  const baseIntervalMinutes = parseDurationToMinutes(input.baseInterval);
  const candles = toCandleCount(horizonMinutes, baseIntervalMinutes);
  const expectedMove = input.atr * Math.sqrt(Math.max(candles, 1));
  const expectedMoveFraction = expectedMove / input.entry;

  // Assumption: use a conservative share of expected move and clamp extremes for realistic intraday targets.
  const targetFraction = clamp(expectedMoveFraction * 0.8, 0.001, 0.02);
  return round(input.notionalUsd * targetFraction, 2);
}

export function defaultHorizonForObjective(objectiveUsdc: number): string {
  if (objectiveUsdc <= 10) {
    return "15";
  }
  if (objectiveUsdc >= 30) {
    return "75";
  }
  // Assumption: intermediate objectives default to a mid intraday horizon.
  return "45";
}

export function defaultRiskRewardForObjective(objectiveUsdc: number): number {
  if (objectiveUsdc <= 10) {
    return 1.4;
  }
  if (objectiveUsdc >= 30) {
    return 2.1;
  }
  // Assumption: keep a balanced default for middle-sized objectives.
  return 1.8;
}

export function parseDurationToMinutes(duration: string): number {
  const normalized = duration.trim().toLowerCase();
  const match = normalized.match(/^(\d+)(m|h)$/);
  if (!match) {
    throw new Error(`Invalid duration '${duration}'. Use formats like 15m, 60m, or 1h.`);
  }

  const amount = Number(match[1]);
  const unit = match[2];
  if (Number.isNaN(amount) || amount <= 0) {
    throw new Error(`Invalid duration '${duration}'. Amount must be a positive number.`);
  }
  return unit === "m" ? amount : amount * 60;
}

export function parseHorizonMinutes(value: string): number {
  const normalized = value.trim();
  const minutes = Number(normalized);
  if (!/^\d+$/.test(normalized) || Number.isNaN(minutes) || minutes <= 0) {
    throw new Error(`Invalid horizon '${value}'. Use minutes as a positive integer (e.g. 15, 75, 90).`);
  }
  return minutes;
}

export function toCandleCount(horizonMinutes: number, baseIntervalMinutes: number): number {
  if (horizonMinutes <= 0 || baseIntervalMinutes <= 0) {
    throw new Error("Horizon and interval minutes must be positive.");
  }
  return Math.ceil(horizonMinutes / baseIntervalMinutes);
}

function round(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
