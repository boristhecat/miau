import type { EntryReadinessStatus, MarketRegime, SetupGrade, Signal, TradingSession } from "./types.js";
import { parseIntervalToMinutes } from "./interval-utils.js";
import { detectTradingSession } from "./recommendation-market-context.js";

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
  independentChannelAgreement?: number;
  setupQuality: number;
  confidence: number;
  /** Raw directional edge score before setup quality blending — used for directional guards */
  signalStrength?: number;
  riskRewardRatio: number;
  feeBurdenPct?: number;
  setupDetected?: boolean;
  entryReadinessStatus?: EntryReadinessStatus;
  preferredEntryPrice?: number;
  entryReadinessRationale?: readonly string[];
  bidAskSpreadPct?: number;
  spreadBlockThreshold?: number;
  skipLegacyTradeabilityChecks?: boolean;
  /** BTC context for alt correlation hard filter */
  pair?: string;
  btcContext?: { emaAbove: boolean; momentumPositive: boolean };
  rationale: readonly string[];
}): { signal: Signal; blocked: boolean; rationale: readonly string[] } {
  const intervalMinutes = parseIntervalToMinutes(input.interval);
  const session = detectTradingSession();
  const forceActive = input.forcedDirection !== undefined;
  const accumulated: string[] = [...input.rationale];
  // Use raw signal strength for directional edge checks; fall back to blended confidence
  const directionalConfidence = input.signalStrength ?? input.confidence;
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
  if (input.entryReadinessStatus && input.entryReadinessStatus !== "READY_NOW") {
    const readinessMessage = input.entryReadinessRationale?.[0] ?? "entry is not ready yet.";
    const preferredEntry =
      input.preferredEntryPrice !== undefined ? ` Preferred entry ${input.preferredEntryPrice.toFixed(4)}.` : "";
    if (input.entryReadinessStatus === "TOO_LATE") {
      return block(`${readinessMessage}${preferredEntry}`);
    }
    return block(`wait for a cleaner trigger: ${readinessMessage}${preferredEntry}`);
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
  if (!input.skipLegacyTradeabilityChecks && input.marketRegime === "LOW_LIQ_CHOP") {
    return block("low-liquidity chop regime.");
  }
  if (input.winnerRatioInsufficient) {
    return block("winner ratio is below 0.60; directional edge is insufficient.");
  }
  // Improvement #2: Independent channel agreement hard block
  if (input.independentChannelAgreement !== undefined && input.independentChannelAgreement < 2) {
    return block(`only ${input.independentChannelAgreement}/4 independent channels agree; no cross-domain confluence.`);
  }
  // Improvement #8: BTC correlation hard filter for alts
  if (input.pair && input.btcContext) {
    const symbol = input.pair.split("-")[0]?.toUpperCase() ?? "";
    const isAlt = symbol !== "BTC";
    if (isAlt) {
      const btcStrongBearish = !input.btcContext.emaAbove && !input.btcContext.momentumPositive;
      const btcStrongBullish = input.btcContext.emaAbove && input.btcContext.momentumPositive;
      if (input.signal === "LONG" && btcStrongBearish) {
        return block("BTC is strongly bearish; alt long blocked due to high cross-asset correlation.");
      }
      if (input.signal === "SHORT" && btcStrongBullish) {
        return block("BTC is strongly bullish; alt short blocked due to high cross-asset correlation.");
      }
    }
  }
  if (input.htfContradictionCount >= 3) {
    return block(`HTF context (${input.htfContradictionCount}/4 dimensions) strongly contradicts signal direction.`);
  }
  if (input.htfContradictionCount === 2 && directionalConfidence < 60) {
    return block("HTF context partially contradicts signal; directional strength must be at least 60.");
  }
  if (input.regimeSignalMismatch) {
    accumulated.push(
      `Guard: trend-follow signal in ${input.marketRegime} regime requires higher R/R (1.6) and confidence (55).`
    );
  }
  const effectiveSpreadThreshold = input.spreadBlockThreshold ?? 0.12;
  if (!input.skipLegacyTradeabilityChecks && input.bidAskSpreadPct !== undefined && input.bidAskSpreadPct > effectiveSpreadThreshold) {
    return block("orderbook spread is too wide for clean execution.");
  }
  if (!input.skipLegacyTradeabilityChecks && input.regime === "CHOPPY") {
    return block("choppy regime.");
  }
  if (input.regimeSignalMismatch && input.riskRewardRatio < 1.6) {
    return block(`trend-follow signal in ${input.marketRegime} regime requires risk/reward >= 1.6.`);
  }
  if (input.riskRewardRatio < 1.2) {
    return block("risk/reward below 1.2.");
  }
  if (input.feeBurdenPct !== undefined && input.feeBurdenPct > 0.30) {
    return block(`fee burden is ${(input.feeBurdenPct * 100).toFixed(0)}% of gross TP; trade is not economical.`);
  }
  if (input.setupDetected === false) {
    return block("no structural setup detected; no reason to enter.");
  }
  if (input.setupGrade === "D") {
    return block("setup grade D.");
  }
  if (intervalMinutes <= 10 && input.setupGrade === "C") {
    return block("setup grade C is too weak for <=10m trading.");
  }
  if (input.lowAbsoluteConviction && directionalConfidence < 55) {
    return block("directional strength below low-conviction threshold (55).");
  }
  if (input.regimeSignalMismatch && directionalConfidence < 55) {
    return block(`trend-follow signal in ${input.marketRegime} regime requires directional strength >= 55.`);
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
  if (directionalConfidence < confidenceFloor) {
    if (session === "ASIA" || session === "DEAD") {
      return block(`directional strength below ${session} session threshold (${confidenceFloor}).`);
    }
    return block("directional strength too low.");
  }
  if (intervalMinutes <= 10 && directionalConfidence < shortConfidenceFloor) {
    if (session === "DEAD") {
      return block(`directional strength below DEAD zone short-timeframe threshold (${shortConfidenceFloor}).`);
    }
    return block(`directional strength below short-timeframe threshold (${shortConfidenceFloor}).`);
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
