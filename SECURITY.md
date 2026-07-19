# Security Policy

Noted is a local-first macOS app: your notes stay on your machine, there is no
backend and no telemetry. The most sensitive surfaces are the optional cloud LLM
calls, the Git integration, and the local MCP server — the areas below describe
how to report an issue in any of them.

## Reporting a vulnerability

**Please do not open a public issue for security reports.**

- Preferred: open a private report via **GitHub Security Advisories** —
  [Report a vulnerability](https://github.com/fabriziosalmi/noted/security/advisories/new).
- Alternatively, email **fabrizio.salmi@gmail.com** with the details.

Please include:

- affected version (see *Noted → About*, or the release tag) and macOS version;
- a description of the issue and its impact;
- steps to reproduce, a proof-of-concept, or a crash log if you have one.

This is a solo-maintained project, so responses are best-effort: expect an
acknowledgement within a few days. Please give a reasonable window to ship a fix
before any public disclosure. Coordinated disclosure is appreciated, and
reporters are credited in the release notes unless they prefer to stay anonymous.

## Supported versions

Security fixes land on the latest released version. Please reproduce on the most
recent release before reporting.

| Version | Supported |
| ------- | --------- |
| latest `1.x` | ✅ |
| older        | ❌ |

## Scope & hardening

Noted already ships a number of local-surface protections; a report that defeats
one of these is especially valuable:

- **MCP server** — the SSE transport requires a token on every request (checked
  with a constant-time compare) and validates the request Origin/Host; the
  credential is passed to the server process via the environment, not argv.
- **Vault access** — file operations are confined to an allowlist of blessed
  vault roots; path traversal in note/folder names is neutralized.
- **Renderer** — a strict production Content-Security-Policy (`script-src 'self'`,
  no `unsafe-eval`), navigation guards, and DOMPurify sanitization of all
  rendered HTML.
- **Outbound requests** — the LLM proxy enforces a host allowlist and blocks
  metadata/link-local/private addresses (SSRF), and PII is masked by default
  before any text leaves the machine for a cloud provider.
- **Distribution** — release builds are signed with a Developer ID certificate,
  run with the hardened runtime, and are notarized + stapled by Apple.

### Out of scope

- Issues that require a previously-compromised machine or physical access.
- Third-party LLM providers you configure (their API keys, their responses).
- Vulnerabilities in dependencies without a demonstrated impact on Noted — please
  report those upstream, though we welcome a heads-up.

Thank you for helping keep Noted and its users safe.
