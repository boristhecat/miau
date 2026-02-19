export interface AiAdvice {
  bias: "LONG" | "SHORT" | "NO_TRADE";
  confidenceBand: "LOW" | "MEDIUM" | "HIGH";
  suggestedEntry?: number;
  suggestedStopLoss?: number;
  suggestedTakeProfit?: number;
  agreement: "AGREE" | "DISAGREE" | "PARTIAL";
  regime: "TREND" | "RANGE" | "CHOPPY" | "VOLATILE";
  overruledSignals: string[];
  reasons: string[];
  invalidation: string;
  riskNote: string;
  model?: string;
  latencyMs?: number;
}

export interface AiAdviceRequest {
  pair: string;
  signal: "LONG" | "SHORT" | "NO_TRADE";
  modelSignal?: "LONG" | "SHORT";
  requestedDirection?: "LONG" | "SHORT";
  confidence: number;
  setupGrade: "A" | "B" | "C" | "D";
  setupQuality: number;
  marketRegime: "TREND" | "RANGE" | "VOLATILE_SPIKE" | "LOW_LIQ_CHOP";
  riskRewardRatio: number;
  analysisInterval?: string;
  analysisBiasInterval?: string;
  objectiveHorizon?: string;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  expectedLow?: number;
  expectedHigh?: number;
  indicators: {
    rsi14: number;
    ema20: number;
    ema50: number;
    macdHistogram: number;
    atr14: number;
    adx14: number;
    vwap: number;
  };
  perp: {
    fundingRate: number;
    premiumPct: number;
    openInterest: number;
  };
  keyRationale: string[];
}

export interface AiAdvisorPort {
  advise(input: AiAdviceRequest): Promise<AiAdvice>;
}
