import { describe, expect, it } from "vitest";
import { parseTradingInput } from "../src/application/parse-trading-input.js";

describe("parseTradingInput", () => {
  it("parses symbol only", () => {
    expect(parseTradingInput("btc")).toEqual({ symbol: "BTC", leverage: undefined, positionSizeUsd: undefined });
  });

  it("parses symbol with leverage and size", () => {
    expect(parseTradingInput("ETH 5x 250")).toEqual({ symbol: "ETH", leverage: 5, positionSizeUsd: 250 });
  });

  it("parses symbol with leverage only", () => {
    expect(parseTradingInput("SOL 3x")).toEqual({ symbol: "SOL", leverage: 3, positionSizeUsd: undefined });
  });

  it("parses symbol with position size only", () => {
    expect(parseTradingInput("SOL 250")).toEqual({ symbol: "SOL", leverage: undefined, positionSizeUsd: 250 });
  });

  it("rejects invalid leverage", () => {
    expect(() => parseTradingInput("SOL 0x 200")).toThrowError("Invalid leverage");
  });

  it("rejects invalid size", () => {
    expect(() => parseTradingInput("SOL 3x -1")).toThrowError("Invalid position size");
  });
});
