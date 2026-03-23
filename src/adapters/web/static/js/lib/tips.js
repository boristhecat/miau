/**
 * Centralized tooltip / explanation texts for the UI.
 *
 * Usage:  import { tips } from "../lib/tips.js";
 *         title=${tips.signal.long}
 *
 * Keys are grouped by UI area. Every value is a plain string
 * suitable for a `title` attribute or any hover-text mechanism.
 */

// ─── Signals & Direction ────────────────────────────────────

const signal = {
  long:    "Engine recommends a buy position",
  short:   "Engine recommends a sell position",
  noTrade: "Conditions do not support a trade \u2014 guards blocked or no signal",
  forced:  "You forced a directional bias \u2014 engine evaluated this direction even if its own signal disagreed",
};

// ─── Header / Top-line ──────────────────────────────────────

const header = {
  confidence:
    "Overall confidence \u2014 weighted blend of trend, momentum, volatility, structure, context, and setup quality. Below 40 is low conviction, above 70 is high conviction",
  grade:
    "Setup quality grade (A best, D worst)",
  riskReward:
    "Risk-to-reward \u2014 dollars risked to stop vs gained at target. Below 1.5 means the trade needs a high win rate to be profitable",
  structureState:
    "Market structure \u2014 derived from swing highs/lows. Bullish = higher highs + higher lows. Bearish = lower highs + lower lows. Consolidation = no clear direction",
  mtfAlignment:
    "Multi-timeframe alignment \u2014 checks if the structure and directional timeframes agree with the execution timeframe. Full = all agree, Partial = mixed signals, Conflicting = higher timeframes oppose the trade",
};

// ─── Engine Levels (Column 1) ───────────────────────────────

const levels = {
  entry:
    "Recommended entry price \u2014 where the engine suggests opening the position",
  stop:
    "Stop loss \u2014 exit here to cap downside. Percentage shows distance from entry",
  target:
    "Take profit \u2014 exit here to lock in gains. Percentage shows distance from entry",
  liquidation:
    "Estimated liquidation price at this leverage \u2014 exchange force-closes your position here",
  aiLevels:
    "Alternative entry, stop, and target prices suggested by the AI model \u2014 compare with engine levels for confluence",
};

const liquidationRisk = {
  safe:      "Liquidation is far beyond stop \u2014 no cascade risk",
  moderate:  "Liquidation is within a few stop-distances",
  dangerous: "Liquidation is close to stop \u2014 a spike could skip your stop and liquidate",
  critical:  "Liquidation is closer than your stop loss",
};

// ─── App Badges (Rationale area) ────────────────────────────

const playbook = {
  label:
    "Detected setup pattern \u2014 the engine matched current price action to a known playbook. Regime-aligned setups have higher historical win rates",
  misaligned:
    "Setup pattern detected but misaligned with current regime \u2014 lower expected win rate",
};

const regime = {
  label:     "Current market regime classification",
  trend:     "Clear directional move, momentum strategies favored",
  range:     "Price oscillating between support/resistance, fade strategies favored",
  volatileSpike: "Sharp expansion, high risk of fakeouts",
  lowLiqChop:    "Thin book, random wicks \u2014 avoid trading",
};

const tradeability = {
  tradeable:  "Conditions support a trade",
  caution:    "One or more warning flags \u2014 smaller size or tighter stops advised",
  doNotTrade: "Conditions are hostile \u2014 session, spread, regime, or structure guards are blocking",
};

const entryReadiness = {
  readyNow:          "Price is at a valid entry",
  waitPullback:      "Signal is right but price extended \u2014 let it retrace",
  waitBreakoutRetest:"Breakout happened, wait for a pullback to the broken level",
  waitConfirmation:  "Signal forming but not confirmed \u2014 need another candle",
  tooLate:           "Move already happened, chasing here gives bad R:R",
};

const session = {
  asia:   "Lower volume, tighter ranges, breakouts less reliable",
  london: "Highest volume session, most impulsive moves",
  us:     "Strong follow-through or reversal of London move",
  dead:   "Session transition, thin liquidity \u2014 fakeout risk",
  fakeoutWindow:
    "First 15\u201330 minutes of a session \u2014 initial moves often reverse. Wait for confirmation before entering",
  asiaBreak:
    "Price broke above/below the Asia session range \u2014 a directional signal for London/US continuation",
  londonExpansion:
    "London session expansion \u2014 the impulsive direction of the London open. Often defines the day\u2019s trend",
};

const structureBreak = {
  bos:   "Break of Structure \u2014 price broke a swing point in the direction of the trend, continuation signal",
  choch: "Change of Character \u2014 price broke a swing point against the trend, potential reversal, higher risk",
};

const funding = {
  strongContraLong:
    "Funding is heavily negative \u2014 shorts are paying longs, crowded short positioning may fuel a squeeze",
  weakContraLong:
    "Mildly negative funding \u2014 slight short bias in positioning",
  neutral:
    "Balanced funding \u2014 no positioning signal",
  weakContraShort:
    "Mildly positive funding \u2014 slight long bias in positioning",
  strongContraShort:
    "Heavily positive funding \u2014 crowded longs may get flushed",
};

const cluster = {
  supportsDirection:
    "Liquidation cluster cascade supports trade direction \u2014 forced exits will push price toward your target",
  blocksTarget:
    "Liquidation cluster between entry and stop \u2014 cascade could accelerate an adverse move",
};

const cvd = {
  bearish: "Price rising but flow weakening \u2014 buyers losing conviction",
  bullish: "Price falling but flow absorbing \u2014 sellers losing conviction",
};

// ─── Position & Risk (expandable) ───────────────────────────

const position = {
  leverage:
    "Leverage multiplier \u2014 amplifies both gains and losses. Higher leverage brings the liquidation price closer to entry",
  positionSize:
    "Margin (collateral) committed to this trade \u2014 your actual capital at risk before leverage",
  notional:
    "Notional value \u2014 the full position size after leverage. This is what moves your P&L",
  fees:
    "Estimated round-trip fee burden \u2014 maker/taker fees for open + close, as percentage of position",
  netPnl:
    "Estimated net P&L in USD at target / stop, after fees and projected funding costs",
  netRiskReward:
    "Net risk-to-reward after execution costs \u2014 the actual R:R you get after fees and slippage eat into the gross levels",
  timeExit:
    "Time-based exit \u2014 if target is not hit within this window, exit at breakeven to avoid holding a stale thesis",
  winRate:
    "Calibrated win rate \u2014 historical probability of hitting TP before SL, based on the learning system\u2019s paper-trade data",
  preferredEntry:
    "Preferred entry price \u2014 a better entry point the engine identified. Wait for price to reach here if you\u2019re not in a hurry",
  channels:
    "Independent channel agreement \u2014 how many of the 4 signal channels (trend, momentum, structure, flow) agree with the direction. 4/4 = strongest conviction",
  expectedRange:
    "Expected price range over the objective horizon \u2014 the engine\u2019s projected high/low band for this timeframe",
};

// ─── Indicators ─────────────────────────────────────────────

const indicators = {
  rsi:
    "RSI (14) \u2014 momentum oscillator. Below 30 = oversold, above 70 = overbought. Divergence from price signals potential reversals",
  adx:
    "ADX (14) \u2014 trend strength. Below 20 = no trend (range), above 25 = trending, above 40 = strong trend. Does not show direction",
  atr:
    "ATR (14) \u2014 average true range in price units. Measures volatility \u2014 used for stop distance, position sizing, and expected move calculations",
  ema:
    "EMA 20/50 \u2014 exponential moving averages. Price above both = bullish structure. EMA20 crossing below EMA50 = bearish crossover",
  vwap:
    "VWAP \u2014 volume-weighted average price. Institutional benchmark. Price above VWAP = buyers in control, below = sellers. Reclaim/rejection of VWAP is a key signal",
  macd:
    "MACD \u2014 trend-following momentum. Positive = bullish momentum, negative = bearish. Crossing the signal line confirms direction changes",
  macdHistogram:
    "MACD histogram \u2014 momentum acceleration. Growing bars = momentum building, shrinking bars = momentum fading",
  stochRsi:
    "Stochastic RSI K/D \u2014 fast momentum oscillator. Below 20 = oversold, above 80 = overbought. K crossing above D = bullish, below = bearish",
  mfi:
    "MFI (14) \u2014 money flow index. Like RSI but volume-weighted. Below 20 = oversold with volume confirmation, above 80 = overbought",
  cmf:
    "CMF (20) \u2014 Chaikin money flow. Positive = buying pressure, negative = selling pressure. Divergence from price = flow doesn\u2019t confirm the move",
};

// ─── Market / Perp ──────────────────────────────────────────

const market = {
  markPrice:
    "Mark price \u2014 exchange\u2019s fair price used for P&L and liquidation calculations",
  indexPrice:
    "Index price \u2014 spot reference from major exchanges. Difference from mark = basis/premium",
  fundingRate:
    "Current and average funding rate. Positive = longs pay shorts, negative = shorts pay longs. Extreme values signal crowded positioning",
  premium:
    "Premium \u2014 mark-to-index spread. Positive = futures trading above spot (bullish sentiment), negative = below (bearish)",
  openInterest:
    "Open interest \u2014 total outstanding contracts. Rising OI + rising price = new longs. Falling OI + rising price = short covering",
  oiDelta:
    "OI delta \u2014 change in open interest. Combined with price direction, reveals positioning flow",
  oiNewLongs:    "OI rising + price rising \u2014 fresh buying entering the market",
  oiNewShorts:   "OI rising + price falling \u2014 fresh selling entering the market",
  oiShortCover:  "OI falling + price rising \u2014 shorts closing positions, not new buying",
  oiLongLiq:     "OI falling + price falling \u2014 longs being forced out, cascading sells",
  spread:
    "Bid-ask spread \u2014 the cost of immediacy. Wide spread = low liquidity, higher slippage. Avoid trading when spread is abnormally wide",
};

// ─── Confidence Breakdown ───────────────────────────────────

const confidenceBreakdown = {
  trend:
    "Trend score \u2014 how clearly price is trending (EMA alignment, ADX, structure). High = strong trend, low = choppy",
  momentum:
    "Momentum score \u2014 strength and direction of RSI, MACD, Stoch RSI. High = strong directional push, low = exhaustion or divergence",
  volatility:
    "Volatility score \u2014 whether current volatility supports the trade. Penalizes both too-low (no move expected) and too-high (chaotic spikes)",
  structure:
    "Structure score \u2014 market structure alignment (swing points, BOS/CHOCH, order blocks, FVGs). High = price action confirms the direction",
  context:
    "Context score \u2014 session timing, funding, BTC correlation, regime fitness. High = favorable environment, low = hostile conditions",
  setupQuality:
    "Setup quality score \u2014 how well current price action matches a known playbook pattern. High = textbook setup, low = ambiguous",
};

// ─── Structure & Levels ─────────────────────────────────────

const structureLevels = {
  bullishFvg:
    "Bullish Fair Value Gap \u2014 an imbalance zone below price where buyers didn\u2019t let sellers fill. Price often returns to fill this gap. Acts as support",
  bearishFvg:
    "Bearish Fair Value Gap \u2014 an imbalance zone above price where sellers didn\u2019t let buyers fill. Acts as resistance",
  orderBlock:
    "Order Block \u2014 the last candle before an impulsive move. Smart money entry zone. Bullish OB = demand (support), Bearish OB = supply (resistance)",
  equalHighs:
    "Equal Highs \u2014 multiple swing highs at the same price. Liquidity pool \u2014 stop losses cluster here. Price often sweeps through before reversing",
  equalLows:
    "Equal Lows \u2014 multiple swing lows at the same price. Liquidity pool \u2014 stop losses cluster here. Price often sweeps through before reversing",
  liqCluster:
    "Estimated liquidation cluster \u2014 concentration of projected liquidation prices. When price reaches here, forced exits cascade and accelerate the move",
};

// ─── Context ────────────────────────────────────────────────

const context = {
  nearHtfResistance:
    "Price is approaching higher-timeframe resistance \u2014 upside may be capped. Consider tighter targets or skipping longs",
  nearHtfSupport:
    "Price is sitting on higher-timeframe support \u2014 downside may be limited. Consider tighter targets or skipping shorts",
  journalInsight:
    "Paper-trading journal found similar past setups \u2014 shows historical win rate and average P&L for this type of trade",
};

// ─── AI Column ──────────────────────────────────────────────

const ai = {
  bias:
    "AI\u2019s independent directional read \u2014 its own analysis of whether the setup favors long or short, ignoring the engine\u2019s signal",
  agree:
    "AI independently reached the same conclusion as the engine",
  partial:
    "AI sees the direction but has reservations about timing, levels, or conditions",
  disagree:
    "AI\u2019s read opposes the engine \u2014 higher uncertainty, consider reducing size",
  confidenceHigh:
    "AI has strong conviction in its own read",
  confidenceMedium:
    "AI sees the case but notes risks \u2014 moderate conviction",
  confidenceLow:
    "AI is uncertain or sees conflicting signals in its analysis",
  regime:
    "AI\u2019s own regime classification \u2014 compare with the engine\u2019s regime badge. Divergence suggests ambiguous conditions",
  altThesis:
    "Alternative scenario the AI considers plausible \u2014 if this plays out, the trade is wrong. Watch for the invalidation condition",
  invalidation:
    "Price level or condition where the entire thesis breaks \u2014 if this happens, the trade is dead regardless of what the engine says",
  riskNote:
    "Key risk factor the AI flagged \u2014 something that could hurt this trade even if the direction is right (timing, liquidity, event risk)",
  model:
    "AI model used for this analysis \u2014 for reproducibility and comparing advisory quality across models",
};

// ─── Monitor ────────────────────────────────────────────────

const monitor = {
  entryLeverage:
    "Entry price and leverage for this monitored position",
  grossPnlPct:
    "Gross unrealized P&L \u2014 current mark-to-entry return before fees",
  grossPnlUsd:
    "Gross unrealized P&L in USD \u2014 based on position size and leverage",
  currentR:
    "Current R-multiple \u2014 how many risk units (entry-to-stop distance) the trade has moved in your favor. Negative = moving against you",
  duration:
    "Time in trade since entry",
  healthIntact:
    "Price action supports the thesis \u2014 structure, momentum, and levels align",
  healthDegrading:
    "Warning signs appearing \u2014 structure weakening or momentum fading",
  healthBroken:
    "Thesis invalidated \u2014 price broke key levels or structure reversed",
  actionHold:
    "Trade is on track, no action needed",
  actionAtRisk:
    "Conditions deteriorating, watch closely",
  actionBreakeven:
    "Move stop to entry to eliminate risk",
  actionPartial:
    "Secure some profit, let the rest run",
  actionExitEarly:
    "Thesis damaged, close before stop",
  actionStopHit:
    "Stop loss level was reached",
  actionTargetHit:
    "Take profit level was reached",
  heldPct:
    "Percentage of the planned holding period elapsed \u2014 as this approaches 100%, time-based exit rules may trigger",
};

// ─── Monitor Rail ───────────────────────────────────────────

const rail = {
  markPrice:
    "Current mark price \u2014 the exchange\u2019s fair price for P&L calculation",
  entryLine:
    "Your entry price on this trade",
  clusterDumps:
    "Liquidation cluster \u2014 long liquidations here cascade selling and dump the price",
  clusterPumps:
    "Liquidation cluster \u2014 short liquidations here cascade buying and pump the price",
};

// ─── Fib Column ─────────────────────────────────────────────

const fib = {
  header:
    "Fibonacci levels drawn on this timeframe. \u2191 = retracing an upswing (low\u2192high), \u2193 = retracing a downswing (high\u2192low)",
  goldenZoneBadge:
    "Current price is inside the 0.618\u20130.79 retracement zone \u2014 the highest-probability reversal area for fib entries",
  posBarGoldenBand:
    "Golden zone (0.618\u20130.79) \u2014 price entering this band is the trigger to look for entries",
  posBarMarker:
    "Current price position within the fib range",
  posBarEntry:
    "Engine entry price projected onto the fib range",
  posBarSl:
    "Engine stop loss projected onto the fib range",
  posBarTp:
    "Engine take profit projected onto the fib range",
  ratio: {
    "-1":    "Full extension beyond the swing \u2014 final take-profit target, rarely reached in one move",
    "-0.62": "Deep extension \u2014 aggressive take-profit target, expect strong reaction here",
    "-0.27": "Shallow extension \u2014 conservative first take-profit target beyond the swing",
    "0":     "Swing anchor \u2014 the starting point of the measured move",
    "0.28":  "Shallow retracement \u2014 price barely pulled back, trend is strong but entry is aggressive",
    "0.618": "Golden pocket \u2014 the most-watched fib level, where institutional retracement orders cluster",
    "0.705": "Midline of the golden zone \u2014 optimal entry when 0.618 holds as support/resistance",
    "0.79":  "Deep retracement \u2014 last defense of the golden zone, stop loss often placed just beyond this level",
    "1":     "Swing anchor \u2014 the other end of the measured move",
  },
  tag: {
    extTarget:  "Extension target \u2014 take-profit zone beyond the original swing range",
    swingLow:   "The low anchor of the fib measurement \u2014 a break below invalidates the upswing structure",
    swingHigh:  "The high anchor of the fib measurement \u2014 a break above invalidates the downswing structure",
    shallow:    "Shallow retracement \u2014 trend is dominant, price barely pulled back before continuing",
    entryZone:  "Golden zone boundary \u2014 the highest-probability area to place retracement entries",
    midline:    "Center of the golden zone \u2014 the sweet spot between 0.618 and 0.79 for optimal R:R",
  },
  alignEntry: "Engine entry aligns with this fib level \u2014 structural confluence strengthens the entry",
  alignSl:    "Engine stop loss aligns with this fib level \u2014 stop is anchored to fib structure",
  alignTp:    "Engine take profit aligns with this fib level \u2014 target has fib confluence",
  nearest:    "Price is closest to this fib level \u2014 the current structural context",
};

// ─── Scanner ────────────────────────────────────────────────

const scanner = {
  confidenceMeter:
    "Visual confidence gauge \u2014 green = high conviction, yellow = moderate, red = low",
  confidenceNumber:
    "Engine confidence score (0\u2013100)",
  playbook:
    "Detected playbook \u2014 the price action pattern the engine matched (e.g. trend pullback, breakout, reversal)",
};

// ─── Learning ───────────────────────────────────────────────

const learning = {
  phaseAnalysing:
    "Currently generating a recommendation for this pair/horizon combination",
  phaseEvaluating:
    "Monitoring an open paper trade \u2014 waiting for stop, target, or time exit",
  phaseWaiting:
    "Countdown to next action \u2014 when the learning loop will re-analyse or re-evaluate this slot",
  eventWin:
    "Paper trade hit target before stop or timeout \u2014 a successful simulated trade",
  eventLoss:
    "Paper trade hit stop or timed out at a loss \u2014 used to calibrate future confidence",
  eventNoTrade:
    "Engine returned No Trade \u2014 no position was opened. Tracked for counterfactual analysis",
  eventTimeoutWin:
    "Timed out at a profit \u2014 target wasn\u2019t hit within the holding period but price moved favorably",
  eventTimeoutLoss:
    "Timed out at a loss \u2014 neither stop nor target hit, position closed at a loss",
  eventError:
    "Analysis or evaluation failed \u2014 usually a data-fetch issue, the loop will retry next cycle",
  winRate:
    "Paper-trading win rate for this bucket \u2014 green \u226570%, yellow \u226550%, red <50%. Used to calibrate live confidence scores",
  avgPnl:
    "Average P&L per paper trade in this bucket \u2014 green = net profitable, red = net losing",
  samples:
    "Total paper trades evaluated in this lookback window",
  lookback:
    "How far back the learning system is looking \u2014 older data is excluded to keep calibration fresh",
};

// ─── Export ─────────────────────────────────────────────────

export const tips = {
  signal,
  header,
  levels,
  liquidationRisk,
  playbook,
  regime,
  tradeability,
  entryReadiness,
  session,
  structureBreak,
  funding,
  cluster,
  cvd,
  position,
  indicators,
  market,
  confidenceBreakdown,
  structureLevels,
  context,
  ai,
  monitor,
  rail,
  fib,
  scanner,
  learning,
};
