export type Signal = "LONG" | "SHORT" | "HOLD";

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
}

export interface Recommendation {
  pair: string;
  signal: Signal;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  rationale: string[];
  indicators: IndicatorSnapshot;
}
