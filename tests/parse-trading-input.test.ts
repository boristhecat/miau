import { describe, expect, it } from "vitest";
import { parseTradingInput } from "../src/application/parse-trading-input.js";

describe("parseTradingInput", () => {
  it("parses symbol only", () => {
    expect(parseTradingInput("btc")).toEqual({
      symbol: "BTC",
      fullInteractive: false,
      manualLevels: false,
      runSimulation: false,
      objectiveUsdc: undefined,
      objectiveHorizon: undefined,
      showDetails: false
    });
  });

  it("parses full interactive mode flag", () => {
    expect(parseTradingInput("eth -i")).toEqual({
      symbol: "ETH",
      fullInteractive: true,
      manualLevels: false,
      runSimulation: false,
      objectiveUsdc: undefined,
      objectiveHorizon: undefined,
      showDetails: false
    });
    expect(parseTradingInput("sol --interactive")).toEqual({
      symbol: "SOL",
      fullInteractive: true,
      manualLevels: false,
      runSimulation: false,
      objectiveUsdc: undefined,
      objectiveHorizon: undefined,
      showDetails: false
    });
  });

  it("parses objective-only or horizon-only flags", () => {
    expect(parseTradingInput("btc --objective 10")).toEqual({
      symbol: "BTC",
      fullInteractive: false,
      manualLevels: false,
      runSimulation: false,
      objectiveUsdc: 10,
      objectiveHorizon: undefined,
      showDetails: false
    });
    expect(parseTradingInput("eth --horizon 75")).toEqual({
      symbol: "ETH",
      fullInteractive: false,
      manualLevels: false,
      runSimulation: false,
      objectiveUsdc: undefined,
      objectiveHorizon: "75",
      showDetails: false
    });
  });

  it("parses manual levels flag", () => {
    expect(parseTradingInput("btc --manual-levels")).toEqual({
      symbol: "BTC",
      fullInteractive: false,
      manualLevels: true,
      runSimulation: false,
      objectiveUsdc: undefined,
      objectiveHorizon: undefined,
      showDetails: false
    });
  });

  it("parses simulation flag", () => {
    expect(parseTradingInput("btc --simulate")).toEqual({
      symbol: "BTC",
      fullInteractive: false,
      manualLevels: false,
      runSimulation: true,
      objectiveUsdc: undefined,
      objectiveHorizon: undefined,
      showDetails: false
    });
  });

  it("rejects missing symbol", () => {
    expect(() => parseTradingInput(" ")).toThrowError("Symbol is required");
  });

  it("rejects unsupported flags", () => {
    expect(() => parseTradingInput("BTC -l 5")).toThrowError("Only -i/--interactive, --manual-levels, --simulate");
    expect(() => parseTradingInput("ETH --tf 1m")).toThrowError("Only -i/--interactive, --manual-levels, --simulate");
  });

  it("rejects invalid or conflicting targeting flags", () => {
    expect(() => parseTradingInput("BTC --objective -1")).toThrowError("Invalid --objective value");
    expect(() => parseTradingInput("BTC --horizon 90m")).toThrowError("Invalid --horizon value");
    expect(() => parseTradingInput("BTC --objective 10 --horizon 15")).toThrowError(
      "Provide either --objective or --horizon, not both."
    );
    expect(() => parseTradingInput("BTC --manual-levels --objective 10")).toThrowError(
      "Manual levels mode cannot be combined"
    );
  });
});
