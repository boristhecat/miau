export type Signal = "LONG" | "SHORT" | "NO_TRADE";

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorSnapshot {
  rsi14: number;
  ema20: number;
  ema50: number;
  macd: number;
  macdSignal: number;
  macdHistogram: number;
  atr14: number;
  adx14: number;
  bbUpper: number;
  bbMiddle: number;
  bbLower: number;
  stochRsiK: number;
  stochRsiD: number;
  vwap: number;
}

export interface PerpMarketSnapshot {
  symbol: string;
  fundingRate: number;
  fundingRateAvg: number;
  openInterest: number;
  markPrice: number;
  indexPrice: number;
  premiumPct: number;
}

export interface Recommendation {
  pair: string;
  signal: Signal;
  action: "GREEN" | "YELLOW" | "RED";
  regime: "TRADEABLE" | "CHOPPY";
  entry: number;
  stopLoss: number;
  takeProfit: number;
  leverage?: number;
  positionSizeUsd?: number;
  estimatedPnLAtStopLoss?: number;
  estimatedPnLAtTakeProfit?: number;
  riskRewardRatio: number;
  dailyTargetUsd: number;
  tradesToDailyTarget?: number;
  confidence: number;
  rationale: string[];
  indicators: IndicatorSnapshot;
  perp: PerpMarketSnapshot;
}
