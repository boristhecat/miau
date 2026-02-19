import { describe, expect, it } from "vitest";
import { parseTradingInput } from "../src/adapters/console/trading-input-parser.js";

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

  it("parses positional horizon minutes", () => {
    expect(parseTradingInput("eth 75")).toEqual({
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
    expect(parseTradingInput("btc 30 long")).toEqual({
      symbol: "BTC",
      requestedDirection: "LONG",
      customValues: false,
      runSimulation: false,
      objectiveHorizon: "30",
      showDetails: false
    });
    expect(parseTradingInput("btc short 45")).toEqual({
      symbol: "BTC",
      requestedDirection: "SHORT",
      customValues: false,
      runSimulation: false,
      objectiveHorizon: "45",
      showDetails: false
    });
  });

  it("parses expected range mode", () => {
    expect(parseTradingInput("btc --expected 240")).toEqual({
      symbol: "BTC",
      expectedRangeHorizon: "240",
      customValues: false,
      runSimulation: false,
      objectiveHorizon: undefined,
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
    expect(() => parseTradingInput("BTC -i")).toThrowError("Only [long|short], [minutes], --custom, --simulate, --horizon <minutes>, and --expected <minutes>");
    expect(() => parseTradingInput("ETH --interactive")).toThrowError("Only [long|short], [minutes], --custom, --simulate, --horizon <minutes>, and --expected <minutes>");
    expect(() => parseTradingInput("BTC --manual-levels")).toThrowError("Only [long|short], [minutes], --custom, --simulate, --horizon <minutes>, and --expected <minutes>");
    expect(() => parseTradingInput("BTC long short")).toThrowError("Direction can only be set once");
    expect(() => parseTradingInput("BTC --ai")).toThrowError("Only [long|short], [minutes], --custom, --simulate, --horizon <minutes>, and --expected <minutes>");
  });

  it("rejects duplicate horizon inputs", () => {
    expect(() => parseTradingInput("BTC 15 --horizon 30")).toThrowError("Horizon can only be set once");
  });

  it("rejects invalid expected value", () => {
    expect(() => parseTradingInput("BTC --expected 4h")).toThrowError("Invalid --expected value");
    expect(() => parseTradingInput("BTC --expected 0")).toThrowError("Invalid --expected value");
    expect(() => parseTradingInput("BTC --expected")).toThrowError("Missing value for --expected");
  });

  it("rejects invalid targeting flag values", () => {
    expect(() => parseTradingInput("BTC --horizon 90m")).toThrowError("Invalid --horizon value");
    expect(() => parseTradingInput("BTC --horizon 0")).toThrowError("Invalid --horizon value");
    expect(() => parseTradingInput("BTC 0")).toThrowError("Invalid --horizon value");
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
