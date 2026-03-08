# Phase 1a Implementation Plan

Date: 2026-03-06
Status: Planning only
Source: `docs/DOMAIN_REDESIGN_PROPOSAL_V2.md`

## Goal

Implement Phase 1a from the approved `v2.1` proposal:

- separate market tradeability from directional scoring
- preserve current guard behavior where it already works
- keep `Recommendation` backward-compatible
- keep legacy compatibility surfaces stable:
  - `signal`
  - `regime`
  - `qualityVerdict`
  - `No-trade guard:` rationale lines
- avoid setup-family expansion, readiness-state rollout, learning-schema changes, and WebSocket work in this phase

This plan is intentionally narrower than the full proposal. It is a first implementation slice, not the whole redesign.

## Scope

## In scope

- introduce a dedicated domain step for market-state and tradeability assessment
- extract shared market-context helpers where they already exist in duplicated form
- move suitable pre-direction guard logic out of the directional scorer / late guard stage
- keep the current indicator set and current thresholds as the initial baseline
- add backward-compatible optional fields to `Recommendation` only where they are needed for Phase 1a
- preserve current CLI behavior and existing output compatibility
- add focused tests for the new tradeability layer and updated engine orchestration

## Out of scope

- setup-family rollout beyond what is required to support Phase 1a
- snapshot entry-readiness states such as `WATCH` / `WAIT_PULLBACK_*`
- `reliabilityBand` output rollout
- learning-store schema changes
- regime-at-entry persistence
- WebSocket data
- ranking-score changes such as `positive-pnl-probability`
- AI request contract changes
- large console/UI redesign

## Design Intent

Phase 1a should answer this question explicitly before directional scoring:

"Should this market be considered tradeable for a fresh recommendation right now?"

That is different from:

"If we had to choose a side, which direction looks better?"

The implementation should make that separation visible in the domain model and in the engine flow.

## Compatibility Constraints

Phase 1a may improve the internals, but it should preserve the current external behavior contract unless a change is explicitly planned.

Keep these behaviors stable:

- `Recommendation.signal` remains the primary compatibility field for existing consumers
- `Recommendation.regime` remains the legacy `TRADEABLE | CHOPPY` field used by ranking and console output
- `qualityVerdict` still maps to `VALID | WEAK`
- blocked recommendations should still include a `No-trade guard:` rationale line so watch mode, console output, and existing reason extraction continue to work
- `RecommendationPolicyPort.build(...)` should remain the same shape in Phase 1a
- `GenerateRecommendationUseCase`, AI mapping, learning snapshot mapping, and watch-mode evaluation should not require semantic rewrites in this slice
- `positive-pnl-probability` continues to use legacy fields in Phase 1a

## Proposed Domain Changes

## 1. Add explicit tradeability types

Primary file:

- `src/domain/types.ts`

Additive types to introduce:

- `TradeabilityStatus = "TRADEABLE" | "CAUTION" | "DO_NOT_TRADE"`
- `TradeabilityReasonCode`
  - examples:
    - `LOW_LIQUIDITY_CHOP`
    - `WIDE_SPREAD`
    - `VWAP_CHOP`
    - `SESSION_DEAD_ZONE`
    - `HTF_CONTRADICTION`
    - `WEAK_SETUP_QUALITY`
    - `LOW_CONVICTION`
- `TradeabilityAssessment`
  - `status`
  - `session`
  - `marketRegime`
  - `legacyRegime`
  - `reasonCodes`
  - `rationale`
  - `blocked`

Additive `Recommendation` fields for Phase 1a only:

- `marketTradeability?: TradeabilityStatus`
- `marketTradeabilityReasons?: readonly TradeabilityReasonCode[]`

Important constraint:

- do not introduce a second overloaded `regime` field inside the new types
- keep the existing `Recommendation.regime` field unchanged for compatibility

Reason:

Phase 1a is about separating tradeability from direction, not rolling out the whole future contract.

## 2. Extract shared market-context helpers

Proposed new file:

- `src/domain/recommendation-market-context.ts`

Responsibility:

- centralize `detectTradingSession()`
- centralize current regime classification thresholds now embedded in `RecommendationSignalEvaluator`
- expose a small pure helper returning:
  - `marketRegime`
  - `legacyRegime`
  - `session`
  - regime rationale

Why this matters:

- today `detectTradingSession()` exists in both `recommendation-signal-evaluator.ts` and `recommendation-guards.ts`
- the regime classifier is private inside `RecommendationSignalEvaluator`
- Phase 1a needs one source of truth for tradeability inputs before directional scoring

This is the cleanest way to avoid two slightly different market-state implementations.

## 3. Add a dedicated market-state/tradeability evaluator

Proposed new file:

- `src/domain/recommendation-tradeability-evaluator.ts`

Responsibility:

- evaluate whether the market is broadly tradeable before directional decisioning is treated as actionable
- consume shared market-context output
- return a `TradeabilityAssessment`

Inputs should be limited to data already available in the engine:

- `IndicatorSnapshot`
- `PerpMarketSnapshot`
- `lastPrice`
- `BiasContext?`
- `baseInterval`

Phase 1a should inherit current thresholds rather than inventing new ones:

- spread veto: `0.12%`
- extension logic: current ATR-based logic where it is already used as a market-level caution
- session-aware stricter floors
- low-liquidity chop veto
- HTF contradiction severity thresholds only where they are truly market-level rather than side-selection-level

Planned blocker categories:

- hard block:
  - `LOW_LIQUIDITY_CHOP`
  - `WIDE_SPREAD`
  - `SESSION_DEAD_ZONE` only when paired with weak quality / weak conviction conditions already present in the baseline
- caution:
  - `HTF_CONTRADICTION`
  - `LOW_CONVICTION`
  - `WEAK_SETUP_QUALITY`

Important boundary:

- Phase 1a tradeability should only own market-level checks
- direction-specific blocks such as "do not short into strong bullish impulse" stay in the post-direction guard path for now

## 4. Narrow the responsibility of the signal evaluator

Primary file:

- `src/domain/recommendation-signal-evaluator.ts`

Target change:

- keep it focused on directional scoring and directional-support metadata
- stop making it the implicit owner of overall tradeability

Planned outcome:

- it should stop owning `detectTradingSession()` and the only copy of regime classification thresholds
- it should continue to return directional metadata needed by post-direction guards
- market-level veto reasoning should be computed in the dedicated tradeability evaluator and surfaced separately

Phase 1a should prefer minimal extraction over a dramatic rewrite.

## 5. Refactor the engine orchestration order

Primary file:

- `src/domain/recommendation-engine.ts`

Proposed Phase 1a order:

1. compute market-state / tradeability assessment
2. compute directional score and directional-specific metadata
3. compute trade geometry and setup grade as today
4. apply directional / post-entry guards as needed
5. return a backward-compatible `Recommendation` enriched with tradeability fields

Important constraints:

- `signal`, `action`, `confidence`, and existing trade levels remain present
- downstream adapters should not break
- if tradeability blocks the setup before a live side is actionable, the final output still needs compatibility semantics:
  - `signal = NO_TRADE`
  - `qualityVerdict = WEAK`
  - at least one rationale line beginning with `No-trade guard:`

## Guard Refactor Strategy

Primary file:

- `src/domain/recommendation-guards.ts`

Phase 1a should not try to eliminate the current guard module. Instead:

- split guards conceptually into:
  - pre-direction tradeability checks
  - post-direction directional checks

Implementation options:

1. Add a new tradeability evaluator and leave `applyTradeGuards` mostly intact, trimming only the clearly market-level blocks.
2. Extract pure helper functions from `recommendation-guards.ts` and reuse them from the new evaluator.

Preferred option:

- option 2 if the extraction is simple
- otherwise option 1 with duplication kept small and documented

Reason:

The code should improve structure without incurring a large refactor tax in Phase 1a.

## File-by-File Plan

## Domain

- `src/domain/types.ts`
  - add `TradeabilityStatus`, `TradeabilityReasonCode`, `TradeabilityAssessment`
  - add optional Phase 1a `Recommendation` fields for tradeability only

- `src/domain/recommendation-market-context.ts`
  - new file
  - own shared session detection and regime classification

- `src/domain/recommendation-tradeability-evaluator.ts`
  - new file
  - implement market-level tradeability assessment

- `src/domain/recommendation-signal-evaluator.ts`
  - consume shared market-context helper
  - reduce responsibility where reasonable
  - keep directional logic intact unless extraction is trivial

- `src/domain/recommendation-engine.ts`
  - orchestrate new tradeability assessment before or alongside directional scoring
  - attach `marketTradeability` fields to the returned `Recommendation`

- `src/domain/recommendation-guards.ts`
  - either share extracted helpers or trim market-level checks that move earlier

## Application

- `src/application/generate-recommendation-use-case.ts`
  - likely unchanged
  - confirm no call-site changes are required beyond the additive `Recommendation` shape

- `src/application/recommendation-mappers.ts`
  - preserve compatibility
  - do not require AI or learning mappings to consume the new fields in Phase 1a

- `src/application/evaluate-watch-symbol-use-case.ts`
  - should remain unchanged if rationale prefix compatibility is preserved

## Ports

- `src/ports/recommendation-policy-port.ts`
  - no signature change expected
  - confirm additive `Recommendation` type does not force port redesign

## Adapters

- `src/adapters/console/recommendation-printer.ts`
  - defer by default in Phase 1a
  - only touch if a tiny compatibility-safe tradeability display is clearly worth it
  - do not redesign output layout yet

## Persistence and learning

- no Phase 1a schema or port changes

Follow-up note:

- the proposal’s `REGIME_TRANSITION` learning follow-up should be tracked later, but not implemented now

## Testing Plan

New or updated tests should cover:

## 1. Tradeability evaluator unit tests

New file:

- `tests/recommendation-tradeability-evaluator.test.ts`

Cases:

- low-liquidity chop returns `DO_NOT_TRADE`
- wide spread returns `DO_NOT_TRADE`
- dead-zone + weak structure returns `CAUTION` or `DO_NOT_TRADE` depending on chosen semantics
- tradeable trend case returns `TRADEABLE`

## 2. Recommendation engine integration tests

Existing file:

- `tests/recommendation-engine.test.ts`

Cases:

- returned `Recommendation` includes `marketTradeability`
- returned `Recommendation` includes `marketTradeabilityReasons` when blocked or cautious
- existing signal / levels / confidence fields remain intact
- market-level veto preserves compatibility fields:
  - `signal`
  - `regime`
  - `qualityVerdict`
  - `No-trade guard:` rationale prefix

## 3. Guard regression coverage

Existing file:

- `tests/recommendation-guards.test.ts`

Goal:

- ensure the recent baseline-hardening logic still behaves correctly after guard extraction or orchestration changes

## 4. Focused compatibility regressions

Existing files:

- `tests/generate-ai-advice-use-case.test.ts`
- `tests/rank-top-opportunities-use-case.test.ts`
- `tests/run-learning-cycle-use-case.test.ts`

Goal:

- confirm additive `Recommendation` fields do not force AI, ranking, or learning-flow changes in Phase 1a

## 5. Optional presentation regression

If the printer is updated:

- add minimal coverage to ensure presence / absence of tradeability display is stable

## Verification commands

At the end of implementation:

- `npm test -- tests/recommendation-tradeability-evaluator.test.ts`
- `npm test -- tests/recommendation-engine.test.ts`
- `npm test -- tests/recommendation-guards.test.ts`
- `npm test`
- `npm run build`

## Sequencing

Recommended implementation sequence:

1. extract shared market-context helpers into `src/domain/recommendation-market-context.ts`
2. add Phase 1a types in `src/domain/types.ts`
3. add `recommendation-tradeability-evaluator.ts`
4. wire tradeability into `recommendation-engine.ts`
5. minimally adjust `recommendation-signal-evaluator.ts` and `recommendation-guards.ts` to reuse shared helpers and preserve current behavior
6. add tests for the new evaluator
7. update engine and guard regressions
8. optionally surface tradeability in the printer only if it is near-zero cost
9. run focused regressions, then full verification

## Suggested Commit Slices

Keep the implementation reviewable. Recommended commit breakdown:

1. `Extract shared market-context helpers`
   - new helper file
   - signal evaluator and guards import it
   - no `Recommendation` contract changes yet
2. `Add tradeability assessment to domain engine`
   - new types
   - new tradeability evaluator
   - engine wiring
   - new unit tests
3. `Stabilize compatibility surfaces`
   - engine / guard regression fixes
   - optional tiny printer change if still justified
   - full verification

## Risks

## 1. Scope creep into Phase 1b

Risk:

- adding `setupType`, `entryReadiness`, or `reliabilityBand` too early turns Phase 1a into a broader redesign

Mitigation:

- limit additive output fields to tradeability only

## 2. Hidden coupling in `Recommendation`

Risk:

- additive field changes ripple through AI, ranking, learning, and printer layers

Mitigation:

- keep new fields optional
- do not require all consumers to use them in Phase 1a
- preserve rationale prefixes and legacy `regime` semantics

## 3. Guard duplication

Risk:

- market-level logic becomes duplicated between the new evaluator and `recommendation-guards.ts`

Mitigation:

- prefer shared helper extraction if clean
- if duplication is temporarily necessary, document and keep it small

## 4. Semantic confusion between tradeability and signal

Risk:

- the system may still emit a directional `signal` even when `marketTradeability` is poor

Mitigation:

- document Phase 1a semantics clearly:
  - directional signal can exist internally
  - tradeability determines whether the market should be treated as actionable
  - the public `Recommendation` still preserves compatibility behavior

## 5. Silent contract drift in watch / ranking flows

Risk:

- if blocked recommendations stop producing the same legacy guard / rationale patterns, watch signatures and ranking behavior can change without compile failures

Mitigation:

- preserve `No-trade guard:` rationale prefixes
- keep `signal`, `regime`, and `qualityVerdict` behavior stable
- run focused compatibility regressions before the full suite

## Acceptance Criteria

Phase 1a planning will be considered implemented correctly when:

- a dedicated tradeability domain step exists
- shared market-context helpers are no longer duplicated across the signal evaluator and guards
- market-level veto logic is no longer conceptually buried inside one directional pass
- current CLI and adapters remain compatible
- `Recommendation` stays backward-compatible
- `RecommendationPolicyPort` signature remains unchanged
- no persistence schema changes are required
- ranking, AI mapping, and watch-mode flows do not need behavior-specific rewrites
- tests and build pass

## Deliberate Follow-Ups

These should be planned after Phase 1a, not pulled forward:

- Phase 1b setup-family rollout
- snapshot entry-readiness states
- `reliabilityBand` output
- learning-store extension for new failure types
- regime-at-entry persistence
- WebSocket-driven reactive state

## Recommendation

Do not implement the whole proposal at once.

Proceed with:

1. Phase 1a planning sign-off
2. Phase 1a implementation in small commits
3. Phase 1b planning only after Phase 1a is green and behavior is understood

---

## Peer Review

Date: 2026-03-06
Reviewer: Claude Code (Opus)
Status: Approved with minor items

### Overall Assessment

This is a disciplined, well-scoped implementation plan. It faithfully narrows the V2.1 proposal to a single slice, maintains strong compatibility constraints, and resists scope creep explicitly. The file-by-file breakdown, sequencing, commit slicing, and risk identification are all practical. The out-of-scope list is just as important as the in-scope list, and it's well drawn.

The plan is ready for implementation. The items below are refinements, not blockers.

### What the plan gets right

1. **Scope discipline.** The out-of-scope list (lines 36-46) is precise and correctly excludes setup families, readiness states, reliability bands, learning schema changes, and WebSocket work. This prevents Phase 1a from becoming the full redesign.

2. **Compatibility constraints are concrete and verifiable.** The plan names exact fields (`signal`, `regime`, `qualityVerdict`), exact string prefixes (`No-trade guard:`), and exact interfaces (`RecommendationPolicyPort.build(...)`) that must remain stable. I verified these against the codebase — they are all real and heavily depended upon:
   - `No-trade guard:` prefix is consumed by `evaluate-watch-symbol-use-case.ts`, `adaptive-learning-service.ts`, `recommendation-printer.ts`, and asserted in engine tests
   - `regime: "TRADEABLE" | "CHOPPY"` is used by `positive-pnl-probability.ts`, printer, ranking tests, learning tests, and AI mapping
   - `RecommendationPolicyPort.build()` signature is clean and additive-safe

3. **`detectTradingSession` duplication is correctly identified.** Confirmed: identical standalone functions exist at `recommendation-signal-evaluator.ts:53` and `recommendation-guards.ts:4`. Extracting this is a clean win.

4. **Guard refactor strategy is conservative.** Preferring helper extraction over restructuring, with documented duplication as fallback, is the right approach for a first slice.

5. **Commit slicing is reviewable.** Three commits with clear boundaries (extract helpers → add tradeability → stabilize compatibility) keeps each commit focused and independently verifiable.

### Items to address

#### 1. `VWAP_CHOP` reason code has no current precedent

The plan proposes `VWAP_CHOP` as a `TradeabilityReasonCode` (line 88), but there is no existing VWAP-chop detection in the codebase. The current guards and signal evaluator don't check for "price near VWAP with no displacement" as a market-level block. This would be net-new logic, not inherited behavior.

This isn't necessarily wrong — it's a reasonable tradeability check — but it conflicts with the plan's stated principle of inheriting current thresholds (line 160: "Phase 1a should inherit current thresholds rather than inventing new ones").

**Suggestion:** Either drop `VWAP_CHOP` from the Phase 1a reason codes and defer it to Phase 1b where setup-aware gating is introduced, or explicitly acknowledge it as a small net-new addition with a defined threshold (e.g., price within 0.1% of VWAP + ATR compression below Xth percentile).

#### 2. The tradeability → signal interaction needs a clearer decision rule

The plan says tradeability runs before direction (line 211), and that a tradeability block should produce `signal = NO_TRADE` + `qualityVerdict = WEAK` + `No-trade guard:` rationale (lines 221-224). But it doesn't specify what happens to **`CAUTION`** status.

Currently, guards either block (flip signal to `NO_TRADE`) or advise (keep signal but set `blocked: true`). The new `CAUTION` status sits between `TRADEABLE` and `DO_NOT_TRADE` but the plan doesn't say whether:
- `CAUTION` still allows full directional scoring and just annotates the output
- `CAUTION` tightens downstream thresholds (e.g., raises confidence floors)
- `CAUTION` is purely informational in Phase 1a

**Suggestion:** State the Phase 1a rule explicitly. The simplest option: `DO_NOT_TRADE` → hard block (same as current guard blocks), `CAUTION` → informational annotation only (populate `marketTradeability` and `marketTradeabilityReasons` but don't change scoring or guard behavior). This keeps Phase 1a behavioral changes minimal and testable.

#### 3. The plan should note which guards move vs. stay

The plan says "move suitable pre-direction guard logic out of the directional scorer / late guard stage" (line 29) and lists the tradeability evaluator's planned checks. But it doesn't explicitly map which current guard checks from `recommendation-guards.ts` move to the new evaluator versus stay in post-direction guards.

From my earlier analysis, the current guards include both market-level and direction-specific checks:
- **Market-level (candidates to move):** `LOW_LIQ_CHOP` regime block, spread > 0.12% block, `CHOPPY` regime block, session-specific confidence/setup floors
- **Direction-specific (should stay):** impulse-bias clash, pullback-extended blocking, breakout-validation-failed, winner-ratio check, regime-signal mismatch

**Suggestion:** Add a brief mapping table or list identifying which of the ~12 current guard checks are candidates for the tradeability evaluator vs. which remain in post-direction guards. This prevents the implementer from having to re-derive the split and reduces the risk of accidentally moving direction-specific logic.

#### 4. Regime classification extraction may be trickier than stated

The plan says to extract regime classification from `RecommendationSignalEvaluator` into the shared market-context helper (line 125-126). The regime classifier currently lives deep inside the signal evaluator's `evaluate()` method and reads from the same indicator snapshot. But it also sets the `regime: "TRADEABLE" | "CHOPPY"` legacy field, which is a higher-level judgment that currently depends on the directional scoring result (e.g., `CHOPPY` is set when conviction is too low after scoring — see signal evaluator lines ~645-652).

This means `marketRegime` (TREND/RANGE/VOLATILE_SPIKE/LOW_LIQ_CHOP) can be extracted cleanly — it's purely indicator-derived. But the legacy `regime: "TRADEABLE" | "CHOPPY"` can't be fully determined pre-direction because it partially depends on signal strength.

**Suggestion:** Note this explicitly: `marketRegime` extraction is clean, but `legacyRegime` may need to remain computed after directional scoring. The market-context helper should expose `marketRegime` and `session`; the legacy `regime` field should continue to be set by the engine after signal evaluation, as it is today.

#### 5. Missing test case: `CAUTION` status behavior

The testing plan (lines 316-375) covers `DO_NOT_TRADE` and `TRADEABLE` cases well but doesn't include a test for `CAUTION` behavior. Since `CAUTION` is a new status with unspecified downstream effects (see item 2 above), there should be at least one test asserting what happens when `CAUTION` is returned — does the signal still go through? Are the reason codes populated? Is the recommendation otherwise unchanged?

### Minor observations (non-blocking)

- **Sequencing step 5** (line 394) says "minimally adjust recommendation-signal-evaluator.ts and recommendation-guards.ts to reuse shared helpers." This is good but could note that the signal evaluator adjustment is primarily deleting its private `detectTradingSession` and importing the shared one — a very small diff.

- **The plan references `evaluate-watch-symbol-use-case.ts`** (line 290) but doesn't list it in the file-by-file plan. It should be fine unchanged (it only reads `No-trade guard:` prefixes from rationale), but worth confirming in the compatibility regression.

- **`positive-pnl-probability.ts`** reads `rec.regime === "CHOPPY"` (line 16 of that file). The plan correctly notes this should stay on legacy fields. Worth adding this file to the "focused compatibility regressions" test list (lines 360-368) since it's a direct consumer of the legacy `regime` field.

### Bottom line

The plan is implementation-ready. The four actionable items above are small clarifications that can be resolved at implementation time:

1. Decide on `VWAP_CHOP` — defer or define
2. Define `CAUTION` downstream semantics for Phase 1a
3. List which guards move vs. stay
4. Note that legacy `regime` can't fully move pre-direction

None of these require a plan revision — they can be resolved in the first commit. Approved for implementation.
