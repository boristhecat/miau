import {
  assessVwapChop,
  classifyMarketRegime,
  detectTradingSession,
  isSessionTransition
} from "./recommendation-market-context.js";
import type {
  IndicatorSnapshot,
  PerpMarketSnapshot,
  TradeabilityAssessment,
  TradeabilityReasonCode
} from "./types.js";

interface EvaluateTradeabilityInput {
  indicators: IndicatorSnapshot;
  perp: PerpMarketSnapshot;
  lastPrice: number;
  spreadBlockThreshold?: number;
  /** When true (default), blocks RANGE and VOLATILE_SPIKE regimes to focus on trend-following only */
  trendOnlyMode?: boolean;
}

export class RecommendationTradeabilityEvaluator {
  evaluate(input: EvaluateTradeabilityInput): TradeabilityAssessment {
    const marketRegime = classifyMarketRegime(input.indicators, input.lastPrice).marketRegime;
    const session = detectTradingSession();
    const reasonCodes: TradeabilityReasonCode[] = [];
    const rationale: string[] = [];

    const trendOnlyMode = input.trendOnlyMode ?? true;

    if (marketRegime === "LOW_LIQ_CHOP") {
      reasonCodes.push("LOW_LIQUIDITY_CHOP");
      rationale.push("low-liquidity chop regime.");
    }

    if (trendOnlyMode && marketRegime === "RANGE") {
      reasonCodes.push("RANGE_REGIME");
      rationale.push("RANGE regime blocked in trend-only mode.");
    }

    if (trendOnlyMode && marketRegime === "VOLATILE_SPIKE") {
      reasonCodes.push("VOLATILE_SPIKE_REGIME");
      rationale.push("VOLATILE_SPIKE regime blocked in trend-only mode.");
    }

    const spreadThreshold = input.spreadBlockThreshold ?? 0.12;
    if (input.perp.bidAskSpreadPct !== undefined && input.perp.bidAskSpreadPct > spreadThreshold) {
      reasonCodes.push("WIDE_SPREAD");
      rationale.push("orderbook spread is too wide for clean execution.");
    }

    const vwapChop = assessVwapChop(input.indicators, input.lastPrice);
    if (vwapChop.nearVwapChop) {
      reasonCodes.push("VWAP_CHOP");
      rationale.push("price is too close to VWAP; intraday direction is not clean.");
    }

    if (reasonCodes.length > 0) {
      return {
        status: "DO_NOT_TRADE",
        session,
        marketRegime,
        reasonCodes,
        rationale,
        blocked: true
      };
    }

    if (isSessionTransition()) {
      return {
        status: "CAUTION",
        session,
        marketRegime,
        reasonCodes: ["SESSION_TRANSITION"],
        rationale: ["session transition zone (within 15min of boundary); whipsaw risk elevated."],
        blocked: false
      };
    }

    if (session === "DEAD") {
      return {
        status: "CAUTION",
        session,
        marketRegime,
        reasonCodes: ["SESSION_DEAD_ZONE"],
        rationale: ["dead zone session; treat fresh entries cautiously."],
        blocked: false
      };
    }

    return {
      status: "TRADEABLE",
      session,
      marketRegime,
      reasonCodes: [],
      rationale: [],
      blocked: false
    };
  }
}
