import type { IndicatorSnapshot, MarketRegime, TradingSession } from "./types.js";

export interface MarketRegimeAssessment {
  readonly marketRegime: MarketRegime;
  readonly rationale: readonly string[];
}

export interface VwapChopAssessment {
  readonly nearVwapChop: boolean;
  readonly distancePct: number;
  readonly thresholdPct: number;
  readonly rationale?: string;
}

export function detectTradingSession(now: Date = new Date()): TradingSession {
  const utcHour = now.getUTCHours();
  if (utcHour >= 0 && utcHour < 8) return "ASIA";
  if (utcHour >= 8 && utcHour < 13) return "LONDON";
  if (utcHour >= 13 && utcHour < 21) return "US";
  return "DEAD";
}

export function computeAtrPct(indicators: IndicatorSnapshot): number {
  return (indicators.atr14 / Math.max(indicators.ema20, 1)) * 100;
}

export function classifyMarketRegime(
  indicators: IndicatorSnapshot,
  lastPrice: number,
  longerLookback = false
): MarketRegimeAssessment {
  const atrPct = computeAtrPct(indicators);
  const spread = indicators.ema20 - indicators.ema50;
  const spreadPct = (Math.abs(spread) / Math.max(lastPrice, 1)) * 100;
  const bandWidthPct = (Math.abs(indicators.bbUpper - indicators.bbLower) / Math.max(lastPrice, 1)) * 100;
  const nearVwapThreshold = clamp(0.02 + atrPct * 0.01, 0.02, 0.06);
  const nearVwap =
    (Math.abs(lastPrice - indicators.vwap) / Math.max(indicators.vwap, 1)) * 100 < nearVwapThreshold;
  const spikeAtrThreshold = longerLookback ? 2 : 1.2;
  const spikeBandThreshold = longerLookback ? 3.5 : 2.2;
  const trendAdxThreshold = longerLookback ? 18 : 22;
  const trendSpreadThreshold = longerLookback ? 0.08 : 0.12;

  if (atrPct < 0.12 && bandWidthPct < 0.35) {
    return {
      marketRegime: "LOW_LIQ_CHOP",
      rationale: ["Regime classifier: low-liquidity chop (compressed range + very low ATR)."]
    };
  }
  if (atrPct > spikeAtrThreshold || bandWidthPct > spikeBandThreshold) {
    return {
      marketRegime: "VOLATILE_SPIKE",
      rationale: ["Regime classifier: volatility spike (expanded range and elevated ATR)."]
    };
  }
  if (indicators.adx14 >= trendAdxThreshold && spreadPct >= trendSpreadThreshold && !nearVwap) {
    return {
      marketRegime: "TREND",
      rationale: ["Regime classifier: trend (ADX + EMA spread + price displacement)."]
    };
  }
  return {
    marketRegime: "RANGE",
    rationale: ["Regime classifier: range (no persistent trend edge detected)."]
  };
}

export function assessVwapChop(indicators: IndicatorSnapshot, lastPrice: number): VwapChopAssessment {
  const atrPct = computeAtrPct(indicators);
  const thresholdPct = clamp(0.02 + atrPct * 0.01, 0.02, 0.06);
  const distancePct = (Math.abs(lastPrice - indicators.vwap) / Math.max(indicators.vwap, 1)) * 100;
  const nearVwapChop = distancePct < thresholdPct;

  return {
    nearVwapChop,
    distancePct,
    thresholdPct,
    rationale: nearVwapChop ? "VWAP filter: price is too close to VWAP; intraday direction is not clean." : undefined
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
