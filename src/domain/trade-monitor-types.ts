import type {
  EntryReadinessStatus,
  FibLevels,
  FundingAnalysis,
  LevelInteractionReference,
  LevelInteractionStatus,
  LiquidationClusterMap,
  LiquidationMetrics,
  MarketRegime,
  MtfContext,
  Recommendation,
  SequencePattern,
  SequenceStatus,
  SessionContext,
  SetupGrade,
  SetupPlaybook,
  StructureBreakType,
  StructureState,
  TradeabilityStatus
} from "./types.js";

export type OiContext = "NEW_LONGS" | "NEW_SHORTS" | "SHORT_COVERING" | "LONG_LIQUIDATION";
export type CvdDivergence = "BULLISH" | "BEARISH";

export type TradeHealthStatus = "INTACT" | "DEGRADING" | "BROKEN" | "COMPLETED";

export type TradeManagementAction =
  | "HOLD"
  | "AT_RISK"
  | "MOVE_TO_BREAKEVEN"
  | "TAKE_PARTIAL"
  | "EXIT_EARLY"
  | "STOP_HIT"
  | "TARGET_HIT";

export interface OpenTrade {
  readonly pair: string;
  readonly side: "LONG" | "SHORT";
  readonly entry: number;
  readonly stopLoss?: number;
  readonly takeProfit?: number;
  readonly leverage?: number;
  readonly positionSizeUsd?: number;
  readonly openedAtMs: number;
  readonly objectiveHorizon?: string;
  readonly analysisInterval: string;
  readonly analysisBiasInterval: string;
}

export interface TradeMonitorBaseline {
  readonly trade: OpenTrade;
  readonly baselineRecommendation: Recommendation;
  readonly baselineAtr: number;
  readonly baselinePlaybook?: SetupPlaybook;
  readonly baselineMarketRegime: MarketRegime;
  readonly baselineSequenceStatus?: SequenceStatus;
  readonly baselineLevelInteractionStatus?: LevelInteractionStatus;
  readonly baselineEntryReadiness?: EntryReadinessStatus;
  readonly baselineExecutionCostPct?: number;
  readonly baselineHoldingPeriodMinutes?: number;
  readonly baselineBuiltAtMs: number;
}

export interface TradeMonitorMetrics {
  readonly markPrice: number;
  readonly estimatedExitPrice: number;
  readonly grossUnrealizedPnlPct: number;
  readonly grossUnrealizedPnlUsd?: number;
  readonly netUnrealizedPnlPct: number;
  readonly netUnrealizedPnlUsd?: number;
  readonly currentR: number;
  readonly distanceToStopPrice: number;
  readonly distanceToTargetPrice: number;
  readonly distanceToStopPct: number;
  readonly distanceToTargetPct: number;
  readonly distanceToStopAtr?: number;
  readonly distanceToTargetAtr?: number;
  readonly maxFavorableExcursionPct: number;
  readonly maxAdverseExcursionPct: number;
  readonly maxFavorableExcursionUsd?: number;
  readonly maxAdverseExcursionUsd?: number;
  readonly timeInTradeSeconds: number;
  readonly holdingProgressPct?: number;
  readonly stopHit: boolean;
  readonly targetHit: boolean;
  readonly bidAskSpreadPct?: number;
  readonly premiumPct: number;
  readonly slippageEstimatePct?: number;
  readonly totalExecutionCostPct?: number;
}

export interface TradeHealthAssessment {
  readonly status: TradeHealthStatus;
  readonly rationale: readonly string[];
}

export interface TradeManagementAssessment {
  readonly action: TradeManagementAction;
  readonly rationale: readonly string[];
}

export interface TradeMonitorSnapshot {
  readonly trade: OpenTrade;
  readonly metrics: TradeMonitorMetrics;
  readonly analysisSignal: Recommendation["signal"];
  readonly analysisConfidence: number;
  readonly analysisSetupGrade: SetupGrade;
  readonly marketRegime: MarketRegime;
  readonly marketTradeability?: TradeabilityStatus;
  readonly setupPlaybook?: SetupPlaybook;
  readonly playbookRegimeAligned?: boolean;
  readonly entryReadiness?: EntryReadinessStatus;
  readonly sequenceStatus?: SequenceStatus;
  readonly sequencePattern?: SequencePattern;
  readonly levelInteractionStatus?: LevelInteractionStatus;
  readonly levelInteractionReference?: LevelInteractionReference;
  readonly analysisAtr?: number;
  readonly structureState?: StructureState;
  readonly structureBreak?: StructureBreakType;
  readonly structureBreakDirection?: "BULLISH" | "BEARISH";
  readonly sessionContext?: SessionContext;
  readonly liquidation?: LiquidationMetrics;
  readonly fundingAnalysis?: FundingAnalysis;
  readonly liquidationClusters?: LiquidationClusterMap;
  readonly mtfContext?: MtfContext;
  readonly fibLevels?: FibLevels;
  readonly oiContext?: OiContext;
  readonly cvdDivergence?: CvdDivergence;
  readonly analysisRationale?: readonly string[];
  readonly healthStatus: TradeHealthStatus;
  readonly managementAction: TradeManagementAction;
  readonly healthReasons: readonly string[];
  readonly managementReasons: readonly string[];
  readonly analysisUpdatedAtMs: number;
  /** Number of consecutive ticks where health was DEGRADING. */
  readonly consecutiveDegradingTicks: number;
}
