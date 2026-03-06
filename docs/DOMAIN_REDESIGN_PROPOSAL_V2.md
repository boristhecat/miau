# Domain Redesign Proposal V2 for Intraday Crypto Recommendations

Date: 2026-03-06
Status: Merged draft after peer review
Scope: Domain analysis only. No code changes are proposed in this document.

## Purpose

This document merges the original redesign proposal with the appended peer review in `docs/DOMAIN_REDESIGN_PROPOSAL.md`.

It preserves the original diagnosis while tightening the design into something that is:

- more realistic for the current CLI constraints
- clearer about what should be preserved from the current engine
- more explicit about what belongs in Phase 1 versus later phases
- concrete enough to peer review for implementation planning

This `v2` should be treated as the implementation-facing proposal. The original document remains the historical review artifact.

## Executive Summary

The current engine is still best understood as a guarded indicator-confluence system. That is not useless, but it is not robust enough for short-horizon crypto decision support when used too literally.

The main problem is not that the engine lacks indicators. The problem is that it still compresses too many distinct trading questions into one path:

1. Is this market tradeable at all right now?
2. If tradeable, which side has edge?
3. Is there an entry now, or only a setup worth watching?
4. Is the expected execution quality good enough to justify the trade?

The redesign should therefore prioritize separation of concerns over adding more signals.

The peer review was directionally correct: the original proposal described a good target architecture, but it was too broad for a REST-first CLI. This `v2` keeps the strategic direction but narrows the near-term design aggressively.

## What Changes from V1

Compared with the original proposal, this `v2` makes six important changes:

1. It treats the original 7-layer architecture as a long-term target, not a Phase 1 implementation contract.
2. It explicitly preserves the current guard system and adaptive learning as foundations to refactor, not systems to discard.
3. It splits proposed features by data-source feasibility:
   - achievable with current REST data
   - achievable after adding Backpack public WebSocket streams
   - requiring new external data sources
4. It narrows Phase 1 to a practical set of changes for the current tool.
5. It defines one fully worked example setup family.
6. It clarifies that RSI level should be demoted while RSI divergence may remain useful.

## Current Engine: What Should Be Preserved

The current engine already contains meaningful strengths and should not be described as if it were a trivial toy.

Preserve these foundations:

- the guard-heavy `NO_TRADE` culture
- session-aware thresholds
- BTC context for alt decisions
- higher-timeframe contradiction checks
- setup-quality decomposition
- adaptive learning with shrinkage-based fallback

Relevant current files:

- `src/domain/recommendation-signal-evaluator.ts`
- `src/domain/recommendation-guards.ts`
- `src/domain/recommendation-setup-assessor.ts`
- `src/application/learning-policy-service.ts`

The redesign should evolve these capabilities into cleaner domain objects rather than replacing them wholesale.

## Core Diagnosis

The original diagnosis still stands:

- the engine relies too heavily on overlapping price-derived indicators
- it enters too readily at current price
- it does not cleanly separate setup existence from entry readiness
- execution quality is modeled too weakly
- confidence is used too much like probability

Where the peer review improved the argument is in implementation realism:

- some proposed features depend on streaming state and do not belong in Phase 1
- setup families need concrete specification, not just naming
- Phase 1 needs sub-phasing or it will become an uncontrolled rewrite

## Recommended Target Architecture

## Long-Term Target

The long-term target can still be expressed as:

1. `MarketState`
2. `TradeabilityGate`
3. `SetupClassifier`
4. `TriggerEngine`
5. `ExecutionRiskFilter`
6. `InvalidationAndExitPlanner`
7. `EmpiricalReliabilityLayer`

This is still the correct conceptual model.

## Phase 1 Target

For the current REST-first CLI, Phase 1 should be collapsed into four practical layers:

1. `MarketStateAndTradeability`
2. `DirectionalAndSetupClassification`
3. `EntryReadinessAssessment`
4. `ReliabilityAndRecommendationOutput`

This is the key merge from the peer review.

### 1. MarketStateAndTradeability

Responsibilities:

- summarize regime
- summarize basic liquidity quality
- summarize participation quality
- determine whether fresh trades should be allowed at all

This layer absorbs much of the current guard logic but moves it earlier in the decision path.

### 2. DirectionalAndSetupClassification

Responsibilities:

- determine whether the engine sees a directional bias
- determine which setup family, if any, is currently present

This layer should not yet decide that a trade is live. It only decides whether a meaningful setup exists.

### 3. EntryReadinessAssessment

Responsibilities:

- determine whether the setup is:
  - only worth watching
  - ready only on pullback
  - ready only on breakout confirmation
  - currently invalid for fresh entry

For Phase 1 this should be a snapshot-based readiness layer, not a persistent state machine.

Important constraint:

- `WATCH`, `WAIT_PULLBACK`, and `BREAKOUT_ARMED` should be understood as disposition outputs from a snapshot query
- they do not need to be modeled as continuously transitioning states until WebSocket state exists

### 4. ReliabilityAndRecommendationOutput

Responsibilities:

- separate directional conviction from setup quality
- separate setup quality from expected execution quality
- stop presenting confidence as if it were a win-rate estimate
- emit more actionable recommendation output

## Proposed Output Model

The output contract should move away from raw `LONG` / `SHORT` / `NO_TRADE` as the only decision object.

For Phase 1, recommended output states:

- `NO_TRADE`
- `WATCH`
- `WAIT_PULLBACK_LONG`
- `WAIT_PULLBACK_SHORT`
- `BREAKOUT_READY_LONG`
- `BREAKOUT_READY_SHORT`
- `LONG_NOW`
- `SHORT_NOW`
- `EXIT_ONLY`

These are snapshot-friendly outputs. They do not require live streaming to be meaningful.

Each recommendation should include:

- `marketTradeability`
- `directionalBias`
- `setupType`
- `entryReadiness`
- `executionQuality`
- `reliabilityBand`
- `entryGuidance`
- `invalidationGuidance`
- `exitGuidance`
- `cancelConditions`
- `rationale`

## Indicator and Feature Policy

The redesign should focus on orthogonal feature groups rather than indicator count.

## Keep as first-class features

- VWAP displacement and control
- higher-timeframe bias
- BTC context for alt pairs
- funding and premium context
- open interest context
- RSI divergence
- volume profile concepts
- recent impulse and breakout context

## Keep as secondary confirmation features

- EMA spread
- MACD histogram
- ATR
- MFI / CMF / OBV slope where available

These should confirm structure, not dominate direction.

## Demote

- RSI level as a standalone directional input
- StochRSI as a major directional signal
- Bollinger touch logic as a main setup trigger

Clarification:

- RSI level is demoted.
- RSI divergence is retained.

## Replace or redesign

- replace current-price entry assumptions with readiness guidance
- replace one-shot confidence with multi-part quality outputs
- replace generic confluence stacking with setup-aware gating

## Feature Feasibility by Data Source

This section directly addresses the strongest peer-review criticism.

## A. Achievable with Current REST Data

These belong in Phase 1:

- regime classification using existing candles and perp snapshot
- VWAP displacement
- EMA spread as secondary trend confirmation
- MACD histogram as secondary momentum confirmation
- ATR percentile or normalized ATR
- RSI divergence
- volume profile location
- funding deviation versus short average
- open-interest delta and acceleration from available snapshots where possible
- BTC relative direction alignment
- session-aware tradeability filtering
- extension detection
- simple execution-risk checks from spread and snapshot microstructure when available

## B. Achievable with Backpack Public WebSocket Addition

These belong in later reactive phases:

- spread trend over rolling windows
- imbalance persistence
- trade-flow delta over rolling windows
- refill after sweep
- absorption at trigger levels
- microprice drift over time
- short rolling execution-quality deterioration detection

These features become valid only when the tool can observe short-lived sequences rather than isolated snapshots.

## C. Requires New External Data Sources

These should not be assumed in early implementation:

- scheduled macro-event blackout windows
- post-news stabilization timers
- sector-relative strength driven by a maintained sector taxonomy
- richer liquidation intelligence if not available from current public feeds

This is the category most likely to cause scope drift and should be deferred explicitly.

## Worked Example Setup Family

To make the proposal concrete, below is one fully specified Phase 1 setup family.

## Setup: `TREND_PULLBACK_CONTINUATION`

### Intent

Capture continuation in a tradeable trend after a controlled pullback, while avoiding entries taken at extension.

### Valid market state

Must all be true:

- regime is `TREND` or trend-like but not `VOLATILE_SPIKE`
- tradeability is not blocked by spread, dead-chop, or strong HTF contradiction
- BTC context is aligned or neutral for alt longs/shorts

### Directional bias conditions

Long example:

- higher timeframe bias is bullish or neutral
- price is above VWAP or has just reclaimed VWAP
- EMA spread is positive
- MACD histogram is non-negative or improving
- recent impulse is not strongly bearish

Short example is symmetric.

### Mandatory confirmation conditions

At least three should be true:

- VWAP control supports direction
- EMA spread supports direction
- MACD histogram supports direction
- RSI divergence does not contradict the direction
- volume profile is supportive
- funding/premium/OI are not strongly hostile

### Disqualifiers

Any of these should cancel the setup:

- entry is extended too far from EMA/VWAP mean
- price is too close to fair value with no directional displacement
- HTF contradiction is severe
- spread is too wide
- impulse is strongly opposite the intended direction
- setup quality falls below short-horizon minimum

### Entry readiness logic

Output should be one of:

- `WATCH`
  - trend exists but pullback has not formed or reclaim is unclear
- `WAIT_PULLBACK_LONG`
  - trend exists but current price is extended
- `LONG_NOW`
  - trend exists, pullback is complete, current displacement is acceptable, and no major execution veto is active

### Invalidation guidance

For long example:

- invalid if price loses VWAP and fails to reclaim
- invalid if HTF contradiction strengthens materially
- invalid if spread deteriorates beyond threshold
- invalid if pullback deepens into structure failure

### Exit guidance

For Phase 1:

- partial reduction near nearest liquidity objective or value-area expansion target
- time-stop if continuation does not resume within expected short-horizon window
- downgrade to `EXIT_ONLY` if opposite impulse emerges or tradeability deteriorates

### Failure modes to track

Track these explicitly in learning:

- `ENTRY_AT_EXTENSION`
- `WRONG_DIRECTION`
- `STOP_TOO_TIGHT_REBOUND`
- `LIQUIDITY_VANISH`
- `REGIME_TRANSITION`

This setup family is intentionally defined in a way that can be implemented with current data first and improved later with streaming state.

## Confidence and Reliability Redesign

The current single confidence number should not disappear immediately, but its meaning should change.

Instead of one overloaded metric pretending to be everything, expose:

- `directionalConviction`
- `setupQuality`
- `executionQuality`
- `reliabilityBand`

### DirectionalConviction

What direction does the model favor, and how strongly?

This is not probability.

### SetupQuality

How structurally clean is the setup?

This is conceptually close to the current setup grading system and should preserve that strength.

### ExecutionQuality

How risky is fresh entry from a friction and microstructure perspective?

For Phase 1, this will be relatively coarse. That is acceptable.

### ReliabilityBand

Suggested bands:

- `LOW`
- `MODERATE`
- `HIGH`

This is more honest than pretending the system knows that a setup has, for example, a 67% win probability.

Later phases can evolve this into empirical bucketed reliability using learning data.

## What the Current Guard System Already Solves

This section exists so the redesign does not accidentally erase real value already present.

The current guards already cover:

- impulse fade avoidance
- extension blocking
- breakout follow-through checks
- low-liquidity chop blocking
- higher-timeframe contradiction severity
- spread gating
- session-specific confidence and setup thresholds

The redesign should:

- move these into a cleaner tradeability model
- reduce their coupling to one directional vote
- add clearer setup-aware semantics

The redesign should not start by deleting them.

## Phased Implementation Plan

This phase plan replaces the broader original version with a more realistic sequence.

## Phase 1a: Separate Tradeability from Direction

Goal:

- stop letting the directional scorer act as the main organizer of everything

Scope:

- introduce a dedicated market-state and tradeability model
- migrate guard logic into a pre-direction filter where appropriate
- retain current indicator set initially

Expected value:

- fewer hostile-environment trades
- cleaner reasoning

## Phase 1b: Setup Classification and Snapshot Entry Readiness

Goal:

- distinguish "setup exists" from "enter now"

Scope:

- add setup families
- add snapshot-friendly readiness states
- implement at least one high-confidence setup family first

Expected value:

- fewer stale current-price recommendations
- better manual decision support

## Phase 1c: Indicator Orthogonalization and Confidence Redesign

Goal:

- reduce overlap and stop overloading confidence

Scope:

- demote redundant indicators
- promote orthogonal structure/context features
- separate directional conviction, setup quality, and execution quality

Expected value:

- cleaner recommendations
- less false certainty

## Phase 2: Reactive State with WebSocket Inputs

Goal:

- add rolling state where sequence matters

Scope:

- short rolling spread trend
- imbalance persistence
- rolling trade-flow delta
- trigger-quality improvements from live state

Expected value:

- better breakout validation
- better execution-risk filtering

## Phase 3: Empirical Reliability and Failure Attribution

Goal:

- calibrate outputs from observed outcomes rather than heuristic confidence alone

Scope:

- bucket outcomes by setup family, regime, and session
- refine failure taxonomy
- improve reliability reporting

Expected value:

- more honest ranking
- better learning feedback loops

## Additional Failure Types to Add

The peer review was especially useful here. Recommended new failure labels:

- `ENTRY_AT_EXTENSION`
- `LIQUIDITY_VANISH`
- `REGIME_TRANSITION`

These complement the current failure types and directly test whether the redesign is fixing the right problems.

## Open Questions for Further Review

1. Which setup family should be implemented first after `TREND_PULLBACK_CONTINUATION`?
2. Should Phase 1 readiness states stay textual, or should they already become typed domain enums?
3. What minimum data volume is required before reliability can be segmented by setup family without becoming too sparse?
4. Which current indicators should remain visible in rationale output even after they are demoted internally?

## Sources

- Backpack API docs: <https://docs.backpack.exchange/>
- CME Group, Bitcoin options and volatility regime commentary: <https://www.cmegroup.com/articles/2026/bitcoin-options-volatility-spikes-and-recovery-signals.html>
- Coinbase Institutional, trading activity and US-hours liquidity context: <https://www.coinbase.com/institutional/research-insights/research/market-intelligence/trading-activity-from-a-us-lens>
- SSRN, Order Flow and Cryptocurrency Returns: <https://ssrn.com/abstract=5020002>
- SSRN, Spoofing and Manipulating Order Books with Learning Algorithms: <https://ssrn.com/abstract=4639959>

## Bottom Line

The original proposal was directionally right. The peer review was also right: the early version needed tighter scope, clearer feasibility boundaries, and at least one concrete setup specification.

This `v2` resolves that by keeping the strategic direction while narrowing the near-term plan to something the current project can actually absorb.

The most defensible next step is not "add more indicators."

It is:

- separate tradeability from direction
- separate setup existence from entry readiness
- preserve and refactor current guards
- reduce indicator overlap
- report reliability more honestly

That is the best path to reducing avoidable intraday losses without pretending the current tool is an execution-grade trading system.

---

## Peer Review (V2)

Date: 2026-03-06
Reviewer: Claude Code (Opus)
Status: Review complete — ready for implementation planning

### Overall Assessment

V2 is a major improvement over V1. The proposal is now realistic for the project's constraints, preserves existing strengths explicitly, and the phasing is actionable. The worked `TREND_PULLBACK_CONTINUATION` example proves the approach is concrete, not just taxonomic. The feature feasibility split (A/B/C) was the most important structural fix and it is well done.

This review is shorter than the V1 review because most of the serious problems have been addressed. What remains is refinement.

### What V2 fixed well

1. **4-layer Phase 1 collapse.** Merging MarketState+Tradeability and Trigger+ExecutionRisk into practical layers is the right call. The snapshot-disposition framing for readiness states ("these are not continuously transitioning states") resolves the biggest V1 objection cleanly.

2. **Explicit preservation of guards.** The dedicated section on what the current guard system already solves (lines 413-433) is valuable. This prevents the redesign from accidentally regressing on real protection that took iterations to build.

3. **Feature feasibility tiers.** The A/B/C split is clear and honest. Phase 1 scope is now bounded by what REST data can actually support.

4. **Sub-phased Phase 1.** The 1a/1b/1c breakdown is realistic. Each sub-phase delivers standalone value and can be validated independently.

5. **Worked setup family.** The `TREND_PULLBACK_CONTINUATION` spec is concrete enough to implement against. The mandatory-3-of-6 confirmation gate is a good balance between rigidity and flexibility.

### Remaining concerns

#### 1. The worked example needs sharper thresholds

The `TREND_PULLBACK_CONTINUATION` spec reads well qualitatively but is still too soft for implementation. Phrases like "extended too far from EMA/VWAP mean", "too close to fair value", "spread is too wide", and "pullback has not formed" need numeric anchors or at least references to how they should be derived. The current engine already has concrete values for these (e.g., `pullbackExtended = price > 1.35 ATR from EMA20`, spread gate at 0.12%). The worked example should either inherit those or specify replacements. Without thresholds, the implementer will either guess or fall back to the current values anyway, which defeats the purpose of specifying the setup family.

**Suggestion:** Add a "threshold derivation" subsection to the worked example. It can say "inherit current guard thresholds initially, tune after learning data accumulates" — that is fine, but it should be explicit.

#### 2. Transition from current `Recommendation` type is unaddressed

The proposal defines the new output fields (`marketTradeability`, `setupType`, `entryReadiness`, etc.) but doesn't discuss how the existing `Recommendation` type evolves. The current type is deeply embedded — it flows through the use-case, the learning service, the console view, watch mode, and the AI advisor. A clean break would require touching nearly every adapter simultaneously. An incremental approach (extend first, deprecate later) would be safer but needs to be stated.

**Suggestion:** Add a brief migration note: will the new fields be added alongside existing ones during Phase 1a/1b, or will the type be replaced wholesale? The former is more practical and aligns with the "preserve and refactor" philosophy.

#### 3. The output state list may need `FADE_*` states

The output states cover trend continuation and breakout scenarios well. But the current engine already handles mean-reversion setups (the signal evaluator has a dedicated `meanReversion` weight channel, and the setup assessor scores "near band" location highly in RANGE regime). If mean reversion remains a valid setup family, states like `FADE_LONG` / `FADE_SHORT` may be needed to distinguish "short the overextension" from "short because trend is down." Without this, a mean-reversion SHORT in a RANGE regime would output as `SHORT_NOW`, which doesn't communicate the setup's nature or its distinct invalidation logic.

**Suggestion:** Either add `FADE_*` states or document that mean-reversion setups map to `SHORT_NOW`/`LONG_NOW` with the `setupType` field carrying the distinction. Both are valid — just pick one and state it.

#### 4. `reliabilityBand` bootstrapping is unclear

The proposal says reliability bands should be LOW/MODERATE/HIGH and that later phases can evolve them using learning data. But what drives the band assignment in Phase 1 before empirical data exists? If it's a heuristic mapping from the existing confidence + setup grade, say so. If it's a fixed conservative default (e.g., everything starts as LOW until proven otherwise), say that instead. Without this, the band will either be unimplemented or will silently replicate the confidence-as-probability problem it was meant to fix.

**Suggestion:** State the Phase 1 bootstrapping rule explicitly. A simple option: `reliabilityBand = setupGrade A + no guard warnings → MODERATE, everything else → LOW`. HIGH is reserved for empirically validated buckets in Phase 3.

#### 5. Learning integration for new failure types needs a note

The proposal adds three failure types (`ENTRY_AT_EXTENSION`, `LIQUIDITY_VANISH`, `REGIME_TRANSITION`) but doesn't mention how they would be detected after the fact. The current learning system evaluates outcomes by comparing entry price, SL, TP, and subsequent price action. `ENTRY_AT_EXTENSION` is retrospectively detectable (price was far from mean at entry). `REGIME_TRANSITION` is detectable (regime at entry vs regime at outcome). `LIQUIDITY_VANISH` is harder — it requires spread data at the time of the simulated fill, which may not be stored.

**Suggestion:** Note that `LIQUIDITY_VANISH` detection may need the learning store to persist spread-at-entry alongside the existing outcome fields.

### Answers to open questions (lines 536-541)

**1. Which setup family after `TREND_PULLBACK_CONTINUATION`?** `BREAKOUT_EXPANSION` — it is the second most common intraday setup, the current engine already has breakout validation logic and impulse detection, and it exercises different parts of the readiness model (the key state is `BREAKOUT_READY_*` rather than `WAIT_PULLBACK_*`).

**2. Readiness states: textual or typed enums?** Typed domain enums from the start. They are cheap to define, they make exhaustive matching possible in TypeScript, and they prevent string drift. The current codebase already uses typed unions for `Signal`, `MarketRegime`, `SetupGrade`, etc. — this would be consistent.

**3. Minimum data volume for per-setup reliability?** As a rough guide: at least 30 resolved outcomes per bucket before segmenting, with shrinkage toward the global prior below that. The current learning policy already uses shrinkage, so this is a natural extension. Setup-family x regime gives ~20 buckets (5 families x 4 regimes); at 30 per bucket that is ~600 resolved trades to populate meaningfully. Session segmentation should wait until volume is 3-4x that.

**4. Which demoted indicators stay visible in rationale?** RSI level and MACD should remain in the rationale text and indicator snapshot for user context — traders expect to see them. They just should not be major scoring drivers internally. The separation between "displayed for context" and "used for scoring" should be explicit in the code.

### Bottom line

V2 is implementation-ready at the strategic level. The remaining gaps are at the specification level: threshold derivation for setup families, type migration strategy, reliability bootstrapping, and learning store extensions. These can be resolved during Phase 1a planning without another full proposal revision.

Recommend proceeding to implementation planning for Phase 1a (separate tradeability from direction).

---

## V2.1 Addendum

Date: 2026-03-06
Purpose: Resolve the final specification gaps identified in the second peer review without rewriting the `v2` proposal.

This addendum is implementation-oriented. It does not change the direction of `v2`; it makes the near-term plan explicit enough to hand to an implementer.

## 1. Threshold Derivation Policy

The worked setup family `TREND_PULLBACK_CONTINUATION` now inherits existing production thresholds by default unless a replacement threshold is specified explicitly during implementation.

This is the Phase 1 threshold policy:

- inherit current guard thresholds first
- expose them in the new setup family logic with clear names
- tune only after enough outcome data exists to justify a change

### Initial inherited thresholds

These values should be treated as the starting baseline for Phase 1:

- extension threshold:
  - inherit the current extension concept from the signal evaluator
  - initial default: extended if price is more than `1.35 ATR` away from the trend mean used by the setup
- spread veto threshold:
  - inherit the current spread veto from the guard layer
  - initial default: block if spread exceeds `0.12%`
- short-horizon quality floor:
  - inherit the current short-timeframe floor behavior
- session-aware confidence and setup-quality floors:
  - inherit the current ASIA and DEAD session floor logic first
- trend-vs-regime mismatch constraints:
  - inherit the current stricter R/R and confidence handling first

### Worked setup interpretation

Until new thresholds are validated, the `TREND_PULLBACK_CONTINUATION` setup should interpret qualitative phrases as follows:

- "extended too far from mean":
  - use the inherited extension threshold
- "too close to fair value":
  - use the current VWAP proximity / chop-style logic as the starting implementation
- "spread is too wide":
  - use the inherited spread veto threshold
- "pullback has not formed":
  - implement using existing displacement plus recent-candle / impulse context rather than inventing a new pullback detector in Phase 1a

This prevents threshold guessing and makes the first implementation intentionally conservative.

## 2. `Recommendation` Type Migration Strategy

The existing `Recommendation` type is deeply integrated across:

- domain output
- application use-cases
- learning snapshot mapping
- AI advisory requests
- console presentation
- watch mode and simulation flows

Because of that, Phase 1 should use additive migration, not a hard replacement.

### Migration rule

Phase 1a and 1b should:

- add new fields to `Recommendation`
- keep existing fields intact
- mark older semantics as legacy in documentation before removing them later

### Practical sequence

1. Add fields alongside existing ones:
   - `marketTradeability`
   - `setupType`
   - `entryReadiness`
   - `executionQuality`
   - `reliabilityBand`
2. Keep existing fields:
   - `signal`
   - `confidence`
   - `setupGrade`
   - current trade levels and rationale
3. Update mappers and presenters to consume the new fields opportunistically.
4. Only after adapters and persistence have stabilized should legacy semantics be reduced or removed.

### Compatibility note

For Phase 1:

- `signal` remains the compatibility field for existing adapters and ranking flows
- `setupType` and `entryReadiness` provide the new semantics
- `confidence` remains present but should be documented as a legacy scalar rather than a probability-like metric

This matches the "preserve and refactor" philosophy and avoids a risky cross-layer break.

## 3. Phase 1 `reliabilityBand` Bootstrap Rule

`reliabilityBand` must not silently become rebranded confidence.

For Phase 1, use a conservative heuristic bootstrap:

- `HIGH`
  - reserved for empirically validated buckets only
  - do not emit in Phase 1 heuristic-only mode
- `MODERATE`
  - allowed only when all of the following are true:
    - setup grade is `A`
    - no major guard warnings remain active
    - setup is not blocked or advisory-weakened by extension / severe contradiction / poor spread
    - the setup is aligned with the active market state
- `LOW`
  - everything else

### Important semantic rule

In Phase 1:

- `reliabilityBand` means "how comfortable the system is surfacing this setup to a user"
- it does not mean "estimated probability of success"

### Transition to later phases

Phase 3 may unlock:

- `HIGH` only for setup/regime buckets with enough resolved outcomes
- shrinkage-backed empirical band assignment

Until then, the system should err on the side of understatement.

## 4. Learning-Store and Failure-Type Implications

The proposed additional failure types remain valid:

- `ENTRY_AT_EXTENSION`
- `LIQUIDITY_VANISH`
- `REGIME_TRANSITION`

But their detection requirements differ.

### Failure types that are immediately feasible

- `ENTRY_AT_EXTENSION`
  - detectable from entry-time geometry using current recommendation snapshot data
- `REGIME_TRANSITION`
  - detectable if the regime at entry is stored and compared with the regime at evaluation or exit

### Failure type that needs extra persistence

- `LIQUIDITY_VANISH`
  - not reliably inferable from the current learning schema alone
  - should not be treated as fully implementable until entry-time liquidity context is stored

### Minimum persistence extension for later support

To support `LIQUIDITY_VANISH` later, the learning record should eventually persist at least:

- spread at entry
- whether spread breached the execution veto threshold during evaluation, if observable
- optionally a coarse execution-quality snapshot at entry time

Phase 1 does not need to solve the full problem, but the proposal should acknowledge that this failure type depends on additional stored context.

## 5. Mean-Reversion Output-State Clarification

The second peer review correctly noted that mean-reversion setups need explicit output semantics.

Phase 1 rule:

- do not add `FADE_*` states yet
- represent the distinction through `setupType`
- allow the output state to remain `LONG_NOW` / `SHORT_NOW` where needed

Example:

- `setupType = RANGE_MEAN_REVERSION`
- `entryReadiness = SHORT_NOW`

This keeps the state model smaller in Phase 1 while preserving the setup distinction needed by the user and by learning.

If mean-reversion becomes a major first-class workflow later, dedicated `FADE_*` states can be introduced in a controlled follow-up.

## 6. Implementation Note for Demoted Indicators

RSI level and MACD should remain visible to users in rationale output and snapshots even after they are demoted internally.

Phase 1 rule:

- it is acceptable for an indicator to remain visible in output while no longer acting as a major scoring driver

This should be explicit in implementation comments and output design to avoid confusion between:

- "shown for trader context"
- "used as a primary decision input"

## Bottom Line

This `v2.1` addendum closes the remaining specification gaps raised by the second peer review:

- threshold inheritance is now explicit
- `Recommendation` migration is additive
- `reliabilityBand` has a conservative bootstrap rule
- new failure types now have stated detection constraints

With these notes in place, the proposal is ready to move into concrete implementation planning for Phase 1a.

---

## Peer Review (V2.1 Addendum)

Date: 2026-03-06
Reviewer: Claude Code (Opus)
Status: Approved for implementation planning

### Assessment

The V2.1 addendum resolves all five specification gaps raised in the V2 review. Each concern is addressed directly and pragmatically. The addendum stays disciplined — it closes gaps without reopening scope.

### Resolution of V2 review concerns

**1. Threshold derivation — resolved.** The "inherit first, tune later" policy (Section 1) is exactly right. Mapping qualitative phrases to concrete current values (1.35 ATR extension, 0.12% spread veto) makes the worked example implementable without guesswork. The explicit list of inherited thresholds prevents the implementer from having to reverse-engineer which guard values apply.

**2. Recommendation type migration — resolved.** The additive migration strategy (Section 2) is the safe choice. Adding `setupType`, `entryReadiness`, `reliabilityBand` alongside existing fields while keeping `signal` and `confidence` as compatibility fields avoids a cross-layer break. The practical sequence (add → consume opportunistically → deprecate later) is clean.

**3. FADE_* states — resolved.** The decision to use `setupType` to carry the mean-reversion distinction rather than adding new output states (Section 5) is the right call for Phase 1. It keeps the state model small. The example (`setupType = RANGE_MEAN_REVERSION` + `entryReadiness = SHORT_NOW`) is clear and sufficient.

**4. Reliability band bootstrapping — resolved.** The bootstrap rule (Section 3) is well-specified: HIGH is reserved for Phase 3 empirical validation, MODERATE requires grade A + no active guard warnings + no extension/contradiction/spread issues, everything else is LOW. The semantic note ("how comfortable the system is surfacing this" rather than "probability of success") is an important clarification that should survive into code comments.

**5. Learning store for new failure types — resolved.** The feasibility split (Section 4) is honest: `ENTRY_AT_EXTENSION` and `REGIME_TRANSITION` are immediately detectable, `LIQUIDITY_VANISH` needs spread-at-entry persistence. Deferring full `LIQUIDITY_VANISH` detection while noting the persistence requirement is pragmatic.

### Minor observations (non-blocking)

**1. Regime-at-entry persistence.** Section 4 notes that `REGIME_TRANSITION` detection requires storing regime at entry time. This is worth flagging as a Phase 1a task — the current learning store likely doesn't persist regime. It's a small schema change but easy to forget if not tracked.

**2. "pullback has not formed" threshold.** Section 1 maps this to "existing displacement plus recent-candle / impulse context." This is the loosest of the threshold mappings. During Phase 1b implementation, the implementer will need to decide concretely: is a pullback "formed" when price has retraced X% of the impulse? When it touches EMA20? When N consecutive candles close against the trend? The addendum is right not to over-specify this now, but it should be the first threshold that gets learning-driven tuning once outcomes exist.

**3. Additive fields and TypeScript strictness.** Since the codebase uses `readonly` throughout and strict TypeScript, the new fields on `Recommendation` should be optional (`readonly setupType?: SetupFamily`) during the additive phase to avoid breaking every construction site. This is an implementation detail but worth noting since the type is constructed in multiple places.

### Bottom line

No further proposal revisions needed. The V2 + V2.1 addendum package is complete enough to begin Phase 1a implementation planning. The proposal author and reviewers are aligned on direction, scope, and constraints.
