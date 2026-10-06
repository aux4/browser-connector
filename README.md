# aux4 Browser Connector

The aux4 Browser Connector lets aux4 drive the browser profile you already use.
It connects the extension to the local aux4 browser daemon and exposes the
active browser windows, tabs, signed-in pages, cookies, downloads, and page
interactions through the aux4 browser command set.

The connector is local-first: the extension opens a WebSocket only to
`127.0.0.1`, and the pairing token is generated and stored on the same
computer. It does not send browsing data to an aux4-hosted service.

## Requirements

- Google Chrome with Manifest V3 support.
- The aux4 CLI with the `aux4/browser` package installed.
- A local aux4 daemon started with `aux4 browser connect`.

Firefox support is planned. The current package uses Chrome's MV3 service
worker format and is not yet the Firefox package.

## Installation

### Chrome Web Store

Install **aux4 Browser Connector** from its Chrome Web Store listing, then
follow the pairing steps below. The store listing will be published after the
extension has completed review.

### Development or private testing

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this repository directory.
4. Pin **aux4 Browser Connector** if you want it in the toolbar.

## Quick start

1. Start the local daemon:

   ```bash
   aux4 browser connect
   ```

2. Copy the `token` printed by the command.
3. Open the extension popup, paste the token, and choose a target scope:
   - **Current window** routes requests to the active tab in that window.
   - **Current tab** keeps the aux4 session attached to one tab.
4. Click **Connect**.
5. Confirm that the popup shows **Connected**, then use aux4 browser commands:

   ```bash
   aux4 browser open --url https://example.com
   aux4 browser snapshot --format text
   aux4 browser click --name "Learn more"
   ```

The command defaults to WebSocket port `8765`. Pass a different port to
`aux4 browser connect` if another local service is using it, then enter the
same port in the popup.

## Connection behavior

There is one WebSocket connection per browser profile, not one connection per
tab. Requests carry their target window or tab, so multiple windows and tabs
can be controlled over the same paired connection.

The extension retries temporary daemon or transport failures with exponential
backoff and jitter, capped at 30 seconds. An alarms-based safety net restores
the connection if the MV3 service worker is suspended. Pairing-token and
protocol-version errors are shown as actionable errors and do not retry
forever.

The connection badge indicates state:

- Green dot: connected.
- Purple dot: connecting or retrying.
- Red dot: pairing or protocol error.

## Supported capabilities

The extension supports navigation, accessibility snapshots, page content,
element reads and interactions, form filling, selection, keyboard and mouse
events, scrolling, waits, expectations, components, screenshots, cookies,
uploads, downloads, and multi-tab operations.

The following limitations are intentional for the MV3 extension backend:

- Arbitrary `eval` is unavailable because MV3 content security rules prohibit
  string-to-code evaluation in injected extension functions.
- Full-page screenshots are unavailable; visible-tab screenshots are supported.
- `save-pdf --full-page` is unavailable without the invasive debugger
  permission.
- Browser-internal pages such as `chrome://extensions` cannot be scripted by
  normal extension page injection rules.

## Permissions

The extension requests these permissions for the corresponding features:

| Permission | Use |
| --- | --- |
| `scripting` | Read and interact with the current page. |
| `tabs` | Resolve windows and tabs, navigate, switch, and close tabs. |
| `storage` | Store the local pairing settings and connection state. |
| `alarms` | Recover from service-worker suspension and retry connections. |
| `cookies` | Export and import cookies when explicitly requested by aux4. |
| `downloads` | Start browser downloads when explicitly requested by aux4. |
| `<all_urls>` | Allow page interaction on the sites the user chooses to automate. |

The extension has no analytics, advertising, remote code, or third-party
service dependency. Commands are accepted only from the paired local daemon
after the token handshake succeeds.

## Security and privacy

The connector can access the pages and browser data needed to automate the
user's selected browser profile. That access is initiated by the user through
the local daemon and is not uploaded by the extension to an aux4 cloud
service. The pairing token should be treated as a local secret and should not
be shared.

The Chrome Web Store listing must link to a public privacy policy that matches
these behaviors. See `PRIVACY.md` for the policy draft to publish with the
project website or documentation site.

## Troubleshooting

### The popup says the daemon is unavailable

Run `aux4 browser connect` and verify that its port matches the popup. The
extension connects only to `127.0.0.1`; it does not discover daemons on the
network.

### The token is rejected

Start a fresh `aux4 browser connect` session and paste its newly printed token.
Tokens are tied to the daemon instance and protocol version.

### A command reports that no tab is available

Open a normal web page in the selected window. Browser-internal pages and
extension pages have restricted scripting access.

### The extension appears stuck retrying

Check the daemon output and the extension service-worker errors in
`chrome://extensions`. Disconnect, restart the daemon, and pair again if the
daemon was replaced.

## Development

The extension is maintained in the [`aux4/browser-connector`](https://github.com/aux4/browser-connector)
repository. The aux4 daemon and CLI integration are maintained separately in
[`aux4/browser`](https://github.com/aux4/browser).

To create a Chrome Web Store upload package, make the manifest the root of the
ZIP:

```bash
mkdir -p dist
zip -r dist/aux4-browser-connector-0.2.0.zip . \
  -x 'README.md' 'PROTOCOL.md' 'PRIVACY.md' '*.DS_Store'
```

Increment `manifest.json`'s version for every store upload. The ZIP must be
recreated for every code or asset change.

### Versioned GitHub releases

The repository includes a GitHub Action that runs automatically when an
extension change is merged to `main`. It reads the version from
`manifest.json`, creates the matching `browser-connector-vX.Y.Z` tag, and
publishes `aux4-browser-connector-X.Y.Z.zip` as a GitHub Release asset.

Before merging another extension release, increment `manifest.json`'s version.
The action rejects a version that has already been released, validates the
archive, and confirms that `manifest.json` is at the ZIP root.

For example, changing the manifest to `0.3.0` and merging the change creates:

```text
browser-connector-v0.3.0
aux4-browser-connector-0.3.0.zip
```

## Chrome Web Store release checklist

Before submitting the extension:

1. Register a Chrome Web Store developer account, enable 2-Step Verification,
   and complete the one-time developer registration.
2. Run the extension from a clean Chrome profile and verify pairing, reconnect,
   window targeting, tab targeting, navigation, interaction, cookies,
   downloads, and the documented limitations.
3. Upload the ZIP from the `dist/` directory to the Chrome Developer Dashboard.
4. Complete the Store listing with the title, short description, detailed
   description, category, support URL, icon, and at least one current
   screenshot. Screenshots should be `1280x800` or `640x400`.
5. Complete the Privacy practices form. Disclose that the extension can read
   page content, tabs, cookies, and downloads, and that it uses them only to
   provide the local browser-connector function.
6. Add the public privacy-policy URL from `PRIVACY.md`.
7. Start with **Private** or **Unlisted** visibility for trusted testing,
   provide reviewer setup instructions, and submit for review.
8. After acceptance, switch to **Public** visibility if that is the intended
   release channel.

Chrome requires the store listing, privacy declarations, permissions, and
actual behavior to agree. Keep this README, the privacy policy, and the
Dashboard listing synchronized when capabilities change.
