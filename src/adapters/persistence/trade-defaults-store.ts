import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface TradeDefaults {
  leverage: number;
  positionSizeUsd: number;
  objectiveHorizon: string;
  aiModel: string;
}

const FALLBACK_TRADE_DEFAULTS: TradeDefaults = {
  leverage: 20,
  positionSizeUsd: 250,
  objectiveHorizon: "15",
  aiModel: "gpt-5.2"
};

export class JsonTradeDefaultsStore {
  constructor(private readonly filePath: string = path.join(process.cwd(), "data", "trade-defaults.json")) {}

  async load(): Promise<TradeDefaults> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<TradeDefaults>;
      return {
        leverage: Number.isFinite(parsed.leverage) ? Number(parsed.leverage) : FALLBACK_TRADE_DEFAULTS.leverage,
        positionSizeUsd: Number.isFinite(parsed.positionSizeUsd)
          ? Number(parsed.positionSizeUsd)
          : FALLBACK_TRADE_DEFAULTS.positionSizeUsd,
        objectiveHorizon:
          typeof parsed.objectiveHorizon === "string" &&
          /^\d+$/.test(parsed.objectiveHorizon) &&
          Number(parsed.objectiveHorizon) > 0
            ? parsed.objectiveHorizon
            : FALLBACK_TRADE_DEFAULTS.objectiveHorizon,
        aiModel:
          typeof parsed.aiModel === "string" && parsed.aiModel.trim().length > 0
            ? parsed.aiModel.trim()
            : FALLBACK_TRADE_DEFAULTS.aiModel
      };
    } catch {
      return { ...FALLBACK_TRADE_DEFAULTS };
    }
  }

  async save(defaults: TradeDefaults): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(defaults, null, 2), "utf8");
  }
}

