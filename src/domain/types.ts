export type Signal = "LONG" | "SHORT" | "NO_TRADE";
export type TradeAction = "LONG" | "SHORT" | "NO TRADE";
export type MarketRegime = "TREND" | "RANGE" | "VOLATILE_SPIKE" | "LOW_LIQ_CHOP";
export type SetupGrade = "A" | "B" | "C" | "D";
export type ImpulseDirection = "UP" | "DOWN" | "NONE";

export interface ConfidenceBreakdown {
  trend: number;
  momentum: number;
  volatility: number;
  structure: number;
  context: number;
  setupQuality: number;
}

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
  recentCandleContext?: {
    momentumPct3: number;
    bullishCloseRatio5: number;
    bearishCloseRatio5: number;
    rangeExpansionRatio: number;
    breakoutDirection: ImpulseDirection;
  };
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
  analysisInterval?: string;
  analysisBiasInterval?: string;
  signal: Signal;
  modelSignal?: "LONG" | "SHORT";
  requestedDirection?: "LONG" | "SHORT";
  qualityVerdict?: "VALID" | "WEAK";
  action: TradeAction;
  regime: "TRADEABLE" | "CHOPPY";
  marketRegime: MarketRegime;
  entry: number;
  expectedLow?: number;
  expectedHigh?: number;
  expectedRangeHorizonMinutes?: number;
  expectedRangeCandles?: number;
  stopLoss: number;
  takeProfit: number;
  leverage?: number;
  positionSizeUsd?: number;
  estimatedPnLAtStopLoss?: number;
  estimatedPnLAtTakeProfit?: number;
  riskRewardRatio: number;
  objectiveUsdc?: number;
  objectiveHorizon?: string;
  objectiveHorizonMinutes?: number;
  objectiveHorizonCandles?: number;
  timeStopRule?: string;
  objectiveTargetTpPct?: number;
  objectiveTargetSlPct?: number;
  objectiveRiskReward?: number;
  objectiveNotionalUsd?: number;
  objectivePlausibilityWarning?: string;
  netEstimatedPnLAtStopLoss?: number;
  netEstimatedPnLAtTakeProfit?: number;
  netRiskRewardRatio?: number;
  expectedValueUsd?: number;
  expectedValuePerMarginPct?: number;
  confidence: number;
  setupGrade: SetupGrade;
  confidenceBreakdown: ConfidenceBreakdown;
  rationale: string[];
  indicators: IndicatorSnapshot;
  perp: PerpMarketSnapshot;
}
