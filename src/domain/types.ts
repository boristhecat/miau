export type Signal = "LONG" | "SHORT" | "NO_TRADE";
export type TradeAction = "LONG" | "SHORT" | "NO TRADE";
export type MarketRegime = "TREND" | "RANGE" | "VOLATILE_SPIKE" | "LOW_LIQ_CHOP";
export type SetupGrade = "A" | "B" | "C" | "D";
export type ImpulseDirection = "UP" | "DOWN" | "NONE";
export type TradingSession = "ASIA" | "LONDON" | "US" | "DEAD";

export interface BiasContext {
  readonly trend: "LONG" | "SHORT";
  readonly rsiZone: "OVERBOUGHT" | "OVERSOLD" | "NEUTRAL";
  readonly macdDirection: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
  readonly bbPosition: "ABOVE" | "BELOW" | "INSIDE";
}

export interface ConfidenceBreakdown {
  readonly trend: number;
  readonly momentum: number;
  readonly volatility: number;
  readonly structure: number;
  readonly context: number;
  readonly setupQuality: number;
}

export interface Candle {
  readonly timestamp: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

export interface IndicatorSnapshot {
  readonly rsi14: number;
  readonly ema20: number;
  readonly ema50: number;
  readonly macd: number;
  readonly macdSignal: number;
  readonly macdHistogram: number;
  readonly atr14: number;
  readonly adx14: number;
  readonly bbUpper: number;
  readonly bbMiddle: number;
  readonly bbLower: number;
  readonly stochRsiK: number;
  readonly stochRsiD: number;
  readonly vwap: number;
  readonly obv?: number;
  readonly obvSlope5?: number;
  readonly mfi14?: number;
  readonly cmf20?: number;
  readonly volumeZScore20?: number;
  readonly cvdDeltaPct5?: number;
  readonly recentCandleContext?: {
    readonly momentumPct3: number;
    readonly bullishCloseRatio5: number;
    readonly bearishCloseRatio5: number;
    readonly rangeExpansionRatio: number;
    readonly breakoutDirection: ImpulseDirection;
  };
  readonly rsiDivergence?: {
    readonly bullish: boolean;
    readonly bearish: boolean;
  };
  readonly volumeProfile?: {
    readonly vpoc: number;
    readonly vah: number;
    readonly val: number;
  };
  readonly medianAtrPct?: number;
}

export interface PerpMarketSnapshot {
  readonly symbol: string;
  readonly fundingRate: number;
  readonly fundingRateAvg: number;
  readonly openInterest: number;
  readonly openInterestDeltaPct?: number;
  readonly markPrice: number;
  readonly indexPrice: number;
  readonly premiumPct: number;
  readonly bidAskSpreadPct?: number;
  readonly orderBookImbalance?: number;
  readonly microPricePremiumPct?: number;
}

export interface Recommendation {
  readonly pair: string;
  readonly analysisInterval?: string;
  readonly analysisBiasInterval?: string;
  readonly signal: Signal;
  readonly modelSignal?: "LONG" | "SHORT";
  readonly requestedDirection?: "LONG" | "SHORT";
  readonly qualityVerdict?: "VALID" | "WEAK";
  readonly action: TradeAction;
  readonly regime: "TRADEABLE" | "CHOPPY";
  readonly marketRegime: MarketRegime;
  readonly entry: number;
  readonly expectedLow?: number;
  readonly expectedHigh?: number;
  readonly expectedRangeHorizonMinutes?: number;
  readonly expectedRangeCandles?: number;
  readonly stopLoss: number;
  readonly takeProfit: number;
  readonly leverage?: number;
  readonly positionSizeUsd?: number;
  readonly estimatedPnLAtStopLoss?: number;
  readonly estimatedPnLAtTakeProfit?: number;
  readonly riskRewardRatio: number;
  readonly objectiveUsdc?: number;
  readonly objectiveHorizon?: string;
  readonly objectiveHorizonMinutes?: number;
  readonly objectiveHorizonCandles?: number;
  readonly timeStopRule?: string;
  readonly objectiveTargetTpPct?: number;
  readonly objectiveTargetSlPct?: number;
  readonly objectiveRiskReward?: number;
  readonly objectiveNotionalUsd?: number;
  readonly objectivePlausibilityWarning?: string;
  readonly netEstimatedPnLAtStopLoss?: number;
  readonly netEstimatedPnLAtTakeProfit?: number;
  readonly netRiskRewardRatio?: number;
  readonly expectedValueUsd?: number;
  readonly expectedValuePerMarginPct?: number;
  readonly confidence: number;
  readonly setupGrade: SetupGrade;
  readonly confidenceBreakdown: ConfidenceBreakdown;
  readonly rationale: readonly string[];
  readonly indicators: IndicatorSnapshot;
  readonly perp: PerpMarketSnapshot;
}
