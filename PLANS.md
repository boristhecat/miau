# Project Plan

## Task: Simplify internal analysis terminal chrome (2026-03-16)
- [x] Re-read the current terminal-pane markup and identify which internal labels are redundant with the pane headers
- [x] Remove the extra terminal headers while keeping the analysis rows and reason groups scannable
- [x] Re-run syntax/build/tests after the simplification pass

## Task: Restyle analysis columns as light terminal panels (2026-03-16)
- [x] Re-read the current analysis layout and recover the old CLI presentation language from local code/history
- [x] Apply that terminal framing to the application and AI analysis columns while keeping the current lighter palette
- [x] Re-run syntax/build/tests after the styling pass

## Task: Refactor the vanilla frontend into focused modules (2026-03-16)
- [x] Re-read the current frontend bootstrap and identify a module split that preserves behavior without introducing a framework
- [x] Extract shared DOM/formatting/render helpers and page-specific renderers from `app.js` into focused ES modules
- [x] Keep the browser bootstrap thin while preserving analyze, scanner, monitor, learning, and settings behavior
- [x] Re-run syntax/build/tests after the frontend refactor

## Task: Align analysis column headers from screenshot feedback (2026-03-16)
- [x] Inspect the clipboard screenshot and current analysis layout to identify the exact header and spacing alignment defects
- [x] Adjust the analysis column header and spacing system so both columns align cleanly and read as one grid
- [x] Re-run syntax/build/tests after the header alignment fix

## Task: Refocus the analysis UI around decision-first hierarchy (2026-03-16)
- [x] Re-read the current analysis surface and identify which values must stay visible at a glance versus move behind on-demand detail
- [x] Rebuild the single-pair result into a denser summary board with aligned application vs AI columns and stronger emphasis on the trade decision payload
- [x] Tighten the related CSS so hierarchy comes from alignment, typography, and restraint instead of oversized blocks
- [x] Re-run syntax/build/tests after the hierarchy pass

## Task: Realign the analysis comparison layout and header navigation (2026-03-16)
- [x] Re-read the current comparison renderer and identify the content that should remain visible versus move behind disclosure
- [x] Rework the single-pair analysis into paired comparison rows so the app and AI columns align cleanly
- [x] Move the primary page navigation into the brand row and keep it right-aligned without breaking smaller screens
- [x] Re-run build/tests after the layout cleanup

## Task: Split single-pair analysis into app and AI columns (2026-03-16)
- [x] Re-read the current single-pair analysis renderer and identify which sections belong in the deterministic app column versus the AI column
- [x] Restructure the analysis result into a two-column comparison layout with a clear app analysis side and AI response side
- [x] Show a useful empty state when AI advice is unavailable instead of collapsing the second column
- [x] Re-run build/tests after the analysis layout update

## Task: Split scanner and monitor into dedicated pages and support multiple live trades (2026-03-16)
- [x] Re-read the current overview, scanner, and monitor UI/runtime flow and identify the single-monitor assumptions that must change
- [x] Move scanner and open-trade monitoring out of the overview into their own pages while keeping analyze as the default page
- [x] Tighten form field widths so compact inputs like symbol, leverage, and horizon stop consuming unnecessary horizontal space
- [x] Replace the single monitor stream slot with a multi-trade monitor board that can run and stop multiple sessions independently
- [x] Update current-state docs for the new page model and re-run build/tests

## Task: Remove remaining boxed surfaces from the web dashboard (2026-03-16)
- [x] Re-read the current overview shell and identify which top-level wrappers still present as separate cards
- [x] Flatten the app bar, summary strip, overview grid, and secondary pages so they read as aligned sections with separators instead of boxed panels
- [x] Tighten spacing and control sizing further so more information fits at a glance without hurting readability
- [x] Re-run build/tests after the layout flattening pass

## Task: Flatten the dashboard surface and reduce visual bulk (2026-03-16)
- [x] Re-read the current frontend structure and identify which remaining containers still present as nested cards
- [x] Collapse the overview into a more unified surface with separators instead of isolated panel blocks where possible
- [x] Reduce spacing, control heights, and section padding so more information fits without hurting scanability
- [x] Keep existing behavior intact while tightening the analyze, monitor, scanner, learning, and settings presentation
- [x] Re-run build/tests after the visual flattening pass

## Task: Flatten the overview dashboard into a cleaner grid layout (2026-03-16)
- [x] Re-read `PLANS.md`, `docs/CURRENT_STATE.md`, and current frontend files to confirm the overview-first runtime still fits the product
- [x] Rework the overview layout so Analyze, Monitor, and Scanner use a clearly aligned grid with the scanner spanning the full width below the top row
- [x] Replace the remaining terminal/card styling with a flatter dashboard presentation that uses lighter surfaces and less decorative chrome
- [x] Preserve existing analyze, scan, monitor, learning, and settings behavior while adapting the UI renderers to the flatter visual system
- [x] Run build/tests after the redesign and keep docs aligned if the runtime layout changes

## Task: Rebuild the web UI around a single-screen overview dashboard (2026-03-16)
- [x] Re-read `PLANS.md`, `docs/CURRENT_STATE.md`, and current frontend files, then incorporate researched dashboard principles into the next layout pass
- [x] Consolidate Analyze, Scanner, and Monitor into one overview screen while keeping Learning and Settings as secondary pages
- [x] Reduce navigational chrome and decorative framing so the screen prioritizes overview metrics, tables, and direct controls
- [x] Refine renderers and layout density so the overview can be scanned without drilling into multiple tabs
- [x] Run build/tests and update `docs/CURRENT_STATE.md` for the new runtime layout

## Task: Compress the web UI into a denser CLI-style console layout (2026-03-16)
- [x] Re-read `PLANS.md` and `docs/CURRENT_STATE.md`, then inspect which current UI regions are consuming space without improving scanability
- [x] Collapse oversized header/card treatments into a compact terminal shell with inline status context
- [x] Rewrite analyze, scanner, and monitor presentation into denser rows/columns that prioritize at-a-glance reading
- [x] Tighten typography, spacing, and controls so the interface feels closer to a CLI console than a marketing page
- [x] Re-run build/tests and refresh current-state docs only if the runtime description changes materially

## Task: Redesign the web UI around a split-screen cyberterminal layout (2026-03-16)
- [x] Re-read `PLANS.md` and `docs/CURRENT_STATE.md`, then inspect the current static frontend structure and note any code/doc mismatches
- [x] Rework the web shell into distinct Analyze / Scanner / Monitor / Learning / Settings workspaces while preserving existing API behavior
- [x] Replace the current styling with a stronger terminal / pixel / cypherpunk visual system that still works on desktop and mobile
- [x] Update the client-side rendering and interaction code to fit the new layout without regressing analyze, scan, monitor, learning, or settings flows
- [x] Refresh `docs/CURRENT_STATE.md` for the actual tab layout and run build verification

## Task: Allow analyze/monitor override of saved defaults (2026-03-13)
- [x] Re-read `PLANS.md` and `docs/CURRENT_STATE.md`, then trace how saved defaults currently flow through web analyze and monitor paths
- [x] Expose leverage / position size / horizon overrides in the analyze and monitor web forms without exposing AI model there
- [x] Tighten web API parsing/validation so optional per-request overrides cleanly fall back to defaults or reject invalid values
- [x] Add regression coverage and update current docs if the web behavior changes materially

## Task: Remove CLI runtime and make the app web-only (2026-03-13)
- [x] Re-read `PLANS.md` and `docs/CURRENT_STATE.md`, then trace all CLI/runtime references, scripts, and docs
- [x] Replace the remaining console-specific runtime wiring with web-only equivalents and remove `src/cli.ts`
- [x] Delete obsolete console adapters/tests and update package metadata, README, `docs/CURRENT_STATE.md`, `docs/ARCHITECTURE.md`, and `AGENTS.md`
- [x] Run build/tests and confirm the repo is clean with a web-only runtime surface

## Task: Align `rec` with the live single-symbol recommendation path (2026-03-13)
- [x] Re-read `PLANS.md` and `docs/CURRENT_STATE.md`, then trace the exact divergence between `rec` output and direct symbol queries
- [x] Remove the cache-based approach and make `rec` use the same live recommendation path as a plain single-symbol query, without AI
- [x] Serialize the `rec` scan to avoid shared-runtime divergence and add regression coverage for the shared generator path
- [x] Run focused/full verification and refresh current-state docs

## Task: Move trade defaults from JSON into SQLite (2026-03-13)
- [x] Re-read `PLANS.md` and `docs/CURRENT_STATE.md`, then inspect current defaults persistence and all call sites
- [x] Replace the JSON-backed defaults store with a SQLite-backed store using `data/learning.sqlite`
- [x] Delete the legacy `data/trade-defaults.json` file from the active runtime, add regression coverage, and update docs
- [x] Run build/tests, migrate current local defaults into SQLite, and confirm the worktree state

## Task: Switch open-trade monitor fast lane to Backpack WebSocket (2026-03-13)
- [x] Re-read the current monitor implementation and isolate a monitor-only live-market integration point
- [x] Add a live-market stream port and Backpack WebSocket adapter without changing snapshot-based analyze/rec/learning flows
- [x] Wire CLI and web monitor paths to use live snapshots with REST fallback, add regression coverage, and run full verification

## Task: Implement open-trade monitor (2026-03-12)
- [x] Inspect the reusable recommendation/simulation/runtime pieces and confirm the monitor should be a new flow, not a revived watch mode
- [x] Add pure domain monitor types, metrics, health, and management evaluators
- [x] Add application use-cases for baseline creation and per-tick reevaluation
- [x] Add `monitor` command parsing plus a dedicated blocking monitor controller/view in interactive mode
- [x] Add focused regression coverage, update current docs/help text, and run build/full test verification

## Task: Open-trade monitor implementation planning (2026-03-12)
- [x] Re-read `PLANS.md` and `docs/CURRENT_STATE.md` after watch removal, then inspect the reusable simulation/recommendation/runtime pieces
- [x] Define an architecture-consistent monitor design for reevaluating a live trade from user-provided entry / SL / TP
- [x] Write an implementation plan covering command shape, cadence model, new domain/application/adapter modules, tests, and acceptance criteria

## Task: Remove `watch` mode entirely (2026-03-12)
- [x] Re-read `PLANS.md` and `docs/CURRENT_STATE.md`, then trace every watch-mode reference across CLI, console adapters, docs, and tests
- [x] Remove watch-mode code paths and delete watch-specific modules/tests without affecting recommendation or learning flows
- [x] Update current docs/help text and run build/test verification

## Task: Phase 1b trader-viability improvements (2026-03-12)
- [x] Re-read `PLANS.md` and `docs/CURRENT_STATE.md`, then scope the highest-ROI improvements that fit current architecture and public-data limits
- [x] Expand structural level context in the indicator/domain layer without breaking adapter boundaries
- [x] Add a dedicated entry-readiness evaluator and wire it into recommendation building and guards
- [x] Refine setup/playbook semantics so setup classification, readiness, and tradeability are evaluated separately
- [x] Add regression coverage, run focused/full verification, and refresh `docs/CURRENT_STATE.md`

## Task: Phase 1c playbook-aware risk and holding policy (2026-03-12)
- [x] Re-read the current engine/guard/calculator flow and scope playbook-specific behavior that fits current data
- [x] Add a playbook policy module for regime alignment, risk/reward floors, ATR profile tuning, and hold-time behavior
- [x] Wire playbook policy into recommendation building, guards, and expectancy heuristics
- [x] Add regression coverage for continuation vs breakout vs reversal handling and run focused/full verification
- [x] Refresh `docs/CURRENT_STATE.md` if behavior changes materially

## Task: Phase 1d intraday sequence logic (2026-03-12)
- [x] Re-read the current plan/state and trace how recent candle context flows through setup, readiness, and guards
- [x] Expand recent candle context with raw sequence facts from candle history
- [x] Add a dedicated sequence evaluator for reclaim, breakout acceptance/failure, and sweep-rejection patterns
- [x] Wire sequence assessment into entry readiness, recommendation output, and heuristics without touching watch mode
- [x] Add regression coverage, run focused/full verification, and refresh `docs/CURRENT_STATE.md`

## Task: Phase 1e key-level interaction logic (2026-03-12)
- [x] Re-read the current plan/state and trace how session/day structure is used in setup and readiness
- [x] Add a dedicated level-interaction evaluator for acceptance/rejection/testing around key session/day levels
- [x] Wire level interaction into entry readiness, recommendation output, and expectancy heuristics
- [x] Add regression coverage, run focused/full verification, and refresh `docs/CURRENT_STATE.md`

## Task: Fix `rec` mode 400 failure (2026-03-08)
- [x] Re-read `PLANS.md` and `docs/CURRENT_STATE.md`, then trace the `rec`-specific request path
- [x] Harden the `rec` universe prefetch so one Open Interest 400 does not abort the whole mode
- [x] Add regression coverage for partial Open Interest fetch failures in `rec`
- [x] Run focused tests plus build verification

## Task: Implement Phase 1a tradeability separation (2026-03-06)
- [x] Extract shared market-context helpers for session and market-regime classification
- [x] Add additive tradeability types and a dedicated tradeability evaluator
- [x] Wire tradeability into the recommendation engine while preserving legacy compatibility fields and rationale prefixes
- [x] Add regression coverage for `CAUTION`, compatibility behavior, and existing guard logic
- [x] Run focused tests, full `npm test`, and `npm run build`

## Task: Phase 1a implementation planning (2026-03-06)
- [x] Re-read `PLANS.md`, `docs/CURRENT_STATE.md`, and `docs/DOMAIN_REDESIGN_PROPOSAL_V2.md`
- [x] Map the concrete files and interfaces Phase 1a will touch
- [x] Write a Phase 1a implementation plan covering scope, sequence, tests, risks, and acceptance criteria
- [x] Review the Phase 1a plan before starting code changes

## Task: Commit current guard/evaluator baseline hardening (2026-03-06)
- [x] Confirm the remaining uncommitted guard/evaluator/test changes form a coherent baseline-hardening patch
- [x] Run focused guard tests, then broader verification if green
- [x] Commit only the guard/evaluator/test baseline changes, leaving unrelated local changes untouched

## Task: Merge domain redesign proposal with peer review into v2 (2026-03-06)
- [x] Re-read `PLANS.md`, `docs/CURRENT_STATE.md`, and the current proposal plus peer review
- [x] Create a separate merged `v2` document, then consolidate on it after review sign-off
- [x] Tighten Phase 1 scope, add a feasibility split by data source, and specify one concrete setup family
- [x] Append a compact `v2.1` addendum to the `v2` document covering thresholds, type migration, reliability bootstrapping, and learning-store implications

## Task: Trade vs NO_TRADE gate improvements (2026-03-05)
- [x] Add minimum absolute winner-score conviction handling and normalized winner-ratio gating
- [x] Add HTF contradiction severity, volume-confirmation gating, and optional-channel participation confidence adjustment
- [x] Add session-adaptive guard thresholds for ASIA/DEAD and regime/signal mismatch guard escalation
- [x] Update tests for evaluator/guard behavior under the new gating rules
- [x] Run `npm run build` and `npm test`

## Task: Finish indicator improvements alignment (2026-03-03)
- [x] Apply chunk 14 regime multiplier changes in the indicator weight policy
- [x] Update focused tests to assert the new multiplier behavior
- [x] Refresh `docs/CURRENT_STATE.md` so it reflects the implemented indicator improvements
- [x] Run `npm run build` and `npm test`

## Task: Indicator improvements pipeline upgrade (2026-03-03)
- [x] Add domain type foundations for `BiasContext`, `TradingSession`, and extended indicator snapshots
- [x] Add adaptive indicator periods plus RSI divergence / volume profile / median ATR% calculations
- [x] Thread `BiasContext` and BTC market context through use-case, engine, port, and tests
- [x] Expand signal evaluation with richer HTF bias, funding momentum, RSI divergence, volume profile, BTC correlation, session conditioning, conflict detection, ATR normalization, and regime transition logic
- [x] Run `npm run build` and `npm test`

## Task: Remove `learn --buckets` command alias (2026-02-25)
- [x] Remove interactive `learn --buckets` command handling
- [x] Update interactive help and docs to use `learn --stats` only
- [x] Run build + test verification

## Task: Architectural review remediation (2026-02-25)
- [x] Split `src/cli.ts` into a thin composition root and extracted interactive/session runner services
- [x] Decompose `src/domain/recommendation-engine.ts` into focused domain collaborators while preserving outputs
- [x] Reduce `Recommendation` cross-layer coupling via explicit mappers/derived DTO shaping at boundaries
- [x] Make learning policy application return non-mutated recommendations and deduplicate learning snapshot mapping
- [x] Remove hidden use-case instantiation by introducing injected collaborators for ranking/learning symbol selection
- [x] Add bounded concurrency and caching to Backpack open-interest enrichment in volume ranking
- [x] Centralize AI HTTP failure logging ownership (avoid duplicate CLI+adapter logging)
- [x] Run test + build verification

## Task: Fix `--expected` horizon precedence (2026-02-25)
- [x] Ensure expected-range queries honor the explicit `--expected <minutes>` value even when default objective horizon is set
- [x] Add regression test for expected-range override vs objective-horizon defaults

## Task: Findings remediation without trading-logic changes (2026-02-23)
- [x] Align docs with current runtime behavior (learning horizons)
- [x] Remove OpenAI error-log test side effect from tracked `data/openai-http-errors.log`
- [x] Remove unused `learning-gates-policy` module
- [x] Harden `watch` command parsing to reject unsupported flags instead of silently ignoring them
- [x] Reduce maintenance risk by extracting CLI dashboard/help/prompt helpers from `src/cli.ts`
- [x] Reduce throughput risk with bounded-concurrency execution in ranking/learning orchestration
- [x] Run test + build verification

## Task: Fix long-run `learn` mode talib-wasm OOB runtime trap (2026-02-23)
- [x] Verify source of `[learn] memory access out of bounds` with isolated stress reproduction
- [x] Harden talib runtime adapter with safe refresh path (cache reset + listener cleanup)
- [x] Add proactive refresh scheduling and trap-triggered refresh in indicator service
- [x] Tighten numeric input validation before wasm calls
- [x] Run tests + build and document root cause in response

## Task: Document architecture (2026-02-13)
- [x] Capture current clean-architecture boundaries and dependency rules
- [x] Document runtime flows (interactive mode, rec mode, simulation path)
- [x] Add `docs/ARCHITECTURE.md` with component map and data flow

## Task: Document current implementation state (2026-02-13)
- [x] Audit current CLI flows, recommendation logic, and rec mode behavior
- [x] Create `docs/CURRENT_STATE.md` with architecture, capabilities, and constraints snapshot
- [x] Verify commands and references in the snapshot

## Task: Optional auto-order placement via Backpack (proposed)
- [ ] Confirm scope override for `AGENTS.md` non-goal (`no trade execution`)
- [ ] Add authenticated Backpack trading port + adapter for limit order placement
- [ ] Extend CLI flow with post-recommendation confirmation to place optional limit order
- [ ] Validate order inputs (symbol, side, price, quantity, tif) and enforce dry-run safeguards
- [ ] Add application use-case to map recommendation levels to order payload
- [ ] Add unit tests with HTTP mocking for auth signing, payload generation, and error handling
- [ ] Document setup (API key/secret env vars), risks, and usage in README

## Task: `rec` top-opportunities mode (2026-02-12)
- [x] Add CLI parameter parsing for `rec` mode
- [x] Implement ranked top-5 opportunity scan with positive-PnL probability scoring
- [x] Print ordered recommendations (highest to lowest)
- [x] Add/update tests for parser and ranking logic
- [x] Update README usage with the new `rec` command

## Task: README usage documentation (2026-02-12)
- [x] Audit current CLI behavior and available commands
- [x] Add README with installation, run modes, and examples
- [x] Ensure documented commands align with `package.json` scripts

## Task: 15-minute simulation mode (2026-02-12)
- [x] Add a pure domain evaluator for paper-trade outcomes from future candles
- [x] Integrate optional simulation prompt into quick/full interactive flows
- [x] Run simulation asynchronously (non-blocking) and print pass/fail after 15 minutes
- [x] Cover simulation outcome logic with unit tests
- [x] Update README with simulation usage

## Task: Objective + Horizon target policy (2026-02-12)
- [x] Add domain targeting policy for objective-driven TP/SL, horizon defaults, and ATR plausibility checks
- [x] Wire objective/horizon inputs through query parser, prompt flows, use-case, and recommendation engine
- [x] Extend trade-level output with objective/horizon/time-stop/plausibility details
- [x] Add unit tests for objective math, LONG/SHORT level math, duration parsing, candle conversion, and plausibility warning

## Task: Split manual SL/TP into explicit mode (2026-02-12)
- [x] Add `--manual-levels` mode flag and prevent mixing with objective/horizon targeting
- [x] Enforce objective/horizon mode to accept exactly one input (objective or horizon)
- [x] Route quick/full prompts by selected mode without ambiguous combinations
- [x] Add tests for new parsing and horizon-only objective derivation

## Task: Update runtime defaults (2026-02-12)
- [x] Set leverage default to 20
- [x] Keep size default at 250 explicitly in prompts/docs
- [x] Set horizon default to 15 minutes in prompt flow and objective fallback policy

## Task: Interactive help command (2026-02-12)
- [x] Add `help` command handling in prompt loop
- [x] Print concise command and flag reference from interactive mode
- [x] Document `help`/`?` in README interactive usage

## Task: Simulation horizon sync (2026-02-12)
- [x] Use user-provided horizon minutes for simulation timespan when available
- [x] Keep 15-minute fallback when no horizon is set
- [x] Update interactive help and README to reflect simulation timespan behavior

## Task: Always-on simulation behavior (2026-02-12)
- [x] Remove NO_TRADE simulation skip behavior
- [x] Infer simulation direction from recommendation levels when signal is NO_TRADE
- [x] Update help text and README to reflect always-on simulation behavior

## Task: Short-timeframe robustness filters (2026-02-12)
- [x] Add VWAP no-trade band filter for near-VWAP chop
- [x] Add ATR-regime adaptive TP/SL multipliers in base recommendation path
- [x] Add tests for VWAP guard and ATR-adaptive TP/SL behavior

## Task: In-app `rec` command (2026-02-12)
- [x] Add `rec` interactive command in the main prompt loop
- [x] Reuse existing top-opportunities use-case in interactive mode
- [x] Update interactive help text and README command list

## Task: Align `rec` with single-symbol defaults (2026-02-12)
- [x] Pass quick-mode default settings (1m/15m, leverage 20, size 250, horizon 15) in rec scan
- [x] Add test coverage to verify rec generator call defaults

## Task: Dynamic `rec` symbol universe (2026-02-12)
- [x] Replace fixed rec symbol list with top 15 PERP symbols by 24h volume from Backpack
- [x] Wire symbol universe provider into rank use-case and CLI rec command
- [x] Add tests for dynamic symbol fetch and ranking use-case fallback path

## Task: Transparent `rec` universe preview (2026-02-12)
- [x] Print pre-scan notice when fetching top symbols by volume
- [x] Print selected symbols with 24h volume and open interest before ranking
- [x] Add adapter test coverage for volume + open interest symbol snapshot

## Task: High-impact single-symbol mode phase 1 (2026-02-15)
- [x] Add regime classifier in domain with explicit classes: trend/range/volatile-spike/low-liquidity-chop
- [x] Apply regime-specific TP/SL profile selection in recommendation engine base path
- [x] Add execution realism metrics (net TP/SL PnL, net R/R, EV) from simple fee+slippage model
- [x] Extend trade-level console output with regime + EV/net metrics
- [x] Add/adjust tests for regime classification and EV/net output math

## Task: Recent-candle anti-fade filter (2026-02-16)
- [x] Add recent candle context to indicator snapshot (momentum, close skew, breakout impulse)
- [x] Use recent-candle context in recommendation scoring to avoid shorting strong pumps / longing strong dumps
- [x] Add no-trade guard when signal fades a strong opposite impulse
- [x] Add unit test for anti-fade behavior

## Task: Short-term quality pipeline + watch mode (2026-02-16)
- [x] Add setup-quality scoring + confidence decomposition in domain output
- [x] Add breakout validation and pullback-extension no-trade guards
- [x] Add volatility-normalized thresholds for impulse/VWAP proximity logic
- [x] Add session-level cooldown + confidence calibration from simulation outcomes
- [x] Add optional read-only watch mode that rechecks symbols and prints only status changes
- [x] Add tests for new guards/scoring behavior

## Task: Remove user objective input (2026-02-16)
- [x] Remove `--objective` from query parsing and interactive help/usage
- [x] Keep horizon-based targeting flow as the default non-manual mode
- [x] Update watch command parsing to accept horizon only
- [x] Update README and parser tests

## Task: Two-section interactive console layout (2026-02-16)
- [x] Add top watch section that refreshes in place with latest watch status
- [x] Add bottom single-symbol section that stores and shows latest output only
- [x] Route recommendation/rec/simulation output through dashboard renderer instead of streaming logs

## Task: Persistent learning calibration (2026-02-16)
- [x] Add learning store port + persistence adapter for local outcome history
- [x] Add adaptive learning service for rolling confidence calibration + dynamic quality gates
- [x] Wire simulation outcomes into persistence for continuous learning
- [x] Apply learned policy in single-symbol and watch recommendation flows
- [x] Add unit tests for adaptive learning policy behavior

## Task: Enforce SQLite requirement (2026-02-16)
- [x] Remove in-memory learning fallback path
- [x] Make startup require SQLite adapter initialization
- [x] Update dependency/docs to require `better-sqlite3`

## Task: Background learn command (2026-02-16)
- [x] Add interactive `learn --start` and `learn --stop` commands
- [x] Reuse rec-style symbol selection for learning universe
- [x] Schedule background simulations for horizons 5/10/15/30/60/90 per selected symbol
- [x] Ensure learn runner can stop cleanly and cancel pending timers

## Task: Remove deprecated CLI flags/modes (2026-02-16)
- [x] Remove `-i/--interactive` and full interactive prompt flow
- [x] Remove `--manual-levels` parser/validation and manual SL/TP prompt flow
- [x] Remove `watches` command/help/docs references
- [x] Update parser tests and usage/help text

## Task: Setup grading for short intraday quality (2026-02-16)
- [x] Add domain setup grading (`A/B/C/D`) using location/trigger/microstructure/regime/risk/friction factors
- [x] Blend setup grade into confidence and tighten short-timeframe no-trade guards
- [x] Surface setup grade in console output
- [x] Add tests for setup grade output and stricter short-timeframe quality gating

## Task: Horizon-adaptive timeframe selection (2026-02-16)
- [x] Auto-select base/bias timeframe from selected horizon in single-symbol flow
- [x] Apply the same adaptive timeframe logic in watch iterations
- [x] Surface active adaptive timeframe in single-symbol output
- [x] Update CLI help and README notes

## Task: Optional expected-range query mode (2026-02-16)
- [x] Add `--expected <minutes>` parser support for single-symbol commands
- [x] Keep expected low/high hidden in default output
- [x] Add dedicated expected-range output view for explicit expected queries
- [x] Update help/readme and parser tests for expected mode

## Task: Simplify defaults after adaptive timeframe rollout (2026-02-16)
- [x] Remove manual timeframe/bias prompts from `defaults` command
- [x] Keep defaults limited to leverage/size/horizon
- [x] Update help/readme text to reflect horizon-based timeframe selection

## Task: Optional AI secondary opinion (phase 1) (2026-02-17)
- [x] Add AI advisor port and application use-case for normalized recommendation snapshots
- [x] Add OpenAI adapter with env-key config and strict JSON parsing
- [x] Add `--ai` flag in single-symbol parser and CLI flow
- [x] Render AI opinion block in single-symbol output as additional context only
- [x] Add tests for AI use-case mapping and parser support

## Task: Learning failure decomposition for SL-hit rebounds (2026-02-17)
- [x] Add simulation outcome classification fields (wrong-direction vs tight-stop rebound)
- [x] Persist decomposition fields in SQLite learning store with safe schema migration
- [x] Use decomposed failures in adaptive learning policy (reduced penalty for tight-stop rebounds)
- [x] Add/adjust tests for simulation classification and adaptive-policy behavior

## Task: Reduce false contrarian calls in clear trend structure (2026-02-18)
- [x] Audit recommendation scoring/guard paths that flip obvious trend continuations
- [x] Add direction-consensus biasing to avoid shorting strong bullish structure (and vice versa)
- [x] Relax/target guards so continuation setups are not blocked without true opposition evidence
- [x] Add regression tests for "looks long/short" directional alignment cases
- [x] Refresh `docs/CURRENT_STATE.md` to match current runtime behavior and latest signal logic

## Task: Reconcile stale docs/spec with current runtime (2026-02-18)
- [x] Update `AGENTS.md` requirements/commands to match current interactive-first CLI and persistence model
- [x] Rewrite stale `docs/ARCHITECTURE.md` sections (runtime flows, ports, constraints, paths) to current implementation
- [x] Verify docs no longer reference removed flags/modes (`-i`, `--objective`, `--manual-levels`) or stateless behavior

## Task: Enforce single startup entry (`npm run dev`) (2026-02-18)
- [x] Remove startup `rec`/flag handling from CLI argument parser
- [x] Keep `rec`/help behavior available only inside interactive prompt
- [x] Update tests and docs to reflect "no startup args" rule

## Task: Clean Architecture compliance refactor (2026-02-18)
- [x] Invert use-case dependencies to ports (indicator/recommendation policies, richer market-data contracts)
- [x] Remove framework/library coupling from domain by moving technical-indicator implementation to adapters
- [x] Move input parsing from application layer into console adapter layer
- [x] Extract learning/watch/simulation/rec orchestration out of `cli.ts` into application use-cases/services
- [x] Route OpenAI adapter through shared HTTP abstraction instead of direct axios calls
- [x] Update tests/docs and verify build + test after refactor

## Task: Make AI opinion default (2026-02-18)
- [x] Remove `--ai` flag requirement from parser/help/docs
- [x] Run AI secondary opinion by default for normal symbol analysis
- [x] Keep expected-range-only mode free of AI blocks
- [x] Update tests and docs to reflect default AI behavior

## Task: Enrich AI secondary opinion with agreement/regime context (2026-02-18)

## Task: Align learning cycle with live engine settings (2026-02-19)
- [x] Pass runtime defaults (leverage, size) into learning cycle generation
- [x] Use horizon-adaptive base/bias timeframe per learning candidate horizon
- [x] Add regression tests for learning-cycle input mapping and candidate interval output
- [x] Update current-state docs to state that learning excludes AI advisory and mirrors runtime timeframe policy

## Task: Standardize learning horizons (2026-02-19)
- [x] Restrict background learning horizons to 15/30/60/90 minutes
- [x] Update docs/help-visible behavior accordingly
- [x] Run test suite

## Task: Persist rich learning snapshots (2026-02-19)
- [x] Extend learning outcome contract with recommendation snapshot payload
- [x] Persist snapshot JSON and key analysis fields in SQLite (with migration-safe column adds)
- [x] Record full recommendation context during simulation outcome writes
- [x] Add/adjust tests for snapshot persistence contract
- [x] Update state docs and run full tests
- [x] Extend AI response schema with `agreement`, `overruledSignals`, and `regime`
- [x] Update OpenAI prompt/parsing and type contracts for the new fields
- [x] Render the new fields in console AI output
- [x] Add/update tests for mapping and parsing expectations

## Task: Harden OpenAI request compatibility fallback (2026-02-18)
- [x] Add retry strategy for Chat Completions token-limit parameter compatibility
- [x] Keep retries on the configured model only (no cross-model fallback)
- [x] Add adapter tests for retry path and error behavior

## Task: Enforce single-shot OpenAI request with raw error passthrough (2026-02-18)
- [x] Remove OpenAI request retries/parameter switching
- [x] Remove unsupported temperature override for model-default-only endpoints
- [x] Keep detailed API error messages surfaced in CLI and adapter tests

## Task: Persist OpenAI HTTP error diagnostics to logfile (2026-02-18)
- [x] Remove terminal dump of full OpenAI response payload
- [x] Log failed OpenAI HTTP calls with request/response diagnostics to local file
- [x] Keep runtime behavior non-blocking if logging itself fails

## Task: Simplify AI output to actionable veto/change signals (2026-02-18)
- [x] Extend AI response schema with veto/change booleans
- [x] Parse and validate new booleans in OpenAI adapter
- [x] Replace verbose AI section in setup block with concise veto/change summary
- [x] Include concrete suggested values when a change flag is true

## Task: Increase watch polling cadence to 30 seconds (2026-02-18)
- [x] Change watch default interval from 1 minute to 30 seconds
- [x] Allow fractional minute values for `watch --every` (e.g. `0.5`)
- [x] Update interactive help and README examples for new cadence

## Task: Keep watch timestamp aligned with latest poll (2026-02-18)
- [x] Update watch row timestamp on every successful poll, not only on signature change

## Task: Address architecture/SWE audit findings (2026-02-18)
- [x] Keep AI transport adapter focused on transport/parsing; move AI consistency policy to application layer
- [x] Replace verbose AI user-facing failure text with generic message and log-file pointer
- [x] Harden OpenAI HTTP error logging (sanitize payload + simple file rotation)
- [x] Extract watch command parser into console adapter and add cadence parser tests

## Task: Replace AI veto flag with explicit AI action semantics (2026-02-18)
- [x] Replace `veto` with `aiAction` (`KEEP|REJECT|ADJUST`) across AI port, prompt schema, parser, and console rendering
- [x] Enforce application-level consistency rules for `aiAction` vs change flags and suggested values
- [x] Update AI adapter/use-case tests to the new contract
- [x] Verify with full test suite and build

## Task: Keep non-technical AI responses visible (2026-02-18)
- [x] Stop treating AI contract inconsistencies as runtime errors in application layer
- [x] Continue showing parseable AI output in UI without fallback warning
- [x] Keep warning + error-log behavior for technical AI failures only

## Task: Persist AI model in defaults JSON (2026-02-18)
- [x] Extend trade defaults schema/storage with `aiModel` and fallback to `gpt-5.2`
- [x] Use persisted default model when constructing OpenAI advisor
- [x] Update `defaults` command to edit and display model, applying changes immediately
- [x] Refresh docs/defaults file to reflect AI model persistence

## Task: Remove redundant AI response fields (2026-02-18)
- [x] Simplify AI schema by removing duplicated action/change flags from requested response
- [x] Keep only unique decision outputs (`bias` + optional suggested levels + rationale metadata)
- [x] Update parser/types/tests and derive UI change indicators from remaining fields

## Task: Strengthen market microstructure + validation pipeline (2026-02-19)
- [x] Add orderbook-derived features (imbalance, spread, microprice premium) to market snapshot
- [x] Add volume-derived indicators (OBV, MFI, CMF, volume z-score / flow proxy) to indicator snapshot
- [x] Extend recommendation scoring with volume + orderbook + OI-delta confluence
- [x] Introduce horizon-bucket A/B report command from persisted learning outcomes
- [x] Set default indicator engine to `talib-wasm` with adapter-based swap via `INDICATOR_ENGINE`
- [x] Update tests and docs for new commands/fields and verify build+test

## Task: Post-audit cleanup (2026-02-19)
- [x] Remove misleading multi-engine indicator naming and legacy alias path
- [x] Keep indicator initialization explicit to `talib-wasm` only
- [x] Wrap CLI startup initialization in robust error handling
- [x] Run test + build after cleanup

## Task: Horizon/regime-adaptive indicator weighting (2026-02-19)
- [x] Add domain policy for deterministic indicator weight profiles by horizon bucket + market regime
- [x] Integrate weighted scoring channels into recommendation evaluation path
- [x] Surface active weight profile in rationale output for transparency
- [x] Add policy tests and regression checks, then verify build + tests

## Goal
Initialize a minimal, clean-architecture TypeScript CLI (`miau-trader`) that outputs Entry/Stop Loss/Take Profit using Backpack public market data and technical indicators.

## Steps
- [x] Scaffold project configuration and scripts
- [x] Implement domain indicator and recommendation logic
- [x] Implement ports and application use case
- [x] Implement Backpack adapter and console presenter
- [x] Implement CLI argument parsing and entrypoint
- [x] Add tests for input parsing and Backpack API retrieval with mocking
- [x] Verify build/test workflow
- [x] Enforce PERP-only Backpack market resolution and kline request shape
- [x] Switch CLI to interactive symbol prompt (no pair CLI arg)
- [x] Add Backpack PERP context (funding/open interest/mark premium) and extended indicators
- [x] Add optional leverage/position-size input and estimated PnL at SL/TP
- [x] Add user SL/TP overrides with percent (`--sl`, `--tp`) and USD (`--sl-usd`, `--tp-usd`) flags
- [x] Add intraday defaults (`1m`) and higher-timeframe bias via `--tf` and `--bias-tf`

## Completion Criteria
- `npm run dev -- BTC-USD` prints a structured recommendation
- `npm run build` succeeds
- `npm test` succeeds
- Architecture boundaries from `AGENTS.md` are respected

## Task: Persist single-symbol query snapshots into learning data (2026-02-19)
- [x] Add a query-observation persistence path in adaptive learning service
- [x] Extend learning outcome model/storage to support non-evaluated query rows
- [x] Record single-symbol recommendations after generation in interactive flow
- [x] Keep adaptive policy stats based only on evaluated SUCCESS/FAILURE outcomes
- [x] Add/update tests for new persistence and stats filtering behavior

## Task: Fix architecture + code audit findings (2026-02-19)
- [x] Fix simulation time anchoring so evaluation uses recommendation-open timestamp
- [x] Reject non-positive horizon values at input/default parsing boundaries
- [x] Move session calibration/cooldown policy out of `cli.ts` into application layer
- [x] Add regression tests for delayed simulation scheduling + time anchoring
- [x] Run build and test suite

## Task: Hierarchical learning policy + shrinkage (2026-02-19)
- [x] Extend learning stats query to support optional scope filters
- [x] Add flexible scoped stats retrieval in SQLite adapter
- [x] Blend specific + broader bucket stats in adaptive learning policy with sample-size shrinkage
- [x] Keep failure-type weighting and strictness gating using best-available recent context
- [x] Update adaptive learning tests for sparse-bucket fallback behavior and run build+tests

## Task: Fix pending learning insert parameter binding (2026-02-20)
- [x] Bind optional simulation fields (`mfe/mae/pnl`) safely when absent
- [x] Add regression coverage for omitted optional fields in SQLite store writes
- [x] Run tests

## Task: Include NO_TRADE setups in background learning (2026-02-20)
- [x] Stop dropping `NO_TRADE` candidates during learning cycle selection
- [x] Apply counterfactual-friendly gating for `NO_TRADE` candidates (skip confidence floor, keep quality/regime controls)
- [x] Add regression test proving `NO_TRADE` candidate inclusion
- [x] Run tests and update state docs

## Task: Full-coverage learning cycle (2026-02-20)
- [x] Remove pre-gating filters from learning candidate selection so all generated setups are simulated
- [x] Keep failure handling limited to data/runtime errors only
- [x] Update learning-cycle tests to reflect no-filter candidate inclusion behavior
- [x] Update state docs and run full tests

## Task: Reduce tight-stop stopouts with deterministic + learned widening (2026-02-20)
- [x] Add deterministic minimum SL distance floor in objective targeting to avoid ultra-tight stops in low-vol conditions
- [x] Add learning-driven stop widening factor from tight-stop rebound failure rate
- [x] Recompute recommendation risk/pnl metrics after learning stop widening adjustments
- [x] Add/adjust tests for targeting floors and adaptive widening behavior
- [x] Update state docs and run full tests
