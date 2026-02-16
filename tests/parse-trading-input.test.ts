import { describe, expect, it } from "vitest";
import { parseTradingInput } from "../src/application/parse-trading-input.js";

describe("parseTradingInput", () => {
  it("parses symbol only", () => {
    expect(parseTradingInput("btc")).toEqual({
      symbol: "BTC",
      fullInteractive: false,
      customValues: false,
      manualLevels: false,
      runSimulation: false,
      objectiveHorizon: undefined,
      showDetails: false
    });
  });

  it("parses full interactive mode flag", () => {
    expect(parseTradingInput("eth -i")).toEqual({
      symbol: "ETH",
      fullInteractive: true,
      customValues: false,
      manualLevels: false,
      runSimulation: false,
      objectiveHorizon: undefined,
      showDetails: false
    });
    expect(parseTradingInput("sol --interactive")).toEqual({
      symbol: "SOL",
      fullInteractive: true,
      customValues: false,
      manualLevels: false,
      runSimulation: false,
      objectiveHorizon: undefined,
      showDetails: false
    });
  });

  it("parses horizon-only flag", () => {
    expect(parseTradingInput("eth --horizon 75")).toEqual({
      symbol: "ETH",
      fullInteractive: false,
      customValues: false,
      manualLevels: false,
      runSimulation: false,
      objectiveHorizon: "75",
      showDetails: false
    });
  });

  it("parses manual levels flag", () => {
    expect(parseTradingInput("btc --manual-levels")).toEqual({
      symbol: "BTC",
      fullInteractive: false,
      customValues: false,
      manualLevels: true,
      runSimulation: false,
      objectiveHorizon: undefined,
      showDetails: false
    });
  });

  it("parses simulation flag", () => {
    expect(parseTradingInput("btc --simulate")).toEqual({
      symbol: "BTC",
      fullInteractive: false,
      customValues: false,
      manualLevels: false,
      runSimulation: true,
      objectiveHorizon: undefined,
      showDetails: false
    });
  });

  it("rejects missing symbol", () => {
    expect(() => parseTradingInput(" ")).toThrowError("Symbol is required");
  });

  it("rejects unsupported flags", () => {
    expect(() => parseTradingInput("BTC -l 5")).toThrowError("Only -i/--interactive, --custom");
    expect(() => parseTradingInput("ETH --tf 1m")).toThrowError("Only -i/--interactive, --custom");
    expect(() => parseTradingInput("BTC --objective 10")).toThrowError("Only -i/--interactive, --custom");
  });

  it("rejects invalid or conflicting targeting flags", () => {
    expect(() => parseTradingInput("BTC --horizon 90m")).toThrowError("Invalid --horizon value");
    expect(() => parseTradingInput("BTC --manual-levels --horizon 15")).toThrowError("Manual levels mode cannot be combined");
  });

  it("parses --custom flag", () => {
    expect(parseTradingInput("btc --custom")).toEqual({
      symbol: "BTC",
      fullInteractive: false,
      customValues: true,
      manualLevels: false,
      runSimulation: false,
      objectiveHorizon: undefined,
      showDetails: false
    });
  });
});
