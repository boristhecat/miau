export interface TradeDefaults {
  leverage: number;
  positionSizeUsd: number;
  objectiveHorizon: string;
  aiProvider: string;
  aiModel: string;
  apiKeyEnvVar: string;
}

export interface TradeDefaultsStorePort {
  load(): Promise<TradeDefaults>;
  save(defaults: TradeDefaults): Promise<void>;
}

export const FALLBACK_TRADE_DEFAULTS: TradeDefaults = {
  leverage: 20,
  positionSizeUsd: 250,
  objectiveHorizon: "15",
  aiProvider: "openai",
  aiModel: "gpt-5.4",
  apiKeyEnvVar: "OPENAI_API_KEY"
};
