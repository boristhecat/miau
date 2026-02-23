import { parseTradingInput, type TradingInput } from "./trading-input-parser.js";

export interface WatchConfig {
  symbol: string;
  everyMinutes: number;
  input: TradingInput;
}

export function parseWatchCommand(raw: string): WatchConfig {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2 || parts[0]?.toLowerCase() !== "watch") {
    throw new Error("Invalid watch command. Use: watch <SYMBOL> [--every <minutes>] [--horizon <minutes>]");
  }
  let everyMinutes = 0.5;
  const queryTokens: string[] = [];
  for (let i = 1; i < parts.length; i += 1) {
    const token = parts[i]!;
    if (token === "--every") {
      const value = parts[i + 1];
      if (!value || !/^\d+(\.\d+)?$/.test(value)) {
        throw new Error("Invalid --every value. Use minutes as a positive number (decimals allowed, e.g. 0.5).");
      }
      everyMinutes = Number(value);
      if (everyMinutes <= 0) {
        throw new Error("Invalid --every value. Must be greater than 0.");
      }
      i += 1;
      continue;
    }
    queryTokens.push(token);
  }

  const base = parseTradingInput(queryTokens.join(" "));
  const unsupportedOptions: string[] = [];
  if (base.customValues) {
    unsupportedOptions.push("--custom");
  }
  if (base.runSimulation) {
    unsupportedOptions.push("--simulate");
  }
  if (base.expectedRangeHorizon !== undefined) {
    unsupportedOptions.push("--expected");
  }
  if (unsupportedOptions.length > 0) {
    throw new Error(
      `Unsupported watch option(s): ${unsupportedOptions.join(", ")}. ` +
        "Use: watch <SYMBOL> [--every <minutes>] [--horizon <minutes>] [long|short] [minutes]"
    );
  }

  return {
    symbol: base.symbol,
    everyMinutes,
    input: {
      symbol: base.symbol,
      customValues: false,
      runSimulation: false,
      objectiveHorizon: base.objectiveHorizon ?? "15",
      requestedDirection: base.requestedDirection,
      timeframe: "1m",
      biasTimeframe: "15m",
      leverage: 20,
      positionSizeUsd: 250,
      slPct: undefined,
      tpPct: undefined,
      slUsd: undefined,
      tpUsd: undefined,
      showDetails: false
    }
  };
}
