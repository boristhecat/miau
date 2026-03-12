export interface AssetProfile {
  readonly tier: "BTC" | "ETH" | "LARGE_CAP" | "MID_CAP" | "LOW_CAP";
  /** Funding rate threshold above which contrarian signal applies */
  readonly fundingSignificanceThreshold: number;
  /** OI delta % threshold for significant expansion */
  readonly oiDeltaSignificanceThreshold: number;
  /** Bid-ask spread % above which execution is poor */
  readonly spreadBlockThreshold: number;
  /** Typical ATR% for regime classification calibration */
  readonly typicalAtrPct: number;
}

const PROFILES: Record<AssetProfile["tier"], AssetProfile> = {
  BTC: {
    tier: "BTC",
    fundingSignificanceThreshold: 0.00005,
    oiDeltaSignificanceThreshold: 0.35,
    spreadBlockThreshold: 0.08,
    typicalAtrPct: 0.35
  },
  ETH: {
    tier: "ETH",
    fundingSignificanceThreshold: 0.00006,
    oiDeltaSignificanceThreshold: 0.45,
    spreadBlockThreshold: 0.10,
    typicalAtrPct: 0.45
  },
  LARGE_CAP: {
    tier: "LARGE_CAP",
    fundingSignificanceThreshold: 0.00008,
    oiDeltaSignificanceThreshold: 0.6,
    spreadBlockThreshold: 0.14,
    typicalAtrPct: 0.6
  },
  MID_CAP: {
    tier: "MID_CAP",
    fundingSignificanceThreshold: 0.00012,
    oiDeltaSignificanceThreshold: 0.8,
    spreadBlockThreshold: 0.18,
    typicalAtrPct: 0.9
  },
  LOW_CAP: {
    tier: "LOW_CAP",
    fundingSignificanceThreshold: 0.00018,
    oiDeltaSignificanceThreshold: 1.2,
    spreadBlockThreshold: 0.25,
    typicalAtrPct: 1.5
  }
};

const LARGE_CAP_SYMBOLS = new Set(["SOL", "AVAX", "DOGE", "ADA", "XRP", "DOT", "MATIC", "LINK", "NEAR", "UNI"]);

export function resolveAssetProfile(pair: string): AssetProfile {
  const symbol = pair.split("-")[0]?.toUpperCase() ?? pair.toUpperCase();
  if (symbol === "BTC") return PROFILES.BTC;
  if (symbol === "ETH") return PROFILES.ETH;
  if (LARGE_CAP_SYMBOLS.has(symbol)) return PROFILES.LARGE_CAP;
  // Default to MID_CAP for unknown symbols — conservative but not overly restrictive
  return PROFILES.MID_CAP;
}
