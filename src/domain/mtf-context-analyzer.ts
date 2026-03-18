import type {
  IndicatorSnapshot,
  MarketRegime,
  MtfAlignment,
  MtfContext,
  StructuralBiasContext,
  StructureBreakType,
  StructureState
} from "./types.js";
import { classifyMarketRegime } from "./recommendation-market-context.js";
import { inferBiasContext } from "./recommendation-signal-evaluator.js";
import { parseIntervalToMinutes } from "./interval-utils.js";

/**
 * Select the three MTF timeframes based on execution interval and objective horizon.
 */
export function selectMtfTimeframes(input: {
  executionInterval: string;
  objectiveHorizonMinutes?: number;
}): {
  executionInterval: string;
  directionalInterval: string;
  structureInterval: string;
} {
  const execMins = parseIntervalToMinutes(input.executionInterval);
  const horizon = input.objectiveHorizonMinutes ?? execMins * 30;

  // Directional = ~4-6x execution, Structure = ~4-6x directional
  let directionalMins: number;
  let structureMins: number;

  if (horizon < 15) {
    directionalMins = 5;
    structureMins = 15;
  } else if (horizon <= 60) {
    directionalMins = 15;
    structureMins = 60;
  } else if (horizon <= 240) {
    directionalMins = 60;
    structureMins = 240;
  } else {
    directionalMins = 240;
    structureMins = 1440;
  }

  // Ensure each layer is distinct
  if (directionalMins <= execMins) directionalMins = execMins * 4;
  if (structureMins <= directionalMins) structureMins = directionalMins * 4;

  return {
    executionInterval: input.executionInterval,
    directionalInterval: minutesToInterval(directionalMins),
    structureInterval: minutesToInterval(structureMins)
  };
}

function minutesToInterval(mins: number): string {
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${mins / 60}h`;
  return `${mins / 1440}d`;
}

/**
 * Analyze multi-timeframe context from structure and directional timeframe indicators.
 */
export function analyzeMtfContext(input: {
  structureIndicators: IndicatorSnapshot;
  structureInterval: string;
  directionalIndicators: IndicatorSnapshot;
  directionalInterval: string;
  executionSignal: "LONG" | "SHORT";
  executionAtr?: number;
  currentPrice?: number;
}): MtfContext {
  const structureBias = buildStructuralBiasContext(input.structureIndicators, input.structureInterval);
  const directionalBias = buildStructuralBiasContext(input.directionalIndicators, input.directionalInterval);

  const directions = [structureBias.trend, directionalBias.trend, input.executionSignal];
  const longCount = directions.filter((d) => d === "LONG").length;
  const shortCount = directions.filter((d) => d === "SHORT").length;

  let alignment: MtfAlignment;
  let agreementCount: number;
  if (longCount === 3 || shortCount === 3) {
    alignment = "FULL";
    agreementCount = 3;
  } else if (longCount >= 2 || shortCount >= 2) {
    alignment = "PARTIAL";
    agreementCount = Math.max(longCount, shortCount);
  } else {
    alignment = "CONFLICTING";
    agreementCount = 1;
  }

  // Cascade bias: structure wins unless directional shows ChoCH
  let cascadeBias: "LONG" | "SHORT" | "NEUTRAL";
  if (structureBias.trend === directionalBias.trend) {
    cascadeBias = structureBias.trend;
  } else if (directionalBias.structureBreak === "CHOCH") {
    // Directional TF is showing a character change — respect it over structure
    cascadeBias = directionalBias.trend;
  } else {
    cascadeBias = structureBias.trend;
  }

  // HTF level proximity check
  let nearHtfResistance = false;
  let nearHtfSupport = false;
  if (input.currentPrice !== undefined && input.executionAtr !== undefined) {
    const proximityThreshold = input.executionAtr * 1.5;
    if (structureBias.nearestResistance !== undefined) {
      nearHtfResistance = structureBias.nearestResistance - input.currentPrice < proximityThreshold
        && structureBias.nearestResistance > input.currentPrice;
    }
    if (structureBias.nearestSupport !== undefined) {
      nearHtfSupport = input.currentPrice - structureBias.nearestSupport < proximityThreshold
        && structureBias.nearestSupport < input.currentPrice;
    }
  }

  const rationale = buildMtfRationale(
    structureBias, directionalBias, input.executionSignal,
    input.structureInterval, input.directionalInterval,
    alignment, cascadeBias, nearHtfResistance, nearHtfSupport
  );

  return {
    structure: structureBias,
    structureInterval: input.structureInterval,
    directional: directionalBias,
    directionalInterval: input.directionalInterval,
    alignment,
    cascadeBias,
    agreementCount,
    nearHtfResistance,
    nearHtfSupport,
    rationale
  };
}

function buildStructuralBiasContext(indicators: IndicatorSnapshot, interval: string): StructuralBiasContext {
  const basic = inferBiasContext(indicators);
  const intervalMins = parseIntervalToMinutes(interval);
  const lastPrice = indicators.vwap; // best estimate without raw candle close
  const regime = classifyMarketRegime(indicators, lastPrice).marketRegime;

  return {
    ...basic,
    structureState: indicators.marketStructure?.state,
    structureBreak: indicators.marketStructure?.lastBreak,
    regime,
    swingHigh: indicators.marketStructure?.currentSwingHigh ?? indicators.swingHigh,
    swingLow: indicators.marketStructure?.currentSwingLow ?? indicators.swingLow,
    nearestSupport: indicators.nearestSupportLevel,
    nearestResistance: indicators.nearestResistanceLevel
  };
}

function buildMtfRationale(
  structure: StructuralBiasContext,
  directional: StructuralBiasContext,
  executionSignal: "LONG" | "SHORT",
  structureInterval: string,
  directionalInterval: string,
  alignment: MtfAlignment,
  cascadeBias: "LONG" | "SHORT" | "NEUTRAL",
  nearHtfResistance: boolean,
  nearHtfSupport: boolean
): string[] {
  const rationale: string[] = [];

  const structState = structure.structureState ? ` (${structure.structureState})` : "";
  const dirState = directional.structureState ? ` (${directional.structureState})` : "";

  rationale.push(
    `MTF cascade: ${structureInterval} ${structure.trend}${structState} | ${directionalInterval} ${directional.trend}${dirState} | exec ${executionSignal} → ${alignment} alignment.`
  );

  if (structure.structureBreak === "CHOCH") {
    rationale.push(`${structureInterval} shows ChoCH ${structure.trend === "LONG" ? "bullish" : "bearish"} — macro character change.`);
  } else if (structure.structureBreak === "BOS") {
    rationale.push(`${structureInterval} confirmed BOS ${structure.trend === "LONG" ? "bullish" : "bearish"} — macro trend continuation.`);
  }

  if (directional.structureBreak === "CHOCH" && directional.trend !== structure.trend) {
    rationale.push(`${directionalInterval} ChoCH against macro — potential intermediate reversal.`);
  }

  if (nearHtfResistance) {
    rationale.push(`Price is near ${structureInterval} resistance — upside may be capped.`);
  }
  if (nearHtfSupport) {
    rationale.push(`Price is near ${structureInterval} support — downside may be limited.`);
  }

  if (alignment === "CONFLICTING") {
    rationale.push("All timeframes disagree — no directional edge across the cascade.");
  }

  return rationale;
}
