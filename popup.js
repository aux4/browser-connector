const $ = (id) => document.getElementById(id);

let currentStatus = null;

function setStatus(state, title, detail) {
  const box = $("status");
  box.className = `status ${state || "off"}`;
  $("status-title").textContent = title;
  $("status-detail").textContent = detail;
  $("dot").setAttribute("aria-label", title);
}

function describeStatus(status) {
  if (!status || status.error) {
    setStatus("err", "Extension unavailable", status?.error || "Could not read the connection state.");
    return;
  }
  currentStatus = status;
  if (status.connected) {
    const scope = status.scope === "tab" ? "this tab" : "this window";
    setStatus("on", "Connected", `aux4 can drive ${scope}.`);
  } else if (status.shouldConnect) {
    const detail = status.lastError || (status.retryAttempt ? `Retrying connection (attempt ${status.retryAttempt})…` : "Connecting to the local aux4 daemon…");
    setStatus(status.state === "error" ? "err" : "connecting", status.state === "error" ? "Connection error" : "Connecting…", detail);
  } else {
    setStatus("off", "Not connected", "Start the aux4 browser daemon to pair.");
  }
  $("connect").disabled = !!status.connected;
  $("disconnect").disabled = !status.shouldConnect && !status.connected;
}

async function refresh() {
  try {
    const status = await chrome.runtime.sendMessage({ cmd: "status" });
    describeStatus(status);
  } catch (error) {
    describeStatus({ error: String(error?.message || error) });
  }
}

async function restore() {
  const config = await chrome.storage.local.get(["token", "port", "scope"]);
  if (config.token) $("token").value = config.token;
  if (config.port) $("port").value = config.port;
  if (config.scope) $("scope").value = config.scope;
}

$("connection-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const token = $("token").value.trim();
  const port = parseInt($("port").value, 10) || 8765;
  const scope = $("scope").value;
  if (!token) {
    setStatus("err", "Pairing token required", "Paste the token printed by aux4 browser connect.");
    $("token").focus();
    return;
  }
  $("connect").disabled = true;
  setStatus("connecting", "Connecting…", "Contacting the local aux4 daemon.");
  const result = await chrome.runtime.sendMessage({ cmd: "connect", token, port, scope });
  if (!result?.ok) describeStatus({ error: result?.error || "Could not start the connection." });
  else await refresh();
});

$("disconnect").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ cmd: "disconnect" });
  await refresh();
});

$("show-token").addEventListener("click", () => {
  const input = $("token");
  const visible = input.type === "text";
  input.type = visible ? "password" : "text";
  $("show-token").textContent = visible ? "◉" : "○";
  $("show-token").setAttribute("aria-label", visible ? "Show pairing token" : "Hide pairing token");
});

restore().then(refresh);
setInterval(refresh, 2000);
