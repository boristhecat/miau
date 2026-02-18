export interface AdaptiveTimeframes {
  timeframe: string;
  biasTimeframe: string;
  source: "horizon-adaptive" | "fallback";
}

export function resolveAdaptiveTimeframes(objectiveHorizon?: string): AdaptiveTimeframes {
  if (!objectiveHorizon || !/^\d+$/.test(objectiveHorizon.trim())) {
    return {
      timeframe: "1m",
      biasTimeframe: "15m",
      source: "fallback"
    };
  }
  const minutes = Number(objectiveHorizon);
  if (Number.isNaN(minutes) || minutes <= 0) {
    return {
      timeframe: "1m",
      biasTimeframe: "15m",
      source: "fallback"
    };
  }
  if (minutes <= 10) {
    return {
      timeframe: "1m",
      biasTimeframe: "15m",
      source: "horizon-adaptive"
    };
  }
  if (minutes <= 30) {
    return {
      timeframe: "3m",
      biasTimeframe: "15m",
      source: "horizon-adaptive"
    };
  }
  if (minutes <= 90) {
    return {
      timeframe: "5m",
      biasTimeframe: "30m",
      source: "horizon-adaptive"
    };
  }
  return {
    timeframe: "15m",
    biasTimeframe: "1h",
    source: "horizon-adaptive"
  };
}

export function resolveSimulationHorizonMinutes(objectiveHorizon?: string): number {
  if (!objectiveHorizon) {
    return 15;
  }
  const parsed = Number(objectiveHorizon);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return 15;
  }
  return parsed;
}

export function intervalToMs(interval: string): number {
  const normalized = interval.trim().toLowerCase();
  const match = normalized.match(/^(\d+)([mhd])$/);
  if (!match) {
    return 60_000;
  }

  const amount = Number(match[1]);
  const unit = match[2];
  if (Number.isNaN(amount) || amount <= 0) {
    return 60_000;
  }
  if (unit === "m") return amount * 60_000;
  if (unit === "h") return amount * 60 * 60_000;
  return amount * 24 * 60 * 60_000;
}
