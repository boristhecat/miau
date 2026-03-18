export interface MonitorSession {
  readonly id: string;
  readonly symbol: string;
  readonly side: "LONG" | "SHORT";
  readonly entry: number;
  readonly stopLoss: number | null;
  readonly takeProfit: number | null;
  readonly leverage: number | null;
  readonly positionSizeUsd: number | null;
  readonly objectiveHorizon: string | null;
  readonly createdAtMs: number;
}

export type MonitorSessionUpdate = Partial<Pick<MonitorSession, "entry" | "stopLoss" | "takeProfit" | "leverage" | "positionSizeUsd" | "objectiveHorizon">>;

export interface MonitorSessionStorePort {
  listActive(): Promise<readonly MonitorSession[]>;
  create(session: Omit<MonitorSession, "id" | "createdAtMs">): Promise<MonitorSession>;
  update(id: string, fields: MonitorSessionUpdate): Promise<MonitorSession>;
  remove(id: string): Promise<void>;
}
