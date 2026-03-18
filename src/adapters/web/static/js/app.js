import { render, html } from "htm/preact";
import { useState, useEffect, useRef, useCallback } from "preact/hooks";
import { fN, prettyToken } from "./lib/format.js";
import { errorBlock } from "./lib/ui.js";
import { AnalyzeResult } from "./views/analyze.js";
import { LearningResult } from "./views/learning.js";
import { MonitorBoard } from "./views/monitor.js";
import { ScanResult } from "./views/scanner.js";

// ── API helper ──────────────────────────────────────────
async function api(method, path, body) {
  const options = { method, headers: {} };
  if (body) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`/api${path}`, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

// ── Live reload (dev) ───────────────────────────────────
function initLiveReload() {
  const source = new EventSource("/api/__reload");
  source.onmessage = () => location.reload();
  source.onerror = () => setTimeout(() => location.reload(), 2000);
}

// ── App ─────────────────────────────────────────────────
function App() {
  const [activeTab, setActiveTab] = useState("overview");
  const [defaults, setDefaults] = useState(null);
  const [lastAnalysis, setLastAnalysis] = useState(null);
  const [analyzeError, setAnalyzeError] = useState(null);
  const [analyzeRunning, setAnalyzeRunning] = useState(false);
  const [scanData, setScanData] = useState(null);
  const [scanError, setScanError] = useState(null);
  const [scanRunning, setScanRunning] = useState(false);
  const [scanLoaded, setScanLoaded] = useState(false);
  const [monitorSessions, setMonitorSessions] = useState(new Map());
  const [monitorEcho, setMonitorEcho] = useState("");
  const [learningData, setLearningData] = useState(null);
  const [learningError, setLearningError] = useState(null);
  const [learningRunning, setLearningRunning] = useState(false);
  const [settingsStatus, setSettingsStatus] = useState(null);
  const [toast, setToast] = useState(null);

  // Refs
  const toastTimerRef = useRef(null);
  const sourceMapRef = useRef(new Map()); // Map<id, EventSource>
  const symbolInputRef = useRef(null);
  const defaultsRef = useRef(null);
  const monitorSessionsRef = useRef(new Map());
  const qaDirectionRef = useRef(null);
  const qaLeverageRef = useRef(null);
  const qaSizeRef = useRef(null);
  const qaHorizonRef = useRef(null);
  const monitorSymbolRef = useRef(null);
  const monitorSideRef = useRef(null);
  const monitorEntryRef = useRef(null);
  const monitorSlRef = useRef(null);
  const monitorTpRef = useRef(null);
  const monitorLeverageRef = useRef(null);
  const monitorSizeRef = useRef(null);
  const monitorHorizonRef = useRef(null);
  const learningLookbackRef = useRef(null);
  const settingsLeverageRef = useRef(null);
  const settingsSizeRef = useRef(null);
  const settingsHorizonRef = useRef(null);
  const settingsAiModelRef = useRef(null);

  // Keep refs in sync
  defaultsRef.current = defaults;
  monitorSessionsRef.current = monitorSessions;

  // ── Toast ──
  const showToast = useCallback((message, type = "success") => {
    setToast({ message, type });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }, []);

  // ── Helpers ──
  function readOptionalPositiveNumber(ref, label) {
    const raw = ref.current?.value?.trim();
    if (!raw) return undefined;
    const number = Number(raw);
    if (!Number.isFinite(number) || number <= 0) throw new Error(`Invalid ${label}.`);
    return number;
  }

  function readOptionalString(ref) {
    const value = ref.current?.value?.trim();
    return value || undefined;
  }

  // ── Defaults ──
  const ensureDefaults = useCallback(async () => {
    if (defaultsRef.current) return defaultsRef.current;
    const d = await api("GET", "/defaults");
    setDefaults(d);
    return d;
  }, []);

  function syncDefaultInputs(d) {
    if (qaLeverageRef.current) qaLeverageRef.current.value = d.leverage ?? "";
    if (qaSizeRef.current) qaSizeRef.current.value = d.positionSizeUsd ?? "";
    if (qaHorizonRef.current) qaHorizonRef.current.value = d.objectiveHorizon ?? "";
    if (monitorLeverageRef.current) monitorLeverageRef.current.value = d.leverage ?? "";
    if (monitorSizeRef.current) monitorSizeRef.current.value = d.positionSizeUsd ?? "";
    if (monitorHorizonRef.current) monitorHorizonRef.current.value = d.objectiveHorizon ?? "";
    if (settingsLeverageRef.current) settingsLeverageRef.current.value = d.leverage ?? "";
    if (settingsSizeRef.current) settingsSizeRef.current.value = d.positionSizeUsd ?? "";
    if (settingsHorizonRef.current) settingsHorizonRef.current.value = d.objectiveHorizon ?? "";
    if (settingsAiModelRef.current) settingsAiModelRef.current.value = d.aiModel ?? "";
  }

  // ── SSE / Monitor connections ──
  function connectMonitorSession(session) {
    const params = new URLSearchParams({
      symbol: session.symbol,
      side: session.side,
      entry: String(session.entry)
    });
    if (session.stopLoss != null) params.set("stopLoss", String(session.stopLoss));
    if (session.takeProfit != null) params.set("takeProfit", String(session.takeProfit));
    if (session.leverage != null) params.set("leverage", String(session.leverage));
    if (session.positionSizeUsd != null) params.set("positionSizeUsd", String(session.positionSizeUsd));
    if (session.objectiveHorizon != null) params.set("objectiveHorizon", session.objectiveHorizon);

    const source = new EventSource(`/api/monitor/stream?${params.toString()}`);
    sourceMapRef.current.set(session.id, source);

    source.addEventListener("baseline", event => {
      const data = JSON.parse(event.data);
      setMonitorSessions(prev => {
        if (!prev.has(session.id)) return prev;
        const next = new Map(prev);
        const s = next.get(session.id);
        next.set(session.id, { ...s, connected: true, pair: data.trade?.pair ?? s.pair, statusText: `baseline ready for ${data.trade?.pair ?? s.pair}` });
        return next;
      });
    });

    source.addEventListener("snapshot", event => {
      const snapshot = JSON.parse(event.data);
      setMonitorSessions(prev => {
        if (!prev.has(session.id)) return prev;
        const next = new Map(prev);
        const s = next.get(session.id);
        const statusText = `${prettyToken(snapshot.healthStatus ?? "live")} / ${prettyToken(snapshot.managementAction ?? "hold")}`;
        const terminalAction = String(snapshot.managementAction ?? "").toUpperCase();
        const invalidReason = (terminalAction === "STOP_HIT" || terminalAction === "TARGET_HIT")
          ? prettyToken(terminalAction)
          : s.invalidReason;
        next.set(session.id, { ...s, snapshot, connected: true, pair: snapshot.trade?.pair ?? s.pair, statusText, invalidReason });
        return next;
      });
    });

    source.onerror = () => {
      setMonitorSessions(prev => {
        if (!prev.has(session.id)) return prev;

        if (source.readyState === EventSource.CLOSED) {
          source.close();
          sourceMapRef.current.delete(session.id);
          const next = new Map(prev);
          const s = next.get(session.id);
          next.set(session.id, { ...s, active: false, connected: false, stopReason: "connection closed", statusText: "connection closed" });
          return next;
        }

        const next = new Map(prev);
        const s = next.get(session.id);
        next.set(session.id, { ...s, connected: false, statusText: "reconnecting" });
        return next;
      });
    };
  }

  function createSessionFromPersisted(persisted) {
    const d = defaultsRef.current;
    return {
      id: persisted.id,
      dbId: persisted.id,
      symbol: persisted.symbol,
      pair: persisted.symbol.includes("-") ? persisted.symbol : `${persisted.symbol}-USD`,
      side: persisted.side,
      entry: persisted.entry,
      stopLoss: persisted.stopLoss,
      takeProfit: persisted.takeProfit,
      leverage: persisted.leverage ?? d?.leverage ?? null,
      positionSizeUsd: persisted.positionSizeUsd ?? d?.positionSizeUsd ?? null,
      objectiveHorizon: persisted.objectiveHorizon ?? d?.objectiveHorizon ?? null,
      snapshot: null,
      statusText: `connecting ${persisted.symbol} ${persisted.side.toLowerCase()} stream`,
      active: true,
      connected: false,
      stopReason: "",
      invalidReason: null,
      editing: false,
      startedAt: persisted.createdAtMs ?? Date.now()
    };
  }

  // ── Monitor actions ──
  const stopMonitorSession = useCallback((id, reason = "stopped", { persist = true } = {}) => {
    const source = sourceMapRef.current.get(id);
    if (source) {
      source.close();
      sourceMapRef.current.delete(id);
    }

    setMonitorSessions(prev => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      const s = next.get(id);
      next.set(id, { ...s, active: false, connected: false, stopReason: reason, statusText: reason });

      if (persist && s.dbId) {
        api("DELETE", `/monitor/sessions/${encodeURIComponent(s.dbId)}`).catch(() => {});
      }
      return next;
    });
  }, []);

  const stopAllMonitorSessions = useCallback((reason = "stopped") => {
    let stopped = 0;
    setMonitorSessions(prev => {
      const next = new Map(prev);
      next.forEach((s, id) => {
        if (!s.active) return;
        const source = sourceMapRef.current.get(id);
        if (source) {
          source.close();
          sourceMapRef.current.delete(id);
        }
        next.set(id, { ...s, active: false, connected: false, stopReason: reason, statusText: reason });
        stopped += 1;
        if (s.dbId) {
          api("DELETE", `/monitor/sessions/${encodeURIComponent(s.dbId)}`).catch(() => {});
        }
      });
      return next;
    });
    return stopped;
  }, []);

  const removeMonitorSession = useCallback((id) => {
    const source = sourceMapRef.current.get(id);
    if (source) {
      source.close();
      sourceMapRef.current.delete(id);
    }

    setMonitorSessions(prev => {
      const s = prev.get(id);
      const next = new Map(prev);
      next.delete(id);
      if (s?.dbId) {
        api("DELETE", `/monitor/sessions/${encodeURIComponent(s.dbId)}`).catch(() => {});
      }
      return next;
    });
  }, []);

  const toggleEditMonitorSession = useCallback((id) => {
    setMonitorSessions(prev => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      const s = next.get(id);
      next.set(id, { ...s, editing: !s.editing });
      return next;
    });
  }, []);

  const saveEditMonitorSession = useCallback(async (id, fields) => {
    const session = monitorSessionsRef.current.get(id);
    if (!session || !session.dbId) return;

    try {
      const updated = await api("PATCH", `/monitor/sessions/${encodeURIComponent(session.dbId)}`, fields);

      // Close existing source
      const source = sourceMapRef.current.get(id);
      if (source) {
        source.close();
        sourceMapRef.current.delete(id);
      }

      setMonitorSessions(prev => {
        const next = new Map(prev);
        const s = next.get(id);
        if (!s) return prev;
        const updatedSession = {
          ...s,
          entry: updated.entry,
          stopLoss: updated.stopLoss,
          takeProfit: updated.takeProfit,
          leverage: updated.leverage,
          positionSizeUsd: updated.positionSizeUsd,
          objectiveHorizon: updated.objectiveHorizon,
          editing: false,
          invalidReason: null,
          connected: false,
          statusText: "reconnecting with updated params"
        };
        next.set(id, updatedSession);
        // Reconnect with updated session
        connectMonitorSession(updatedSession);
        return next;
      });

      showToast("Session updated");
    } catch (error) {
      showToast(error.message, "error");
    }
  }, [showToast]);

  // ── Analysis ──
  const runAnalysis = useCallback(async (symbol, direction) => {
    setActiveTab("overview");
    setLastAnalysis(null);
    setAnalyzeError(null);
    setAnalyzeRunning(true);

    try {
      await ensureDefaults();
      const payload = { symbol };
      if (direction) payload.direction = direction;

      const leverage = readOptionalPositiveNumber(qaLeverageRef, "leverage");
      const positionSizeUsd = readOptionalPositiveNumber(qaSizeRef, "position size");
      const horizon = readOptionalString(qaHorizonRef);

      if (leverage !== undefined) payload.leverage = leverage;
      if (positionSizeUsd !== undefined) payload.positionSizeUsd = positionSizeUsd;
      if (horizon) payload.horizon = horizon;

      const data = await api("POST", "/analyze", payload);
      setLastAnalysis(data);
    } catch (error) {
      setAnalyzeError(error.message);
    } finally {
      setAnalyzeRunning(false);
    }
  }, [ensureDefaults]);

  // ── Start monitor directly from a recommendation ──
  const startMonitorFromRecommendation = useCallback(async (rec) => {
    if (!rec || rec.signal === "NO_TRADE") return;

    const d = defaultsRef.current ?? await ensureDefaults();
    const symbol = rec.pair.replace(/-USD$/, "");
    const side = rec.signal === "SHORT" ? "SHORT" : "LONG";

    let session = null;
    try {
      const persisted = await api("POST", "/monitor/sessions", {
        symbol,
        side,
        entry: rec.entry,
        stopLoss: rec.stopLoss,
        takeProfit: rec.takeProfit,
        leverage: rec.leverage ?? d?.leverage ?? null,
        positionSizeUsd: rec.positionSizeUsd ?? d?.positionSizeUsd ?? null,
        objectiveHorizon: rec.objectiveHorizon ?? d?.objectiveHorizon ?? null
      });

      session = createSessionFromPersisted(persisted);
      setMonitorSessions(prev => {
        const next = new Map(prev);
        next.set(session.id, session);
        return next;
      });
      connectMonitorSession(session);
      showToast(`Monitoring ${symbol} ${side.toLowerCase()}`);
      setActiveTab("monitor");
    } catch (error) {
      if (session) {
        setMonitorSessions(prev => {
          const next = new Map(prev);
          next.delete(session.id);
          return next;
        });
      }
      showToast(`Monitor error: ${error.message}`, "error");
    }
  }, [ensureDefaults, showToast]);

  // ── Start monitor ──
  const startMonitor = useCallback(async () => {
    setActiveTab("monitor");
    let session = null;

    try {
      const symbol = monitorSymbolRef.current?.value?.trim().toUpperCase();
      const side = monitorSideRef.current?.value;
      const entry = monitorEntryRef.current?.value?.trim();
      const stopLoss = monitorSlRef.current?.value?.trim();
      const takeProfit = monitorTpRef.current?.value?.trim();

      if (!symbol || !entry) return;

      const leverage = readOptionalPositiveNumber(monitorLeverageRef, "leverage");
      const positionSizeUsd = readOptionalPositiveNumber(monitorSizeRef, "position size");
      const objectiveHorizon = readOptionalString(monitorHorizonRef);

      const persisted = await api("POST", "/monitor/sessions", {
        symbol,
        side,
        entry: Number(entry),
        stopLoss: stopLoss ? Number(stopLoss) : null,
        takeProfit: takeProfit ? Number(takeProfit) : null,
        leverage: leverage ?? null,
        positionSizeUsd: positionSizeUsd ?? null,
        objectiveHorizon: objectiveHorizon ?? null
      });

      session = createSessionFromPersisted(persisted);
      setMonitorSessions(prev => {
        const next = new Map(prev);
        next.set(session.id, session);
        return next;
      });
      connectMonitorSession(session);
    } catch (error) {
      if (session) {
        setMonitorSessions(prev => {
          const next = new Map(prev);
          next.delete(session.id);
          return next;
        });
      }
      setMonitorEcho(`Monitor error: ${error.message}`);
    }
  }, []);

  // ── Scanner ──
  const loadScan = useCallback(async () => {
    setScanData(null);
    setScanError(null);
    setScanRunning(true);

    try {
      const data = await api("GET", "/scan");
      setScanData(data);
      setScanLoaded(true);
    } catch (error) {
      setScanError(error.message);
      setScanLoaded(false);
    } finally {
      setScanRunning(false);
    }
  }, []);

  // ── Learning ──
  const loadLearning = useCallback(async () => {
    setLearningData(null);
    setLearningError(null);
    setLearningRunning(true);

    try {
      const lookbackDays = readOptionalPositiveNumber(learningLookbackRef, "lookback days");
      const data = await api("GET", `/learning/stats?lookbackDays=${lookbackDays ?? 14}`);
      setLearningData(data);
    } catch (error) {
      setLearningError(error.message);
    } finally {
      setLearningRunning(false);
    }
  }, []);

  // ── Settings ──
  const saveSettings = useCallback(async () => {
    setSettingsStatus(null);
    try {
      const saved = await api("PUT", "/defaults", {
        leverage: Number(settingsLeverageRef.current?.value),
        positionSizeUsd: Number(settingsSizeRef.current?.value),
        objectiveHorizon: settingsHorizonRef.current?.value?.trim(),
        aiModel: settingsAiModelRef.current?.value?.trim()
      });
      setDefaults(saved);
      syncDefaultInputs(saved);
      setSettingsStatus({ text: "saved", type: "success" });
      showToast("Defaults updated");
    } catch (error) {
      setSettingsStatus({ text: error.message, type: "error" });
    }
  }, [showToast]);

  // ── Tab switching with side effects ──
  const switchTab = useCallback((name) => {
    setActiveTab(name);
    if (name === "scanner" && !scanLoaded) {
      loadScan();
    }
    if (name === "settings") {
      ensureDefaults().then(d => syncDefaultInputs(d)).catch(e => showToast(e.message, "error"));
    }
  }, [scanLoaded, loadScan, ensureDefaults, showToast]);

  // ── Scanner analyze click ──
  const handleScanAnalyze = useCallback((symbol) => {
    if (symbolInputRef.current) symbolInputRef.current.value = symbol;
    runAnalysis(symbol);
  }, [runAnalysis]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const tabs = ["overview", "scanner", "monitor", "learning", "settings"];

    const handler = (event) => {
      if (event.target.matches("input, select, textarea")) {
        if (event.key === "Escape") event.target.blur();
        return;
      }

      if (event.key === "/") {
        event.preventDefault();
        symbolInputRef.current?.focus();
        symbolInputRef.current?.select();
        return;
      }

      if (/^[1-5]$/.test(event.key)) {
        switchTab(tabs[Number(event.key) - 1]);
        return;
      }

      if (event.key === "Escape" && event.shiftKey) {
        const stopped = stopAllMonitorSessions("stopped from keyboard");
        if (stopped > 0) {
          showToast(`Stopped ${stopped} monitor stream${stopped === 1 ? "" : "s"}`);
        }
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [switchTab, stopAllMonitorSessions, showToast]);

  // ── Init: load defaults, restore sessions, live reload ──
  useEffect(() => {
    initLiveReload();
    symbolInputRef.current?.focus();

    ensureDefaults()
      .then(d => {
        syncDefaultInputs(d);
        return api("GET", "/monitor/sessions");
      })
      .then(sessions => {
        if (!Array.isArray(sessions) || sessions.length === 0) return;
        setMonitorSessions(prev => {
          const next = new Map(prev);
          for (const persisted of sessions) {
            const session = createSessionFromPersisted(persisted);
            next.set(session.id, session);
            connectMonitorSession(session);
          }
          return next;
        });
      })
      .catch(e => showToast(e.message, "error"));
  }, []);

  // ── Compute analysis-is-monitored ──
  const analysisIsMonitored = lastAnalysis?.recommendation?.pair
    && Array.from(monitorSessions.values()).some(s =>
      s.active && (s.pair === lastAnalysis.recommendation.pair || `${s.symbol}-USD` === lastAnalysis.recommendation.pair)
    );

  // ── Compute monitor status bar ──
  const sessionsList = Array.from(monitorSessions.values());
  const activeCount = sessionsList.filter(s => s.active).length;
  const connectedCount = sessionsList.filter(s => s.active && s.connected).length;
  const stoppedCount = sessionsList.filter(s => !s.active).length;

  const summaryBits = html`
    <span>${activeCount} active trade${activeCount === 1 ? "" : "s"}</span>
    <span>${connectedCount} connected stream${connectedCount === 1 ? "" : "s"}</span>
    ${!sessionsList.length
      ? html`<span>board empty</span>`
      : stoppedCount > 0
        ? html`<span>${stoppedCount} stopped</span>`
        : html`<span>${sessionsList.length} on board</span>`}
  `;

  // Monitor echo text
  let monitorEchoText = monitorEcho;
  if (sessionsList.length) {
    if (activeCount > 0) {
      const visiblePairs = sessionsList.filter(s => s.active).slice(0, 3).map(s => s.symbol).join(", ");
      monitorEchoText = `${activeCount} active trade${activeCount === 1 ? "" : "s"}${visiblePairs ? ` | ${visiblePairs}` : ""}`;
    } else {
      monitorEchoText = `${stoppedCount} stopped trade${stoppedCount === 1 ? "" : "s"} on board`;
    }
  } else if (!monitorEcho && defaults) {
    monitorEchoText = `Ready: ${defaults.leverage}x / ${fN(defaults.positionSizeUsd, 0)} USDC / ${defaults.objectiveHorizon}m`;
  }

  // ── Scan defaults display ──
  const scanDefaultsContent = defaults
    ? html`<span>${defaults.leverage}x</span><span>${fN(defaults.positionSizeUsd, 0)} usdc</span><span>${defaults.objectiveHorizon}m</span>`
    : html`<span>loading defaults...</span>`;

  return html`
    <div class="app-shell">
      <header class="appbar">
        <div class="app-brand">miau</div>
        <nav class="topnav" aria-label="Pages">
          ${["overview", "scanner", "monitor", "learning", "settings"].map((tab, i) => html`
            <button class="tab ${activeTab === tab ? "active" : ""}" onClick=${() => switchTab(tab)}>
              <span class="tab-num">0${i + 1}</span> ${tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          `)}
        </nav>
        <div class="appbar-right">/ focus symbol | shift+esc stop all</div>
      </header>

      <main class="page-stack">
        ${"\n"}
        <section class="panel ${activeTab === "overview" ? "active" : ""}">
          <div class="analyze-bar">
            <form class="compact-form analyze-form" onSubmit=${(e) => {
              e.preventDefault();
              const symbol = symbolInputRef.current?.value?.trim();
              if (!symbol) return;
              symbolInputRef.current?.blur();
              runAnalysis(symbol, qaDirectionRef.current?.value || undefined);
            }}>
              <label class="field-symbol"><input ref=${symbolInputRef} type="text" placeholder="BTC" spellcheck="false" autocomplete="off" /></label>
              <label class="field-side"><select ref=${qaDirectionRef}><option value="">auto</option><option value="LONG">long</option><option value="SHORT">short</option></select></label>
              <label class="field-lev"><input ref=${qaLeverageRef} type="number" step="1" min="1" placeholder="20" /></label>
              <label class="field-size"><input ref=${qaSizeRef} type="number" step="1" min="1" placeholder="250" /></label>
              <label class="field-hzn"><input ref=${qaHorizonRef} type="text" placeholder="15" /></label>
              <button type="submit" class="btn-primary field-action ${analyzeRunning ? "is-running" : ""}" disabled=${analyzeRunning}>${analyzeRunning ? "Running\u2026" : "Run"}</button>
            </form>
          </div>
          <div class="overview-main">
            <div class="output-area">
              ${lastAnalysis
                ? html`<${AnalyzeResult}
                    rec=${lastAnalysis.recommendation}
                    aiAdvice=${lastAnalysis.aiAdvice}
                    onMonitor=${() => startMonitorFromRecommendation(lastAnalysis.recommendation)}
                    isMonitored=${analysisIsMonitored}
                    onGoToMonitor=${() => setActiveTab("monitor")}
                  />`
                : analyzeError
                  ? errorBlock(analyzeError)
                  : html`<div class="empty-state">type a symbol and press Run</div>`}
            </div>
          </div>
        </section>

        ${"\n"}
        <section class="panel ${activeTab === "scanner" ? "active" : ""}">
          <div class="scanner-bar">
            <div class="inline-context">${scanDefaultsContent}</div>
            <button class="btn-primary ${scanRunning ? "is-running" : ""}" disabled=${scanRunning} onClick=${loadScan}>${scanRunning ? "Scanning\u2026" : "Refresh"}</button>
          </div>
          <div class="output-area">
            ${scanData
              ? html`<${ScanResult} data=${scanData} onAnalyze=${handleScanAnalyze} onMonitor=${startMonitorFromRecommendation} />`
              : scanError
                ? errorBlock(scanError)
                : html`<div class="empty-state">board not loaded</div>`}
          </div>
        </section>

        ${"\n"}
        <section class="panel ${activeTab === "monitor" ? "active" : ""}">
          <div class="monitor-compose">
            <form class="compact-form monitor-form" onSubmit=${(e) => { e.preventDefault(); startMonitor(); }}>
              <label class="field-symbol"><input ref=${monitorSymbolRef} type="text" placeholder="BTC" spellcheck="false" required /></label>
              <label class="field-side"><select ref=${monitorSideRef} required><option value="LONG">long</option><option value="SHORT">short</option></select></label>
              <label class="field-price"><input ref=${monitorEntryRef} type="number" step="any" placeholder="entry" required /></label>
              <label class="field-price"><input ref=${monitorSlRef} type="number" step="any" placeholder="sl" /></label>
              <label class="field-price"><input ref=${monitorTpRef} type="number" step="any" placeholder="tp" /></label>
              <label class="field-lev"><input ref=${monitorLeverageRef} type="number" step="1" min="1" placeholder="20" /></label>
              <label class="field-size"><input ref=${monitorSizeRef} type="number" step="1" min="1" placeholder="250" /></label>
              <label class="field-hzn"><input ref=${monitorHorizonRef} type="text" placeholder="15" /></label>
              <button type="submit" class="btn-primary field-action">Add</button>
              <button type="button" class="btn-secondary field-action" disabled=${activeCount === 0} onClick=${() => {
                const stopped = stopAllMonitorSessions("stopped manually");
                if (stopped > 0) showToast(`Stopped ${stopped} monitor stream${stopped === 1 ? "" : "s"}`);
              }}>Stop All</button>
            </form>
          </div>
          <div class="monitor-board">
            <${MonitorBoard}
              sessions=${monitorSessions}
              onStop=${(id) => stopMonitorSession(id, "stopped manually")}
              onRemove=${removeMonitorSession}
              onEdit=${toggleEditMonitorSession}
              onSaveEdit=${saveEditMonitorSession}
              onCancelEdit=${toggleEditMonitorSession}
              onAnalyze=${handleScanAnalyze}
            />
          </div>
        </section>

        ${"\n"}
        <section class="panel ${activeTab === "learning" ? "active" : ""}">
          <div class="learning-bar">
            <form class="compact-form" onSubmit=${(e) => { e.preventDefault(); loadLearning(); }}>
              <label class="field-lev"><input ref=${learningLookbackRef} type="number" min="1" step="1" placeholder="14" value="14" /></label>
              <button type="submit" class="btn-primary field-action ${learningRunning ? "is-running" : ""}" disabled=${learningRunning}>${learningRunning ? "Loading\u2026" : "Load"}</button>
            </form>
          </div>
          <div class="output-area">
            ${learningData
              ? html`<${LearningResult} data=${learningData} />`
              : learningError
                ? errorBlock(learningError)
                : html`<div class="empty-state">stats not loaded</div>`}
          </div>
        </section>

        ${"\n"}
        <section class="panel ${activeTab === "settings" ? "active" : ""}">
          <div class="settings-grid">
            <form class="settings-form" onSubmit=${(e) => { e.preventDefault(); saveSettings(); }}>
              <div class="settings-row">
                <label><span>leverage</span><input ref=${settingsLeverageRef} type="number" step="1" min="1" /></label>
                <label><span>size usdc</span><input ref=${settingsSizeRef} type="number" step="1" min="1" /></label>
                <label><span>horizon min</span><input ref=${settingsHorizonRef} type="text" /></label>
              </div>
              <label><span>ai model</span><input ref=${settingsAiModelRef} type="text" /></label>
              <div class="settings-actions">
                <button type="submit" class="btn-primary">Save</button>
                ${settingsStatus ? html`<span class="status-msg ${settingsStatus.type}">${settingsStatus.text}</span>` : null}
              </div>
            </form>
            <div class="meta-list">
              <div class="meta-row"><span>storage</span><span>data/learning.sqlite</span></div>
              <div class="meta-row"><span>exchange</span><span>Backpack public API + WebSocket</span></div>
              <div class="meta-row"><span>execution</span><span>disabled by design</span></div>
              <div class="meta-row"><span>ai</span><span>single-symbol advice only</span></div>
            </div>
          </div>
        </section>
      </main>
    </div>

    ${"\n"}
    ${toast ? html`<div class="toast ${toast.type}">${toast.message}</div>` : null}
  `;
}

render(html`<${App} />`, document.getElementById("app"));
