import { describe, expect, it } from "vitest";
import { parseTradingInput } from "../src/application/parse-trading-input.js";

describe("parseTradingInput", () => {
  it("parses symbol only", () => {
    expect(parseTradingInput("btc")).toEqual({
      symbol: "BTC",
      customValues: false,
      runSimulation: false,
      objectiveHorizon: undefined,
      showDetails: false
    });
  });

  it("parses horizon-only flag", () => {
    expect(parseTradingInput("eth --horizon 75")).toEqual({
      symbol: "ETH",
      customValues: false,
      runSimulation: false,
      objectiveHorizon: "75",
      showDetails: false
    });
  });

  it("parses optional direction token", () => {
    expect(parseTradingInput("hype long")).toEqual({
      symbol: "HYPE",
      requestedDirection: "LONG",
      customValues: false,
      runSimulation: false,
      objectiveHorizon: undefined,
      showDetails: false
    });
    expect(parseTradingInput("sol short --horizon 10")).toEqual({
      symbol: "SOL",
      requestedDirection: "SHORT",
      customValues: false,
      runSimulation: false,
      objectiveHorizon: "10",
      showDetails: false
    });
  });

  it("parses simulation flag", () => {
    expect(parseTradingInput("btc --simulate")).toEqual({
      symbol: "BTC",
      customValues: false,
      runSimulation: true,
      objectiveHorizon: undefined,
      showDetails: false
    });
  });

  it("rejects missing symbol", () => {
    expect(() => parseTradingInput(" ")).toThrowError("Symbol is required");
  });

  it("rejects unsupported flags", () => {
    expect(() => parseTradingInput("BTC -i")).toThrowError("Only [long|short], --custom, --simulate, and --horizon <minutes>");
    expect(() => parseTradingInput("ETH --interactive")).toThrowError("Only [long|short], --custom, --simulate, and --horizon <minutes>");
    expect(() => parseTradingInput("BTC --manual-levels")).toThrowError("Only [long|short], --custom, --simulate, and --horizon <minutes>");
    expect(() => parseTradingInput("BTC long short")).toThrowError("Direction can only be set once");
  });

  it("rejects invalid targeting flag values", () => {
    expect(() => parseTradingInput("BTC --horizon 90m")).toThrowError("Invalid --horizon value");
  });

  it("parses --custom flag", () => {
    expect(parseTradingInput("btc --custom")).toEqual({
      symbol: "BTC",
      customValues: true,
      runSimulation: false,
      objectiveHorizon: undefined,
      showDetails: false
    });
  });
});
