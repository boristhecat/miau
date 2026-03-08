import type {
  BiasContext,
  ConfidenceBreakdown,
  IndicatorSnapshot,
  MarketRegime,
  PerpMarketSnapshot,
  Signal
} from "./types.js";
import { resolveIndicatorWeightProfile, type WeightChannel } from "./indicator-weight-policy.js";
import { parseIntervalToMinutes as parseInterval } from "./interval-utils.js";
import {
  assessVwapChop,
  classifyMarketRegime,
  computeAtrPct as computeIndicatorAtrPct,
  detectTradingSession
} from "./recommendation-market-context.js";

export interface SignalEvaluationResult {
  signal: Exclude<Signal, "NO_TRADE">;
  confidence: number;
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

export class RecommendationSignalEvaluator {
  evaluate(
    indicators: IndicatorSnapshot,
    perp: PerpMarketSnapshot,
    lastPrice: number,
    biasContext?: BiasContext,
    biasInterval?: string,
    baseInterval = "1m",
    btcContext?: { emaAbove: boolean; momentumPositive: boolean }
  ): SignalEvaluationResult {
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
    let impulseBias: "UP_IMPULSE" | "DOWN_IMPULSE" | "NONE" = "NONE";
    let pullbackExtended = false;
    let breakoutValidationFailed = false;
    let breakoutFailureDirection: "UP" | "DOWN" | "NONE" = "NONE";
    let lowAbsoluteConviction = false;
    let winnerRatioInsufficient = false;
    let htfContradictionCount = 0;
    let regimeSignalMismatch = false;

    const emaTrendWeight = shortHorizon ? 17 : 28;
    if (indicators.ema20 > indicators.ema50) {
      longScore += w("trend", emaTrendWeight);
      rationale.push("EMA20 is above EMA50 (bullish trend).");
    } else {
      shortScore += w("trend", emaTrendWeight);
      rationale.push("EMA20 is below EMA50 (bearish trend).");
    }

    if (indicators.adx14 >= 25) {
      if (indicators.ema20 >= indicators.ema50) {
        longScore += w("trend", 10);
      } else {
        shortScore += w("trend", 10);
      }
      rationale.push("ADX confirms a strong trend regime.");
    } else if (indicators.adx14 < 18) {
      rationale.push("ADX is very low; trend conviction is weak.");
    } else {
      rationale.push("ADX indicates a moderate trend regime.");
    }

    if (indicators.macdHistogram > 0 && indicators.macd > indicators.macdSignal) {
      longScore += w("momentum", 18);
      rationale.push("MACD momentum is positive.");
    } else if (indicators.macdHistogram < 0 && indicators.macd < indicators.macdSignal) {
      shortScore += w("momentum", 18);
      rationale.push("MACD momentum is negative.");
    } else {
      rationale.push("MACD momentum is mixed.");
    }

    if (indicators.rsi14 > 55 && indicators.rsi14 < 70) {
      longScore += w("momentum", 4);
      rationale.push("RSI supports continuation to the upside.");
    } else if (indicators.rsi14 < 45 && indicators.rsi14 > 30) {
      shortScore += w("momentum", 4);
      rationale.push("RSI supports continuation to the downside.");
    } else if (indicators.rsi14 >= 70) {
      const confirmedBullTrend =
        marketRegime === "TREND" &&
        indicators.ema20 >= indicators.ema50 &&
        lastPrice >= indicators.vwap &&
        indicators.macdHistogram > 0;
      if (confirmedBullTrend) {
        longScore += w("momentum", 2);
        rationale.push("RSI is overbought but trend structure is bullish; continuation is favored over reversal.");
      } else {
        shortScore += w("meanReversion", 5);
        rationale.push("RSI is overbought; upside may be exhausted.");
      }
    } else if (indicators.rsi14 <= 30) {
      const confirmedBearTrend =
        marketRegime === "TREND" &&
        indicators.ema20 <= indicators.ema50 &&
        lastPrice <= indicators.vwap &&
        indicators.macdHistogram < 0;
      if (confirmedBearTrend) {
        shortScore += w("momentum", 2);
        rationale.push("RSI is oversold but trend structure is bearish; continuation is favored over reversal.");
      } else {
        longScore += w("meanReversion", 5);
        rationale.push("RSI is oversold; rebound risk is elevated.");
      }
    } else {
      rationale.push("RSI is neutral.");
    }

    if (indicators.stochRsiK > indicators.stochRsiD && indicators.stochRsiK < 80) {
      longScore += w("momentum", 3);
      rationale.push("StochRSI timing is aligned for long continuation.");
    } else if (indicators.stochRsiK < indicators.stochRsiD && indicators.stochRsiK > 20) {
      shortScore += w("momentum", 3);
      rationale.push("StochRSI timing is aligned for short continuation.");
    } else {
      rationale.push("StochRSI timing is neutral.");
    }

    if (lastPrice >= indicators.vwap) {
      longScore += w("flow", 10);
      rationale.push("Price is above VWAP (intraday buyer control).");
    } else {
      shortScore += w("flow", 10);
      rationale.push("Price is below VWAP (intraday seller control).");
    }

    if (lastPrice > indicators.bbUpper) {
      shortScore += w("meanReversion", 3);
      rationale.push("Price is stretched above Bollinger upper band.");
    } else if (lastPrice < indicators.bbLower) {
      longScore += w("meanReversion", 3);
      rationale.push("Price is stretched below Bollinger lower band.");
    } else {
      rationale.push("Price is inside Bollinger bands.");
    }

    const fundingMomentum = perp.fundingRate - perp.fundingRateAvg;
    const fundingAccelerating = Math.abs(fundingMomentum) > 0.00003;
    if (perp.fundingRate > 0.00005 && perp.fundingRateAvg > 0) {
      const pts = fundingAccelerating ? 6 : 4;
      shortScore += w("flow", pts);
      rationale.push(
        fundingAccelerating
          ? "Funding is accelerating positive (increasing long crowding risk)."
          : "Funding is persistently positive (long crowding risk)."
      );
    } else if (perp.fundingRate < -0.00005 && perp.fundingRateAvg < 0) {
      const pts = fundingAccelerating ? 6 : 4;
      longScore += w("flow", pts);
      rationale.push(
        fundingAccelerating
          ? "Funding is accelerating negative (increasing short crowding risk)."
          : "Funding is persistently negative (short crowding risk)."
      );
    } else {
      rationale.push("Funding is neutral.");
    }

    if (perp.premiumPct > 0.15) {
      shortScore += w("flow", 4);
      rationale.push("Mark trades at a premium to index (possible long overheating).");
    } else if (perp.premiumPct < -0.15) {
      longScore += w("flow", 4);
      rationale.push("Mark trades at a discount to index (possible short exhaustion).");
    } else {
      rationale.push("Mark/index premium is balanced.");
    }

    if (perp.orderBookImbalance !== undefined) {
      if (perp.orderBookImbalance >= 0.08) {
        longScore += w("microstructure", 8);
        rationale.push("Orderbook imbalance favors bids.");
      } else if (perp.orderBookImbalance <= -0.08) {
        shortScore += w("microstructure", 8);
        rationale.push("Orderbook imbalance favors asks.");
      } else {
        rationale.push("Orderbook imbalance is neutral.");
      }
    }

    if (perp.microPricePremiumPct !== undefined) {
      if (perp.microPricePremiumPct > 0.01) {
        longScore += w("microstructure", 3);
        rationale.push("Microprice sits above mid; near-term pressure is bid-led.");
      } else if (perp.microPricePremiumPct < -0.01) {
        shortScore += w("microstructure", 3);
        rationale.push("Microprice sits below mid; near-term pressure is ask-led.");
      }
    }

    if (perp.openInterestDeltaPct !== undefined) {
      if (perp.openInterestDeltaPct > 0.35 && indicators.macdHistogram > 0) {
        longScore += w("flow", 3);
        rationale.push("Open interest is expanding alongside bullish momentum.");
      } else if (perp.openInterestDeltaPct > 0.35 && indicators.macdHistogram < 0) {
        shortScore += w("flow", 3);
        rationale.push("Open interest is expanding alongside bearish momentum.");
      } else if (perp.openInterestDeltaPct < -0.35) {
        longScore -= w("flow", 2);
        shortScore -= w("flow", 2);
        rationale.push("Open interest is fading; follow-through conviction is reduced.");
      }
    }

    if (biasContext) {
      const htfLabel = biasInterval ?? "HTF";
      if (biasContext.trend === "LONG") {
        longScore += w("trend", 14);
        rationale.push(`HTF bias (${htfLabel}) is bullish (EMA trend).`);
      } else {
        shortScore += w("trend", 14);
        rationale.push(`HTF bias (${htfLabel}) is bearish (EMA trend).`);
      }
      if (biasContext.macdDirection === "POSITIVE") {
        longScore += w("momentum", 4);
        rationale.push("HTF MACD is positive.");
      } else if (biasContext.macdDirection === "NEGATIVE") {
        shortScore += w("momentum", 4);
        rationale.push("HTF MACD is negative.");
      }
      if (biasContext.rsiZone === "OVERBOUGHT" && biasContext.trend === "LONG") {
        longScore -= w("momentum", 3);
        rationale.push("HTF RSI is overbought; long continuation risk elevated.");
      } else if (biasContext.rsiZone === "OVERSOLD" && biasContext.trend === "SHORT") {
        shortScore -= w("momentum", 3);
        rationale.push("HTF RSI is oversold; short continuation risk elevated.");
      }
      if (biasContext.bbPosition === "ABOVE") {
        shortScore += w("meanReversion", 2);
        rationale.push("HTF price is above Bollinger upper band.");
      } else if (biasContext.bbPosition === "BELOW") {
        longScore += w("meanReversion", 2);
        rationale.push("HTF price is below Bollinger lower band.");
      }
    }

    const atrPct = computeIndicatorAtrPct(indicators);
    const impulseMomentumThreshold = this.clamp(0.2 + atrPct * 0.14, 0.22, 0.45);
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
        longScore += w("momentum", 12);
        shortScore -= w("momentum", 10);
        rationale.push("Recent candles show a bullish impulse (momentum + close skew + expansion/breakout).");
      } else if (downImpulse) {
        impulseBias = "DOWN_IMPULSE";
        shortScore += w("momentum", 12);
        longScore -= w("momentum", 10);
        rationale.push("Recent candles show a bearish impulse (momentum + close skew + expansion/breakout).");
      } else {
        rationale.push("Recent candle impulse is neutral.");
      }

      if (recent.breakoutDirection === "UP") {
        const validated = recent.momentumPct3 >= impulseMomentumThreshold * 0.9 && recent.bullishCloseRatio5 >= 0.6;
        if (validated) {
          longScore += w("momentum", 6);
          rationale.push("Breakout check: upside breakout has follow-through confirmation.");
        } else {
          shortScore += w("momentum", 4);
          breakoutValidationFailed = true;
          breakoutFailureDirection = "UP";
          rationale.push("Breakout check: upside breakout lacks follow-through; fade risk increased.");
        }
      } else if (recent.breakoutDirection === "DOWN") {
        const validated =
          recent.momentumPct3 <= -impulseMomentumThreshold * 0.9 && recent.bearishCloseRatio5 >= 0.6;
        if (validated) {
          shortScore += w("momentum", 6);
          rationale.push("Breakout check: downside breakout has follow-through confirmation.");
        } else {
          longScore += w("momentum", 4);
          breakoutValidationFailed = true;
          breakoutFailureDirection = "DOWN";
          rationale.push("Breakout check: downside breakout lacks follow-through; fade risk increased.");
        }
      }
    }

    if (indicators.rsiDivergence) {
      if (indicators.rsiDivergence.bullish) {
        longScore += w("meanReversion", 8);
        shortScore -= w("meanReversion", 4);
        rationale.push("RSI bullish divergence detected (price lower low, RSI higher low).");
      } else if (indicators.rsiDivergence.bearish) {
        shortScore += w("meanReversion", 8);
        longScore -= w("meanReversion", 4);
        rationale.push("RSI bearish divergence detected (price higher high, RSI lower high).");
      }
    }

    if (indicators.volumeProfile) {
      const { vpoc, vah, val } = indicators.volumeProfile;
      const vpocDist = (Math.abs(lastPrice - vpoc) / Math.max(vpoc, 1)) * 100;
      if (vpocDist < 0.15) {
        if (marketRegime === "RANGE") {
          rationale.push("Price is near VPOC (volume fair value) - range mean reversion favored.");
        } else {
          longScore -= w("flow", 2);
          shortScore -= w("flow", 2);
          rationale.push("Price is near VPOC; may act as resistance/support.");
        }
      } else if (lastPrice > vah) {
        longScore += w("flow", 4);
        rationale.push("Price is above Value Area High; breakout above value area.");
      } else if (lastPrice < val) {
        shortScore += w("flow", 4);
        rationale.push("Price is below Value Area Low; breakdown below value area.");
      } else {
        rationale.push(`Price is inside value area (VAL ${val.toFixed(4)} - VAH ${vah.toFixed(4)}).`);
      }
    }

    if (btcContext) {
      const btcBullish = btcContext.emaAbove && btcContext.momentumPositive;
      const btcBearish = !btcContext.emaAbove && !btcContext.momentumPositive;
      if (btcBullish) {
        longScore += w("trend", 5);
        shortScore -= w("trend", 3);
        rationale.push("BTC is bullish (EMA + MACD); alt long has macro tailwind.");
      } else if (btcBearish) {
        shortScore += w("trend", 5);
        longScore -= w("trend", 3);
        rationale.push("BTC is bearish (EMA + MACD); alt long has macro headwind.");
      } else {
        rationale.push("BTC trend is mixed; cross-asset correlation neutral.");
      }
    }

    const session = detectTradingSession();
    if (session === "ASIA") {
      longScore -= w("momentum", 2);
      shortScore -= w("momentum", 2);
      rationale.push("Session: Asian hours - lower volume; impulse follow-through reduced.");
    } else if (session === "DEAD") {
      longScore -= w("momentum", 4);
      shortScore -= w("momentum", 4);
      rationale.push("Session: dead zone (US close - Asia open) - low volume, avoid breakouts.");
    } else if (session === "US") {
      rationale.push("Session: US peak hours - elevated volatility and volume.");
    } else {
      rationale.push("Session: London/NY overlap - trend-follow reliability moderate-high.");
    }

    const bullishStructureSignals = [
      indicators.ema20 >= indicators.ema50,
      lastPrice >= indicators.vwap,
      indicators.macdHistogram > 0 && indicators.macd >= indicators.macdSignal,
      (recent?.momentumPct3 ?? 0) > 0,
      recent?.breakoutDirection === "UP"
    ].filter(Boolean).length;
    const bearishStructureSignals = [
      indicators.ema20 <= indicators.ema50,
      lastPrice <= indicators.vwap,
      indicators.macdHistogram < 0 && indicators.macd <= indicators.macdSignal,
      (recent?.momentumPct3 ?? 0) < 0,
      recent?.breakoutDirection === "DOWN"
    ].filter(Boolean).length;
    if (shortHorizon && bullishStructureSignals >= 4 && bearishStructureSignals <= 1) {
      longScore += w("consensus", 10);
      shortScore -= w("consensus", 14);
      rationale.push("Directional consensus: bullish structure dominates trend, momentum, and flow inputs.");
    } else if (shortHorizon && bearishStructureSignals >= 4 && bullishStructureSignals <= 1) {
      shortScore += w("consensus", 10);
      longScore -= w("consensus", 14);
      rationale.push("Directional consensus: bearish structure dominates trend, momentum, and flow inputs.");
    }

    if (atrPct < 0.8) {
      longScore += w("volatility", 3);
      shortScore += w("volatility", 3);
      rationale.push("ATR indicates controlled intraday volatility.");
    } else {
      rationale.push("ATR indicates elevated volatility; execution risk rises.");
    }

    if (indicators.mfi14 !== undefined) {
      if (indicators.mfi14 >= 55 && indicators.mfi14 < 80) {
        longScore += w("flow", 4);
        rationale.push("MFI confirms buying pressure.");
      } else if (indicators.mfi14 <= 45 && indicators.mfi14 > 20) {
        shortScore += w("flow", 4);
        rationale.push("MFI confirms selling pressure.");
      } else if (indicators.mfi14 >= 80) {
        shortScore += w("meanReversion", 2);
        rationale.push("MFI is overbought; exhaustion risk rises.");
      } else if (indicators.mfi14 <= 20) {
        longScore += w("meanReversion", 2);
        rationale.push("MFI is oversold; rebound risk rises.");
      }
    }

    if (indicators.cmf20 !== undefined) {
      if (indicators.cmf20 >= 0.08) {
        longScore += w("flow", 4);
        rationale.push("CMF indicates sustained accumulation.");
      } else if (indicators.cmf20 <= -0.08) {
        shortScore += w("flow", 4);
        rationale.push("CMF indicates sustained distribution.");
      }
    }

    if (indicators.obvSlope5 !== undefined) {
      if (indicators.obvSlope5 > 0.02) {
        longScore += w("flow", 3);
        rationale.push("OBV slope is rising.");
      } else if (indicators.obvSlope5 < -0.02) {
        shortScore += w("flow", 3);
        rationale.push("OBV slope is falling.");
      }
    }

    if (indicators.volumeZScore20 !== undefined && indicators.cvdDeltaPct5 !== undefined) {
      const expansion = indicators.volumeZScore20 >= 1;
      if (expansion && indicators.cvdDeltaPct5 > 10) {
        longScore += w("flow", 4);
        rationale.push("Volume expansion aligns with positive flow delta.");
      } else if (expansion && indicators.cvdDeltaPct5 < -10) {
        shortScore += w("flow", 4);
        rationale.push("Volume expansion aligns with negative flow delta.");
      }
    }

    if (marketRegime === "TREND") {
      if (indicators.ema20 >= indicators.ema50) {
        longScore += w("trend", 8);
      } else {
        shortScore += w("trend", 8);
      }
      rationale.push("Regime model favors trend-follow continuation.");
    } else if (marketRegime === "RANGE") {
      if (lastPrice <= indicators.bbLower) {
        longScore += w("meanReversion", 8);
        rationale.push("Range regime: price is at lower band, favoring mean reversion long.");
      } else if (lastPrice >= indicators.bbUpper) {
        shortScore += w("meanReversion", 8);
        rationale.push("Range regime: price is at upper band, favoring mean reversion short.");
      } else {
        longScore -= w("meanReversion", 2);
        shortScore -= w("meanReversion", 2);
        rationale.push("Range regime but entry is mid-band; edge is limited.");
      }
    } else if (marketRegime === "VOLATILE_SPIKE") {
      longScore -= w("volatility", 4);
      shortScore -= w("volatility", 4);
      rationale.push("Volatility spike regime: reduce conviction until expansion settles.");
    }

    const emaSpreadPct = (Math.abs(indicators.ema20 - indicators.ema50) / Math.max(lastPrice, 1)) * 100;
    if (shortHorizon && emaSpreadPct < 0.08) {
      longScore -= w("fastFilters", 8);
      shortScore -= w("fastFilters", 8);
      rationale.push("Short-horizon filter: EMA spread is tight; likely chop around crossover.");
    }

    const bullishFastConfirmations = [
      indicators.macdHistogram > 0 && indicators.macd > indicators.macdSignal,
      lastPrice > indicators.vwap,
      indicators.rsi14 > 52,
      (indicators.recentCandleContext?.momentumPct3 ?? 0) > 0
    ].filter(Boolean).length;
    const bearishFastConfirmations = [
      indicators.macdHistogram < 0 && indicators.macd < indicators.macdSignal,
      lastPrice < indicators.vwap,
      indicators.rsi14 < 48,
      (indicators.recentCandleContext?.momentumPct3 ?? 0) < 0
    ].filter(Boolean).length;
    const emaTrendDirection: Exclude<Signal, "NO_TRADE"> = indicators.ema20 >= indicators.ema50 ? "LONG" : "SHORT";
    if (shortHorizon) {
      if (emaTrendDirection === "LONG" && bullishFastConfirmations === 0) {
        longScore -= w("fastFilters", 12);
        rationale.push("Short-horizon filter: EMA trend needs at least one fast confirmation before a long.");
      }
      if (emaTrendDirection === "SHORT" && bearishFastConfirmations === 0) {
        shortScore -= w("fastFilters", 12);
        rationale.push("Short-horizon filter: EMA trend needs at least one fast confirmation before a short.");
      }
    }

    const prevRegimeContext = classifyMarketRegime(indicators, lastPrice, true);
    const prevMarketRegime = prevRegimeContext.marketRegime;
    if (prevMarketRegime !== marketRegime) {
      if (prevMarketRegime === "RANGE" && marketRegime === "TREND") {
        longScore += w("trend", 5);
        shortScore += w("trend", 5);
        rationale.push("Regime transition: RANGE -> TREND detected (fresh breakout setup).");
      } else if (prevMarketRegime === "TREND" && marketRegime === "RANGE") {
        longScore -= w("trend", 4);
        shortScore -= w("trend", 4);
        rationale.push("Regime transition: TREND -> RANGE detected (exhaustion; reduce trend conviction).");
      } else if (marketRegime === "VOLATILE_SPIKE") {
        longScore -= w("volatility", 3);
        shortScore -= w("volatility", 3);
        rationale.push("Regime transition: spike detected - caution escalated.");
      }
    }

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

    const winnerScore = Math.max(longScore, shortScore);
    const loserScore = Math.min(longScore, shortScore);
    let winnerRatio = 1;
    if (loserScore > 0) {
      winnerRatio = winnerScore / (winnerScore + loserScore);
    }
    if (winnerRatio < 0.48) {
      winnerRatioInsufficient = true;
      rationale.push(`Winner ratio ${winnerRatio.toFixed(2)} is below 0.48; directional edge is insufficient.`);
    } else if (winnerRatio < 0.55) {
      confidence -= 12;
      rationale.push(`Low winner ratio (${winnerRatio.toFixed(2)}); mixed signals reduce conviction.`);
    }

    if (winnerScore < 28) {
      lowAbsoluteConviction = true;
      confidence -= 10;
      rationale.push("Few indicators contributed to the winning direction; conviction is low.");
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
      signal,
      indicators,
      lastPrice,
      biasContext,
      btcContext
    });
    rationale.push(`Signal participation: ${optionalParticipationCount} optional channels confirmed direction.`);
    if (optionalParticipationCount >= 6) {
      confidence += 5;
    } else if (optionalParticipationCount <= 2) {
      confidence -= 6;
    }

    htfContradictionCount = this.countHtfContradictions(signal, biasContext);
    if (htfContradictionCount > 0) {
      rationale.push(`HTF contradiction count: ${htfContradictionCount}/4 against ${signal}.`);
    }

    regimeSignalMismatch =
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

    if (marketRegime === "TREND") {
      const extensionAtr = Math.abs(lastPrice - indicators.ema20) / Math.max(indicators.atr14, 1e-8);
      if (extensionAtr > 1.35) {
        pullbackExtended = true;
        confidence = Math.max(25, confidence - 10);
        rationale.push("Pullback filter: price is extended from EMA20; wait for pullback entry.");
      }
    }

    const confidenceBreakdown = this.computeConfidenceBreakdown({
      indicators,
      marketRegime,
      impulseBias,
      biasContext,
      breakoutValidationFailed,
      pullbackExtended
    });
    confidence = Math.round(this.clamp(confidence * 0.62 + confidenceBreakdown.setupQuality * 0.38, 1, 99));

    return {
      signal,
      confidence,
      confidenceBreakdown,
      rationale,
      regime,
      marketRegime,
      impulseBias,
      pullbackExtended,
      breakoutValidationFailed,
      breakoutFailureDirection,
      lowAbsoluteConviction,
      winnerRatioInsufficient,
      htfContradictionCount,
      regimeSignalMismatch
    };
  }

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
    const trend = this.clamp(
      35 +
        input.indicators.adx14 * 1.1 +
        emaSpreadPct * 40 +
        (input.marketRegime === "TREND" ? 12 : input.marketRegime === "RANGE" ? -4 : 0),
      0,
      100
    );
    const momentum = this.clamp(
      45 +
        Math.abs(input.indicators.macdHistogram) * 2.2 +
        (input.indicators.rsi14 > 55 || input.indicators.rsi14 < 45 ? 8 : -5) +
        (input.impulseBias === "NONE" ? 0 : 12) +
        (input.indicators.rsiDivergence?.bullish || input.indicators.rsiDivergence?.bearish ? 6 : 0),
      0,
      100
    );
    const medianAtrPct = input.indicators.medianAtrPct ?? atrPct;
    const volatility = this.clamp(100 - Math.abs(atrPct - medianAtrPct) * 70, 0, 100);
    const vwapDistancePct =
      (Math.abs(input.indicators.ema20 - input.indicators.vwap) / Math.max(input.indicators.vwap, 1)) * 100;
    const structure = this.clamp(
      45 +
        vwapDistancePct * 130 +
        (input.breakoutValidationFailed ? -18 : 8) +
        (input.pullbackExtended ? -10 : 0),
      0,
      100
    );
    const context = this.clamp(
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
    const setupQuality = this.clamp(
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

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
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
}
