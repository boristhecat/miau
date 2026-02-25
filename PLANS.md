# Project Plan

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
