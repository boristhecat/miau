import { RankTopOpportunitiesUseCase } from "./rank-top-opportunities-use-case.js";
import type { MarketDataPort } from "../ports/market-data-port.js";

export class SelectLearningSymbolsUseCase {
  constructor(
    private readonly marketData: MarketDataPort,
    private readonly rankTopOpportunitiesUseCase: RankTopOpportunitiesUseCase
  ) {}

  async execute(input?: { universeLimit?: number; top?: number }): Promise<string[]> {
    const universeLimit = input?.universeLimit ?? 15;
    const top = input?.top ?? 5;
    const selected = await this.marketData.getTopPerpSymbolsByVolumeWithOpenInterest(universeLimit);
    const result = await this.rankTopOpportunitiesUseCase.execute({
      symbols: selected.map((item) => item.symbol),
      top
    });
    const ranked = result.ranked.map((row) => row.symbol);
    if (ranked.length > 0) {
      return ranked;
    }
    return selected.slice(0, top).map((item) => item.symbol);
  }
}

