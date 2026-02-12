import { describe, expect, it } from "vitest";
import { getUsageText, parseCliInput } from "../src/application/parse-cli-input.js";

describe("parseCliInput", () => {
  it("accepts no flags in early dev mode", () => {
    expect(() => parseCliInput(["node", "cli"])).not.toThrow();
  });

  it("throws for any provided argument", () => {
    expect(() => parseCliInput(["node", "cli", "--logIndicators"]))
      .toThrowError("takes no flags");
  });

  it("throws usage sentinel on --help", () => {
    expect(() => parseCliInput(["node", "cli", "--help"]))
      .toThrowError("USAGE");
  });

  it("throws for unknown argument", () => {
    expect(() => parseCliInput(["node", "cli", "BTC"]))
      .toThrowError("Unknown argument");
  });
});

describe("getUsageText", () => {
  it("returns usage string", () => {
    expect(getUsageText()).toContain("Usage: miau-trader");
  });
});
