import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createLearningStore } from "../src/adapters/persistence/sqlite-learning-store.js";

let tempDir: string | undefined;

afterAll(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

describe("SqliteLearningStore", () => {
  it("excludes pending query observations from evaluated learning stats", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "miau-learning-store-"));
    const dbPath = path.join(tempDir, "learning.sqlite");
    const store = await createLearningStore(dbPath);

    await store.recordOutcome({
      pair: "BTC-USD",
      symbol: "BTC",
      timeframe: "1m",
      horizonMinutes: 15,
      marketRegime: "TREND",
      signal: "LONG",
      confidence: 60,
      setupQuality: 58,
      status: "PENDING",
      maxFavorableExcursionPct: undefined,
      maxAdverseExcursionPct: undefined,
      pnlUsd: undefined
    });
    await store.recordOutcome({
      pair: "BTC-USD",
      symbol: "BTC",
      timeframe: "1m",
      horizonMinutes: 15,
      marketRegime: "TREND",
      signal: "LONG",
      confidence: 60,
      setupQuality: 58,
      status: "SUCCESS",
      maxFavorableExcursionPct: undefined,
      maxAdverseExcursionPct: undefined,
      pnlUsd: undefined
    });
    await store.recordOutcome({
      pair: "BTC-USD",
      symbol: "BTC",
      timeframe: "1m",
      horizonMinutes: 15,
      marketRegime: "TREND",
      signal: "LONG",
      confidence: 60,
      setupQuality: 58,
      status: "FAILURE",
      maxFavorableExcursionPct: undefined,
      maxAdverseExcursionPct: undefined,
      pnlUsd: undefined
    });

    const stats = await store.getStats({
      pair: "BTC-USD",
      timeframe: "1m",
      marketRegime: "TREND",
      lookbackDays: 14,
      limit: 10
    });
    const overview = await store.getOverview({ lookbackDays: 14 });
    const buckets = await store.getBucketOverview({ lookbackDays: 14 });

    expect(stats.samples).toBe(2);
    expect(stats.winRate).toBe(0.5);
    expect(stats.recentOutcomes).toHaveLength(2);
    expect(overview.totalSamples).toBe(2);
    expect(overview.wins).toBe(1);
    expect(overview.losses).toBe(1);
    expect(overview.winRate).toBe(0.5);
    expect(buckets).toHaveLength(1);
    expect(buckets[0]?.samples).toBe(2);
  });
});
