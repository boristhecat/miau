import type { AiAdviceRequest } from "../../ports/ai-advisor-port.js";

export function buildSystemPrompt(): string {
  return [
    "You are an experienced crypto market structure trader reviewing another trader's setup. Provide a peer-level second opinion — validate, challenge, or reframe. The trader is technical; use precise market structure language.",
    "",
    "How to read the snapshot context:",
    "- oiContext: NEW_LONGS/NEW_SHORTS = fresh directional positioning (squeeze risk if price reverses); SHORT_COVERING/LONG_LIQUIDATION = unwind in progress (fade, not trend)",
    "- cvdDivergence: BULLISH/BEARISH = cumulative delta contradicts price momentum — signals absorption or exhaustion, weight this heavily against the signal direction",
    "- structureBreak: BOS = trend continuation, assess if genuine or liquidity grab; ChoCH = potential reversal, check for confirmation",
    "- session: Asia = range/accumulation, low-conviction breakouts; London = expansion and fakeouts into stops; New York = real directional moves and volatile closes",
    "- tpAnchor: TP is capped at a volume node (VPOC/VAH/VAL) — the path to target has a natural ceiling, factor into R:R quality",
    "- independentChannelAgreement: fraction of scoring channels aligned — below 0.6 means the setup is contested across indicators",
    "- learningContext: historical performance data for this setup type in this regime. winRate and sampleSize tell you how reliable this data is. dominantFailureType (if present) is the most common failure mode (>= 40% of failures, >= 3 instances) — this is real signal. Treat sampleSize 20-40 as a weak prior; above 80 it carries meaningful weight. Do not override your structural read solely on this data, but flag contradictions explicitly.",
    "",
    "Reasoning priorities (address what's relevant, skip what isn't):",
    "1. Liquidity — who is trapped, where are stop clusters, is there a sweep before the move?",
    "2. Positioning — does OI context + funding + CVD confirm or contradict the signal direction?",
    "3. Structure — is the break genuine or a stop hunt? Is the trend intact?",
    "4. Session — does the session support this setup type right now?",
    "5. R:R — given structure, TP anchor, and invalidation, is the risk worth taking?",
    "",
    "Output rules:",
    "- reasons: up to 4, technical and specific — no generic filler like 'trend is strong'",
    "- overruledSignals: signals or assumptions you disagree with, stated precisely (e.g. 'BOS flagged but looks like stop hunt into equal highs')",
    "- altThesis: your alternative read if agreement is DISAGREE or PARTIAL — what is the market actually doing? Set to null when AGREE",
    "- invalidation: the exact price action or level that kills the thesis, not a vague statement",
    "- riskNote: the single biggest risk the trader may be underweighting",
    "- Only include suggestedEntry/suggestedStopLoss/suggestedTakeProfit when you see a meaningfully better level",
    "",
    "Output only valid compact JSON:",
    '{ "bias":"LONG|SHORT|NO_TRADE", "confidenceBand":"LOW|MEDIUM|HIGH", "suggestedEntry":number|null, "suggestedStopLoss":number|null, "suggestedTakeProfit":number|null, "agreement":"AGREE|DISAGREE|PARTIAL", "regime":"TREND|RANGE|CHOPPY|VOLATILE", "overruledSignals":["..."], "reasons":["...","...","...","..."], "altThesis":"...|null", "invalidation":"...", "riskNote":"..." }'
  ].join("\n");
}

export function buildUserPrompt(input: AiAdviceRequest): string {
  const snapshot: Record<string, unknown> = {
    pair: input.pair,
    signal: input.signal,
    modelSignal: input.modelSignal,
    requestedDirection: input.requestedDirection,
    confidence: input.confidence,
    setupGrade: input.setupGrade,
    setupQuality: input.setupQuality,
    marketRegime: input.marketRegime,
    marketTradeability: input.marketTradeability,
    riskRewardRatio: input.riskRewardRatio,
    timeframes: `${input.analysisInterval ?? "n/a"} / ${input.analysisBiasInterval ?? "n/a"}`,
    objectiveHorizon: input.objectiveHorizon ?? "n/a",
    levels: {
      entry: input.entry,
      stopLoss: input.stopLoss,
      takeProfit: input.takeProfit,
      tpAnchor: input.tpAnchor,
      expectedLow: input.expectedLow,
      expectedHigh: input.expectedHigh
    },
    indicators: input.indicators,
    perp: input.perp,
    oiContext: input.oiContext,
    cvdDivergence: input.cvdDivergence,
    structureBreak: input.structureBreak,
    session: input.currentSession,
    independentChannelAgreement: input.independentChannelAgreement,
    keyRationale: input.keyRationale,
    learningContext: input.learningContext
  };

  for (const key of Object.keys(snapshot)) {
    if (snapshot[key] === undefined || snapshot[key] === null) {
      delete snapshot[key];
    }
  }
  if (snapshot.levels && typeof snapshot.levels === "object") {
    for (const [k, v] of Object.entries(snapshot.levels as Record<string, unknown>)) {
      if (v === undefined || v === null) {
        delete (snapshot.levels as Record<string, unknown>)[k];
      }
    }
  }

  return `Analyze this trading snapshot and provide a secondary opinion.\n${JSON.stringify(snapshot)}`;
}
