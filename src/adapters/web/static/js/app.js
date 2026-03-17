import { $, $$, hide, show } from "./lib/dom.js";
import { fN, prettyToken } from "./lib/format.js";
import { errorMarkup } from "./lib/ui.js";
import { renderAnalyzeResult } from "./views/analyze.js";
import { renderLearning } from "./views/learning.js";
import { renderMonitorSessionCard } from "./views/monitor.js";
import { renderScan } from "./views/scanner.js";

const state = {
  defaults: null,
  lastAnalysis: null,
  monitorSessions: new Map(),
  nextMonitorId: 1,
  scanLoaded: false
};

let toastTimer = null;

async function api(method, path, body) {
  const options = { method, headers: {} };
  if (body) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`/api${path}`, options);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

function toast(message, type = "success") {
  const element = $("#toast");
  element.textContent = message;
  element.className = `toast ${type}`;
  show(element);

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => hide(element), 3000);
}

function setInputValue(selector, value) {
  const element = $(selector);
  if (element) element.value = value ?? "";
}

function readOptionalString(selector) {
  const value = $(selector).value.trim();
  return value ? value : undefined;
}

function readOptionalPositiveNumber(selector, label) {
  const raw = $(selector).value.trim();
  if (!raw) return undefined;
  const number = Number(raw);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`Invalid ${label}.`);
  }
  return number;
}

function syncDefaultInputs(defaults) {
  setInputValue("#qa-leverage", defaults.leverage ?? "");
  setInputValue("#qa-size", defaults.positionSizeUsd ?? "");
  setInputValue("#qa-horizon", defaults.objectiveHorizon ?? "");
  setInputValue("#monitor-leverage", defaults.leverage ?? "");
  setInputValue("#monitor-size", defaults.positionSizeUsd ?? "");
  setInputValue("#monitor-horizon", defaults.objectiveHorizon ?? "");
  setInputValue("#settings-leverage", defaults.leverage ?? "");
  setInputValue("#settings-size", defaults.positionSizeUsd ?? "");
  setInputValue("#settings-horizon", defaults.objectiveHorizon ?? "");
  setInputValue("#settings-ai-model", defaults.aiModel ?? "");
}

function renderDefaultSurfaces(defaults) {
  $("#scan-defaults").innerHTML = [
    `<span>${defaults.leverage}x</span>`,
    `<span>${fN(defaults.positionSizeUsd, 0)} usdc</span>`,
    `<span>${defaults.objectiveHorizon}m</span>`
  ].join("");

  if (!state.lastAnalysis) {
    $("#analyze-echo").textContent = `${defaults.leverage}x / ${fN(defaults.positionSizeUsd, 0)} USDC / ${defaults.objectiveHorizon}m`;
  }
  renderMonitorBoard();
}

function setDefaults(defaults) {
  state.defaults = defaults;
  syncDefaultInputs(defaults);
  renderDefaultSurfaces(defaults);
}

async function ensureDefaults() {
  if (state.defaults) return state.defaults;
  const defaults = await api("GET", "/defaults");
  setDefaults(defaults);
  return defaults;
}

function flashPanel(selector) {
  const element = $(selector);
  if (!element) return;
  element.classList.remove("flash");
  void element.offsetWidth;
  element.classList.add("flash");
}

function switchTab(name) {
  $$(".tab").forEach(button => button.classList.toggle("active", button.dataset.tab === name));
  $$(".panel").forEach(panel => panel.classList.toggle("active", panel.id === `tab-${name}`));

  if (name === "scanner") {
    void ensureScanLoaded();
  }

  if (name === "settings") {
    void loadSettings();
  }
}

function initTabs() {
  $$(".tab").forEach(button => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });
}

function initKeyboard() {
  const tabs = ["overview", "scanner", "monitor", "learning", "settings"];

  document.addEventListener("keydown", event => {
    if (event.target.matches("input, select, textarea")) {
      if (event.key === "Escape") event.target.blur();
      return;
    }

    if (event.key === "/") {
      event.preventDefault();
      $("#qa-symbol").focus();
      $("#qa-symbol").select();
      return;
    }

    if (/^[1-5]$/.test(event.key)) {
      switchTab(tabs[Number(event.key) - 1]);
      return;
    }

    if (event.key === "Escape" && event.shiftKey) {
      const stopped = stopAllMonitorSessions("stopped from keyboard");
      if (stopped > 0) {
        toast(`Stopped ${stopped} monitor stream${stopped === 1 ? "" : "s"}`);
      }
    }
  });
}

function initActionDelegates() {
  document.addEventListener("click", event => {
    const monitorTrigger = event.target.closest("[data-monitor-id]");
    if (monitorTrigger) {
      const id = Number(monitorTrigger.getAttribute("data-monitor-id"));
      if (!Number.isFinite(id)) return;

      if (monitorTrigger.getAttribute("data-monitor-action") === "remove") {
        removeMonitorSession(id);
      } else {
        stopMonitorSession(id, "stopped manually");
      }
      return;
    }

    const analyzeTrigger = event.target.closest("[data-analyze-symbol]");
    if (analyzeTrigger) {
      const symbol = analyzeTrigger.getAttribute("data-analyze-symbol");
      if (symbol) {
        $("#qa-symbol").value = symbol;
        void runAnalysis(symbol);
      }
      return;
    }

    if (event.target.closest("[data-monitor-last-analysis]")) {
      monitorFromAnalysis();
    }
  });
}

function initAnalyze() {
  $("#quick-analyze").addEventListener("submit", async event => {
    event.preventDefault();
    const symbol = $("#qa-symbol").value.trim();
    if (!symbol) return;
    $("#qa-symbol").blur();
    await runAnalysis(symbol, $("#qa-direction").value || undefined);
  });
}

async function runAnalysis(symbol, direction) {
  switchTab("overview");
  flashPanel("#overview-analyze");
  $("#analyze-result").innerHTML = "";
  $("#qa-btn").disabled = true;
  $("#qa-btn").textContent = "Running…";
  $("#qa-btn").classList.add("is-running");

  try {
    await ensureDefaults();

    const payload = { symbol };
    if (direction) payload.direction = direction;

    const leverage = readOptionalPositiveNumber("#qa-leverage", "leverage");
    const positionSizeUsd = readOptionalPositiveNumber("#qa-size", "position size");
    const horizon = readOptionalString("#qa-horizon");

    if (leverage !== undefined) payload.leverage = leverage;
    if (positionSizeUsd !== undefined) payload.positionSizeUsd = positionSizeUsd;
    if (horizon) payload.horizon = horizon;

    $("#analyze-echo").textContent = `Dispatch ${symbol.toUpperCase()} | ${direction || "AUTO"} | ${payload.leverage ?? "default"}x | ${payload.positionSizeUsd ?? "default"} USDC | ${payload.horizon ?? "default"}m`;

    const data = await api("POST", "/analyze", payload);
    state.lastAnalysis = data;
    $("#analyze-result").innerHTML = renderAnalyzeResult(data.recommendation, data.aiAdvice);
    $("#analyze-echo").textContent = `Loaded ${data.recommendation.pair} at ${Math.round(data.recommendation.confidence ?? 0)} confidence`;
  } catch (error) {
    $("#analyze-result").innerHTML = errorMarkup(error.message);
    $("#analyze-echo").textContent = `Analysis error: ${error.message}`;
  } finally {
    $("#qa-btn").disabled = false;
    $("#qa-btn").textContent = "Run";
    $("#qa-btn").classList.remove("is-running");
  }
}

function monitorFromAnalysis() {
  const rec = state.lastAnalysis?.recommendation;
  if (!rec) return;

  $("#monitor-symbol").value = rec.pair.replace(/-USD$/, "");
  $("#monitor-side").value = rec.signal === "SHORT" ? "SHORT" : "LONG";
  $("#monitor-entry").value = rec.entry ?? "";
  $("#monitor-sl").value = rec.stopLoss ?? "";
  $("#monitor-tp").value = rec.takeProfit ?? "";
  $("#monitor-leverage").value = rec.leverage ?? state.defaults?.leverage ?? "";
  $("#monitor-size").value = rec.positionSizeUsd ?? state.defaults?.positionSizeUsd ?? "";
  $("#monitor-horizon").value = rec.objectiveHorizon ?? state.defaults?.objectiveHorizon ?? "";
  $("#monitor-echo").textContent = `Seeded from ${rec.pair} ${rec.signal}`;
  switchTab("monitor");
  flashPanel("#monitor-compose");
}

function initScan() {
  $("#scan-btn").addEventListener("click", () => {
    void loadScan();
  });
}

async function ensureScanLoaded() {
  if (state.scanLoaded) return;
  await loadScan();
}

async function loadScan() {
  show($("#scan-loading"));
  $("#scan-result").innerHTML = "";
  $("#scan-btn").disabled = true;

  try {
    const data = await api("GET", "/scan");
    $("#scan-result").innerHTML = renderScan(data);
    state.scanLoaded = true;
  } catch (error) {
    $("#scan-result").innerHTML = errorMarkup(error.message);
    state.scanLoaded = false;
  } finally {
    hide($("#scan-loading"));
    $("#scan-btn").disabled = false;
  }
}

function initMonitor() {
  $("#monitor-form").addEventListener("submit", event => {
    event.preventDefault();
    startMonitor();
  });
  $("#monitor-stop-all-btn").addEventListener("click", () => {
    const stopped = stopAllMonitorSessions("stopped manually");
    if (stopped > 0) {
      toast(`Stopped ${stopped} monitor stream${stopped === 1 ? "" : "s"}`);
    }
  });
}

function startMonitor() {
  switchTab("monitor");
  flashPanel("#monitor-compose");
  let session = null;

  try {
    const symbol = $("#monitor-symbol").value.trim().toUpperCase();
    const side = $("#monitor-side").value;
    const entry = $("#monitor-entry").value.trim();
    const stopLoss = $("#monitor-sl").value.trim();
    const takeProfit = $("#monitor-tp").value.trim();

    if (!symbol || !entry || !stopLoss || !takeProfit) return;

    const params = new URLSearchParams({ symbol, side, entry, stopLoss, takeProfit });
    const leverage = readOptionalPositiveNumber("#monitor-leverage", "leverage");
    const positionSizeUsd = readOptionalPositiveNumber("#monitor-size", "position size");
    const objectiveHorizon = readOptionalString("#monitor-horizon");

    if (leverage !== undefined) params.set("leverage", String(leverage));
    if (positionSizeUsd !== undefined) params.set("positionSizeUsd", String(positionSizeUsd));
    if (objectiveHorizon) params.set("objectiveHorizon", objectiveHorizon);

    session = {
      id: state.nextMonitorId++,
      symbol,
      pair: `${symbol}-USD`,
      side,
      entry: Number(entry),
      stopLoss: Number(stopLoss),
      takeProfit: Number(takeProfit),
      leverage: leverage ?? state.defaults?.leverage ?? null,
      positionSizeUsd: positionSizeUsd ?? state.defaults?.positionSizeUsd ?? null,
      objectiveHorizon: objectiveHorizon ?? state.defaults?.objectiveHorizon ?? null,
      source: null,
      snapshot: null,
      statusText: `connecting ${symbol} ${side.toLowerCase()} stream`,
      active: true,
      connected: false,
      stopReason: "",
      startedAt: Date.now()
    };

    state.monitorSessions.set(session.id, session);
    renderMonitorBoard(session.id);

    const source = new EventSource(`/api/monitor/stream?${params.toString()}`);
    session.source = source;
    $("#monitor-echo").textContent = `Opening ${symbol} ${side} | ${params.get("leverage") ?? "default"}x | ${params.get("positionSizeUsd") ?? "default"} USDC | ${params.get("objectiveHorizon") ?? "default"}m`;

    source.addEventListener("baseline", event => {
      const data = JSON.parse(event.data);
      if (!state.monitorSessions.has(session.id)) return;
      session.connected = true;
      session.pair = data.trade?.pair ?? session.pair;
      session.statusText = `baseline ready for ${session.pair}`;
      renderMonitorBoard(session.id);
    });

    source.addEventListener("snapshot", event => {
      const snapshot = JSON.parse(event.data);
      if (!state.monitorSessions.has(session.id)) return;
      session.snapshot = snapshot;
      session.connected = true;
      session.pair = snapshot.trade?.pair ?? session.pair;
      session.statusText = `${prettyToken(snapshot.healthStatus ?? "live")} / ${prettyToken(snapshot.managementAction ?? "hold")}`;
      renderMonitorBoard(session.id);

      const terminalAction = String(snapshot.managementAction ?? "").toUpperCase();
      if (terminalAction === "STOP_HIT" || terminalAction === "TARGET_HIT") {
        stopMonitorSession(session.id, prettyToken(terminalAction));
      }
    });

    source.onerror = () => {
      if (!state.monitorSessions.has(session.id)) return;

      if (source.readyState === EventSource.CLOSED) {
        stopMonitorSession(session.id, "connection closed");
        return;
      }

      session.connected = false;
      session.statusText = "reconnecting";
      renderMonitorBoard(session.id);
    };
  } catch (error) {
    if (session && state.monitorSessions.has(session.id)) {
      state.monitorSessions.delete(session.id);
      renderMonitorBoard();
    }
    $("#monitor-echo").textContent = `Monitor error: ${error.message}`;
  }
}

function stopMonitorSession(id, reason = "stopped") {
  const session = state.monitorSessions.get(id);
  if (!session) return false;

  if (session.source) {
    session.source.close();
    session.source = null;
  }

  session.active = false;
  session.connected = false;
  session.stopReason = reason;
  session.statusText = reason;
  renderMonitorBoard(id);
  return true;
}

function stopAllMonitorSessions(reason = "stopped") {
  let stopped = 0;

  state.monitorSessions.forEach(session => {
    if (!session.active) return;

    if (session.source) {
      session.source.close();
      session.source = null;
    }

    session.active = false;
    session.connected = false;
    session.stopReason = reason;
    session.statusText = reason;
    stopped += 1;
  });

  renderMonitorBoard();
  return stopped;
}

function removeMonitorSession(id) {
  const session = state.monitorSessions.get(id);
  if (!session) return;

  if (session.source) {
    session.source.close();
  }

  state.monitorSessions.delete(id);
  renderMonitorBoard();
}

function renderMonitorBoard(flashId) {
  const sessions = Array.from(state.monitorSessions.values()).sort((left, right) => right.startedAt - left.startedAt);
  const board = $("#monitor-board");

  board.innerHTML = sessions.length
    ? sessions.map(renderMonitorSessionCard).join("")
    : `<div class="empty-state">no active monitor sessions</div>`;

  renderMonitorStatusBar(sessions);

  if (flashId && state.monitorSessions.has(flashId)) {
    flashPanel(`#monitor-session-${flashId}`);
  }
}

function renderMonitorStatusBar(sessions = Array.from(state.monitorSessions.values())) {
  const active = sessions.filter(session => session.active).length;
  const connected = sessions.filter(session => session.active && session.connected).length;
  const stopped = sessions.filter(session => !session.active).length;

  const summaryBits = [
    `<span>${active} active trade${active === 1 ? "" : "s"}</span>`,
    `<span>${connected} connected stream${connected === 1 ? "" : "s"}</span>`
  ];

  if (!sessions.length) {
    summaryBits.push("<span>board empty</span>");
  } else if (stopped > 0) {
    summaryBits.push(`<span>${stopped} stopped</span>`);
  } else {
    summaryBits.push(`<span>${sessions.length} on board</span>`);
  }

  $("#monitor-summary").innerHTML = summaryBits.join("");
  $("#monitor-stop-all-btn").disabled = active === 0;

  if (!sessions.length) {
    $("#monitor-echo").textContent = state.defaults
      ? `Ready: ${state.defaults.leverage}x / ${fN(state.defaults.positionSizeUsd, 0)} USDC / ${state.defaults.objectiveHorizon}m`
      : "No active monitor sessions.";
    return;
  }

  const visiblePairs = sessions
    .filter(session => session.active)
    .slice(0, 3)
    .map(session => session.symbol)
    .join(", ");

  if (active > 0) {
    $("#monitor-echo").textContent = `${active} active trade${active === 1 ? "" : "s"}${visiblePairs ? ` | ${visiblePairs}` : ""}`;
    return;
  }

  $("#monitor-echo").textContent = `${stopped} stopped trade${stopped === 1 ? "" : "s"} on board`;
}

function initLearning() {
  $("#learning-form").addEventListener("submit", event => {
    event.preventDefault();
    void loadLearning();
  });
}

async function loadLearning() {
  show($("#learning-loading"));
  $("#learning-result").innerHTML = "";
  $("#learning-load-btn").disabled = true;

  try {
    const lookbackDays = readOptionalPositiveNumber("#learning-lookback", "lookback days");
    const data = await api("GET", `/learning/stats?lookbackDays=${lookbackDays ?? 14}`);
    $("#learning-result").innerHTML = renderLearning(data);
  } catch (error) {
    $("#learning-result").innerHTML = errorMarkup(error.message);
  } finally {
    hide($("#learning-loading"));
    $("#learning-load-btn").disabled = false;
  }
}

async function loadSettings() {
  try {
    const defaults = await ensureDefaults();
    syncDefaultInputs(defaults);
  } catch (error) {
    toast(error.message, "error");
  }
}

function initSettings() {
  $("#settings-form").addEventListener("submit", async event => {
    event.preventDefault();
    const status = $("#settings-status");
    hide(status);

    try {
      const saved = await api("PUT", "/defaults", {
        leverage: Number($("#settings-leverage").value),
        positionSizeUsd: Number($("#settings-size").value),
        objectiveHorizon: $("#settings-horizon").value.trim(),
        aiModel: $("#settings-ai-model").value.trim()
      });

      setDefaults(saved);
      status.textContent = "saved";
      status.className = "status-msg success";
      show(status);
      toast("Defaults updated");
    } catch (error) {
      status.textContent = error.message;
      status.className = "status-msg error";
      show(status);
    }
  });
}

function initLiveReload() {
  const source = new EventSource("/api/__reload");
  source.onmessage = () => location.reload();
  source.onerror = () => setTimeout(() => location.reload(), 2000);
}

document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  initKeyboard();
  initActionDelegates();
  initAnalyze();
  initScan();
  initMonitor();
  initLearning();
  initSettings();
  initLiveReload();

  $("#qa-symbol").focus();
  renderMonitorBoard();

  void ensureDefaults()
    .catch(error => toast(error.message, "error"));
});
