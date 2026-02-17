import { parseTradingSymbol } from "./parse-trading-symbol.js";

export interface TradingInput {
  symbol: string;
  requestedDirection?: "LONG" | "SHORT";
  expectedRangeHorizon?: string;
  customValues: boolean;
  runSimulation: boolean;
  objectiveHorizon?: string;
  timeframe?: string;
  biasTimeframe?: string;
  leverage?: number;
  positionSizeUsd?: number;
  slPct?: number;
  tpPct?: number;
  slUsd?: number;
  tpUsd?: number;
  showDetails: boolean;
}

export function parseTradingInput(raw: string): TradingInput {
  const parts = raw.trim().split(/\s+/).filter((part) => part.length > 0);
  if (parts.length === 0) {
    throw new Error("Symbol is required.");
  }
  const symbol = parseTradingSymbol(parts[0] ?? "");
  let customValues = false;
  let runSimulation = false;
  let objectiveHorizon: string | undefined;
  let expectedRangeHorizon: string | undefined;
  let requestedDirection: "LONG" | "SHORT" | undefined;

  for (let i = 1; i < parts.length; i += 1) {
    const token = parts[i];
    const normalizedToken = token?.toLowerCase();
    if (normalizedToken === "long" || normalizedToken === "short") {
      const parsedDirection = normalizedToken.toUpperCase() as "LONG" | "SHORT";
      if (requestedDirection && requestedDirection !== parsedDirection) {
        throw new Error("Direction can only be set once: use either 'long' or 'short'.");
      }
      requestedDirection = parsedDirection;
      continue;
    }
    if (token === "--custom") {
      customValues = true;
      continue;
    }
    if (token === "--simulate") {
      runSimulation = true;
      continue;
    }

    if (token === "--horizon") {
      const rawValue = parts[i + 1];
      if (!rawValue) {
        throw new Error("Missing value for --horizon.");
      }
      if (!/^\d+$/i.test(rawValue)) {
        throw new Error("Invalid --horizon value. Use minutes as a positive integer (e.g. 15, 75, 90).");
      }
      objectiveHorizon = rawValue;
      i += 1;
      continue;
    }
    if (token === "--expected") {
      const rawValue = parts[i + 1];
      if (!rawValue) {
        throw new Error("Missing value for --expected.");
      }
      if (!/^\d+$/i.test(rawValue)) {
        throw new Error("Invalid --expected value. Use minutes as a positive integer (e.g. 60, 120, 240).");
      }
      expectedRangeHorizon = rawValue;
      i += 1;
      continue;
    }

    throw new Error(
      "Only [long|short], --custom, --simulate, --horizon <minutes>, and --expected <minutes> are supported after symbol."
    );
  }

  return {
    symbol,
    ...(requestedDirection ? { requestedDirection } : {}),
    ...(expectedRangeHorizon ? { expectedRangeHorizon } : {}),
    customValues,
    runSimulation,
    objectiveHorizon,
    showDetails: false
  };
}
