import type {
  BiasContext,
  ConfidenceBreakdown,
  IndicatorSnapshot,
  MarketRegime,
  PerpMarketSnapshot,
  Signal
} from "./types.js";
import { resolveIndicatorWeightProfile, type WeightChannel } from "./indicator-weight-policy.js";
import { clamp, parseIntervalToMinutes as parseInterval } from "./interval-utils.js";
import {
  assessVwapChop,
  classifyMarketRegime,
  computeAtrPct as computeIndicatorAtrPct,
  detectTradingSession
} from "./recommendation-market-context.js";
import { resolveAssetProfile, type AssetProfile } from "./asset-profile.js";

export interface SignalEvaluationResult {
  signal: Exclude<Signal, "NO_TRADE">;
  confidence: number;
  /** Raw directional score strength (0-100) before setup quality blending.
   *  Use this for win probability estimation, not confidence. */
  signalStrength: number;
  confidenceBreakdown: ConfidenceBreakdown;
  rationale: string[];
  marketRegime: MarketRegime;
  impulseBias: "UP_IMPULSE" | "DOWN_IMPULSE" | "NONE";
  pullbackExtended: boolean;
  breakoutValidationFailed: boolean;
  breakoutFailureDirection: "UP" | "DOWN" | "NONE";
  regime: "TRADEABLE" | "CHOPPY";
  lowAbsoluteConviction: boolean;
  winnerRatioInsufficient: boolean;
  htfContradictionCount: number;
  regimeSignalMismatch: boolean;
  /** Number of independent signal channels (out of 4) agreeing with the chosen direction */
  independentChannelAgreement: number;
  /** Whether the current regime is freshly transitioned or mature */
  regimeMaturity: "FRESH" | "MATURE";
}

export function inferBiasContext(biasIndicators: IndicatorSnapshot): BiasContext {
  const trend = biasIndicators.ema20 >= biasIndicators.ema50 ? "LONG" : "SHORT";
  const rsiZone =
    biasIndicators.rsi14 >= 70 ? "OVERBOUGHT" : biasIndicators.rsi14 <= 30 ? "OVERSOLD" : "NEUTRAL";
  const macdDirection =
    biasIndicators.macdHistogram > 0 ? "POSITIVE" : biasIndicators.macdHistogram < 0 ? "NEGATIVE" : "NEUTRAL";
  const lastClose = biasIndicators.vwap;
  const bbPosition =
    lastClose > biasIndicators.bbUpper ? "ABOVE" : lastClose < biasIndicators.bbLower ? "BELOW" : "INSIDE";
  return { trend, rsiZone, macdDirection, bbPosition };
}

/** Kept for backward compatibility. */
export function inferBiasTrend(biasIndicators: IndicatorSnapshot): "LONG" | "SHORT" {
  return biasIndicators.ema20 >= biasIndicators.ema50 ? "LONG" : "SHORT";
}

interface ScoringContext {
  readonly indicators: IndicatorSnapshot;
  readonly perp: PerpMarketSnapshot;
  readonly lastPrice: number;
  readonly biasContext?: BiasContext;
  readonly biasInterval?: string;
  readonly btcContext?: { emaAbove: boolean; momentumPositive: boolean };
  readonly assetProfile: AssetProfile;
  readonly intervalMinutes: number;
  readonly shortHorizon: boolean;
  readonly marketRegime: MarketRegime;
  readonly emaTrend: "LONG" | "SHORT";
  readonly macdAligned: boolean;
  readonly macdBearAligned: boolean;
  readonly aboveVwap: boolean;
  readonly atrPct: number;
  readonly fundingHorizonScale: number;
  readonly impulseMomentumThreshold: number;
  readonly addL: (ch: WeightChannel, pts: number) => void;
  readonly addS: (ch: WeightChannel, pts: number) => void;
  readonly rationale: string[];
}

export class RecommendationSignalEvaluator {
  evaluate(
    indicators: IndicatorSnapshot,
    perp: PerpMarketSnapshot,
    lastPrice: number,
    biasContext?: BiasContext,
    biasInterval?: string,
    baseInterval = "1m",
    btcContext?: { emaAbove: boolean; momentumPositive: boolean },
    pair?: string
  ): SignalEvaluationResult {
    const assetProfile = resolveAssetProfile(pair ?? "BTC-USD");
    let longScore = 0;
    let shortScore = 0;
    const rationale: string[] = [];
    const intervalMinutes = this.parseIntervalToMinutes(baseInterval);
    const shortHorizon = intervalMinutes <= 15;
    const regimeContext = classifyMarketRegime(indicators, lastPrice);
    rationale.push(...regimeContext.rationale);
    let regime: "TRADEABLE" | "CHOPPY" = regimeContext.marketRegime === "LOW_LIQ_CHOP" ? "CHOPPY" : "TRADEABLE";
    const marketRegime = regimeContext.marketRegime;
    const weightProfile = resolveIndicatorWeightProfile({
      intervalMinutes,
      marketRegime
    });
    const w = (channel: WeightChannel, points: number): number => points * weightProfile.multipliers[channel];
    rationale.push(
      `Weight profile ${weightProfile.horizonBucket}/${marketRegime}: trend x${weightProfile.multipliers.trend.toFixed(2)}, momentum x${weightProfile.multipliers.momentum.toFixed(2)}, flow x${weightProfile.multipliers.flow.toFixed(2)}, micro x${weightProfile.multipliers.microstructure.toFixed(2)}.`
    );
    // Phase 1a: Channel score accumulator — tracks per-channel contributions for capping
    const acc: Record<WeightChannel, { long: number; short: number }> = {
      trend: { long: 0, short: 0 },
      momentum: { long: 0, short: 0 },
      flow: { long: 0, short: 0 },
      microstructure: { long: 0, short: 0 },
      meanReversion: { long: 0, short: 0 },
      volatility: { long: 0, short: 0 },
      fastFilters: { long: 0, short: 0 },
      consensus: { long: 0, short: 0 }
    };
    const addL = (ch: WeightChannel, pts: number) => { acc[ch].long += w(ch, pts); };
    const addS = (ch: WeightChannel, pts: number) => { acc[ch].short += w(ch, pts); };

    const emaTrend: "LONG" | "SHORT" = indicators.ema20 > indicators.ema50 ? "LONG" : "SHORT";
    const macdAligned = indicators.macdHistogram > 0 && indicators.macd > indicators.macdSignal;
    const macdBearAligned = indicators.macdHistogram < 0 && indicators.macd < indicators.macdSignal;
    const aboveVwap = lastPrice >= indicators.vwap;
    const atrPct = computeIndicatorAtrPct(indicators);
    const fundingHorizonScale = intervalMinutes <= 10 ? 0.3 : intervalMinutes <= 30 ? 0.6 : intervalMinutes <= 60 ? 0.8 : 1.0;
    const impulseMomentumThreshold = clamp(0.2 + atrPct * 0.14, 0.22, 0.45);

    const ctx: ScoringContext = {
      indicators, perp, lastPrice, biasContext, biasInterval, btcContext,
      assetProfile, intervalMinutes, shortHorizon, marketRegime,
      emaTrend, macdAligned, macdBearAligned, aboveVwap,
      atrPct, fundingHorizonScale, impulseMomentumThreshold,
      addL, addS, rationale
    };

    // --- Channel scoring (order-independent; all write to accumulator) ---
    const { regimeMaturity } = this.scoreTrendContext(ctx);
    const { impulseBias, breakoutValidationFailed, breakoutFailureDirection } = this.scoreMomentum(ctx);
    this.scoreFlow(ctx);
    this.scoreMicrostructure(ctx);
    this.scoreMeanReversion(ctx);
    this.scoreHtfBias(ctx);
    this.scoreConsensusAndFilters(ctx);

    // Phase 1a: Apply channel score caps — limit each channel to ±18 after weight multiplier
    const CHANNEL_CAP = 18;
    for (const ch of Object.keys(acc) as WeightChannel[]) {
      longScore += Math.max(-CHANNEL_CAP, Math.min(CHANNEL_CAP, acc[ch].long));
      shortScore += Math.max(-CHANNEL_CAP, Math.min(CHANNEL_CAP, acc[ch].short));
    }

    // --- Signal determination ---
    const diff = Math.abs(longScore - shortScore);
    let signal: Exclude<Signal, "NO_TRADE">;
    let confidence: number;

    if (longScore > shortScore) {
      signal = "LONG";
    } else if (shortScore > longScore) {
      signal = "SHORT";
    } else {
      signal = indicators.ema20 >= indicators.ema50 ? "LONG" : "SHORT";
      rationale.push("Scores are tied; trend direction used as tie-breaker.");
    }

    if (diff >= 15) {
      confidence = Math.min(100, 50 + diff);
    } else {
      confidence = Math.max(35, 45 + diff);
      rationale.push("Indicator confluence is weak; confidence is reduced.");
    }

    // --- Post-processing: confidence adjustments ---
    const winnerScore = Math.max(longScore, shortScore);
    const loserScore = Math.min(longScore, shortScore);
    let winnerRatio = 1;
    if (loserScore > 0) {
      winnerRatio = winnerScore / (winnerScore + loserScore);
    }
    let winnerRatioInsufficient = false;
    if (winnerRatio < 0.60) {
      winnerRatioInsufficient = true;
      rationale.push(`Winner ratio ${winnerRatio.toFixed(2)} is below 0.60; directional edge is insufficient.`);
    } else if (winnerRatio < 0.65) {
      confidence -= 12;
      rationale.push(`Low winner ratio (${winnerRatio.toFixed(2)}); mixed signals reduce conviction.`);
    }

    let lowAbsoluteConviction = false;
    if (winnerScore < 28) {
      lowAbsoluteConviction = true;
      confidence -= 10;
      rationale.push("Few indicators contributed to the winning direction; conviction is low.");
    }

    const independentChannelAgreement = this.computeIndependentChannelAgreement({
      signal, indicators, perp, lastPrice, biasContext, btcContext
    });
    if (independentChannelAgreement < 3) {
      confidence -= 15;
      rationale.push(`Independent channel agreement: only ${independentChannelAgreement}/4 channels confirm ${signal}; insufficient cross-domain confluence.`);
    } else if (independentChannelAgreement === 4) {
      confidence += 5;
      rationale.push(`Independent channel agreement: all 4 channels confirm ${signal}; strong cross-domain confluence.`);
    } else {
      rationale.push(`Independent channel agreement: ${independentChannelAgreement}/4 channels confirm ${signal}.`);
    }

    const volumeConfirmation = this.computeVolumeConfirmationScore(signal, indicators);
    if (volumeConfirmation.score <= 0) {
      if (!volumeConfirmation.anyData) {
        confidence -= 8;
        rationale.push("No volume indicators available; confidence reduced.");
      } else {
        confidence -= 12;
        rationale.push("Volume indicators do not confirm trade direction.");
      }
    } else if (volumeConfirmation.score >= 2) {
      rationale.push(`Volume confirmation is strong (${volumeConfirmation.score} channels aligned).`);
    } else {
      rationale.push(`Volume confirmation is partial (${volumeConfirmation.score} channel aligned).`);
    }

    const optionalParticipationCount = this.countOptionalParticipation({
      signal, indicators, lastPrice, biasContext, btcContext
    });
    rationale.push(`Signal participation: ${optionalParticipationCount} optional channels confirmed direction.`);
    if (optionalParticipationCount >= 6) {
      confidence += 5;
    } else if (optionalParticipationCount <= 2) {
      confidence -= 6;
    }

    const htfContradictionCount = this.countHtfContradictions(signal, biasContext);
    if (htfContradictionCount > 0) {
      rationale.push(`HTF contradiction count: ${htfContradictionCount}/4 against ${signal}.`);
    }

    const emaTrendDirection: Exclude<Signal, "NO_TRADE"> = emaTrend;
    const regimeSignalMismatch =
      (marketRegime === "RANGE" || marketRegime === "VOLATILE_SPIKE") && signal === emaTrendDirection;
    if (regimeSignalMismatch) {
      rationale.push(`Regime mismatch: trend-follow ${signal} in ${marketRegime} regime.`);
    }

    if (regime === "CHOPPY") {
      confidence = Math.max(25, confidence - 18);
      rationale.push("Regime filter reduced confidence due to intraday chop risk.");
    }

    const vwapChop = assessVwapChop(indicators, lastPrice);
    if (vwapChop.nearVwapChop) {
      regime = "CHOPPY";
      confidence = Math.max(25, confidence - 12);
      rationale.push(vwapChop.rationale ?? "VWAP filter: price is too close to VWAP; intraday direction is not clean.");
    }

    let pullbackExtended = false;
    if (marketRegime === "TREND") {
      const extensionAtr = Math.abs(lastPrice - indicators.ema20) / Math.max(indicators.atr14, 1e-8);
      if (extensionAtr > 1.35) {
        pullbackExtended = true;
        confidence = Math.max(25, confidence - 10);
        rationale.push("Pullback filter: price is extended from EMA20; wait for pullback entry.");
      }
    }

    if (marketRegime === "TREND") {
      if (regimeMaturity === "FRESH") {
        confidence += 4;
        rationale.push("Fresh TREND regime: confidence boosted for fresh directional breakout.");
      } else {
        confidence -= 4;
        rationale.push("Mature TREND regime: confidence reduced for potential trend exhaustion.");
      }
    }

    const signalStrength = Math.round(clamp(confidence, 1, 99));

    const confidenceBreakdown = this.computeConfidenceBreakdown({
      indicators, marketRegime, impulseBias, biasContext,
      breakoutValidationFailed, pullbackExtended
    });
    confidence = Math.round(clamp(confidence * 0.62 + confidenceBreakdown.setupQuality * 0.38, 1, 99));

    return {
      signal, confidence, signalStrength, confidenceBreakdown, rationale,
      regime, marketRegime, impulseBias, pullbackExtended,
      breakoutValidationFailed, breakoutFailureDirection,
      lowAbsoluteConviction, winnerRatioInsufficient,
      htfContradictionCount, regimeSignalMismatch,
      independentChannelAgreement, regimeMaturity
    };
  }

  // ---------------------------------------------------------------------------
  // Channel scoring methods — each writes to the accumulator via addL/addS
  // ---------------------------------------------------------------------------

  private scoreTrendContext(ctx: ScoringContext): { regimeMaturity: "FRESH" | "MATURE" } {
    const { indicators, lastPrice, marketRegime, emaTrend, macdAligned, macdBearAligned,
      aboveVwap, shortHorizon, btcContext, addL, addS, rationale } = ctx;

    // Regime filter: count how many lagging indicators agree
    const bullishRegimeConfirmations = [
      emaTrend === "LONG", macdAligned, aboveVwap, indicators.rsi14 > 50
    ].filter(Boolean).length;
    const bearishRegimeConfirmations = [
      emaTrend === "SHORT", macdBearAligned, !aboveVwap, indicators.rsi14 < 50
    ].filter(Boolean).length;

    const regimeNudge = shortHorizon ? 8 : 14;
    if (bullishRegimeConfirmations >= 3) {
      addL("trend", regimeNudge);
      rationale.push(`Regime context: ${bullishRegimeConfirmations}/4 lagging indicators confirm bullish structure.`);
    } else if (bearishRegimeConfirmations >= 3) {
      addS("trend", regimeNudge);
      rationale.push(`Regime context: ${bearishRegimeConfirmations}/4 lagging indicators confirm bearish structure.`);
    } else {
      rationale.push("Regime context: lagging indicators are mixed; no clear directional regime.");
    }

    // BTC context
    if (btcContext) {
      const btcBullish = btcContext.emaAbove && btcContext.momentumPositive;
      const btcBearish = !btcContext.emaAbove && !btcContext.momentumPositive;
      if (btcBullish) {
        addL("trend", 5);
        addS("trend", -3);
        rationale.push("BTC is bullish (EMA + MACD); alt long has macro tailwind.");
      } else if (btcBearish) {
        addS("trend", 5);
        addL("trend", -3);
        rationale.push("BTC is bearish (EMA + MACD); alt long has macro headwind.");
      } else {
        rationale.push("BTC trend is mixed; cross-asset correlation neutral.");
      }
    }

    // Regime model scoring
    if (marketRegime === "TREND") {
      if (emaTrend === "LONG") {
        addL("trend", 6);
      } else {
        addS("trend", 6);
      }
      rationale.push("Regime model favors trend-follow continuation.");
    } else if (marketRegime === "RANGE") {
      if (lastPrice <= indicators.bbLower) {
        addL("meanReversion", 8);
        rationale.push("Range regime: price is at lower band, favoring mean reversion long.");
      } else if (lastPrice >= indicators.bbUpper) {
        addS("meanReversion", 8);
        rationale.push("Range regime: price is at upper band, favoring mean reversion short.");
      } else {
        addL("meanReversion", -2);
        addS("meanReversion", -2);
        rationale.push("Range regime but entry is mid-band; edge is limited.");
      }
    } else if (marketRegime === "VOLATILE_SPIKE") {
      addL("volatility", -4);
      addS("volatility", -4);
      rationale.push("Volatility spike regime: reduce conviction until expansion settles.");
    }

    // Regime transition
    const prevRegimeContext = classifyMarketRegime(indicators, lastPrice, true);
    const prevMarketRegime = prevRegimeContext.marketRegime;
    const regimeMaturity: "FRESH" | "MATURE" = prevMarketRegime !== marketRegime ? "FRESH" : "MATURE";
    if (prevMarketRegime !== marketRegime) {
      if (prevMarketRegime === "RANGE" && marketRegime === "TREND") {
        addL("trend", 4);
        addS("trend", 4);
        rationale.push("Regime transition: RANGE -> TREND detected (fresh breakout setup).");
      } else if (prevMarketRegime === "TREND" && marketRegime === "RANGE") {
        addL("trend", -3);
        addS("trend", -3);
        rationale.push("Regime transition: TREND -> RANGE detected (exhaustion; reduce trend conviction).");
      } else if (marketRegime === "VOLATILE_SPIKE") {
        addL("volatility", -3);
        addS("volatility", -3);
        rationale.push("Regime transition: spike detected - caution escalated.");
      }
    }

    return { regimeMaturity };
  }

  private scoreMomentum(ctx: ScoringContext): {
    impulseBias: "UP_IMPULSE" | "DOWN_IMPULSE" | "NONE";
    breakoutValidationFailed: boolean;
    breakoutFailureDirection: "UP" | "DOWN" | "NONE";
  } {
    const { indicators, impulseMomentumThreshold, addL, addS, rationale } = ctx;
    let impulseBias: "UP_IMPULSE" | "DOWN_IMPULSE" | "NONE" = "NONE";
    let breakoutValidationFailed = false;
    let breakoutFailureDirection: "UP" | "DOWN" | "NONE" = "NONE";

    const recent = indicators.recentCandleContext;
    if (recent) {
      const upImpulse =
        recent.momentumPct3 >= impulseMomentumThreshold &&
        recent.bullishCloseRatio5 >= 0.6 &&
        (recent.breakoutDirection === "UP" || recent.rangeExpansionRatio >= 1.25);
      const downImpulse =
        recent.momentumPct3 <= -impulseMomentumThreshold &&
        recent.bearishCloseRatio5 >= 0.6 &&
        (recent.breakoutDirection === "DOWN" || recent.rangeExpansionRatio >= 1.25);

      if (upImpulse) {
        impulseBias = "UP_IMPULSE";
        addL("momentum", 18);
        addS("momentum", -14);
        rationale.push("Recent candles show a bullish impulse (momentum + close skew + expansion/breakout).");
      } else if (downImpulse) {
        impulseBias = "DOWN_IMPULSE";
        addS("momentum", 18);
        addL("momentum", -14);
        rationale.push("Recent candles show a bearish impulse (momentum + close skew + expansion/breakout).");
      } else {
        rationale.push("Recent candle impulse is neutral.");
      }

      if (recent.breakoutDirection === "UP") {
        const validated = recent.momentumPct3 >= impulseMomentumThreshold * 0.9 && recent.bullishCloseRatio5 >= 0.6;
        if (validated) {
          addL("momentum", 6);
          rationale.push("Breakout check: upside breakout has follow-through confirmation.");
        } else {
          addS("momentum", 4);
          breakoutValidationFailed = true;
          breakoutFailureDirection = "UP";
          rationale.push("Breakout check: upside breakout lacks follow-through; fade risk increased.");
        }
      } else if (recent.breakoutDirection === "DOWN") {
        const validated =
          recent.momentumPct3 <= -impulseMomentumThreshold * 0.9 && recent.bearishCloseRatio5 >= 0.6;
        if (validated) {
          addS("momentum", 6);
          rationale.push("Breakout check: downside breakout has follow-through confirmation.");
        } else {
          addL("momentum", 4);
          breakoutValidationFailed = true;
          breakoutFailureDirection = "DOWN";
          rationale.push("Breakout check: downside breakout lacks follow-through; fade risk increased.");
        }
      }
    }

    // Session conditioning
    const session = detectTradingSession();
    if (session === "ASIA") {
      addL("momentum", -2);
      addS("momentum", -2);
      rationale.push("Session: Asian hours - lower volume; impulse follow-through reduced.");
    } else if (session === "DEAD") {
      addL("momentum", -4);
      addS("momentum", -4);
      rationale.push("Session: dead zone (US close - Asia open) - low volume, avoid breakouts.");
    } else if (session === "US") {
      rationale.push("Session: US peak hours - elevated volatility and volume.");
    } else {
      rationale.push("Session: London/NY overlap - trend-follow reliability moderate-high.");
    }

    return { impulseBias, breakoutValidationFailed, breakoutFailureDirection };
  }

  private scoreFlow(ctx: ScoringContext): void {
    const { indicators, perp, lastPrice, marketRegime, assetProfile,
      fundingHorizonScale, addL, addS, rationale } = ctx;

    // Funding rate
    const fundingThreshold = assetProfile.fundingSignificanceThreshold;
    const fundingMomentum = perp.fundingRate - perp.fundingRateAvg;
    const fundingAccelerating = Math.abs(fundingMomentum) > fundingThreshold * 0.6;
    if (perp.fundingRate > fundingThreshold && perp.fundingRateAvg > 0) {
      const pts = (fundingAccelerating ? 12 : 8) * fundingHorizonScale;
      addS("flow", pts);
      rationale.push(
        fundingAccelerating
          ? "Funding is accelerating positive (increasing long crowding risk)."
          : "Funding is persistently positive (long crowding risk)."
      );
    } else if (perp.fundingRate < -fundingThreshold && perp.fundingRateAvg < 0) {
      const pts = (fundingAccelerating ? 12 : 8) * fundingHorizonScale;
      addL("flow", pts);
      rationale.push(
        fundingAccelerating
          ? "Funding is accelerating negative (increasing short crowding risk)."
          : "Funding is persistently negative (short crowding risk)."
      );
    } else {
      rationale.push("Funding is neutral.");
    }

    // Premium
    if (perp.premiumPct > 0.15) {
      addS("flow", 6);
      rationale.push("Mark trades at a premium to index (possible long overheating).");
    } else if (perp.premiumPct < -0.15) {
      addL("flow", 6);
      rationale.push("Mark trades at a discount to index (possible short exhaustion).");
    } else {
      rationale.push("Mark/index premium is balanced.");
    }

    // OI delta
    const oiThreshold = assetProfile.oiDeltaSignificanceThreshold;
    if (perp.openInterestDeltaPct !== undefined) {
      if (perp.openInterestDeltaPct > oiThreshold && indicators.macdHistogram > 0) {
        addL("flow", 6);
        rationale.push("Open interest is expanding alongside bullish momentum.");
      } else if (perp.openInterestDeltaPct > oiThreshold && indicators.macdHistogram < 0) {
        addS("flow", 6);
        rationale.push("Open interest is expanding alongside bearish momentum.");
      } else if (perp.openInterestDeltaPct < -oiThreshold) {
        addL("flow", -4);
        addS("flow", -4);
        rationale.push("Open interest is fading; follow-through conviction is reduced.");
      }
    }

    // Volume profile
    if (indicators.volumeProfile) {
      const { vpoc, vah, val } = indicators.volumeProfile;
      const vpocDist = (Math.abs(lastPrice - vpoc) / Math.max(vpoc, 1)) * 100;
      if (vpocDist < 0.15) {
        if (marketRegime === "RANGE") {
          if (lastPrice > vpoc) {
            addS("meanReversion", 6);
          } else {
            addL("meanReversion", 6);
          }
          rationale.push("Price is near VPOC in range regime; mean reversion toward VPOC favored.");
        } else {
          addL("flow", -2);
          addS("flow", -2);
          rationale.push("Price is near VPOC; may act as resistance/support.");
        }
      } else if (lastPrice > vah) {
        addL("flow", 7);
        rationale.push("Price is above Value Area High; breakout above value area.");
      } else if (lastPrice < val) {
        addS("flow", 7);
        rationale.push("Price is below Value Area Low; breakdown below value area.");
      } else {
        const vaWidth = vah - val;
        if (vaWidth > 0) {
          const posInVa = (lastPrice - val) / vaWidth;
          if (posInVa > 0.7) {
            addS("flow", 2);
            rationale.push("Price is in upper value area; closer to VAH resistance.");
          } else if (posInVa < 0.3) {
            addL("flow", 2);
            rationale.push("Price is in lower value area; closer to VAL support.");
          } else {
            rationale.push(`Price is inside value area (VAL ${val.toFixed(4)} - VAH ${vah.toFixed(4)}).`);
          }
        } else {
          rationale.push(`Price is inside value area (VAL ${val.toFixed(4)} - VAH ${vah.toFixed(4)}).`);
        }
      }
    }

    // MFI
    if (indicators.mfi14 !== undefined) {
      if (indicators.mfi14 >= 55 && indicators.mfi14 < 80) {
        addL("flow", 4);
        rationale.push("MFI confirms buying pressure.");
      } else if (indicators.mfi14 <= 45 && indicators.mfi14 > 20) {
        addS("flow", 4);
        rationale.push("MFI confirms selling pressure.");
      } else if (indicators.mfi14 >= 80) {
        addS("meanReversion", 2);
        rationale.push("MFI is overbought; exhaustion risk rises.");
      } else if (indicators.mfi14 <= 20) {
        addL("meanReversion", 2);
        rationale.push("MFI is oversold; rebound risk rises.");
      }
    }

    // CMF
    if (indicators.cmf20 !== undefined) {
      if (indicators.cmf20 >= 0.08) {
        addL("flow", 4);
        rationale.push("CMF indicates sustained accumulation.");
      } else if (indicators.cmf20 <= -0.08) {
        addS("flow", 4);
        rationale.push("CMF indicates sustained distribution.");
      }
    }

    // OBV
    if (indicators.obvSlope5 !== undefined) {
      if (indicators.obvSlope5 > 0.02) {
        addL("flow", 3);
        rationale.push("OBV slope is rising.");
      } else if (indicators.obvSlope5 < -0.02) {
        addS("flow", 3);
        rationale.push("OBV slope is falling.");
      }
    }

    // CVD + volume expansion
    if (indicators.volumeZScore20 !== undefined && indicators.cvdDeltaPct5 !== undefined) {
      const expansion = indicators.volumeZScore20 >= 1;
      if (expansion && indicators.cvdDeltaPct5 > 10) {
        addL("flow", 4);
        rationale.push("Volume expansion aligns with positive flow delta.");
      } else if (expansion && indicators.cvdDeltaPct5 < -10) {
        addS("flow", 4);
        rationale.push("Volume expansion aligns with negative flow delta.");
      }
    }
  }

  private scoreMicrostructure(ctx: ScoringContext): void {
    const { perp, addL, addS, rationale } = ctx;

    if (perp.orderBookImbalance !== undefined) {
      if (perp.orderBookImbalance >= 0.20) {
        addL("microstructure", 8);
        rationale.push("Orderbook imbalance favors bids.");
      } else if (perp.orderBookImbalance <= -0.20) {
        addS("microstructure", 8);
        rationale.push("Orderbook imbalance favors asks.");
      } else {
        rationale.push("Orderbook imbalance is neutral.");
      }
    }

    if (perp.microPricePremiumPct !== undefined) {
      if (perp.microPricePremiumPct > 0.01) {
        addL("microstructure", 8);
        rationale.push("Microprice sits above mid; near-term pressure is bid-led.");
      } else if (perp.microPricePremiumPct < -0.01) {
        addS("microstructure", 8);
        rationale.push("Microprice sits below mid; near-term pressure is ask-led.");
      }
    }
  }

  private scoreMeanReversion(ctx: ScoringContext): void {
    const { indicators, lastPrice, addL, addS, rationale } = ctx;

    // RSI extremes
    if (indicators.rsi14 >= 75) {
      addS("meanReversion", 6);
      rationale.push("RSI is at extreme overbought; mean-reversion risk elevated.");
    } else if (indicators.rsi14 <= 25) {
      addL("meanReversion", 6);
      rationale.push("RSI is at extreme oversold; mean-reversion risk elevated.");
    } else if (indicators.rsi14 >= 70) {
      addS("meanReversion", 3);
      rationale.push("RSI is overbought; upside may be exhausted.");
    } else if (indicators.rsi14 <= 30) {
      addL("meanReversion", 3);
      rationale.push("RSI is oversold; rebound risk is elevated.");
    }

    // BB band stretch
    if (lastPrice > indicators.bbUpper) {
      addS("meanReversion", 3);
      rationale.push("Price is stretched above Bollinger upper band.");
    } else if (lastPrice < indicators.bbLower) {
      addL("meanReversion", 3);
      rationale.push("Price is stretched below Bollinger lower band.");
    }

    // RSI divergence
    if (indicators.rsiDivergence) {
      if (indicators.rsiDivergence.bullish) {
        addL("meanReversion", 8);
        addS("meanReversion", -4);
        rationale.push("RSI bullish divergence detected (price lower low, RSI higher low).");
      } else if (indicators.rsiDivergence.bearish) {
        addS("meanReversion", 8);
        addL("meanReversion", -4);
        rationale.push("RSI bearish divergence detected (price higher high, RSI lower high).");
      }
    }
  }

  private scoreHtfBias(ctx: ScoringContext): void {
    const { biasContext, biasInterval, addL, addS, rationale } = ctx;
    if (!biasContext) return;

    const htfLabel = biasInterval ?? "HTF";
    if (biasContext.trend === "LONG") {
      addL("trend", 14);
      rationale.push(`HTF bias (${htfLabel}) is bullish (EMA trend).`);
    } else {
      addS("trend", 14);
      rationale.push(`HTF bias (${htfLabel}) is bearish (EMA trend).`);
    }
    if (biasContext.macdDirection === "POSITIVE") {
      addL("momentum", 4);
      rationale.push("HTF MACD is positive.");
    } else if (biasContext.macdDirection === "NEGATIVE") {
      addS("momentum", 4);
      rationale.push("HTF MACD is negative.");
    }
    if (biasContext.rsiZone === "OVERBOUGHT" && biasContext.trend === "LONG") {
      addL("momentum", -3);
      rationale.push("HTF RSI is overbought; long continuation risk elevated.");
    } else if (biasContext.rsiZone === "OVERSOLD" && biasContext.trend === "SHORT") {
      addS("momentum", -3);
      rationale.push("HTF RSI is oversold; short continuation risk elevated.");
    }
    if (biasContext.bbPosition === "ABOVE") {
      addS("meanReversion", 2);
      rationale.push("HTF price is above Bollinger upper band.");
    } else if (biasContext.bbPosition === "BELOW") {
      addL("meanReversion", 2);
      rationale.push("HTF price is below Bollinger lower band.");
    }
  }

  private scoreConsensusAndFilters(ctx: ScoringContext): void {
    const { indicators, lastPrice, emaTrend, macdAligned, macdBearAligned,
      aboveVwap, shortHorizon, atrPct, addL, addS, rationale } = ctx;

    // Directional consensus
    const recent = indicators.recentCandleContext;
    const bullishStructureSignals = [
      emaTrend === "LONG", aboveVwap, macdAligned,
      (recent?.momentumPct3 ?? 0) > 0, recent?.breakoutDirection === "UP"
    ].filter(Boolean).length;
    const bearishStructureSignals = [
      emaTrend === "SHORT", !aboveVwap, macdBearAligned,
      (recent?.momentumPct3 ?? 0) < 0, recent?.breakoutDirection === "DOWN"
    ].filter(Boolean).length;
    if (shortHorizon && bullishStructureSignals >= 4 && bearishStructureSignals <= 1) {
      addL("consensus", 10);
      addS("consensus", -14);
      rationale.push("Directional consensus: bullish structure dominates trend, momentum, and flow inputs.");
    } else if (shortHorizon && bearishStructureSignals >= 4 && bullishStructureSignals <= 1) {
      addS("consensus", 10);
      addL("consensus", -14);
      rationale.push("Directional consensus: bearish structure dominates trend, momentum, and flow inputs.");
    }

    // ATR volatility
    if (atrPct < 0.8) {
      addL("volatility", 3);
      addS("volatility", 3);
      rationale.push("ATR indicates controlled intraday volatility.");
    } else {
      rationale.push("ATR indicates elevated volatility; execution risk rises.");
    }

    // Fast filters
    const emaSpreadPct = (Math.abs(indicators.ema20 - indicators.ema50) / Math.max(lastPrice, 1)) * 100;
    if (shortHorizon && emaSpreadPct < 0.08) {
      addL("fastFilters", -8);
      addS("fastFilters", -8);
      rationale.push("Short-horizon filter: EMA spread is tight; likely chop around crossover.");
    }

    const bullishFastConfirmations = [
      macdAligned, aboveVwap, indicators.rsi14 > 52,
      (indicators.recentCandleContext?.momentumPct3 ?? 0) > 0
    ].filter(Boolean).length;
    const bearishFastConfirmations = [
      macdBearAligned, !aboveVwap, indicators.rsi14 < 48,
      (indicators.recentCandleContext?.momentumPct3 ?? 0) < 0
    ].filter(Boolean).length;
    const emaTrendDirection: Exclude<Signal, "NO_TRADE"> = emaTrend;
    if (shortHorizon) {
      if (emaTrendDirection === "LONG" && bullishFastConfirmations === 0) {
        addL("fastFilters", -12);
        rationale.push("Short-horizon filter: EMA trend needs at least one fast confirmation before a long.");
      }
      if (emaTrendDirection === "SHORT" && bearishFastConfirmations === 0) {
        addS("fastFilters", -12);
        rationale.push("Short-horizon filter: EMA trend needs at least one fast confirmation before a short.");
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Helper methods (unchanged)
  // ---------------------------------------------------------------------------

  computeAtrPct(indicators: IndicatorSnapshot): number {
    return computeIndicatorAtrPct(indicators);
  }

  private computeConfidenceBreakdown(input: {
    indicators: IndicatorSnapshot;
    marketRegime: MarketRegime;
    impulseBias: "UP_IMPULSE" | "DOWN_IMPULSE" | "NONE";
    biasContext?: BiasContext;
    breakoutValidationFailed: boolean;
    pullbackExtended: boolean;
  }): ConfidenceBreakdown {
    const atrPct = this.computeAtrPct(input.indicators);
    const emaSpreadPct =
      (Math.abs(input.indicators.ema20 - input.indicators.ema50) / Math.max(input.indicators.ema20, 1)) * 100;
    const trend = clamp(
      35 +
        input.indicators.adx14 * 1.1 +
        emaSpreadPct * 40 +
        (input.marketRegime === "TREND" ? 12 : input.marketRegime === "RANGE" ? -4 : 0),
      0,
      100
    );
    const momentum = clamp(
      45 +
        Math.abs(input.indicators.macdHistogram) * 2.2 +
        (input.indicators.rsi14 > 55 || input.indicators.rsi14 < 45 ? 8 : -5) +
        (input.impulseBias === "NONE" ? 0 : 12) +
        (input.indicators.rsiDivergence?.bullish || input.indicators.rsiDivergence?.bearish ? 6 : 0),
      0,
      100
    );
    const medianAtrPct = input.indicators.medianAtrPct ?? atrPct;
    const volatility = clamp(100 - Math.abs(atrPct - medianAtrPct) * 70, 0, 100);
    const vwapDistancePct =
      (Math.abs(input.indicators.ema20 - input.indicators.vwap) / Math.max(input.indicators.vwap, 1)) * 100;
    const structure = clamp(
      45 +
        vwapDistancePct * 130 +
        (input.breakoutValidationFailed ? -18 : 8) +
        (input.pullbackExtended ? -10 : 0),
      0,
      100
    );
    const context = clamp(
      50 +
        (Math.abs(input.indicators.macdHistogram) > 0.2 ? 8 : -4) +
        (input.biasContext
          ? 4 + (input.biasContext.macdDirection === "POSITIVE" || input.biasContext.macdDirection === "NEGATIVE" ? 4 : 0)
          : 0) +
        ((input.indicators.mfi14 ?? 50) > 55 || (input.indicators.mfi14 ?? 50) < 45 ? 4 : -2) +
        (Math.abs(input.indicators.cmf20 ?? 0) > 0.06 ? 4 : 0) +
        (input.marketRegime === "LOW_LIQ_CHOP" ? -20 : 0) +
        (input.marketRegime === "VOLATILE_SPIKE" ? -8 : 0),
      0,
      100
    );
    const setupQuality = clamp(
      trend * 0.28 + momentum * 0.24 + volatility * 0.16 + structure * 0.2 + context * 0.12,
      0,
      100
    );
    return {
      trend: this.round(trend),
      momentum: this.round(momentum),
      volatility: this.round(volatility),
      structure: this.round(structure),
      context: this.round(context),
      setupQuality: this.round(setupQuality)
    };
  }

  private round(value: number): number {
    return Number(value.toFixed(4));
  }

  private parseIntervalToMinutes(interval: string): number {
    return parseInterval(interval);
  }

  private countHtfContradictions(signal: Exclude<Signal, "NO_TRADE">, biasContext?: BiasContext): number {
    if (!biasContext) {
      return 0;
    }
    let count = 0;
    if ((signal === "LONG" && biasContext.trend === "SHORT") || (signal === "SHORT" && biasContext.trend === "LONG")) {
      count += 1;
    }
    if (
      (signal === "LONG" && biasContext.macdDirection === "NEGATIVE") ||
      (signal === "SHORT" && biasContext.macdDirection === "POSITIVE")
    ) {
      count += 1;
    }
    if ((signal === "LONG" && biasContext.rsiZone === "OVERBOUGHT") || (signal === "SHORT" && biasContext.rsiZone === "OVERSOLD")) {
      count += 1;
    }
    if ((signal === "LONG" && biasContext.bbPosition === "ABOVE") || (signal === "SHORT" && biasContext.bbPosition === "BELOW")) {
      count += 1;
    }
    return count;
  }

  private computeVolumeConfirmationScore(
    signal: Exclude<Signal, "NO_TRADE">,
    indicators: IndicatorSnapshot
  ): { score: number; anyData: boolean } {
    let score = 0;
    const hasObv = indicators.obvSlope5 !== undefined;
    const hasMfi = indicators.mfi14 !== undefined;
    const hasCmf = indicators.cmf20 !== undefined;
    const hasCvd = indicators.cvdDeltaPct5 !== undefined && indicators.volumeZScore20 !== undefined;
    const anyData = hasObv || hasMfi || hasCmf || hasCvd;

    if (hasObv && ((signal === "LONG" && indicators.obvSlope5! > 0) || (signal === "SHORT" && indicators.obvSlope5! < 0))) {
      score += 1;
    }
    if (hasMfi && ((signal === "LONG" && indicators.mfi14! > 55) || (signal === "SHORT" && indicators.mfi14! < 45))) {
      score += 1;
    }
    if (hasCmf && ((signal === "LONG" && indicators.cmf20! > 0.08) || (signal === "SHORT" && indicators.cmf20! < -0.08))) {
      score += 1;
    }
    if (
      hasCvd &&
      indicators.volumeZScore20! >= 1 &&
      ((signal === "LONG" && indicators.cvdDeltaPct5! > 0) || (signal === "SHORT" && indicators.cvdDeltaPct5! < 0))
    ) {
      score += 1;
    }
    return { score, anyData };
  }

  private countOptionalParticipation(input: {
    signal: Exclude<Signal, "NO_TRADE">;
    indicators: IndicatorSnapshot;
    lastPrice: number;
    biasContext?: BiasContext;
    btcContext?: { emaAbove: boolean; momentumPositive: boolean };
  }): number {
    const { signal, indicators, lastPrice, biasContext, btcContext } = input;
    let count = 0;
    if ((signal === "LONG" && indicators.rsiDivergence?.bullish) || (signal === "SHORT" && indicators.rsiDivergence?.bearish)) {
      count += 1;
    }
    if (
      (signal === "LONG" && indicators.volumeProfile !== undefined && lastPrice > indicators.volumeProfile.vah) ||
      (signal === "SHORT" && indicators.volumeProfile !== undefined && lastPrice < indicators.volumeProfile.val)
    ) {
      count += 1;
    }
    if (
      (signal === "LONG" && (indicators.obvSlope5 ?? 0) > 0.02) ||
      (signal === "SHORT" && (indicators.obvSlope5 ?? 0) < -0.02)
    ) {
      count += 1;
    }
    if ((signal === "LONG" && (indicators.mfi14 ?? 0) >= 55) || (signal === "SHORT" && (indicators.mfi14 ?? 100) <= 45)) {
      count += 1;
    }
    if ((signal === "LONG" && (indicators.cmf20 ?? 0) >= 0.08) || (signal === "SHORT" && (indicators.cmf20 ?? 0) <= -0.08)) {
      count += 1;
    }
    if (
      indicators.volumeZScore20 !== undefined &&
      indicators.cvdDeltaPct5 !== undefined &&
      indicators.volumeZScore20 >= 1 &&
      ((signal === "LONG" && indicators.cvdDeltaPct5 > 10) || (signal === "SHORT" && indicators.cvdDeltaPct5 < -10))
    ) {
      count += 1;
    }
    if (
      btcContext &&
      ((signal === "LONG" && btcContext.emaAbove && btcContext.momentumPositive) ||
        (signal === "SHORT" && !btcContext.emaAbove && !btcContext.momentumPositive))
    ) {
      count += 1;
    }
    if (biasContext && biasContext.trend === signal) {
      count += 1;
    }
    return count;
  }

  /**
   * Improvement #2: Decorrelate signals.
   * Score 4 truly independent channels and count how many agree with the signal direction.
   *
   * Channel 1 — Price Structure: EMA position, swing levels, VWAP
   * Channel 2 — Volume/Flow: OBV delta, CVD, volume z-score (NOT momentum oscillators)
   * Channel 3 — Perp-specific: Funding, OI delta, premium
   * Channel 4 — Microstructure: Orderbook imbalance, microprice
   */
  private computeIndependentChannelAgreement(input: {
    signal: Exclude<Signal, "NO_TRADE">;
    indicators: IndicatorSnapshot;
    perp: PerpMarketSnapshot;
    lastPrice: number;
    biasContext?: BiasContext;
    btcContext?: { emaAbove: boolean; momentumPositive: boolean };
  }): number {
    const { signal, indicators, perp, lastPrice } = input;
    let agreeing = 0;

    // Channel 1: Price Structure
    const priceStructureScore = (() => {
      let bullish = 0;
      let bearish = 0;
      if (indicators.ema20 > indicators.ema50) bullish++; else bearish++;
      if (lastPrice >= indicators.vwap) bullish++; else bearish++;
      if (indicators.swingLow !== undefined && lastPrice > indicators.swingLow &&
          (indicators.swingHigh === undefined || lastPrice < indicators.swingHigh)) {
        bullish++;
      } else if (indicators.swingHigh !== undefined && lastPrice < indicators.swingHigh) {
        bearish++;
      }
      return bullish > bearish ? "LONG" : bearish > bullish ? "SHORT" : "NEUTRAL";
    })();
    if (priceStructureScore === signal) agreeing++;

    // Channel 2: Volume/Flow (pure volume — no momentum oscillators)
    const volumeFlowScore = (() => {
      let bullish = 0;
      let bearish = 0;
      if ((indicators.obvSlope5 ?? 0) > 0.02) bullish++;
      else if ((indicators.obvSlope5 ?? 0) < -0.02) bearish++;
      if ((indicators.cvdDeltaPct5 ?? 0) > 10) bullish++;
      else if ((indicators.cvdDeltaPct5 ?? 0) < -10) bearish++;
      if ((indicators.cmf20 ?? 0) > 0.08) bullish++;
      else if ((indicators.cmf20 ?? 0) < -0.08) bearish++;
      return bullish > bearish ? "LONG" : bearish > bullish ? "SHORT" : "NEUTRAL";
    })();
    if (volumeFlowScore === signal) agreeing++;

    // Channel 3: Perp-specific
    const perpScore = (() => {
      let bullish = 0;
      let bearish = 0;
      // Funding: negative = short crowding = bullish
      if (perp.fundingRate < -0.00005) bullish++;
      else if (perp.fundingRate > 0.00005) bearish++;
      // Premium: discount = bullish
      if (perp.premiumPct < -0.1) bullish++;
      else if (perp.premiumPct > 0.1) bearish++;
      // OI expansion + MACD direction
      if (perp.openInterestDeltaPct !== undefined && perp.openInterestDeltaPct > 0.3) {
        if (indicators.macdHistogram > 0) bullish++;
        else if (indicators.macdHistogram < 0) bearish++;
      }
      return bullish > bearish ? "LONG" : bearish > bullish ? "SHORT" : "NEUTRAL";
    })();
    if (perpScore === signal) agreeing++;

    // Channel 4: Microstructure
    const microScore = (() => {
      let bullish = 0;
      let bearish = 0;
      if ((perp.orderBookImbalance ?? 0) >= 0.15) bullish++;
      else if ((perp.orderBookImbalance ?? 0) <= -0.15) bearish++;
      if ((perp.microPricePremiumPct ?? 0) > 0.008) bullish++;
      else if ((perp.microPricePremiumPct ?? 0) < -0.008) bearish++;
      return bullish > bearish ? "LONG" : bearish > bullish ? "SHORT" : "NEUTRAL";
    })();
    if (microScore === signal) agreeing++;

    return agreeing;
  }
}
