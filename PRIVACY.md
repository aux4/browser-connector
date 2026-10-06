# aux4 Browser Connector privacy policy draft

**Effective date:** 2026-10-06

aux4 Browser Connector is a local browser connector for the aux4 command-line
tool. This draft should be published at a stable HTTPS URL and linked from the
Chrome Web Store listing before submission. It is not legal advice.

## Information the extension can access

When the user explicitly pairs the extension with a local aux4 daemon, the
extension can access:

- The URLs, titles, and visible page content needed for requested browser
  automation.
- Browser tabs and windows needed to identify and control the selected target.
- Cookies when the user requests cookie export or import.
- Download information when the user requests a download.
- The pairing token, port, selected target scope, and connection status in
  browser extension storage.

## How information is used

This information is used only to perform the browser actions requested through
the user's local aux4 daemon. The extension does not use it for advertising,
profiling, analytics, or unrelated purposes.

## Sharing and transmission

The extension does not send information to an aux4 cloud service or sell it to
third parties. Its browser connection is made to `127.0.0.1` on the user's
computer. The local aux4 daemon may store command outputs or screenshots when
the user requests those outputs through the aux4 CLI.

## Data retention and deletion

Connection settings and the pairing token remain in the browser's extension
storage until the user disconnects, clears the extension data, or uninstalls
the extension. Browser data accessed during a command is not retained by the
extension after the command completes.

## Contact

For privacy questions or deletion requests, contact the aux4 project
maintainers through the support contact published with the Chrome Web Store
listing.
