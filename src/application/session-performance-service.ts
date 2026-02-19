import { intervalToMs } from "./timeframe-policy.js";

interface SessionStats {
  wins: number;
  losses: number;
}

export class SessionPerformanceService {
  private readonly byPair = new Map<string, SessionStats>();
  private readonly cooldownUntilMsByPair = new Map<string, number>();

  applyConfidenceCalibration(pair: string, confidence: number): { confidence: number; note?: string } {
    const stats = this.byPair.get(pair);
    if (!stats) {
      return { confidence };
    }
    const samples = stats.wins + stats.losses;
    if (samples < 3) {
      return { confidence };
    }
    const winRate = stats.wins / Math.max(samples, 1);
    const delta = Math.round((winRate - 0.5) * 20);
    if (delta === 0) {
      return { confidence };
    }
    const adjusted = Math.min(99, Math.max(1, confidence + delta));
    return {
      confidence: adjusted,
      note: `session calibration ${delta >= 0 ? "+" : ""}${delta}% from ${samples} sims (${Math.round(winRate * 100)}% win)`
    };
  }

  recordSimulation(pair: string, status: "SUCCESS" | "FAILURE", interval: string): void {
    const current = this.byPair.get(pair) ?? { wins: 0, losses: 0 };
    if (status === "SUCCESS") {
      current.wins += 1;
    } else {
      current.losses += 1;
      const intervalMs = intervalToMs(interval);
      const cooldownMs = Math.max(intervalMs, 60_000) * 8;
      this.cooldownUntilMsByPair.set(pair, Date.now() + cooldownMs);
    }
    this.byPair.set(pair, current);
  }

  getCooldownRemainingMs(pair: string): number {
    const until = this.cooldownUntilMsByPair.get(pair);
    if (!until) {
      return 0;
    }
    return Math.max(0, until - Date.now());
  }
}
