import type { IndicatorSnapshot, SessionContext, SetupPlaybook, TradingSession } from "./types.js";
import { detectTradingSession } from "./recommendation-market-context.js";

/**
 * Analyze session context: what session we're in, how it behaves,
 * which setups are favored vs risky, and intraday range/expansion tracking.
 */
export function analyzeSessionContext(
  now: Date,
  sessionLevels: IndicatorSnapshot["sessionLevels"],
  dailyLevels: IndicatorSnapshot["dailyLevels"],
  lastPrice: number
): SessionContext {
  const currentSession = detectTradingSession(now);
  const minutesIntoSession = computeMinutesIntoSession(now, currentSession);
  const isSessionOpenWindow = minutesIntoSession < 30;

  // Asia range: priorHigh/Low during London/US, currentHigh/Low during Asia
  let asiaHigh: number | undefined;
  let asiaLow: number | undefined;

  if (currentSession === "ASIA" && sessionLevels) {
    asiaHigh = sessionLevels.currentHigh;
    asiaLow = sessionLevels.currentLow;
  } else if (sessionLevels?.priorHigh !== undefined && sessionLevels?.priorLow !== undefined) {
    asiaHigh = sessionLevels.priorHigh;
    asiaLow = sessionLevels.priorLow;
  }

  // Asia range break
  let asiaRangeBreak: "ABOVE" | "BELOW" | "NONE" = "NONE";
  if (asiaHigh !== undefined && asiaLow !== undefined && currentSession !== "ASIA") {
    if (lastPrice > asiaHigh) asiaRangeBreak = "ABOVE";
    else if (lastPrice < asiaLow) asiaRangeBreak = "BELOW";
  }

  // London expansion direction (only meaningful during US or late London)
  let londonExpansionDirection: "BULLISH" | "BEARISH" | "NONE" = "NONE";
  if (currentSession === "US" || (currentSession === "LONDON" && minutesIntoSession > 120)) {
    if (asiaRangeBreak === "ABOVE") londonExpansionDirection = "BULLISH";
    else if (asiaRangeBreak === "BELOW") londonExpansionDirection = "BEARISH";
  }

  const { favoredSetups, riskySetups } = resolveSessionSetups(currentSession, isSessionOpenWindow);

  return {
    currentSession,
    minutesIntoSession,
    isSessionOpenWindow,
    asiaHigh,
    asiaLow,
    asiaRangeBreak,
    londonExpansionDirection,
    favoredSetups,
    riskySetups
  };
}

function computeMinutesIntoSession(now: Date, session: TradingSession): number {
  const utcHour = now.getUTCHours();
  const utcMinute = now.getUTCMinutes();
  const totalMinutes = utcHour * 60 + utcMinute;

  const sessionStarts: Record<TradingSession, number> = {
    ASIA: 0,
    LONDON: 480,
    US: 780,
    DEAD: 1260
  };

  return totalMinutes - sessionStarts[session];
}

const ALL_PLAYBOOKS: readonly SetupPlaybook[] = [
  "TREND_PULLBACK_CONTINUATION",
  "BREAKOUT_CONTINUATION",
  "DIVERGENCE_REVERSAL",
  "LIQUIDATION_REVERSAL",
  "RANGE_FADE"
] as const;

function resolveSessionSetups(
  session: TradingSession,
  isOpenWindow: boolean
): { favoredSetups: readonly SetupPlaybook[]; riskySetups: readonly SetupPlaybook[] } {
  switch (session) {
    case "ASIA":
      return {
        favoredSetups: ["RANGE_FADE", "DIVERGENCE_REVERSAL"],
        riskySetups: ["BREAKOUT_CONTINUATION"]
      };
    case "LONDON":
      if (isOpenWindow) {
        return {
          favoredSetups: ["RANGE_FADE", "DIVERGENCE_REVERSAL", "LIQUIDATION_REVERSAL"],
          riskySetups: ["BREAKOUT_CONTINUATION"]
        };
      }
      return { favoredSetups: ALL_PLAYBOOKS, riskySetups: [] };
    case "US":
      return { favoredSetups: ALL_PLAYBOOKS, riskySetups: [] };
    case "DEAD":
      return {
        favoredSetups: ["RANGE_FADE"],
        riskySetups: ["BREAKOUT_CONTINUATION", "TREND_PULLBACK_CONTINUATION"]
      };
  }
}
