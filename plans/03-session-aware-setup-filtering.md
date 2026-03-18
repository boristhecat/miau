# Plan 3: Session-Aware Setup Filtering

## What This Adds
The app currently detects sessions (ASIA/LONDON/US/DEAD) and flags transitions, but sessions don't **influence which setups are valid**. A breakout during Asia is usually a trap. The same breakout at London open is meaningful. This feature makes session context a first-class input to setup selection, entry readiness, and guard logic.

## Domain Concepts

### Session Behavior Profiles

**ASIA (00:00-08:00 UTC):**
- **Character**: Range building, accumulation, low volatility
- **Liquidity**: Thin — moves are often fakeouts
- **Valid setups**: RANGE_FADE, DIVERGENCE_REVERSAL (fading extremes back into range)
- **Risky setups**: BREAKOUT_CONTINUATION (most breakouts during Asia fail), TREND_PULLBACK_CONTINUATION on short timeframes
- **Key levels built**: Asia high and Asia low define the range that London will expand from

**LONDON (08:00-13:00 UTC):**
- **Character**: Expansion, fakeouts at open then directional move
- **Liquidity**: First major liquidity injection of the day
- **Typical pattern**: Sweep Asia high OR low in first 30min (stop hunt / fakeout), then expand in the opposite direction
- **Valid setups**: ALL — London is the highest-probability session for any setup type
- **Special behavior at open (08:00-08:30 UTC)**: The first 30 minutes are often a fakeout — a sweep of the Asia range extreme followed by reversal. BREAKOUT_CONTINUATION within this window should be treated with extra caution.
- **Key consideration**: Direction of the London expansion often sets the daily bias

**US (13:00-21:00 UTC):**
- **Character**: Volatility, real moves, continuation OR reversal of London
- **Liquidity**: Deepest liquidity window — execution is cleanest
- **Typical pattern**: If London established direction, US continues OR reverses at key levels
- **Valid setups**: ALL, but with awareness that:
  - Continuation of London move = higher probability
  - Reversal of London move at key levels = valid but needs stronger confirmation
- **NY Open (13:00-13:30 UTC)**: Similar fakeout window to London open — initial moves may reverse

**DEAD (21:00-00:00 UTC):**
- **Character**: Low volume, thin books, unpredictable
- **Liquidity**: Minimal — slippage risk high
- **Valid setups**: Generally avoid new entries. If entering, use RANGE_FADE only with tight sizing
- **Key risk**: Stop hunts with no follow-through due to thin books

### Session-Specific Biases

**Asia Range as Context:**
The Asia session high/low (already computed in `sessionLevels`) defines the day's initial range. London's job is to expand this range. The direction of expansion is a strong intraday bias signal.

**London Expansion Direction:**
Once London breaks and **accepts** beyond Asia high or low (closes beyond with follow-through), this becomes the day's directional bias. Trading against this bias for the rest of the day requires strong structural reason.

**NY Continuation/Reversal:**
NY either:
1. Continues London's direction (higher probability) — look for pullback entries
2. Reverses London at a key structural level — look for reversal setups with confirmation

## Implementation Plan

### Step 1: New Types in `src/domain/types.ts`

```typescript
export interface SessionContext {
  readonly currentSession: TradingSession;
  /** Minutes into the current session (0 = session just started) */
  readonly minutesIntoSession: number;
  /** True if within first 30 minutes of session open (fakeout window) */
  readonly isSessionOpenWindow: boolean;
  /** Asia range: set during and after Asia session */
  readonly asiaHigh?: number;
  readonly asiaLow?: number;
  /** Which side of the Asia range has been broken (set during London/US) */
  readonly asiaRangeBreak?: "ABOVE" | "BELOW" | "NONE";
  /** London expansion direction, if established */
  readonly londonExpansionDirection?: "BULLISH" | "BEARISH" | "NONE";
  /** Setup types that are high-probability in the current session context */
  readonly favoredSetups: readonly SetupPlaybook[];
  /** Setup types that are low-probability / risky in the current session context */
  readonly riskySetups: readonly SetupPlaybook[];
}
```

Add to `Recommendation`:
```typescript
readonly sessionContext?: SessionContext;
```

### Step 2: New Domain Module `src/domain/session-context-analyzer.ts`

```typescript
export function analyzeSessionContext(
  now: Date,
  sessionLevels: IndicatorSnapshot["sessionLevels"],
  dailyLevels: IndicatorSnapshot["dailyLevels"],
  lastPrice: number,
  indicators: IndicatorSnapshot
): SessionContext
```

**Logic:**

1. **Determine current session and time within it:**
   ```
   session = detectTradingSession(now)
   minutesIntoSession = compute from now and session boundary
   isSessionOpenWindow = minutesIntoSession < 30
   ```

2. **Determine Asia range:**
   - If current session is ASIA: asiaHigh = sessionLevels.currentHigh, asiaLow = sessionLevels.currentLow
   - If current session is LONDON/US: asiaHigh = sessionLevels.priorHigh, asiaLow = sessionLevels.priorLow (if prior session was ASIA)

3. **Determine Asia range break:**
   - If lastPrice > asiaHigh and candle closed above → "ABOVE"
   - If lastPrice < asiaLow and candle closed below → "BELOW"
   - Otherwise → "NONE"

4. **Determine London expansion:**
   - Only meaningful during US session or late London
   - If session is US and asiaRangeBreak is "ABOVE" → londonExpansionDirection = "BULLISH"
   - If session is US and asiaRangeBreak is "BELOW" → londonExpansionDirection = "BEARISH"

5. **Determine favored/risky setups per session:**

   ```
   ASIA:
     favored: ["RANGE_FADE", "DIVERGENCE_REVERSAL"]
     risky:   ["BREAKOUT_CONTINUATION"]

   LONDON (open window, first 30min):
     favored: ["RANGE_FADE", "DIVERGENCE_REVERSAL", "LIQUIDATION_REVERSAL"]
     risky:   ["BREAKOUT_CONTINUATION"]  // fakeout window

   LONDON (after 30min):
     favored: ALL
     risky:   []  // London is high-probability for everything

   US:
     favored: ALL
     risky:   []  // but trading against London expansion gets advisory

   DEAD:
     favored: ["RANGE_FADE"]
     risky:   ["BREAKOUT_CONTINUATION", "TREND_PULLBACK_CONTINUATION"]
   ```

### Step 3: Integrate into Recommendation Engine

In `recommendation-engine.ts`:
- Call `analyzeSessionContext` after computing indicators
- Pass the result through to guards and setup assessment

### Step 4: Consume in Trade Guards

In `recommendation-guards.ts`, add new guards:

**New soft advisory:**
- If detected setupPlaybook is in `sessionContext.riskySetups`:
  - Advisory: "Session context ({session}) makes {playbook} lower probability. {reason}."
  - Example: "Session context (ASIA) makes BREAKOUT_CONTINUATION lower probability. Asia breakouts often fail; wait for London."

**New soft advisory:**
- If signal direction opposes `londonExpansionDirection` during US session:
  - Advisory: "Trading against London expansion direction ({direction}). Requires stronger confirmation."

**New hard guard (DEAD session + weak setup):**
- If session is DEAD and setup grade < B:
  - Block: "DEAD session with sub-B setup; market is too thin for this trade."

### Step 5: Consume in Setup Assessor

In `recommendation-setup-assessor.ts`, in the regime factor:
- If playbook is in `sessionContext.favoredSetups` → regime score bonus (+5-10 out of 100)
- If playbook is in `sessionContext.riskySetups` → regime score penalty (-5-10)
- If `isSessionOpenWindow` and playbook is BREAKOUT_CONTINUATION → penalty (-10) with rationale "Session open fakeout window"

### Step 6: Consume in Entry Readiness

In `recommendation-entry-readiness-evaluator.ts`:
- If session is ASIA and playbook is BREAKOUT_CONTINUATION → override to WAIT_CONFIRMATION regardless of other factors, with rationale "Asia breakouts need London confirmation"
- If `isSessionOpenWindow` (London/US open) and entry readiness would be READY_NOW for a breakout → downgrade to WAIT_CONFIRMATION, with rationale "Session open window; wait for fakeout resolution"

### Step 7: Rationale Messages

Add session context to rationale:
- "Session: LONDON (12 min into session, open fakeout window active)"
- "Asia range: 64,100 - 64,450. Breakout above Asia high; London expansion bullish."
- "Setup BREAKOUT_CONTINUATION is risky during ASIA — breakouts in Asia are typically fakeouts."
- "Trading SHORT against London bullish expansion — requires extra confirmation."

### Step 8: Surface in Frontend

In analysis view:
- Session badge with timer: "LONDON (12m)" / "US (2h 15m)"
- If session open window: sub-badge "Fakeout window"
- Asia range display: "Asia 64,100 - 64,450"
- If London expansion established: "London ↑ Bullish"

In monitor view:
- Session badge (already partially exists)
- Alert when session transitions (especially ASIA → LONDON, where the real action starts)

## Relationship to Existing Code

**What already exists:**
- `detectTradingSession()` in `recommendation-market-context.ts` — returns ASIA/LONDON/US/DEAD
- `isSessionTransition()` — detects 15min boundary windows
- `sessionLevels` in indicators — currentOpen/High/Low, priorHigh/Low
- Tradeability evaluator flags `SESSION_DEAD_ZONE` and `SESSION_TRANSITION`

**What changes:**
- Session detection stays as-is; this feature adds **behavioral context** on top of the label
- Tradeability evaluator can use `SessionContext` for richer decisions instead of simple hour checks
- The existing session level computation provides the Asia high/low data needed

## What NOT to Do
- Don't hard-block all trades during ASIA — some setups (range fades) are valid
- Don't hard-block all breakouts during session opens — just flag them as risky and require higher grade
- Don't try to predict exact fakeout direction — just flag the window and downgrade breakout confidence
- Don't add complexity to the dead zone beyond a simple penalty — there's not enough data to be smart about it
