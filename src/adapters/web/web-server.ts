import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { WebApiHandler, HttpError } from "./web-api-handler.js";
import type { WebApiDeps } from "./web-api-handler.js";
import type { TradeMonitorBaseline, TradeMonitorSnapshot } from "../../domain/trade-monitor-types.js";
import type { Recommendation } from "../../domain/types.js";
import { clamp } from "../../domain/interval-utils.js";
import { parseIntervalToMinutes } from "../../domain/interval-utils.js";
import type { LiveMarketDataPort, LivePerpStream } from "../../ports/live-market-data-port.js";
import type { LearningLoopService } from "../../application/learning-loop-service.js";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

export class WebServer {
  private readonly handler: WebApiHandler;
  private readonly server: http.Server;
  private readonly staticDir: string;
  private readonly liveMarketData: LiveMarketDataPort;
  private readonly learningLoop: LearningLoopService | undefined;
  private readonly reloadClients: Set<http.ServerResponse> = new Set();
  private fileWatcher: fs.FSWatcher | undefined;

  constructor(deps: WebApiDeps & { liveMarketData: LiveMarketDataPort; learningLoop?: LearningLoopService }) {
    this.handler = new WebApiHandler(deps);
    this.liveMarketData = deps.liveMarketData;
    this.learningLoop = deps.learningLoop;
    this.staticDir = path.join(process.cwd(), "src/adapters/web/static");
    this.server = http.createServer((req, res) => void this.handleRequest(req, res));
    this.watchStaticDir();
  }

  async start(port: number): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(port, () => {
        console.log(`\n  miau trader UI running at http://localhost:${port}\n`);
        resolve();
      });
    });
  }

  close(): void {
    this.fileWatcher?.close();
    for (const client of this.reloadClients) {
      client.end();
    }
    this.reloadClients.clear();
    this.server.close();
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const method = req.method ?? "GET";

    try {
      if (url.pathname.startsWith("/api/")) {
        await this.handleApiRoute(method, url, req, res);
      } else {
        this.serveStatic(url.pathname, res);
      }
    } catch (err) {
      const statusCode = err instanceof HttpError ? err.statusCode : 500;
      const message = err instanceof Error ? err.message : "Internal Server Error";
      this.sendJson(res, statusCode, { error: message });
    }
  }

  private async handleApiRoute(
    method: string,
    url: URL,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const pathname = url.pathname;
    const query = Object.fromEntries(url.searchParams.entries());

    if (method === "POST" && pathname === "/api/analyze") {
      const body = await readJsonBody(req);
      const result = await this.handler.handleAnalyze(body);
      this.sendJson(res, 200, result);
      return;
    }

    if (method === "GET" && pathname === "/api/scan") {
      const result = await this.handler.handleScan(query);
      this.sendJson(res, 200, result);
      return;
    }

    if (method === "GET" && pathname === "/api/learning/stats") {
      const result = await this.handler.handleLearningStats(query);
      this.sendJson(res, 200, result);
      return;
    }

    if (method === "GET" && pathname === "/api/learning/activity") {
      const activity = this.learningLoop?.getActivity() ?? { slots: [], recentEvents: [] };
      this.sendJson(res, 200, activity);
      return;
    }

    if (method === "GET" && pathname === "/api/defaults") {
      const result = await this.handler.handleGetDefaults();
      this.sendJson(res, 200, result);
      return;
    }

    if (method === "PUT" && pathname === "/api/defaults") {
      const body = await readJsonBody(req);
      const result = await this.handler.handleSaveDefaults(body);
      this.sendJson(res, 200, result);
      return;
    }

    if (method === "GET" && pathname === "/api/monitor/sessions") {
      const result = await this.handler.handleListMonitorSessions();
      this.sendJson(res, 200, result);
      return;
    }

    if (method === "POST" && pathname === "/api/monitor/sessions") {
      const body = await readJsonBody(req);
      const result = await this.handler.handleCreateMonitorSession(body);
      this.sendJson(res, 200, result);
      return;
    }

    if (method === "PATCH" && pathname.startsWith("/api/monitor/sessions/")) {
      const id = pathname.slice("/api/monitor/sessions/".length);
      const body = await readJsonBody(req);
      const result = await this.handler.handleUpdateMonitorSession(id, body);
      this.sendJson(res, 200, result);
      return;
    }

    if (method === "DELETE" && pathname.startsWith("/api/monitor/sessions/")) {
      const id = pathname.slice("/api/monitor/sessions/".length);
      await this.handler.handleRemoveMonitorSession(id);
      this.sendJson(res, 200, { ok: true });
      return;
    }

    if (method === "GET" && pathname === "/api/monitor/stream") {
      await this.handleMonitorStream(query, req, res);
      return;
    }

    // Plan 9: Trade Journal endpoints
    if (method === "POST" && pathname === "/api/journal") {
      const body = await readJsonBody(req);
      const result = await this.handler.handleSaveJournalEntry(body);
      this.sendJson(res, 200, result);
      return;
    }

    if (method === "GET" && pathname === "/api/journal") {
      const result = await this.handler.handleGetJournalEntries(query);
      this.sendJson(res, 200, result);
      return;
    }

    if (method === "GET" && pathname === "/api/journal/stats") {
      const result = await this.handler.handleGetJournalStats(query);
      this.sendJson(res, 200, result);
      return;
    }

    if (method === "GET" && pathname === "/api/journal/similar") {
      const result = await this.handler.handleGetSimilarTrades(query);
      this.sendJson(res, 200, result);
      return;
    }

    if (method === "GET" && pathname === "/api/__reload") {
      this.handleReloadStream(req, res);
      return;
    }

    this.sendJson(res, 404, { error: "Not found" });
  }

  private async handleMonitorStream(
    params: Record<string, string>,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const baseline = await this.handler.buildMonitorBaseline(params);
    let liveStream: LivePerpStream | undefined;
    try {
      liveStream = await this.liveMarketData.openPerpStream({
        pair: baseline.trade.pair,
        initialSnapshot: baseline.baselineRecommendation.perp
      });
    } catch {
      // Fall back to snapshot polling if the live stream cannot be established.
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });

    const sendEvent = (event: string, data: unknown): void => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    sendEvent("baseline", {
      trade: baseline.trade,
      baselinePlaybook: baseline.baselinePlaybook,
      baselineMarketRegime: baseline.baselineMarketRegime
    });

    const refreshMs = Math.max(500, Math.round((Number(params.refreshSeconds) || 1) * 1000));
    const slowRefreshMs = this.deriveSlowRefreshMs(
      params.slowRefreshSeconds ? Number(params.slowRefreshSeconds) : undefined,
      baseline.trade.analysisInterval
    );

    let currentAnalysisRecommendation: Recommendation | undefined = baseline.baselineRecommendation;
    let previousSnapshot: TradeMonitorSnapshot | undefined;
    let stopped = false;
    let tickInterval: NodeJS.Timeout | undefined;

    const cleanup = (): void => {
      stopped = true;
      if (tickInterval) {
        clearInterval(tickInterval);
        tickInterval = undefined;
      }
      liveStream?.close();
    };
    req.on("close", cleanup);

    const tick = async (): Promise<void> => {
      if (stopped) return;
      const refreshAnalysis =
        previousSnapshot === undefined ||
        Date.now() - previousSnapshot.analysisUpdatedAtMs >= slowRefreshMs;
      try {
        const result = await this.handler.evaluateMonitorTick({
          baseline,
          currentAnalysisRecommendation,
          previousSnapshot,
          refreshAnalysis,
          livePerpSnapshot: this.getLiveSnapshot(liveStream)
        });
        currentAnalysisRecommendation = result.analysisRecommendation;
        previousSnapshot = result.snapshot;
        sendEvent("snapshot", result.snapshot);
      } catch (err) {
        sendEvent("error", { error: err instanceof Error ? err.message : String(err) });
      }
    };

    await tick();
    tickInterval = setInterval(() => void tick(), refreshMs);
  }

  private deriveSlowRefreshMs(explicitSeconds: number | undefined, analysisInterval: string): number {
    if (explicitSeconds !== undefined && Number.isFinite(explicitSeconds)) {
      return Math.round(clamp(explicitSeconds, 3, 30) * 1000);
    }
    const candleSeconds = parseIntervalToMinutes(analysisInterval) * 60;
    const derivedSeconds = clamp(candleSeconds * 0.8, 3, 30);
    return Math.round(derivedSeconds * 1000);
  }

  private watchStaticDir(): void {
    let debounce: NodeJS.Timeout | undefined;
    try {
      this.fileWatcher = fs.watch(this.staticDir, { recursive: true }, () => {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => {
          for (const client of this.reloadClients) {
            client.write("data: reload\n\n");
          }
        }, 150);
      });
    } catch {
      // fs.watch may not support recursive on all platforms — silently skip
    }
  }

  private handleReloadStream(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });
    res.write(":\n\n");
    this.reloadClients.add(res);
    req.on("close", () => {
      this.reloadClients.delete(res);
    });
  }

  private serveStatic(pathname: string, res: http.ServerResponse): void {
    if (pathname === "/") pathname = "/index.html";
    const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
    const filePath = path.join(this.staticDir, safePath);

    if (!filePath.startsWith(this.staticDir)) {
      this.sendJson(res, 403, { error: "Forbidden" });
      return;
    }

    try {
      const content = fs.readFileSync(filePath);
      const ext = path.extname(filePath);
      const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
      res.writeHead(200, { "Content-Type": contentType });
      res.end(content);
    } catch {
      this.sendJson(res, 404, { error: "Not found" });
    }
  }

  private sendJson(res: http.ServerResponse, statusCode: number, data: unknown): void {
    res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(data));
  }

  private getLiveSnapshot(liveStream: LivePerpStream | undefined) {
    return liveStream?.getLatestSnapshot();
  }
}

function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new HttpError(400, "Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}
