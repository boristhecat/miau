export interface TradeDefaults {
  leverage: number;
  positionSizeUsd: number;
  objectiveHorizon: string;
  aiModel: string;
}

export interface TradeDefaultsStorePort {
  load(): Promise<TradeDefaults>;
  save(defaults: TradeDefaults): Promise<void>;
}

export const FALLBACK_TRADE_DEFAULTS: TradeDefaults = {
  leverage: 20,
  positionSizeUsd: 250,
  objectiveHorizon: "15",
  aiModel: "gpt-5.4"
};
