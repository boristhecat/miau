import { describe, expect, it } from "vitest";
import { getUsageText, parseCliInput } from "../src/application/parse-cli-input.js";

describe("parseCliInput", () => {
  it("defaults to interactive mode with no args", () => {
    expect(parseCliInput(["node", "cli"])).toEqual({ mode: "interactive" });
  });

  it("rejects startup rec argument", () => {
    expect(() => parseCliInput(["node", "cli", "rec"]))
      .toThrowError("Startup arguments are not supported");
  });

  it("rejects startup help flag", () => {
    expect(() => parseCliInput(["node", "cli", "--help"]))
      .toThrowError("Startup arguments are not supported");
  });

  it("rejects unknown startup argument", () => {
    expect(() => parseCliInput(["node", "cli", "BTC"]))
      .toThrowError("Startup arguments are not supported");
  });

  it("rejects multiple startup arguments", () => {
    expect(() => parseCliInput(["node", "cli", "rec", "extra"]))
      .toThrowError("Startup arguments are not supported");
  });
});

describe("getUsageText", () => {
  it("returns usage string", () => {
    expect(getUsageText()).toContain("Usage: miau-trader");
  });
});
