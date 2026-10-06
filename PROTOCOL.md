# aux4/browser ⇄ extension wire protocol

**Protocol version: 1** — increment this when the handshake or message
contract changes incompatibly.

## Topology

```
aux4 CLI ── Unix socket ──▶ daemon (WebSocket server) ◀── WebSocket client ── MV3 extension
                                                                            └─ Chrome tabs
```

MV3 extensions initiate outbound connections, so the local daemon owns the
WebSocket server. The server binds to `127.0.0.1` only. There is one socket per
Chrome profile; tab/window routing happens inside request parameters.

Default endpoint: `ws://127.0.0.1:8765`.

## Handshake

The extension sends the first frame:

```json
{
  "type": "hello",
  "token": "<pairing token>",
  "protocolVersion": 1,
  "client": { "name": "aux4 browser connector", "version": "0.2.0", "scope": "window" }
}
```

The daemon responds with `welcome` or an `error` (`bad-token`,
`version-mismatch`, or `expected-hello`). Pairing errors stop automatic retry;
transport failures retry with backoff.

## Request/response

```json
{ "id": 17, "method": "snapshot", "params": {
  "target": { "scope": "tab", "windowId": 4, "tabId": 91 },
  "mode": "full"
} }
```

```json
{ "id": 17, "result": { "snapshot": { "url": "https://example.com/" } } }
```

Errors use the same correlation id:

```json
{ "id": 17, "error": { "message": "No Chrome tab is available in the selected window" } }
```

`target.scope = "window"` resolves the active tab in `windowId`.
`target.scope = "tab"` addresses the exact `tabId`. `open`, `new-tab`, and
`switch-tab` return a target so the daemon can pin the session to that tab.

## Methods

The extension implements the browser command surface used by the daemon:

`open`, `visit`, `back`, `forward`, `reload`, `list`, `close`, `snapshot`,
`content`, `read`, `click`, `click-selector`, `click-text`,
`click-item`, `mouse`, `type`, `fill`, `select`, `check`, `uncheck`, `hover`,
`press`, `clear`, `scroll`, `wait`, `expect`, `expect-list`, `get-items`,
`component`, `screenshot`, `cookies`, `upload`, `download`, `new-tab`,
`switch-tab`, `close-tab`, and `list-tabs`. The daemon reports `eval` as
unsupported for this backend because MV3's CSP forbids arbitrary string
evaluation in injected code.

Screenshots are returned as PNG data URLs for the daemon to write to disk.
Cookie import/export and file uploads are performed by the daemon and sent
over the already-authenticated local socket. Full-page screenshots and
print-to-PDF are intentionally reported as unsupported by the extension
backend.
