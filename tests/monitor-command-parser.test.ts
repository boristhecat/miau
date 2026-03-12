import { describe, expect, it } from "vitest";
import { parseMonitorCommand } from "../src/adapters/console/monitor-command-parser.js";

describe("parseMonitorCommand", () => {
  it("parses a valid monitor command", () => {
    const parsed = parseMonitorCommand(
      "monitor btc long --entry 69420 --sl 68850 --tp 70800 --refresh 0.5 --size 300 --leverage 10 --horizon 60",
      1_700_000_000_000
    );

    expect(parsed).toEqual({
      symbol: "BTC",
      side: "LONG",
      entry: 69420,
      stopLoss: 68850,
      takeProfit: 70800,
      refreshSeconds: 0.5,
      positionSizeUsd: 300,
      leverage: 10,
      objectiveHorizon: "60",
      openedAtMs: 1_700_000_000_000,
      intervalOverride: undefined
    });
  });

  it("rejects invalid level ordering", () => {
    expect(() =>
      parseMonitorCommand("monitor btc long --entry 69420 --sl 70000 --tp 70800", 1_700_000_000_000)
    ).toThrow("Invalid LONG trade");
  });

  it("rejects missing required level flags", () => {
    expect(() => parseMonitorCommand("monitor btc short --entry 69420 --sl 70000", 1_700_000_000_000)).toThrow(
      "Monitor command requires --entry, --sl, and --tp."
    );
  });

  it("rejects too-fast refresh intervals", () => {
    expect(() =>
      parseMonitorCommand("monitor btc short --entry 69420 --sl 70000 --tp 68000 --refresh 0.1", 1_700_000_000_000)
    ).toThrow("Invalid --refresh value");
  });
});
