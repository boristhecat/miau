import type { AiAdvice } from "../../ports/ai-advisor-port.js";

export function parseAiResponse(raw: string): Omit<AiAdvice, "model" | "latencyMs"> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("AI response was not valid JSON.");
  }

  if (!value || typeof value !== "object") {
    throw new Error("AI response object is invalid.");
  }
  const candidate = value as Record<string, unknown>;

  const bias = String(candidate.bias ?? "").toUpperCase();
  if (bias !== "LONG" && bias !== "SHORT" && bias !== "NO_TRADE") {
    throw new Error("AI response bias is invalid.");
  }

  const confidenceBand = String(candidate.confidenceBand ?? "").toUpperCase();
  if (confidenceBand !== "LOW" && confidenceBand !== "MEDIUM" && confidenceBand !== "HIGH") {
    throw new Error("AI response confidence band is invalid.");
  }

  const agreement = String(candidate.agreement ?? "").toUpperCase();
  if (agreement !== "AGREE" && agreement !== "DISAGREE" && agreement !== "PARTIAL") {
    throw new Error("AI response agreement is invalid.");
  }

  const regime = String(candidate.regime ?? "").toUpperCase();
  if (regime !== "TREND" && regime !== "RANGE" && regime !== "CHOPPY" && regime !== "VOLATILE") {
    throw new Error("AI response regime is invalid.");
  }

  const overruledSignals = (Array.isArray(candidate.overruledSignals) ? candidate.overruledSignals : [])
    .map((item) => String(item ?? "").trim())
    .filter((item) => item.length > 0)
    .slice(0, 4);

  const reasons = (Array.isArray(candidate.reasons) ? candidate.reasons : [])
    .map((item) => String(item ?? "").trim())
    .filter((item) => item.length > 0)
    .slice(0, 4);

  if (reasons.length === 0) {
    throw new Error("AI response reasons are missing.");
  }

  const altThesisRaw = candidate.altThesis;
  const altThesis =
    altThesisRaw !== null && altThesisRaw !== undefined && String(altThesisRaw).trim().length > 0
      ? String(altThesisRaw).trim()
      : undefined;

  const invalidation = String(candidate.invalidation ?? "").trim();
  const riskNote = String(candidate.riskNote ?? "").trim();
  if (!invalidation || !riskNote) {
    throw new Error("AI response invalidation/risk note missing.");
  }

  return {
    bias,
    confidenceBand,
    suggestedEntry: toOptionalFiniteNumber(candidate.suggestedEntry),
    suggestedStopLoss: toOptionalFiniteNumber(candidate.suggestedStopLoss),
    suggestedTakeProfit: toOptionalFiniteNumber(candidate.suggestedTakeProfit),
    agreement,
    regime,
    overruledSignals,
    reasons,
    altThesis,
    invalidation,
    riskNote
  };
}

function toOptionalFiniteNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}
