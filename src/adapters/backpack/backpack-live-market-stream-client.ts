import type { PerpMarketSnapshot } from "../../domain/types.js";
import type { LiveMarketDataPort, LivePerpStream } from "../../ports/live-market-data-port.js";
import type { MarketDataPort } from "../../ports/market-data-port.js";

interface MessageEventLike {
  data?: string;
}

interface WebSocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open" | "message" | "close" | "error", listener: (event: unknown) => void): void;
  removeEventListener(type: "open" | "message" | "close" | "error", listener: (event: unknown) => void): void;
}

type WebSocketFactory = (url: string) => WebSocketLike;

const LIVE_STREAMS = (symbol: string) => [`bookTicker.${symbol}`, `markPrice.${symbol}`, `openInterest.${symbol}`] as const;

export class BackpackLiveMarketStreamClient implements LiveMarketDataPort {
  constructor(
    private readonly marketData: MarketDataPort,
    private readonly webSocketFactory: WebSocketFactory = createDefaultWebSocket,
    private readonly wsUrl = "wss://ws.backpack.exchange"
  ) {}

  async openPerpStream(input: {
    pair: string;
    initialSnapshot?: PerpMarketSnapshot;
  }): Promise<LivePerpStream> {
    const bootstrap = input.initialSnapshot ?? (await this.marketData.getPerpSnapshot({ pair: input.pair }));
    return new BackpackPerpStream({
      symbol: bootstrap.symbol,
      bootstrap,
      webSocketFactory: this.webSocketFactory,
      wsUrl: this.wsUrl
    });
  }
}

class BackpackPerpStream implements LivePerpStream {
  private latestSnapshot: PerpMarketSnapshot;
  private socket: WebSocketLike | undefined;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private manuallyClosed = false;
  private backoffMs = 1_000;
  private readonly waiters = new Set<{
    resolve: (snapshot: PerpMarketSnapshot) => void;
    reject: (error: Error) => void;
    timer?: NodeJS.Timeout;
  }>();

  constructor(
    private readonly deps: {
      symbol: string;
      bootstrap: PerpMarketSnapshot;
      webSocketFactory: WebSocketFactory;
      wsUrl: string;
    }
  ) {
    this.latestSnapshot = deps.bootstrap;
    this.connect();
  }

  getLatestSnapshot(): PerpMarketSnapshot | undefined {
    return this.latestSnapshot;
  }

  waitForSnapshot(timeoutMs = 5_000): Promise<PerpMarketSnapshot> {
    if (this.latestSnapshot) {
      return Promise.resolve(this.latestSnapshot);
    }

    return new Promise<PerpMarketSnapshot>((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        timer:
          timeoutMs > 0
            ? setTimeout(() => {
                this.waiters.delete(waiter);
                reject(new Error("Timed out waiting for live Backpack market snapshot."));
              }, timeoutMs)
            : undefined
      };
      this.waiters.add(waiter);
    });
  }

  close(): void {
    this.manuallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.socket?.close();
    this.socket = undefined;
    for (const waiter of this.waiters) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.resolve(this.latestSnapshot);
    }
    this.waiters.clear();
  }

  private connect(): void {
    const socket = this.deps.webSocketFactory(this.deps.wsUrl);
    this.socket = socket;

    const onOpen = (): void => {
      this.backoffMs = 1_000;
      socket.send(
        JSON.stringify({
          method: "SUBSCRIBE",
          params: [...LIVE_STREAMS(this.deps.symbol)]
        })
      );
      this.resolveWaiters();
    };

    const onMessage = (event: unknown): void => {
      const payload = parseStreamEnvelope(event);
      if (!payload) {
        return;
      }
      const next = applyStreamUpdate(this.latestSnapshot, payload.stream, payload.data);
      if (!next) {
        return;
      }
      this.latestSnapshot = next;
      this.resolveWaiters();
    };

    const onCloseOrError = (): void => {
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("close", onCloseOrError);
      socket.removeEventListener("error", onCloseOrError);
      if (this.manuallyClosed) {
        return;
      }
      this.scheduleReconnect();
    };

    socket.addEventListener("open", onOpen);
    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", onCloseOrError);
    socket.addEventListener("error", onCloseOrError);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.manuallyClosed) {
      return;
    }
    const delayMs = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, 10_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (!this.manuallyClosed) {
        this.connect();
      }
    }, delayMs);
  }

  private resolveWaiters(): void {
    for (const waiter of this.waiters) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.resolve(this.latestSnapshot);
    }
    this.waiters.clear();
  }
}

function createDefaultWebSocket(url: string): WebSocketLike {
  const WebSocketCtor = (globalThis as unknown as { WebSocket?: new (url: string) => WebSocketLike }).WebSocket;
  if (!WebSocketCtor) {
    throw new Error("Global WebSocket client is not available in this runtime.");
  }
  return new WebSocketCtor(url);
}

function parseStreamEnvelope(event: unknown): { stream: string; data: Record<string, unknown> } | null {
  const rawData =
    typeof event === "object" && event !== null && "data" in event
      ? (event as MessageEventLike).data
      : undefined;
  if (typeof rawData !== "string" || rawData.trim() === "") {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawData);
  } catch {
    return null;
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("stream" in parsed) ||
    !("data" in parsed) ||
    typeof (parsed as { stream?: unknown }).stream !== "string" ||
    typeof (parsed as { data?: unknown }).data !== "object" ||
    (parsed as { data?: unknown }).data === null
  ) {
    return null;
  }

  return {
    stream: (parsed as { stream: string }).stream,
    data: (parsed as { data: Record<string, unknown> }).data
  };
}

function applyStreamUpdate(
  current: PerpMarketSnapshot,
  stream: string,
  data: Record<string, unknown>
): PerpMarketSnapshot | null {
  if (stream.startsWith("bookTicker.")) {
    const ask = toNumber(data.a);
    const askQty = toNumber(data.A);
    const bid = toNumber(data.b);
    const bidQty = toNumber(data.B);
    if (ask === undefined || askQty === undefined || bid === undefined || bidQty === undefined) {
      return null;
    }
    const mid = (ask + bid) / 2;
    const spreadPct = mid > 0 ? ((ask - bid) / mid) * 100 : current.bidAskSpreadPct;
    const depthSum = bidQty + askQty;
    const orderBookImbalance =
      depthSum > 0 ? (bidQty - askQty) / depthSum : current.orderBookImbalance;
    const microPrice =
      depthSum > 0 ? (ask * bidQty + bid * askQty) / depthSum : mid;
    const microPricePremiumPct =
      mid > 0 ? ((microPrice - mid) / mid) * 100 : current.microPricePremiumPct;
    return {
      ...current,
      bidAskSpreadPct: spreadPct === undefined ? undefined : round(spreadPct),
      orderBookImbalance: orderBookImbalance === undefined ? undefined : round(orderBookImbalance),
      microPricePremiumPct: microPricePremiumPct === undefined ? undefined : round(microPricePremiumPct)
    };
  }

  if (stream.startsWith("markPrice.")) {
    const markPrice = toNumber(data.p);
    const fundingRate = toNumber(data.f);
    const indexPrice = toNumber(data.i);
    if (markPrice === undefined) {
      return null;
    }
    const resolvedIndex = indexPrice ?? current.indexPrice;
    const premiumPct = resolvedIndex === 0 ? current.premiumPct : ((markPrice - resolvedIndex) / resolvedIndex) * 100;
    return {
      ...current,
      markPrice: round(markPrice),
      fundingRate: fundingRate === undefined ? current.fundingRate : round(fundingRate),
      indexPrice: round(resolvedIndex),
      premiumPct: round(premiumPct)
    };
  }

  if (stream.startsWith("openInterest.")) {
    const openInterest = toNumber(data.o);
    if (openInterest === undefined) {
      return null;
    }
    return {
      ...current,
      openInterest: round(openInterest)
    };
  }

  return null;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function round(value: number): number {
  return Number(value.toFixed(8));
}
