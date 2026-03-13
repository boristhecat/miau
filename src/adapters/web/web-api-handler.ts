import type {
  IGenerateRecommendationUseCase,
  IRankingUseCase,
  IAdaptiveLearningService,
  ILearningBucketReportUseCase,
  IBuildOpenTradeBaselineUseCase,
  IEvaluateOpenTradeUseCase,
  IGenerateAiAdviceUseCase
} from "../../application/use-case-interfaces.js";
import { LearningAwareRecommendationGenerator } from "../../application/learning-aware-recommendation-generator.js";
import { resolveAdaptiveTimeframes } from "../../application/timeframe-policy.js";
import type { TradeMonitorBaseline, TradeMonitorSnapshot } from "../../domain/trade-monitor-types.js";
import type { PerpMarketSnapshot, Recommendation } from "../../domain/types.js";
import type { TradeDefaultsStorePort } from "../../ports/trade-defaults-store-port.js";

export interface WebApiDeps {
  recommendationUseCase: IGenerateRecommendationUseCase;
  rankingUseCase: IRankingUseCase;
  learning: IAdaptiveLearningService;
  learningBucketReportUseCase: ILearningBucketReportUseCase;
  buildBaselineUseCase: IBuildOpenTradeBaselineUseCase;
  evaluateOpenTradeUseCase: IEvaluateOpenTradeUseCase;
  tradeDefaultsStore: TradeDefaultsStorePort;
  aiAdviceUseCase?: IGenerateAiAdviceUseCase;
  aiEnabled: boolean;
}

export class WebApiHandler {
  private readonly learningAwareRecommendationGenerator: LearningAwareRecommendationGenerator;

  constructor(private readonly deps: WebApiDeps) {
    this.learningAwareRecommendationGenerator = new LearningAwareRecommendationGenerator(
      deps.recommendationUseCase,
      deps.learning
    );
  }

  async handleAnalyze(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const symbol = String(body.symbol ?? "").trim().toUpperCase();
    if (!symbol) throw new HttpError(400, "Symbol is required.");
    const pair = symbol.includes("-") ? symbol : `${symbol}-USD`;
    const direction = body.direction ? String(body.direction).toUpperCase() as "LONG" | "SHORT" : undefined;
    if (direction && direction !== "LONG" && direction !== "SHORT") {
      throw new HttpError(400, "Direction must be LONG or SHORT.");
    }
    const horizon = parseOptionalString(body.horizon);
    const defaults = await this.deps.tradeDefaultsStore.load();
    const effectiveHorizon = horizon ?? defaults.objectiveHorizon;
    const adaptive = resolveAdaptiveTimeframes(effectiveHorizon);
    const leverage = parseOptionalPositiveNumber(body.leverage, "leverage") ?? defaults.leverage;
    const positionSizeUsd = parseOptionalPositiveNumber(body.positionSizeUsd, "position size") ?? defaults.positionSizeUsd;

    let recommendation = await this.learningAwareRecommendationGenerator.execute({
      pair,
      forcedDirection: direction,
      interval: adaptive.timeframe,
      biasInterval: adaptive.biasTimeframe,
      leverage,
      positionSizeUsd,
      objectiveHorizon: effectiveHorizon,
      expectedRangeHorizon: body.expectedRangeHorizon ? String(body.expectedRangeHorizon) : undefined
    });

    let aiAdvice: unknown = undefined;
    if (this.deps.aiEnabled && this.deps.aiAdviceUseCase) {
      try {
        aiAdvice = await this.deps.aiAdviceUseCase.execute({ recommendation });
      } catch {
        // AI advice is optional — swallow errors
      }
    }

    return { recommendation, aiAdvice };
  }

  async handleScan(query: Record<string, string>): Promise<unknown> {
    const defaults = await this.deps.tradeDefaultsStore.load();
    const top = query.top ? Number(query.top) : 5;
    const universeLimit = query.universeLimit ? Number(query.universeLimit) : 15;
    return this.deps.rankingUseCase.execute({
      defaults: {
        leverage: defaults.leverage,
        positionSizeUsd: defaults.positionSizeUsd,
        objectiveHorizon: defaults.objectiveHorizon
      },
      top,
      universeLimit
    });
  }

  async handleLearningStats(query: Record<string, string>): Promise<unknown> {
    const lookbackDays = query.lookbackDays ? Number(query.lookbackDays) : 14;
    const [overview, bucketReport] = await Promise.all([
      this.deps.learning.getOverview(lookbackDays),
      this.deps.learningBucketReportUseCase.execute({ lookbackDays })
    ]);
    return { overview, bucketReport, lookbackDays };
  }

  async handleGetDefaults(): Promise<unknown> {
    return this.deps.tradeDefaultsStore.load();
  }

  async handleSaveDefaults(body: Record<string, unknown>): Promise<unknown> {
    const leverage = Number(body.leverage);
    const positionSizeUsd = Number(body.positionSizeUsd);
    const objectiveHorizon = String(body.objectiveHorizon ?? "15").trim();
    const aiModel = String(body.aiModel ?? "gpt-5.2").trim();
    if (!Number.isFinite(leverage) || leverage <= 0) throw new HttpError(400, "Invalid leverage.");
    if (!Number.isFinite(positionSizeUsd) || positionSizeUsd <= 0) throw new HttpError(400, "Invalid position size.");
    if (!objectiveHorizon) throw new HttpError(400, "Objective horizon is required.");
    if (!aiModel) throw new HttpError(400, "AI model is required.");
    const defaults = { leverage, positionSizeUsd, objectiveHorizon, aiModel };
    await this.deps.tradeDefaultsStore.save(defaults);
    return defaults;
  }

  async buildMonitorBaseline(params: Record<string, string>): Promise<TradeMonitorBaseline> {
    const symbol = String(params.symbol ?? "").trim().toUpperCase();
    if (!symbol) throw new HttpError(400, "Symbol is required.");
    const pair = symbol.includes("-") ? symbol : `${symbol}-USD`;
    const side = String(params.side ?? "").toUpperCase() as "LONG" | "SHORT";
    if (side !== "LONG" && side !== "SHORT") throw new HttpError(400, "Side must be LONG or SHORT.");
    const entry = Number(params.entry);
    const stopLoss = Number(params.stopLoss);
    const takeProfit = Number(params.takeProfit);
    if (!Number.isFinite(entry) || entry <= 0) throw new HttpError(400, "Invalid entry price.");
    if (!Number.isFinite(stopLoss) || stopLoss <= 0) throw new HttpError(400, "Invalid stop loss.");
    if (!Number.isFinite(takeProfit) || takeProfit <= 0) throw new HttpError(400, "Invalid take profit.");
    if (side === "LONG" && (stopLoss >= entry || takeProfit <= entry)) {
      throw new HttpError(400, "LONG requires SL < entry < TP.");
    }
    if (side === "SHORT" && (stopLoss <= entry || takeProfit >= entry)) {
      throw new HttpError(400, "SHORT requires TP < entry < SL.");
    }

    const defaults = await this.deps.tradeDefaultsStore.load();
    return this.deps.buildBaselineUseCase.execute({
      pair,
      side,
      entry,
      stopLoss,
      takeProfit,
      leverage: parseOptionalPositiveNumber(params.leverage, "leverage") ?? defaults.leverage,
      positionSizeUsd: parseOptionalPositiveNumber(params.positionSizeUsd, "position size") ?? defaults.positionSizeUsd,
      objectiveHorizon: parseOptionalString(params.objectiveHorizon) ?? defaults.objectiveHorizon,
      intervalOverride: params.intervalOverride,
      openedAtMs: params.openedAtMs ? Number(params.openedAtMs) : undefined
    });
  }

  async evaluateMonitorTick(input: {
    baseline: TradeMonitorBaseline;
    currentAnalysisRecommendation?: Recommendation;
    previousSnapshot?: TradeMonitorSnapshot;
    refreshAnalysis: boolean;
    livePerpSnapshot?: PerpMarketSnapshot;
  }): Promise<{ snapshot: TradeMonitorSnapshot; analysisRecommendation: Recommendation }> {
    return this.deps.evaluateOpenTradeUseCase.execute(input);
  }
}

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

function parseOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const normalized = String(value).trim();
  return normalized ? normalized : undefined;
}

function parseOptionalPositiveNumber(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string" && value.trim() === "") {
    return undefined;
  }

  const parsed = typeof value === "number" ? value : Number(String(value));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new HttpError(400, `Invalid ${label}.`);
  }
  return parsed;
}
