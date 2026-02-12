import { describe, expect, it } from "vitest";
import { parseTradingInput } from "../src/application/parse-trading-input.js";

describe("parseTradingInput", () => {
  it("parses symbol only", () => {
    expect(parseTradingInput("btc")).toEqual({
      symbol: "BTC",
      timeframe: undefined,
      biasTimeframe: undefined,
      leverage: undefined,
      positionSizeUsd: undefined,
      slPct: undefined,
      tpPct: undefined,
      slUsd: undefined,
      tpUsd: undefined,
      showDetails: false
    });
  });

  it("parses short leverage/size flags", () => {
    expect(parseTradingInput("ETH --tf 1m --bias-tf 15m -l 5 -s 250 --sl 0.8 --tp 1.6")).toEqual({
      symbol: "ETH",
      timeframe: "1m",
      biasTimeframe: "15m",
      leverage: 5,
      positionSizeUsd: 250,
      slPct: 0.8,
      tpPct: 1.6,
      slUsd: undefined,
      tpUsd: undefined,
      showDetails: false
    });
  });

  it("parses long leverage/size flags", () => {
    expect(parseTradingInput("ETH --leverage 5 --size 250")).toEqual({
      symbol: "ETH",
      timeframe: undefined,
      biasTimeframe: undefined,
      leverage: 5,
      positionSizeUsd: 250,
      slPct: undefined,
      tpPct: undefined,
      slUsd: undefined,
      tpUsd: undefined,
      showDetails: false
    });
  });

  it("parses symbol with leverage only", () => {
    expect(parseTradingInput("SOL -l 3")).toEqual({
      symbol: "SOL",
      timeframe: undefined,
      biasTimeframe: undefined,
      leverage: 3,
      positionSizeUsd: undefined,
      slPct: undefined,
      tpPct: undefined,
      slUsd: undefined,
      tpUsd: undefined,
      showDetails: false
    });
  });

  it("parses symbol with position size only", () => {
    expect(parseTradingInput("SOL -s 250")).toEqual({
      symbol: "SOL",
      timeframe: undefined,
      biasTimeframe: undefined,
      leverage: undefined,
      positionSizeUsd: 250,
      slPct: undefined,
      tpPct: undefined,
      slUsd: undefined,
      tpUsd: undefined,
      showDetails: false
    });
  });

  it("parses verbose flag", () => {
    expect(parseTradingInput("SOL -l 5 -s 100 -v")).toEqual({
      symbol: "SOL",
      timeframe: undefined,
      biasTimeframe: undefined,
      leverage: 5,
      positionSizeUsd: 100,
      slPct: undefined,
      tpPct: undefined,
      slUsd: undefined,
      tpUsd: undefined,
      showDetails: true
    });
  });

  it("parses usd target overrides", () => {
    expect(parseTradingInput("SOL --sl-usd 30 --tp-usd 90")).toEqual({
      symbol: "SOL",
      timeframe: undefined,
      biasTimeframe: undefined,
      leverage: undefined,
      positionSizeUsd: undefined,
      slPct: undefined,
      tpPct: undefined,
      slUsd: 30,
      tpUsd: 90,
      showDetails: false
    });
  });

  it("rejects unknown options", () => {
    expect(() => parseTradingInput("SOL --raw")).toThrowError("Unknown option");
  });

  it("rejects positional values without flags", () => {
    expect(() => parseTradingInput("SOL 5x 100")).toThrowError("Use format");
  });

  it("rejects missing flag values", () => {
    expect(() => parseTradingInput("SOL -l")).toThrowError("Missing value for leverage");
    expect(() => parseTradingInput("SOL -s")).toThrowError("Missing value for size");
    expect(() => parseTradingInput("SOL --sl")).toThrowError("Missing value for --sl");
    expect(() => parseTradingInput("SOL --tp")).toThrowError("Missing value for --tp");
    expect(() => parseTradingInput("SOL --tf")).toThrowError("Missing value for --tf");
    expect(() => parseTradingInput("SOL --bias-tf")).toThrowError("Missing value for --bias-tf");
  });

  it("rejects invalid leverage", () => {
    expect(() => parseTradingInput("SOL -l 0")).toThrowError("Invalid leverage");
    expect(() => parseTradingInput("SOL -l 5x")).toThrowError("Invalid leverage");
  });

  it("rejects invalid size", () => {
    expect(() => parseTradingInput("SOL -l 3 -s -1")).toThrowError("Invalid position size");
  });

  it("rejects mixed sl/tp unit flags", () => {
    expect(() => parseTradingInput("SOL --sl 1 --sl-usd 30")).toThrowError("either --sl");
    expect(() => parseTradingInput("SOL --tp 2 --tp-usd 50")).toThrowError("either --tp");
  });

  it("rejects invalid timeframe formats", () => {
    expect(() => parseTradingInput("SOL --tf 1min")).toThrowError("Invalid timeframe");
    expect(() => parseTradingInput("SOL --bias-tf 15min")).toThrowError("Invalid bias timeframe");
  });
});
