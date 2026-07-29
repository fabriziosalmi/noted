# Contributing to Noted

Thanks for taking the time to contribute. Noted is a local-first notes app, and
it stays healthy because changes are small, tested, and respect the "your notes
never leave your machine unless you ask" promise. This guide covers how to get
set up, what the checks expect, and how a change becomes a release.

By participating you agree to abide by the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Ways to help

- **Report a bug** — open a [bug report](https://github.com/fabriziosalmi/noted/issues/new?template=bug_report.yml). Include your OS, the Noted version (**Noted → About**), and steps to reproduce.
- **Suggest a feature** — open a [feature request](https://github.com/fabriziosalmi/noted/issues/new?template=feature_request.yml). Explain the problem first; the solution second.
- **Improve the docs** — the site lives in [`docs/`](./docs) (VitePress). Even a typo fix is welcome.
- **Send code** — pick up an issue labelled [`good first issue`](https://github.com/fabriziosalmi/noted/issues?q=is%3Aopen+label%3A%22good+first+issue%22), or open one to discuss a larger change before you build it.
- **Report a vulnerability** — do **not** open a public issue. Follow the [Security Policy](./SECURITY.md).

## Getting set up

You need **Node.js 20+** and **npm 10+**.

```bash
git clone https://github.com/fabriziosalmi/noted.git
cd noted
npm install
npm run dev
```

`npm run dev` starts the Vite renderer and loads the Electron `main` and
`preload` bundles produced by `esbuild`.

## The checks your PR must pass

CI runs on Node 20 and 22 and mirrors these exactly. Run them locally before you
push — a green local run is a green CI run:

```bash
npm run lint        # ESLint (flat config)
npx tsc -b          # TypeScript, no emit
npm test            # Vitest — the whole suite
```

A few expectations that trip people up:

- **Tests are required.** New behaviour needs a test; a bug fix needs a test that
  fails before your change and passes after. The suite is fast — keep it that way.
- **Every string the user can see must be translated.** UI strings go through
  `t(...)` and must exist in all locales; a locale-parity test
  (`src/lib/i18n.completeness.test.ts`) fails the build otherwise. Add your key to
  every file under the locales, not just English.
- **Nothing platform-specific may be hardcoded.** Code that reads paths or OS
  behaviour should take the platform as a parameter so it stays testable on the
  Linux CI runner — see `electron/src/services/cloud-detector.ts` for the pattern.
- **Keep the privacy promise.** No telemetry, no network calls the user did not
  initiate. Cloud LLM calls, Git, and the MCP server are the only egress points,
  and each is user-driven.

## Commits and pull requests

- Branch off `main`. Keep each PR focused on one thing.
- Write commit messages in the imperative mood; a short subject, then a body that
  explains *why*, not just *what*. Conventional prefixes (`feat:`, `fix:`,
  `docs:`, `refactor:`, `chore:`) are used throughout the history.
- Fill in the pull request template. Link the issue it closes.
- Match the surrounding code: its naming, its comment density, its idioms. Noted's
  comments explain the reasoning behind a choice, not the mechanics of the line.

## Project layout

| Path | What lives there |
| --- | --- |
| `src/` | React renderer — components, hooks, Zustand store, `lib/` utilities |
| `electron/` | Main and preload processes, IPC, vault and Git operations |
| `shared/` | Code shared across processes (agent engine, markdown, search, security) |
| `mcp-server/` | The standalone Model Context Protocol server |
| `docs/` | VitePress documentation site |
| `scripts/` | Release, demo capture, and end-to-end helpers |

The architecture is documented in more depth at
[fabriziosalmi.github.io/noted](https://fabriziosalmi.github.io/noted/) under
*Contributing → Architecture*.

## How a change ships

Maintainers cut releases; you do not need to touch versions in a PR. For
reference, the flow is:

1. Merge to `main` with CI green.
2. Bump the version (`chore: release X.Y.Z`) and update the changelog.
3. Push a `vX.Y.Z` tag. This triggers the [build workflow](.github/workflows/release.yml),
   which packages the Windows and Linux installers into a **draft** release.
4. The maintainer builds, signs, and notarizes the macOS DMGs locally
   (`scripts/release.sh`), attaches them, and publishes.

Installed copies then pick the update up automatically (see the auto-updater).

Questions? Open a [discussion or issue](https://github.com/fabriziosalmi/noted/issues).
Thank you for helping make Noted better.
