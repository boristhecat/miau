import { parseTradingSymbol } from "./parse-trading-symbol.js";

export interface TradingInput {
  symbol: string;
  fullInteractive: boolean;
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
  if (parts.length > 2) {
    throw new Error("Enter SYMBOL or SYMBOL -i. Parameter prompts are handled interactively.");
  }

  const symbol = parseTradingSymbol(parts[0] ?? "");
  const modeToken = parts[1];
  if (modeToken !== undefined && modeToken !== "-i" && modeToken !== "--interactive") {
    throw new Error("Only -i/--interactive is supported after symbol. Other parameters are prompted interactively.");
  }

  return {
    symbol,
    fullInteractive: modeToken !== undefined,
    showDetails: false
  };
}
