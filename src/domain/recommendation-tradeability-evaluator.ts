import {
  assessVwapChop,
  classifyMarketRegime,
  detectTradingSession
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
}

export class RecommendationTradeabilityEvaluator {
  evaluate(input: EvaluateTradeabilityInput): TradeabilityAssessment {
    const marketRegime = classifyMarketRegime(input.indicators, input.lastPrice).marketRegime;
    const session = detectTradingSession();
    const reasonCodes: TradeabilityReasonCode[] = [];
    const rationale: string[] = [];

    if (marketRegime === "LOW_LIQ_CHOP") {
      reasonCodes.push("LOW_LIQUIDITY_CHOP");
      rationale.push("low-liquidity chop regime.");
    }

    if (input.perp.bidAskSpreadPct !== undefined && input.perp.bidAskSpreadPct > 0.12) {
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
