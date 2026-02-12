import { parseTradingSymbol } from "./parse-trading-symbol.js";

export interface TradingInput {
  symbol: string;
  fullInteractive: boolean;
  manualLevels: boolean;
  runSimulation: boolean;
  objectiveUsdc?: number;
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
  let fullInteractive = false;
  let manualLevels = false;
  let runSimulation = false;
  let objectiveUsdc: number | undefined;
  let objectiveHorizon: string | undefined;

  for (let i = 1; i < parts.length; i += 1) {
    const token = parts[i];
    if (token === "-i" || token === "--interactive") {
      fullInteractive = true;
      continue;
    }

    if (token === "--manual-levels") {
      manualLevels = true;
      continue;
    }
    if (token === "--simulate") {
      runSimulation = true;
      continue;
    }

    if (token === "--objective") {
      const rawValue = parts[i + 1];
      if (!rawValue) {
        throw new Error("Missing value for --objective.");
      }
      const parsed = Number(rawValue);
      if (Number.isNaN(parsed) || parsed <= 0) {
        throw new Error("Invalid --objective value. Use a positive number.");
      }
      objectiveUsdc = parsed;
      i += 1;
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

    throw new Error(
      "Only -i/--interactive, --manual-levels, --simulate, --objective <USDC>, and --horizon <minutes> are supported after symbol."
    );
  }

  if (manualLevels && (objectiveUsdc !== undefined || objectiveHorizon !== undefined)) {
    throw new Error("Manual levels mode cannot be combined with --objective/--horizon.");
  }
  if (objectiveUsdc !== undefined && objectiveHorizon !== undefined) {
    throw new Error("Provide either --objective or --horizon, not both.");
  }

  return {
    symbol,
    fullInteractive,
    manualLevels,
    runSimulation,
    objectiveUsdc,
    objectiveHorizon,
    showDetails: false
  };
}
