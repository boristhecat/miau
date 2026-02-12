import { describe, expect, it } from "vitest";
import { parseTradingInput } from "../src/application/parse-trading-input.js";

describe("parseTradingInput", () => {
  it("parses symbol only", () => {
    expect(parseTradingInput("btc")).toEqual({
      symbol: "BTC",
      fullInteractive: false,
      runSimulation: false,
      showDetails: false
    });
  });

  it("parses full interactive mode flag", () => {
    expect(parseTradingInput("eth -i")).toEqual({
      symbol: "ETH",
      fullInteractive: true,
      runSimulation: false,
      showDetails: false
    });
    expect(parseTradingInput("sol --interactive")).toEqual({
      symbol: "SOL",
      fullInteractive: true,
      runSimulation: false,
      showDetails: false
    });
  });

  it("rejects missing symbol", () => {
    expect(() => parseTradingInput(" ")).toThrowError("Symbol is required");
  });

  it("rejects extra tokens/flags", () => {
    expect(() => parseTradingInput("BTC -l 5")).toThrowError("Enter SYMBOL or SYMBOL -i");
    expect(() => parseTradingInput("ETH --tf 1m")).toThrowError("Enter SYMBOL or SYMBOL -i");
  });
});
