import { describe, expect, it } from "vitest";
import { isTalibBoundsTrap } from "../src/adapters/indicators/talib-wasm-runtime.js";

describe("talib-wasm-runtime", () => {
  it("detects wasm memory bounds traps", () => {
    const runtimeError = new WebAssembly.RuntimeError("memory access out of bounds");
    expect(isTalibBoundsTrap(runtimeError)).toBe(true);
    expect(isTalibBoundsTrap(new Error("memory access out of bounds"))).toBe(true);
    expect(isTalibBoundsTrap(new Error("some other error"))).toBe(false);
  });
});
