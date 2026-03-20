export type Signal = "LONG" | "SHORT" | "NO_TRADE";
export type TradeAction = "LONG" | "SHORT" | "NO TRADE";
export type MarketRegime = "TREND" | "RANGE" | "VOLATILE_SPIKE" | "LOW_LIQ_CHOP";
export type SetupGrade = "A" | "B" | "C" | "D";
export type ImpulseDirection = "UP" | "DOWN" | "NONE";
export type TradingSession = "ASIA" | "LONDON" | "US" | "DEAD";
export type TradeabilityStatus = "TRADEABLE" | "CAUTION" | "DO_NOT_TRADE";
export type SetupPlaybook =
  | "TREND_PULLBACK_CONTINUATION"
  | "BREAKOUT_CONTINUATION"
  | "DIVERGENCE_REVERSAL"
  | "LIQUIDATION_REVERSAL"
  | "RANGE_FADE";
export type EntryReadinessStatus =
  | "READY_NOW"
  | "WAIT_PULLBACK"
  | "WAIT_BREAKOUT_RETEST"
  | "WAIT_CONFIRMATION"
  | "TOO_LATE";
export type SequenceStatus = "CONFIRMED" | "FORMING" | "FAILED" | "NONE";
export type SequencePattern =
  | "VWAP_RECLAIM"
  | "EMA_RECLAIM"
  | "BREAKOUT_ACCEPTANCE"
  | "BREAKOUT_FAILURE"
  | "SWEEP_REJECTION"
  | "NONE";
export type LevelInteractionStatus = "ACCEPTED" | "REJECTED" | "TESTING" | "NONE";
export type LevelInteractionReference =
  | "CURRENT_SESSION_OPEN"
  | "PRIOR_SESSION_HIGH"
  | "PRIOR_SESSION_LOW"
  | "CURRENT_DAY_OPEN"
  | "PRIOR_DAY_HIGH"
  | "PRIOR_DAY_LOW"
  | "NEAREST_SUPPORT"
  | "NEAREST_RESISTANCE"
  | "VWAP"
  | "EMA20"
  | "NONE";
export type TradeabilityReasonCode =
  | "LOW_LIQUIDITY_CHOP"
  | "WIDE_SPREAD"
  | "VWAP_CHOP"
  | "SESSION_DEAD_ZONE"
  | "SESSION_TRANSITION"
  | "HTF_CONTRADICTION"
  | "WEAK_SETUP_QUALITY"
  | "LOW_CONVICTION"
  | "RANGE_REGIME"
  | "VOLATILE_SPIKE_REGIME";

// --- Plan 1: Market Structure ---
export type SwingLabel = "HH" | "HL" | "LH" | "LL";
export type StructureState = "BULLISH" | "BEARISH" | "CONSOLIDATION";
export type StructureBreakType = "BOS" | "CHOCH" | "NONE";

export interface SwingPoint {
  readonly type: "HIGH" | "LOW";
  readonly price: number;
  readonly label: SwingLabel;
  readonly candleIndex: number;
}

export interface MarketStructure {
  readonly swings: readonly SwingPoint[];
  readonly state: StructureState;
  readonly lastBreak: StructureBreakType;
  readonly lastBreakDirection?: "BULLISH" | "BEARISH";
  readonly lastBreakLevel?: number;
  readonly lastBreakCandleIndex?: number;
  readonly currentSwingHigh?: number;
  readonly currentSwingLow?: number;
}

// --- Plan 2: Liquidity Mapping ---
export interface FairValueGap {
  readonly type: "BULLISH" | "BEARISH";
  readonly top: number;
  readonly bottom: number;
  readonly midpoint: number;
  readonly candleIndex: number;
  readonly mitigated: boolean;
}

export interface OrderBlock {
  readonly type: "BULLISH" | "BEARISH";
  readonly top: number;
  readonly bottom: number;
  readonly midpoint: number;
  readonly candleIndex: number;
  readonly mitigated: boolean;
}

export interface EqualLevel {
  readonly type: "EQH" | "EQL";
  readonly price: number;
  readonly count: number;
  readonly swept: boolean;
}

export interface LiquidityMap {
  readonly fairValueGaps: readonly FairValueGap[];
  readonly orderBlocks: readonly OrderBlock[];
  readonly equalLevels: readonly EqualLevel[];
  readonly nearestBullishFvg?: FairValueGap;
  readonly nearestBearishFvg?: FairValueGap;
  readonly nearestBullishOb?: OrderBlock;
  readonly nearestBearishOb?: OrderBlock;
  readonly nearestEqh?: EqualLevel;
  readonly nearestEql?: EqualLevel;
}

// --- Plan 3: Session-Aware Filtering ---
export interface SessionContext {
  readonly currentSession: TradingSession;
  readonly minutesIntoSession: number;
  readonly isSessionOpenWindow: boolean;
  readonly asiaHigh?: number;
  readonly asiaLow?: number;
  readonly asiaRangeBreak?: "ABOVE" | "BELOW" | "NONE";
  readonly londonExpansionDirection?: "BULLISH" | "BEARISH" | "NONE";
  readonly favoredSetups: readonly SetupPlaybook[];
  readonly riskySetups: readonly SetupPlaybook[];
}

// --- Plan 4: Liquidation Distance ---
export type LiquidationRisk = "SAFE" | "MODERATE" | "DANGEROUS" | "CRITICAL";

export interface LiquidationMetrics {
  readonly liquidationPrice: number;
  readonly distanceToLiquidation: number;
  readonly distanceToLiquidationPct: number;
  readonly distanceToLiquidationAtr?: number;
  readonly liquidationToStopRatio: number;
  readonly risk: LiquidationRisk;
  readonly effectiveMarginRate: number;
  readonly maintenanceMarginRate: number;
  readonly projectedFundingCostPct?: number;
  readonly fundingAdjustedLiquidationPrice?: number;
}

// --- Plan 6: Estimated Liquidation Clusters ---
export interface EstimatedLiquidationCluster {
  /** Center price of the cluster */
  readonly price: number;
  /** Number of individual projected liquidation levels that fell into this cluster */
  readonly density: number;
  /** Normalized strength 0-100 (recency + confluence + equal-level boost) */
  readonly strength: number;
  /** Which side gets liquidated if price reaches this cluster */
  readonly side: "LONG_LIQUIDATIONS" | "SHORT_LIQUIDATIONS";
  /** Distance from current price as percentage */
  readonly distancePct: number;
  /** Distance from current price in ATR units */
  readonly distanceAtr: number;
}

export interface LiquidationClusterMap {
  /** All clusters, sorted by strength descending */
  readonly clusters: readonly EstimatedLiquidationCluster[];
  /** Strongest cluster below current price (long liquidations) */
  readonly nearestClusterBelow?: EstimatedLiquidationCluster;
  /** Strongest cluster above current price (short liquidations) */
  readonly nearestClusterAbove?: EstimatedLiquidationCluster;
  /** True when a strong cluster sits between entry and stop — cascade could pull price away from TP */
  readonly clusterBlocksTarget: boolean;
  /** True when a strong cluster sits between current price and TP — cascade pushes price toward TP */
  readonly clusterSupportsDirection: boolean;
}

// --- Plan 5: Funding Rate Signals ---
export type FundingSignal = "STRONG_CONTRA_LONG" | "WEAK_CONTRA_LONG" | "NEUTRAL" | "WEAK_CONTRA_SHORT" | "STRONG_CONTRA_SHORT";
export type FundingTrend = "RISING" | "FALLING" | "FLIPPING_POSITIVE" | "FLIPPING_NEGATIVE" | "STABLE";

export interface FundingAnalysis {
  readonly currentRate: number;
  readonly averageRate: number;
  readonly deviationFromAvg: number;
  readonly signal: FundingSignal;
  readonly trend: FundingTrend;
  readonly minutesToNextSettlement: number;
  readonly projectedFundingCostPct?: number;
  readonly projectedFundingCostUsd?: number;
  readonly settlementsInHoldPeriod?: number;
  readonly isExtreme: boolean;
  readonly rationale: readonly string[];
}

// --- Plan 8: MTF Structure Cascade ---
export interface StructuralBiasContext {
  readonly trend: "LONG" | "SHORT";
  readonly rsiZone: "OVERBOUGHT" | "OVERSOLD" | "NEUTRAL";
  readonly macdDirection: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
  readonly bbPosition: "ABOVE" | "BELOW" | "INSIDE";
  readonly structureState?: StructureState;
  readonly structureBreak?: StructureBreakType;
  readonly regime?: MarketRegime;
  readonly swingHigh?: number;
  readonly swingLow?: number;
  readonly nearestSupport?: number;
  readonly nearestResistance?: number;
}

export type MtfAlignment = "FULL" | "PARTIAL" | "CONFLICTING";

export interface MtfContext {
  readonly structure: StructuralBiasContext;
  readonly structureInterval: string;
  readonly directional: StructuralBiasContext;
  readonly directionalInterval: string;
  readonly alignment: MtfAlignment;
  readonly cascadeBias: "LONG" | "SHORT" | "NEUTRAL";
  readonly agreementCount: number;
  readonly nearHtfResistance: boolean;
  readonly nearHtfSupport: boolean;
  readonly rationale: readonly string[];
}

// --- Plan 9: Trade Journal ---
export type TradeOutcomeClassification =
  | "AS_PLANNED"
  | "STOPPED_OUT"
  | "EARLY_EXIT_PROFIT"
  | "EARLY_EXIT_LOSS"
  | "BREAKEVEN";

export type TradeFailureReason =
  | "WRONG_DIRECTION"
  | "STOP_TOO_TIGHT"
  | "BAD_TIMING"
  | "SESSION_FAKEOUT"
  | "FUNDING_DRAIN"
  | "EXTERNAL_EVENT"
  | "NONE";

export interface TradeJournalEntry {
  readonly id: string;
  readonly sessionId: string;
  readonly symbol: string;
  readonly side: "LONG" | "SHORT";
  readonly entry: number;
  readonly stopLoss: number;
  readonly takeProfit: number;
  readonly leverage?: number;
  readonly positionSizeUsd?: number;
  readonly openedAtMs: number;
  readonly closedAtMs: number;
  readonly durationMinutes: number;
  readonly exitPrice: number;
  readonly pnlPct: number;
  readonly pnlUsd?: number;
  readonly maxFavorableExcursionPct: number;
  readonly maxAdverseExcursionPct: number;
  readonly setupGrade: SetupGrade;
  readonly setupPlaybook?: SetupPlaybook;
  readonly marketRegime: MarketRegime;
  readonly confidence: number;
  readonly analysisInterval: string;
  readonly managementAction: import("./trade-monitor-types.js").TradeManagementAction;
  readonly consecutiveDegradingTicks: number;
  readonly outcomeClassification: TradeOutcomeClassification;
  readonly failureReason: TradeFailureReason;
  readonly notes?: string;
  readonly executionRating?: number;
}

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
    readonly lastOpen?: number;
    readonly lastHigh?: number;
    readonly lastLow?: number;
    readonly lastClose?: number;
    readonly previousClose?: number;
    readonly lastClosePositionInRange?: number;
    readonly upperWickPct?: number;
    readonly lowerWickPct?: number;
    readonly sweptPrevHigh?: boolean;
    readonly sweptPrevLow?: boolean;
    readonly closedBackInsidePrevRange?: boolean;
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
  readonly sessionLevels?: {
    readonly currentOpen: number;
    readonly currentHigh: number;
    readonly currentLow: number;
    readonly priorHigh?: number;
    readonly priorLow?: number;
  };
  readonly dailyLevels?: {
    readonly currentOpen: number;
    readonly currentHigh: number;
    readonly currentLow: number;
    readonly priorHigh?: number;
    readonly priorLow?: number;
  };
  readonly medianAtrPct?: number;
  readonly swingHigh?: number;
  readonly swingLow?: number;
  readonly nearestSupportLevel?: number;
  readonly nearestResistanceLevel?: number;
  readonly marketStructure?: MarketStructure;
  readonly liquidityMap?: LiquidityMap;
  readonly liquidationClusters?: LiquidationClusterMap;
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

export interface TradeabilityAssessment {
  readonly status: TradeabilityStatus;
  readonly session: TradingSession;
  readonly marketRegime: MarketRegime;
  readonly reasonCodes: readonly TradeabilityReasonCode[];
  readonly rationale: readonly string[];
  readonly blocked: boolean;
}

export interface EntryReadinessAssessment {
  readonly status: EntryReadinessStatus;
  readonly rationale: readonly string[];
  readonly preferredEntryPrice?: number;
  readonly invalidationLevel?: number;
}

export interface SequenceAssessment {
  readonly status: SequenceStatus;
  readonly pattern: SequencePattern;
  readonly rationale: readonly string[];
}

export interface LevelInteractionAssessment {
  readonly status: LevelInteractionStatus;
  readonly reference: LevelInteractionReference;
  readonly rationale: readonly string[];
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
  readonly marketTradeability?: TradeabilityStatus;
  readonly marketTradeabilityReasons?: readonly TradeabilityReasonCode[];
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
  readonly signalStrength?: number;
  readonly calibratedWinRate?: number;
  readonly setupGrade: SetupGrade;
  readonly confidenceBreakdown: ConfidenceBreakdown;
  readonly rationale: readonly string[];
  readonly indicators: IndicatorSnapshot;
  readonly perp: PerpMarketSnapshot;
  readonly pullbackEntry?: boolean;
  readonly feeBurdenPct?: number;
  readonly slippageEstimatePct?: number;
  readonly totalExecutionCostPct?: number;
  readonly riskBasedPositionSizeUsd?: number;
  readonly riskBudgetUsd?: number;
  readonly setupDetected?: boolean;
  readonly setupType?: string;
  readonly setupPlaybook?: SetupPlaybook;
  readonly playbookRegimeAligned?: boolean;
  readonly playbookMinRiskReward?: number;
  readonly holdingPeriodCandles?: number;
  readonly holdingPeriodMinutes?: number;
  readonly entryValidityWindow?: string;
  readonly entryReadiness?: EntryReadinessStatus;
  readonly entryReadinessReasons?: readonly string[];
  readonly preferredEntryPrice?: number;
  readonly sequenceStatus?: SequenceStatus;
  readonly sequencePattern?: SequencePattern;
  readonly sequenceReasons?: readonly string[];
  readonly levelInteractionStatus?: LevelInteractionStatus;
  readonly levelInteractionReference?: LevelInteractionReference;
  readonly levelInteractionReasons?: readonly string[];
  /** Time-based exit: close at breakeven if TP not hit within this many candles */
  readonly timeBasedExitCandles?: number;
  readonly timeBasedExitMinutes?: number;
  /** Number of independent signal channels (out of 4) agreeing with direction */
  readonly independentChannelAgreement?: number;
  /** True if BTC correlation hard-blocked this alt signal */
  readonly btcCorrelationBlocked?: boolean;
  /** Paper-trading confidence — only populated when learning system has sufficient calibration data */
  readonly paperTradingConfidence?: number;
  // Plan 1: Market Structure
  readonly structureState?: StructureState;
  readonly structureBreak?: StructureBreakType;
  readonly structureBreakDirection?: "BULLISH" | "BEARISH";
  // Plan 2: Liquidity Mapping
  readonly nearestFvgAbove?: { top: number; bottom: number };
  readonly nearestFvgBelow?: { top: number; bottom: number };
  readonly nearestOrderBlock?: { type: "BULLISH" | "BEARISH"; top: number; bottom: number };
  readonly nearestEqualLevel?: { type: "EQH" | "EQL"; price: number; count: number };
  // Plan 3: Session Context
  readonly sessionContext?: SessionContext;
  // Plan 4: Liquidation
  readonly liquidation?: LiquidationMetrics;
  // Plan 5: Funding
  readonly fundingAnalysis?: FundingAnalysis;
  // Plan 6: Estimated Liquidation Clusters
  readonly liquidationClusters?: LiquidationClusterMap;
  // Plan 8: MTF
  readonly mtfContext?: MtfContext;
  // Plan 9: Journal insight
  readonly journalInsight?: {
    readonly similarTradeCount: number;
    readonly winRate: number;
    readonly avgPnlPct: number;
    readonly mostCommonFailure?: TradeFailureReason;
  };
  /** Volume profile anchor that constrained the take profit level */
  readonly tpAnchor?: "VPOC" | "VAH" | "VAL";
  /** OI-price quadrant classification for the current candle */
  readonly oiContext?: "NEW_LONGS" | "NEW_SHORTS" | "SHORT_COVERING" | "LONG_LIQUIDATION";
  /** CVD divergence direction when price/flow mismatch is detected */
  readonly cvdDivergence?: "BULLISH" | "BEARISH";
  /** Learning system context attached after policy application */
  readonly learningContext?: {
    readonly active: boolean;
    readonly sampleSize: number;
    readonly winRate?: number;
    readonly confidenceDelta: number;
    readonly dominantFailureType?: string;
  };
}
