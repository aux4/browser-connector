// aux4 Browser Connector — MV3 service worker.
//
// One WebSocket represents the Chrome profile. Requests are scoped to a window
// or tab in their params, so a second browser window does not need a second
// pairing connection.

importScripts("page-runtime.js");

const PROTOCOL_VERSION = 1;
const DEFAULT_PORT = 8765;
const RECONNECT_ALARM = "aux4-reconnect";
const MAX_RETRY_DELAY = 30000;
const HANDSHAKE_TIMEOUT = 10000;

let ws = null;
let socketGeneration = 0;
let shouldConnect = false;
let connected = false;
let connectionState = "off";
let targetScope = "window";
let targetWindowId = null;
let targetTabId = null;
let retryAttempt = 0;
let retryTimer = null;
let handshakeTimer = null;
let lastError = null;

// ---- configuration and lifecycle -----------------------------------------

async function loadConfig() {
  const config = await chrome.storage.local.get([
    "token", "port", "autoConnect", "scope", "windowId", "tabId", "lastError"
  ]);
  return {
    token: config.token,
    port: config.port || DEFAULT_PORT,
    autoConnect: config.autoConnect !== false,
    scope: config.scope || "window",
    windowId: config.windowId ?? null,
    tabId: config.tabId ?? null,
    lastError: config.lastError || null
  };
}

async function captureTarget(scope = targetScope) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) return;
  targetScope = scope === "tab" ? "tab" : "window";
  targetWindowId = tab.windowId ?? null;
  targetTabId = tab.id ?? null;
  await chrome.storage.local.set({ scope: targetScope, windowId: targetWindowId, tabId: targetTabId });
}

async function connect(token, port, scope = "window") {
  const normalizedPort = Math.min(65535, Math.max(1, parseInt(port, 10) || DEFAULT_PORT));
  await chrome.storage.local.set({
    token,
    port: normalizedPort,
    scope: scope === "tab" ? "tab" : "window",
    autoConnect: true,
    lastError: null
  });
  lastError = null;
  retryAttempt = 0;
  shouldConnect = true;
  await captureTarget(scope);
  await chrome.alarms.clear(RECONNECT_ALARM);
  await ensureReconnectAlarm();
  openSocket();
}

async function disconnect() {
  shouldConnect = false;
  connectionState = "off";
  connected = false;
  retryAttempt = 0;
  clearTimeout(retryTimer);
  clearTimeout(handshakeTimer);
  await chrome.alarms.clear(RECONNECT_ALARM);
  if (ws) {
    try { ws.close(1000, "user disconnected"); } catch {}
  }
  ws = null;
  await chrome.storage.local.set({ autoConnect: false });
  await setBadge("");
}

async function restoreConnection() {
  const config = await loadConfig();
  if (!config.token || !config.autoConnect || shouldConnect) return;
  targetScope = config.scope;
  targetWindowId = config.windowId;
  targetTabId = config.tabId;
  lastError = config.lastError;
  shouldConnect = true;
  connectionState = "connecting";
  if (targetScope === "window" || targetWindowId == null) await captureTarget(targetScope);
  await ensureReconnectAlarm();
  openSocket();
}

async function ensureReconnectAlarm() {
  await chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: 0.5 });
}

function closeSocket(socket) {
  try { socket.close(); } catch {}
}

function errorMessage(reason) {
  switch (reason) {
    case "bad-token": return "Pairing token rejected. Start a new aux4 connect session.";
    case "version-mismatch": return "Extension and aux4 protocol versions differ. Update both sides.";
    case "expected-hello": return "The aux4 daemon rejected the connection handshake.";
    default: return String(reason || "Connection rejected by aux4");
  }
}

function isFatalPairingError(reason) {
  return reason === "bad-token" || reason === "version-mismatch" || reason === "expected-hello";
}

async function setConnectionError(message, fatal = false) {
  lastError = message;
  connectionState = "error";
  connected = false;
  if (fatal) await chrome.alarms.clear(RECONNECT_ALARM);
  await chrome.storage.local.set({ lastError: message, autoConnect: fatal ? false : shouldConnect });
  await setBadge("err");
}

function nextRetryDelay() {
  const base = Math.min(MAX_RETRY_DELAY, 1000 * (2 ** Math.min(retryAttempt, 5)));
  const jitter = Math.round(base * (Math.random() * 0.25 - 0.125));
  return Math.max(1000, base + jitter);
}

function scheduleReconnect() {
  if (!shouldConnect) return;
  clearTimeout(retryTimer);
  const delay = nextRetryDelay();
  retryAttempt++;
  connectionState = "retrying";
  retryTimer = setTimeout(() => openSocket(), delay);
  // A timer alone can disappear with an MV3 worker. The alarm is a slower
  // safety net; when the worker stays alive, the timer gives a quick retry.
  chrome.alarms.create(RECONNECT_ALARM, { delayInMinutes: Math.max(0.5, delay / 60000) });
}

async function openSocket() {
  if (!shouldConnect) return;
  const { token, port } = await loadConfig();
  if (!token) return;

  clearTimeout(handshakeTimer);
  if (ws && ws.readyState <= 1) closeSocket(ws);
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  const generation = ++socketGeneration;
  ws = socket;
  connectionState = retryAttempt ? "retrying" : "connecting";
  await setBadge("…");

  handshakeTimer = setTimeout(() => {
    if (ws === socket && !connected) closeSocket(socket);
  }, HANDSHAKE_TIMEOUT);

  socket.onopen = () => {
    if (ws !== socket || generation !== socketGeneration) return;
    socket.send(JSON.stringify({
      type: "hello",
      token,
      protocolVersion: PROTOCOL_VERSION,
      client: { name: "aux4 browser connector", version: "0.2.0", scope: targetScope }
    }));
  };

  socket.onmessage = async (event) => {
    if (ws !== socket || generation !== socketGeneration) return;
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }

    if (msg.type === "welcome") {
      clearTimeout(handshakeTimer);
      retryAttempt = 0;
      connected = true;
      connectionState = "connected";
      lastError = null;
      await ensureReconnectAlarm();
      await chrome.storage.local.set({ lastError: null });
      await setBadge("on");
      return;
    }
    if (msg.type === "error") {
      const fatal = isFatalPairingError(msg.reason);
      await setConnectionError(errorMessage(msg.reason), fatal);
      closeSocket(socket);
      if (!fatal) scheduleReconnect();
      return;
    }

    if (msg.id != null && msg.method) {
      try {
        const result = await dispatch(msg.method, msg.params || {});
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id: msg.id, result }));
      } catch (error) {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ id: msg.id, error: { message: String(error?.message || error) } }));
        }
      }
    }
  };

  socket.onclose = async () => {
    if (ws !== socket || generation !== socketGeneration) return;
    clearTimeout(handshakeTimer);
    ws = null;
    connected = false;
    if (shouldConnect) {
      if (!lastError || lastError.includes("rejected")) lastError = "aux4 daemon is unavailable; retrying";
      await chrome.storage.local.set({ lastError });
      scheduleReconnect();
    } else {
      connectionState = "off";
      await setBadge("");
    }
  };

  socket.onerror = () => {
    // WebSocket deliberately gives no useful error detail. onclose owns the
    // retry path so this does not create duplicate timers.
    try { socket.close(); } catch {}
  };
}

async function setBadge(state) {
  try {
    const text = state === "on" ? "●" : state === "err" ? "!" : state === "…" ? "…" : "";
    await chrome.action.setBadgeText({ text });
    await chrome.action.setBadgeBackgroundColor({
      color: state === "on" ? "#1a7f37" : state === "err" ? "#cf222e" : "#8250df"
    });
  } catch {}
}

// ---- tab/window targeting -------------------------------------------------

async function resolveTarget(target = {}) {
  const scope = target.scope || targetScope;
  if (scope === "tab" && target.tabId != null) {
    try { return await chrome.tabs.get(Number(target.tabId)); } catch {}
  }

  const windowId = target.windowId ?? (scope === "window" ? targetWindowId : null);
  if (windowId != null) {
    const [tab] = await chrome.tabs.query({ windowId: Number(windowId), active: true });
    if (tab) return tab;
  }

  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab) {
    targetWindowId = tab.windowId ?? targetWindowId;
    targetTabId = tab.id ?? targetTabId;
  }
  return tab;
}

function targetInfo(tab) {
  if (!tab) return null;
  return { tabId: tab.id, windowId: tab.windowId, url: tab.url || "", title: tab.title || "" };
}

async function waitForComplete(tabId, timeout = 15000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const listener = (id, info) => {
      if (id === tabId && info.status === "complete") finish();
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(finish, timeout);
  });
}

async function page(tab, operation, params) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: globalThis.aux4PageRuntime,
    args: [operation, params]
  });
  return result?.result;
}

async function navigate(tab, url) {
  if (url) await chrome.tabs.update(tab.id, { url });
  await waitForComplete(tab.id);
  const current = await chrome.tabs.get(tab.id);
  return targetInfo(current);
}

async function queryWindowTabs(target = {}) {
  const windowId = target.windowId ?? targetWindowId;
  const tabs = windowId == null
    ? await chrome.tabs.query({})
    : await chrome.tabs.query({ windowId: Number(windowId) });
  return tabs.map((tab) => targetInfo(tab));
}

async function dispatch(method, params) {
  if (method === "list") return queryWindowTabs(params.target || {});

  const target = params.target || {};
  const tab = await resolveTarget(target);
  if (!tab) throw new Error("No Chrome tab is available in the selected window");

  if (method === "open" || method === "visit") {
    const info = await navigate(tab, params.url);
    return { ...info, target: { scope: "tab", tabId: info.tabId, windowId: info.windowId } };
  }
  if (method === "close") return { status: "closed" };
  if (method === "snapshot" || method === "content" || method === "read" ||
      method === "click" || method === "click-selector" || method === "click-text" || method === "click-item" || method === "type" ||
      method === "fill" || method === "select" || method === "check" || method === "uncheck" ||
      method === "hover" || method === "press" || method === "clear" || method === "scroll" ||
      method === "mouse" || method === "wait" || method === "expect" || method === "expect-list" ||
      method === "get-items" || method === "upload" || method === "component") {
    const result = await page(tab, method, params);
    if (method === "get-items") return result?.items || [];
    return result;
  }

  if (method === "back" || method === "forward") {
    const fn = method === "back" ? chrome.tabs.goBack : chrome.tabs.goForward;
    if (typeof fn === "function") await fn(tab.id);
    else await page(tab, "eval", { script: method === "back" ? "history.back()" : "history.forward()" });
    await waitForComplete(tab.id);
    return { status: "ok", ...(targetInfo(await chrome.tabs.get(tab.id))) };
  }
  if (method === "reload") {
    await chrome.tabs.reload(tab.id);
    await waitForComplete(tab.id);
    return { status: "ok", ...(targetInfo(await chrome.tabs.get(tab.id))) };
  }
  if (method === "screenshot") {
    if (params.fullPage === true || params.fullPage === "true") {
      return { status: "unsupported", backend: "extension", reason: "Chrome captureVisibleTab cannot capture full pages" };
    }
    if (!tab.active) await chrome.tabs.update(tab.id, { active: true });
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    return { status: "ok", dataUrl, width: 0, height: 0 };
  }
  if (method === "new-tab") {
    const created = await chrome.tabs.create({ windowId: tab.windowId, url: params.url || "about:blank", active: true });
    await waitForComplete(created.id);
    const info = targetInfo(await chrome.tabs.get(created.id));
    return { status: "ok", tab: info, target: { scope: "tab", tabId: info.tabId, windowId: info.windowId } };
  }
  if (method === "switch-tab") {
    const tabs = await chrome.tabs.query({ windowId: tab.windowId });
    const next = tabs[parseInt(params.tab, 10)];
    if (!next) throw new Error(`Tab index out of range: ${params.tab}`);
    await chrome.tabs.update(next.id, { active: true });
    const info = targetInfo(await chrome.tabs.get(next.id));
    return { status: "ok", tab: parseInt(params.tab, 10), url: info.url, target: { scope: "tab", tabId: info.tabId, windowId: info.windowId } };
  }
  if (method === "close-tab") {
    const tabs = await chrome.tabs.query({ windowId: tab.windowId });
    const index = parseInt(params.tab, 10);
    if (tabs.length <= 1) throw new Error("Cannot close last tab. Use close session instead.");
    if (!tabs[index]) throw new Error(`Tab index out of range: ${params.tab}`);
    await chrome.tabs.remove(tabs[index].id);
    const remaining = await chrome.tabs.query({ windowId: tab.windowId });
    const next = remaining.find((item) => item.active) || remaining[0];
    const info = targetInfo(next);
    return { status: "ok", tabs: remaining.length, target: { scope: "tab", tabId: info.tabId, windowId: info.windowId } };
  }
  if (method === "list-tabs") {
    const tabs = await chrome.tabs.query({ windowId: tab.windowId });
    return tabs.map((item, index) => ({ index, url: item.url || "", active: item.active }));
  }
  if (method === "cookies") {
    if (params.action === "set") {
      for (const cookie of params.cookies || []) {
        await chrome.cookies.set({ ...cookie, url: cookie.url || tab.url });
      }
      return { status: "imported", count: (params.cookies || []).length };
    }
    return { cookies: await chrome.cookies.getAll({ url: params.url || tab.url }) };
  }
  if (method === "download") {
    const filename = params.output ? String(params.output).split(/[\\/]/).pop() : undefined;
    const id = await chrome.downloads.download({ url: params.url, ...(filename ? { filename } : {}) });
    return { status: "started", id };
  }

  throw new Error(`Unsupported extension method: ${method}`);
}

// ---- popup and worker events ---------------------------------------------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.cmd === "connect") {
        await connect(msg.token, msg.port, msg.scope);
        sendResponse({ ok: true });
      } else if (msg.cmd === "disconnect") {
        await disconnect();
        sendResponse({ ok: true });
      } else if (msg.cmd === "status") {
        await restoreConnection();
        const config = await loadConfig();
        sendResponse({
          connected,
          shouldConnect,
          state: connectionState,
          retryAttempt,
          lastError: lastError || config.lastError,
          scope: targetScope,
          windowId: targetWindowId,
          tabId: targetTabId
        });
      }
    } catch (error) {
      sendResponse({ ok: false, error: String(error?.message || error) });
    }
  })();
  return true;
});

chrome.runtime.onStartup.addListener(restoreConnection);
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === RECONNECT_ALARM && !connected) {
    if (!shouldConnect) await restoreConnection();
    else if (!ws) openSocket();
  }
});
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === targetTabId && targetScope === "tab") {
    targetTabId = null;
    if (shouldConnect) captureTarget("window");
  }
});

restoreConnection();
