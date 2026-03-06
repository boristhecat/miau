import type { MarketRegime, SetupGrade, Signal, TradingSession } from "./types.js";
import { parseIntervalToMinutes } from "./interval-utils.js";

function detectTradingSession(): TradingSession {
  const utcHour = new Date().getUTCHours();
  if (utcHour >= 0 && utcHour < 8) return "ASIA";
  if (utcHour >= 8 && utcHour < 13) return "LONDON";
  if (utcHour >= 13 && utcHour < 21) return "US";
  return "DEAD";
}

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
  lowAbsoluteConviction: boolean;
  winnerRatioInsufficient: boolean;
  htfContradictionCount: number;
  regimeSignalMismatch: boolean;
  setupQuality: number;
  confidence: number;
  riskRewardRatio: number;
  bidAskSpreadPct?: number;
  rationale: readonly string[];
}): { signal: Signal; blocked: boolean; rationale: readonly string[] } {
  const intervalMinutes = parseIntervalToMinutes(input.interval);
  const session = detectTradingSession();
  const forceActive = input.forcedDirection !== undefined;
  const accumulated: string[] = [...input.rationale];
  const block = (message: string): { signal: Signal; blocked: boolean; rationale: readonly string[] } => {
    if (forceActive) {
      accumulated.push(`Guard advisory: ${message}`);
      return { signal: input.signal, blocked: true, rationale: accumulated };
    }
    accumulated.push(`No-trade guard: ${message}`);
    return { signal: "NO_TRADE", blocked: true, rationale: accumulated };
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
    accumulated.push("Guard advisory: trend entry is extended; continuation allowed only due to strong setup.");
  }
  if (input.breakoutValidationFailed) {
    const breakoutFailureAgainstSignal =
      (input.breakoutFailureDirection === "UP" && input.signal === "LONG") ||
      (input.breakoutFailureDirection === "DOWN" && input.signal === "SHORT");
    if (breakoutFailureAgainstSignal) {
      return block("breakout failed follow-through validation in trade direction.");
    }
    accumulated.push("Guard advisory: breakout follow-through warning detected, but directional edge still dominates.");
  }
  if (input.marketRegime === "LOW_LIQ_CHOP") {
    return block("low-liquidity chop regime.");
  }
  if (input.winnerRatioInsufficient) {
    return block("winner ratio is below 0.48; directional edge is insufficient.");
  }
  if (input.htfContradictionCount >= 3) {
    return block(`HTF context (${input.htfContradictionCount}/4 dimensions) strongly contradicts signal direction.`);
  }
  if (input.htfContradictionCount === 2 && input.confidence < 60) {
    return block("HTF context partially contradicts signal; confidence must be at least 60.");
  }
  if (input.regimeSignalMismatch) {
    accumulated.push(
      `Guard: trend-follow signal in ${input.marketRegime} regime requires higher R/R (1.6) and confidence (55).`
    );
  }
  if (input.bidAskSpreadPct !== undefined && input.bidAskSpreadPct > 0.12) {
    return block("orderbook spread is too wide for clean execution.");
  }
  if (input.regime === "CHOPPY") {
    return block("choppy regime.");
  }
  if (input.regimeSignalMismatch && input.riskRewardRatio < 1.6) {
    return block(`trend-follow signal in ${input.marketRegime} regime requires risk/reward >= 1.6.`);
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
  if (input.lowAbsoluteConviction && input.confidence < 55) {
    return block("confidence below low-conviction threshold (55).");
  }
  if (input.regimeSignalMismatch && input.confidence < 55) {
    return block(`trend-follow signal in ${input.marketRegime} regime requires confidence >= 55.`);
  }
  let confidenceFloor = 45;
  let setupQualityFloor = 52;
  let shortConfidenceFloor = 52;
  if (session === "ASIA") {
    confidenceFloor = Math.max(confidenceFloor, 50);
    setupQualityFloor = Math.max(setupQualityFloor, 55);
  } else if (session === "DEAD") {
    confidenceFloor = Math.max(confidenceFloor, 55);
    setupQualityFloor = Math.max(setupQualityFloor, 58);
    shortConfidenceFloor = Math.max(shortConfidenceFloor, 62);
  }
  if (input.confidence < confidenceFloor) {
    if (session === "ASIA" || session === "DEAD") {
      return block(`confidence below ${session} session threshold (${confidenceFloor}).`);
    }
    return block("confidence too low.");
  }
  if (intervalMinutes <= 10 && input.confidence < shortConfidenceFloor) {
    if (session === "DEAD") {
      return block(`confidence below DEAD zone short-timeframe threshold (${shortConfidenceFloor}).`);
    }
    return block(`confidence below short-timeframe threshold (${shortConfidenceFloor}).`);
  }
  if (input.setupQuality < setupQualityFloor) {
    if (session === "ASIA" || session === "DEAD") {
      return block(`setup quality below ${session} session threshold (${setupQualityFloor}).`);
    }
    return block("setup quality below threshold.");
  }
  if (intervalMinutes <= 10 && input.setupQuality < 60) {
    return block("setup quality below short-timeframe threshold (60).");
  }
  return { signal: input.signal, blocked: false, rationale: accumulated };
}
