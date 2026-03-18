# Plan 9: Trade Journal Integration in Monitor Flow

## What This Adds
The learning system exists (SQLite outcomes, win-rate shrinkage, adaptive policy) but is disconnected from the monitor UI. When a monitored trade hits STOP_HIT or TARGET_HIT, nothing happens — the session just sits there as "stopped." This feature closes the loop: **trade ends → outcome recorded → learning store updated → next analysis benefits**.

## Domain Concepts

### The Learning Loop
```
Analyze → Enter Trade → Monitor → Trade Ends → Record Outcome → Learn → Better Analysis
                                                    ↑                           |
                                                    └───────────────────────────┘
```

Currently, the loop is broken at "Record Outcome." The simulation evaluator (`simulation-evaluator.ts`) can evaluate paper trades against historical candles, but the UI monitor doesn't trigger it and doesn't capture trader intent/reflection.

### What an Outcome Record Needs

**From the system (auto-captured):**
- Trade parameters: symbol, side, entry, SL, TP, leverage, position size
- Entry time, exit time, duration
- Exit price, PnL %, PnL USD
- MFE and MAE (max favorable/adverse excursion) — already tracked in monitor
- Setup grade, playbook, market regime, confidence at entry (from baseline)
- Health status history: how many degrading ticks, did it go BROKEN?
- Management action that triggered the exit (STOP_HIT, TARGET_HIT, EXIT_EARLY)

**From the trader (manually input at close):**
- **Outcome classification**: Did the trade play out as expected?
  - `AS_PLANNED` — TP hit, thesis was correct
  - `STOPPED_OUT` — SL hit, thesis invalidated
  - `EARLY_EXIT_PROFIT` — Exited before TP with profit (manual decision or EXIT_EARLY with profit)
  - `EARLY_EXIT_LOSS` — Exited before SL with loss (manual decision or EXIT_EARLY)
  - `BREAKEVEN` — Exited at or near entry
- **Failure classification** (if loss): What went wrong?
  - `WRONG_DIRECTION` — completely wrong read
  - `STOP_TOO_TIGHT` — right direction but stopped out, then went to TP
  - `BAD_TIMING` — right direction, right level, but entered too early/late
  - `SESSION_FAKEOUT` — got caught in a session open fakeout
  - `FUNDING_DRAIN` — funding cost ate the edge
  - `EXTERNAL_EVENT` — news/event outside technical analysis
  - `NONE` — no failure (win)
- **Notes** (optional): Free-text for the trader to capture what they learned
- **Rating** (optional): 1-5 self-assessment of trade execution quality (separate from outcome)

### What the System Does with the Outcome

1. **Stores in learning store**: Creates a learning outcome record in SQLite (extends existing `learning.sqlite` schema)
2. **Updates adaptive policy**: The win-rate shrinkage blend gets a new data point for the relevant bucket (symbol, regime, playbook, setup grade)
3. **Enriches future analysis**: Next time the same setup/regime/symbol is analyzed, the system can show: "Last 5 trades with this setup: 3W/2L, avg PnL +0.8%, common failure: STOP_TOO_TIGHT"

### Monitor Session Lifecycle (Updated)

```
ACTIVE → STOP_HIT/TARGET_HIT/MANUALLY_STOPPED
       → Journal modal opens (auto-populated with trade data)
       → Trader fills in outcome/failure/notes
       → Submit → learning store updated
       → Session marked "journaled"
       → Can view in trade history
```

## Implementation Plan

### Step 1: New Types in `src/domain/types.ts`

```typescript
export type TradeOutcomeClassification =
  | "AS_PLANNED"
  | "STOPPED_OUT"
  | "EARLY_EXIT_PROFIT"
  | "EARLY_EXIT_LOSS"
  | "BREAKEVEN";

export type TradeFailureReason =
  | "WRONG_DIRECTION"
  | "STOP_TOO_TIGHT"
  | "BAD_TIMING"
  | "SESSION_FAKEOUT"
  | "FUNDING_DRAIN"
  | "EXTERNAL_EVENT"
  | "NONE";

export interface TradeJournalEntry {
  /** Auto-generated unique ID */
  readonly id: string;
  /** Reference to monitor session ID */
  readonly sessionId: string;
  /** Trade parameters */
  readonly symbol: string;
  readonly side: "LONG" | "SHORT";
  readonly entry: number;
  readonly stopLoss: number;
  readonly takeProfit: number;
  readonly leverage?: number;
  readonly positionSizeUsd?: number;
  /** Timing */
  readonly openedAtMs: number;
  readonly closedAtMs: number;
  readonly durationMinutes: number;
  /** Result */
  readonly exitPrice: number;
  readonly pnlPct: number;
  readonly pnlUsd?: number;
  readonly maxFavorableExcursionPct: number;
  readonly maxAdverseExcursionPct: number;
  /** Analysis context at entry */
  readonly setupGrade: SetupGrade;
  readonly setupPlaybook?: SetupPlaybook;
  readonly marketRegime: MarketRegime;
  readonly confidence: number;
  readonly analysisInterval: string;
  /** How the trade ended */
  readonly managementAction: TradeManagementAction;
  readonly consecutiveDegradingTicks: number;
  /** Trader input */
  readonly outcomeClassification: TradeOutcomeClassification;
  readonly failureReason: TradeFailureReason;
  readonly notes?: string;
  readonly executionRating?: number; // 1-5
}
```

### Step 2: Extend SQLite Schema

In `src/adapters/persistence/sqlite-learning-store.ts` or a new `trade-journal-store.ts`:

```sql
CREATE TABLE IF NOT EXISTS trade_journal (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  entry REAL NOT NULL,
  stop_loss REAL NOT NULL,
  take_profit REAL NOT NULL,
  leverage REAL,
  position_size_usd REAL,
  opened_at_ms INTEGER NOT NULL,
  closed_at_ms INTEGER NOT NULL,
  duration_minutes REAL NOT NULL,
  exit_price REAL NOT NULL,
  pnl_pct REAL NOT NULL,
  pnl_usd REAL,
  mfe_pct REAL NOT NULL,
  mae_pct REAL NOT NULL,
  setup_grade TEXT NOT NULL,
  setup_playbook TEXT,
  market_regime TEXT NOT NULL,
  confidence INTEGER NOT NULL,
  analysis_interval TEXT NOT NULL,
  management_action TEXT NOT NULL,
  consecutive_degrading_ticks INTEGER NOT NULL DEFAULT 0,
  outcome_classification TEXT NOT NULL,
  failure_reason TEXT NOT NULL DEFAULT 'NONE',
  notes TEXT,
  execution_rating INTEGER,
  created_at_ms INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_journal_symbol ON trade_journal(symbol);
CREATE INDEX IF NOT EXISTS idx_journal_playbook ON trade_journal(setup_playbook);
CREATE INDEX IF NOT EXISTS idx_journal_regime ON trade_journal(market_regime);
CREATE INDEX IF NOT EXISTS idx_journal_grade ON trade_journal(setup_grade);
CREATE INDEX IF NOT EXISTS idx_journal_created ON trade_journal(created_at_ms);
```

### Step 3: Port Interface

New port in `src/ports/trade-journal-store-port.ts`:

```typescript
export interface TradeJournalStorePort {
  save(entry: TradeJournalEntry): void;
  getBySessionId(sessionId: string): TradeJournalEntry | undefined;
  getRecent(limit: number): readonly TradeJournalEntry[];
  getBySymbol(symbol: string, limit: number): readonly TradeJournalEntry[];
  getSimilarTrades(criteria: {
    setupPlaybook?: SetupPlaybook;
    marketRegime?: MarketRegime;
    setupGrade?: SetupGrade;
    symbol?: string;
    limit?: number;
  }): readonly TradeJournalEntry[];
  getStats(lookbackDays?: number): TradeJournalStats;
}

export interface TradeJournalStats {
  readonly totalTrades: number;
  readonly wins: number;
  readonly losses: number;
  readonly winRate: number;
  readonly avgPnlPct: number;
  readonly avgWinPct: number;
  readonly avgLossPct: number;
  readonly avgDurationMinutes: number;
  readonly mostCommonFailure: TradeFailureReason;
  readonly bestPlaybook?: { playbook: SetupPlaybook; winRate: number; count: number };
  readonly worstPlaybook?: { playbook: SetupPlaybook; winRate: number; count: number };
}
```

### Step 4: SQLite Adapter Implementation

New file `src/adapters/persistence/sqlite-trade-journal-store.ts`:
- Implements `TradeJournalStorePort`
- Uses the existing `better-sqlite3` database from `learning.sqlite`
- Standard CRUD + aggregation queries
- `getSimilarTrades` does filtered lookups for the "similar trades" feature

### Step 5: New API Endpoints

In `src/adapters/web/web-api-handler.ts`:

```
POST /api/journal          — Save a journal entry
GET  /api/journal          — Get recent journal entries (query: limit, symbol)
GET  /api/journal/stats    — Get aggregated stats (query: lookbackDays)
GET  /api/journal/similar  — Get similar past trades (query: playbook, regime, grade, symbol)
```

### Step 6: Wire into Monitor Termination

In `web-api-handler.ts`, when a monitor session ends (STOP_HIT, TARGET_HIT, or manual stop):
- The SSE stream already sends the terminal snapshot
- Add a field to the terminal snapshot: `journalPrompt: true` — tells the frontend to show the journal modal
- Auto-populate the journal entry with system-known fields from the baseline + final snapshot

### Step 7: Frontend — Journal Modal

In `monitor.js`, when a trade reaches a terminal state:

1. **Show journal modal** (overlay on the monitor card):
   - Auto-populated fields (read-only, displayed for context):
     - Symbol, side, entry, SL, TP, leverage, size
     - Exit price, PnL %, PnL USD, duration
     - MFE, MAE
     - Setup grade, playbook, regime, confidence
   - **Trader input fields:**
     - Outcome classification: dropdown (AS_PLANNED, STOPPED_OUT, EARLY_EXIT_PROFIT, EARLY_EXIT_LOSS, BREAKEVEN)
     - Failure reason: dropdown (only enabled if outcome is a loss)
     - Notes: textarea
     - Execution rating: 1-5 stars/buttons
   - **Auto-suggest outcome**: If managementAction was TARGET_HIT → pre-select AS_PLANNED. If STOP_HIT → pre-select STOPPED_OUT. If EXIT_EARLY → pre-select based on PnL sign.
   - **Submit** button → POST /api/journal
   - **Skip** button → dismiss without journaling (trade still recorded as "unjournaled")

2. **After submit:**
   - Show confirmation: "Trade journaled. Win rate for {playbook} in {regime}: {rate}%"
   - Update session status to "journaled"
   - If similar trades exist, show brief summary: "Similar trades: 5W/3L (62.5%)"

### Step 8: Feed into Learning System

When a journal entry is saved, also create a learning outcome record (same format as the existing learning system uses):
- Map `TradeJournalEntry` → `SimulationOutcome` equivalent:
  - `AS_PLANNED` / `EARLY_EXIT_PROFIT` → `SUCCESS`
  - `STOPPED_OUT` / `EARLY_EXIT_LOSS` → `FAILURE` with appropriate `SimulationFailureType`
  - `BREAKEVEN` → `SUCCESS` (didn't lose money)
- Call existing learning store's save method
- The adaptive policy service (`learning-policy-service.ts`) will pick up the new data on next analysis

### Step 9: Similar Trades in Analysis View

When generating a recommendation, if journal data exists:
- Query `getSimilarTrades({ setupPlaybook, marketRegime, setupGrade })` — limit 20
- If >= 5 similar trades exist:
  - Compute win rate from journal data
  - Add to rationale: "Historical similar trades ({playbook} in {regime}, grade {grade}): {wins}W/{losses}L ({winRate}%)"
  - If common failure reason: "Most common failure: {reason} ({count}/{total})"
- Add to Recommendation:

```typescript
readonly journalInsight?: {
  readonly similarTradeCount: number;
  readonly winRate: number;
  readonly avgPnlPct: number;
  readonly mostCommonFailure?: TradeFailureReason;
};
```

### Step 10: Trade History View in Frontend

New tab or section in the UI (or extend existing scanner/monitor view):

**Trade Log:**
- Table of recent journal entries, newest first
- Columns: Date, Symbol, Side, PnL%, Duration, Grade, Playbook, Regime, Outcome, Failure
- Color-coded rows: green for wins, red for losses
- Click to expand: full details + notes

**Stats Dashboard (simple):**
- Overall: {total} trades, {winRate}% win rate, avg PnL {avgPnl}%
- By playbook: breakdown table
- By regime: breakdown table
- Most common failure reason
- Best/worst performing setup type

### Step 11: DI Wiring

In `src/web.ts`:
- Create `SqliteTradeJournalStore` with the existing database connection
- Pass to web API handler
- Optionally pass to the recommendation use case for journal insight queries

## Data Flow Summary

```
Monitor SSE → Terminal event (STOP_HIT/TARGET_HIT/EXIT_EARLY)
  → Frontend shows journal modal (auto-populated)
  → Trader fills outcome/failure/notes
  → POST /api/journal
  → SQLite trade_journal table
  → Also feeds learning store (existing adaptive policy)
  → Next analysis queries journal for similar trade insights
  → Recommendation includes journal insight in rationale
```

## What NOT to Do
- Don't make journaling mandatory — traders hate friction. "Skip" must be prominent.
- Don't auto-close the journal modal — let the trader review at their own pace
- Don't try to auto-detect failure reason — the trader's self-assessment is more valuable than any heuristic
- Don't show too many historical stats in the analysis view — one line in rationale is enough. The stats dashboard is for separate review.
- Don't block the monitor from removing/restarting while journal modal is open — the modal can be independent
- Don't duplicate the simulation evaluator logic — the journal entry IS the outcome; no need to re-simulate
- Don't store full recommendation snapshots in the journal — they're huge. Store the key fields (grade, playbook, regime, confidence) and reference the session ID for baseline lookup if needed.
