# Security

Noted is local-first, so most of its security work is about keeping a desktop app
that renders arbitrary HTML and talks to AI providers from doing anything you did
not ask for. This page summarizes the posture. To report a vulnerability, see
[SECURITY.md](https://github.com/fabriziosalmi/noted/blob/main/SECURITY.md).

## Process isolation

Both the main window and the Quick Capture window run with `contextIsolation`
enabled and `nodeIntegration` disabled. The renderer has no direct Node access;
its only channel to the system is the audited preload bridge.

## Content Security Policy

A CSP is injected on every response. In production it is strict —
`script-src 'self' app:` with no `unsafe-inline` or `unsafe-eval`, and a
`connect-src` limited to the app itself and loopback. All AI traffic is proxied
through the main process rather than made from the renderer, so the renderer never
needs a wildcard network grant. The development CSP is loosened only as far as the
Vite dev server requires.

## Navigation guards

The app refuses to navigate away from itself. Requests to open a new window are
sent to the OS browser and denied in-app, and any attempt to navigate the main
frame to something other than the app protocol is blocked.

## HTML sanitization

Every note body is sanitized with a shared DOMPurify policy — the same policy in
the renderer, the main process, and the MCP server — which strips scripts,
frames, and dangerous URL schemes. Sanitization runs both on input and before any
export, so exported files never carry active content.

## Outbound requests (SSRF defense)

The LLM proxy in the main process only allows requests to an **allowlist**: the
known provider hosts, loopback, and the local endpoints you configure for LM
Studio or Ollama. Because it is an allowlist rather than a denylist, attempts to
reach cloud metadata endpoints, private ranges, or rebindable hosts simply are not
on the list and are refused. Requests are also capped in time and size.

## Secrets

API keys and the GitHub token are stored with the macOS Keychain through
Electron's `safeStorage`, kept only in memory in the main process, and encrypted
when OS encryption is available. If it is not, the app falls back to a plaintext
buffer and warns you once. Git errors are scrubbed of tokens and authorization
headers before they ever reach the UI or a log.

## Filesystem confinement

Note paths are validated (`.md` only, at most one subfolder, no traversal) and
resolved through symlinks so a link cannot escape the vault. Broad or destructive
operations — wiping the vault, copying it elsewhere — only act on vault roots that
were explicitly blessed through the native folder picker or a detected cloud path,
recorded in an allowlist.

## PII masking

Before any request reaches a **cloud** provider, Noted masks common personal-data
patterns (emails, phone numbers, card numbers, and similar) with typed
placeholders. It is on by default and applies to every outgoing message, including
system prompts; local providers receive text verbatim.

::: warning A hint, not a boundary
PII masking is a best-effort filter, not a guarantee. Do not rely on it for
regulated or highly sensitive data — review content before sending it to a cloud
provider.
:::

## MCP server

The optional SSE transport of the [MCP server](/reference/mcp-server#security)
binds to loopback, rejects non-local `Host`/`Origin` headers, and requires a
constant-time-compared bearer token on every request. The default stdio transport
inherits the trust of the client that launched it.

## Distribution

Release builds run with the macOS hardened runtime and a minimal set of
entitlements, are signed with an Apple Developer ID, and are notarized and stapled
by Apple so they pass Gatekeeper offline. Signing and notarization happen locally,
never in CI, so no signing credentials are ever exposed to a build server.
