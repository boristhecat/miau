import type { MarketRegime, SetupGrade, Signal } from "./types.js";

export function applyTradeGuards(input: {
  signal: Exclude<Signal, "NO_TRADE">;
  forcedDirection?: "LONG" | "SHORT";
  interval: string;
  setupGrade: SetupGrade;
  regime: "TRADEABLE" | "CHOPPY";
  marketRegime: MarketRegime;
  impulseBias: "UP_IMPULSE" | "DOWN_IMPULSE" | "NONE";
  pullbackExtended: boolean;
  breakoutValidationFailed: boolean;
  breakoutFailureDirection: "UP" | "DOWN" | "NONE";
  setupQuality: number;
  confidence: number;
  riskRewardRatio: number;
  bidAskSpreadPct?: number;
  rationale: string[];
}): { signal: Signal; blocked: boolean } {
  const intervalMinutes = parseIntervalToMinutes(input.interval);
  const forceActive = input.forcedDirection !== undefined;
  const block = (message: string): { signal: Signal; blocked: boolean } => {
    if (forceActive) {
      input.rationale.push(`Guard advisory: ${message}`);
      return { signal: input.signal, blocked: true };
    }
    input.rationale.push(`No-trade guard: ${message}`);
    return { signal: "NO_TRADE", blocked: true };
  };
  if (input.signal === "SHORT" && input.impulseBias === "UP_IMPULSE") {
    return block("avoid fading a strong recent bullish impulse.");
  }
  if (input.signal === "LONG" && input.impulseBias === "DOWN_IMPULSE") {
    return block("avoid fading a strong recent bearish impulse.");
  }
  if (input.pullbackExtended) {
    const strictExtensionBlock = intervalMinutes <= 10 && input.setupGrade !== "A";
    if (strictExtensionBlock) {
      return block("trend entry is extended; wait for pullback.");
    }
    input.rationale.push("Guard advisory: trend entry is extended; continuation allowed only due to strong setup.");
  }
  if (input.breakoutValidationFailed) {
    const breakoutFailureAgainstSignal =
      (input.breakoutFailureDirection === "UP" && input.signal === "LONG") ||
      (input.breakoutFailureDirection === "DOWN" && input.signal === "SHORT");
    if (breakoutFailureAgainstSignal) {
      return block("breakout failed follow-through validation in trade direction.");
    }
    input.rationale.push("Guard advisory: breakout follow-through warning detected, but directional edge still dominates.");
  }
  if (input.marketRegime === "LOW_LIQ_CHOP") {
    return block("low-liquidity chop regime.");
  }
  if (input.bidAskSpreadPct !== undefined && input.bidAskSpreadPct > 0.12) {
    return block("orderbook spread is too wide for clean execution.");
  }
  if (input.regime === "CHOPPY") {
    return block("choppy regime.");
  }
  if (input.riskRewardRatio < 1.2) {
    return block("risk/reward below 1.2.");
  }
  if (input.setupGrade === "D") {
    return block("setup grade D.");
  }
  if (intervalMinutes <= 10 && input.setupGrade === "C") {
    return block("setup grade C is too weak for <=10m trading.");
  }
  if (input.confidence < 45) {
    return block("confidence too low.");
  }
  if (intervalMinutes <= 10 && input.confidence < 52) {
    return block("confidence below short-timeframe threshold (52).");
  }
  if (input.setupQuality < 52) {
    return block("setup quality below threshold.");
  }
  if (intervalMinutes <= 10 && input.setupQuality < 60) {
    return block("setup quality below short-timeframe threshold (60).");
  }
  return { signal: input.signal, blocked: false };
}

function parseIntervalToMinutes(interval: string): number {
  const normalized = interval.trim().toLowerCase();
  const match = normalized.match(/^(\d+)([mhd])$/);
  if (!match) {
    return 1;
  }
  const amount = Number(match[1]);
  const unit = match[2];
  if (Number.isNaN(amount) || amount <= 0) {
    return 1;
  }
  if (unit === "m") return amount;
  if (unit === "h") return amount * 60;
  return amount * 60 * 24;
}
