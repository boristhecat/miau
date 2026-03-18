import type { EntryReadinessStatus, LiquidationRisk, MarketRegime, SessionContext, SetupGrade, Signal, TradingSession } from "./types.js";
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
  setupPlaybook?: import("./types.js").SetupPlaybook;
  playbookRegimeAligned?: boolean;
  playbookMinRiskReward?: number;
  entryReadinessStatus?: EntryReadinessStatus;
  preferredEntryPrice?: number;
  entryReadinessRationale?: readonly string[];
  bidAskSpreadPct?: number;
  spreadBlockThreshold?: number;
  skipLegacyTradeabilityChecks?: boolean;
  /** BTC context for alt correlation hard filter */
  pair?: string;
  btcContext?: { emaAbove: boolean; momentumPositive: boolean };
  /** Plan 3: Session context for setup filtering */
  sessionContext?: SessionContext;
  /** Plan 4: Liquidation risk level */
  liquidationRisk?: LiquidationRisk;
  /** Plan 1: Structure break info */
  structureBreak?: "BOS" | "CHOCH" | "NONE";
  structureBreakDirection?: "BULLISH" | "BEARISH";
  structureState?: "BULLISH" | "BEARISH" | "CONSOLIDATION";
  /** Plan 6: Liquidation cluster context */
  clusterBlocksTarget?: boolean;
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
    accumulated.push(`Entry timing: ${readinessMessage}${preferredEntry}`);
  }
  if (input.setupPlaybook && input.playbookRegimeAligned === false) {
    return block(`${input.setupPlaybook} is not aligned with the current ${input.marketRegime} regime.`);
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
  // Plan 1: Structure break guard — ChoCH against signal direction
  if (input.structureBreak === "CHOCH" && input.structureBreakDirection !== undefined) {
    const chochAgainstSignal =
      (input.signal === "LONG" && input.structureBreakDirection === "BEARISH") ||
      (input.signal === "SHORT" && input.structureBreakDirection === "BULLISH");
    if (chochAgainstSignal) {
      accumulated.push(`Guard advisory: ChoCH ${input.structureBreakDirection} detected — structure just broke against ${input.signal} signal.`);
    }
  }

  // Plan 3: Session context guards
  if (input.sessionContext) {
    const sc = input.sessionContext;
    if (input.setupPlaybook && sc.riskySetups.includes(input.setupPlaybook)) {
      accumulated.push(
        `Guard advisory: ${input.setupPlaybook} is risky during ${sc.currentSession} session.`
      );
    }
    if (
      sc.londonExpansionDirection !== "NONE" &&
      sc.londonExpansionDirection !== undefined &&
      sc.currentSession === "US"
    ) {
      const tradingAgainstExpansion =
        (input.signal === "LONG" && sc.londonExpansionDirection === "BEARISH") ||
        (input.signal === "SHORT" && sc.londonExpansionDirection === "BULLISH");
      if (tradingAgainstExpansion) {
        accumulated.push(
          `Guard advisory: trading against London ${sc.londonExpansionDirection} expansion — requires stronger confirmation.`
        );
      }
    }
    if (sc.currentSession === "DEAD" && input.setupGrade !== "A" && input.setupGrade !== "B") {
      return block("DEAD session with sub-B setup; market is too thin.");
    }
  }

  // Plan 4: Liquidation risk guard
  if (input.liquidationRisk === "CRITICAL") {
    return block("Liquidation price is dangerously close to stop-loss. Reduce leverage or widen stop.");
  }
  if (input.liquidationRisk === "DANGEROUS") {
    accumulated.push("Guard advisory: liquidation price is uncomfortably close to stop-loss.");
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
  const playbookRiskRewardFloor = Math.max(input.playbookMinRiskReward ?? 0, input.regimeSignalMismatch ? 1.6 : 0, 1.2);
  if (input.regimeSignalMismatch && input.riskRewardRatio < 1.6) {
    return block(`trend-follow signal in ${input.marketRegime} regime requires risk/reward >= 1.6.`);
  }
  if (input.riskRewardRatio < playbookRiskRewardFloor) {
    const floorLabel = Number.isInteger(playbookRiskRewardFloor)
      ? playbookRiskRewardFloor.toFixed(1)
      : String(playbookRiskRewardFloor);
    if (input.setupPlaybook && playbookRiskRewardFloor > 1.2) {
      return block(`${input.setupPlaybook} requires risk/reward >= ${floorLabel}.`);
    }
    return block(`risk/reward below ${floorLabel}.`);
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
  // Plan 6: Liquidation cluster advisory
  if (input.clusterBlocksTarget) {
    accumulated.push("Guard advisory: estimated liquidation cluster between entry and stop — cascade risk before TP.");
  }
  return { signal: input.signal, blocked: false, rationale: accumulated };
}
