import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { SqliteTradeDefaultsStore } from "../src/adapters/persistence/trade-defaults-store.js";

let tempDir: string | undefined;

afterAll(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

describe("SqliteTradeDefaultsStore", () => {
  it("persists and reloads defaults from SQLite", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "miau-defaults-store-"));
    const dbPath = path.join(tempDir, "learning.sqlite");
    const legacyPath = path.join(tempDir, "trade-defaults.json");
    const store = new SqliteTradeDefaultsStore(dbPath, legacyPath);

    await store.save({
      leverage: 12,
      positionSizeUsd: 420,
      objectiveHorizon: "45",
      aiModel: "gpt-5.4"
    });

    await expect(store.load()).resolves.toEqual({
      leverage: 12,
      positionSizeUsd: 420,
      objectiveHorizon: "45",
      aiModel: "gpt-5.4"
    });
  });

  it("migrates legacy JSON defaults into SQLite on first load", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "miau-defaults-store-"));
    const dbPath = path.join(tempDir, "learning.sqlite");
    const legacyPath = path.join(tempDir, "trade-defaults.json");
    await writeFile(
      legacyPath,
      JSON.stringify({
        leverage: 33,
        positionSizeUsd: 555,
        objectiveHorizon: "60",
        aiModel: "gpt-5.4"
      }),
      "utf8"
    );

    const store = new SqliteTradeDefaultsStore(dbPath, legacyPath);

    await expect(store.load()).resolves.toEqual({
      leverage: 33,
      positionSizeUsd: 555,
      objectiveHorizon: "60",
      aiModel: "gpt-5.4"
    });
    await expect(store.load()).resolves.toEqual({
      leverage: 33,
      positionSizeUsd: 555,
      objectiveHorizon: "60",
      aiModel: "gpt-5.4"
    });
  });
});
