# Building &amp; releasing

This page covers how Noted is built, packaged, signed, and shipped, plus the
continuous-integration gates that run on every push.

## Prerequisites

- **Node.js 20 or later**
- **npm 10 or later**
- To package the desktop app: **macOS** for the DMG (with Xcode command-line
  tools for signing), **Windows** for the NSIS installer, or **Linux** for the
  AppImage and `.deb`. electron-builder does not cross-compile, so each
  platform's installer is built on that platform — see
  [Cross-platform builds (CI)](#cross-platform-builds-ci).

Install dependencies once:

```bash
npm install
```

## Development

```bash
npm run dev
```

This builds the Electron `main` and `preload` bundles with `esbuild`, then
starts the Vite renderer with hot-module reloading.

## npm scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Build main + preload, then start Vite |
| `npm run build` | Full production build and package (`electron-builder`) |
| `npm run build:dmg` | Build and package a macOS DMG (arm64) |
| `npm run build:win` | Build and package the Windows NSIS installer (x64 + arm64) |
| `npm run build:linux` | Build and package the Linux AppImage and `.deb` (x64 + arm64) |
| `npm run build:main` | Bundle the Electron main process (`dist-electron/main.cjs`) |
| `npm run build:preload` | Bundle the preload script (`dist-electron/preload.js`) |
| `npm run build:mcp` | Bundle the MCP server (`dist-mcp/index.cjs`) |
| `npm run lint` | ESLint with cache |
| `npm run lint:ci` | ESLint without cache (CI) |
| `npm run test` | Run the Vitest suite |
| `npm run test:ci` | Verbose Vitest run |
| `npm run test:coverage` | Vitest with V8 coverage |

## The build pipeline

`npm run build` runs, in order:

1. `tsc -b` — type-check the whole project.
2. `vite build` — bundle the React renderer into `dist/`.
3. `build:main`, `build:preload`, `build:mcp` — three `esbuild` passes that emit
   CommonJS bundles for the Electron main process, the preload bridge, and the
   standalone MCP server.
4. `electron-builder` — package the app and produce installers (a DMG on macOS,
   an NSIS `.exe` on Windows, an AppImage and `.deb` on Linux).

The renderer, main process, preload bridge, and MCP server are separate bundles;
see [Architecture](/contributing/architecture) for how they fit together.

## Packaging

`electron-builder` is configured in `package.json` under the `build` key. Each
platform produces its own installers:

- **macOS** — `Noted-<version>-arm64.dmg` (Apple Silicon) and
  `Noted-<version>.dmg` (Intel)
- **Windows** — `Noted-<version>-<arch>-setup.exe` (NSIS, x64 and arm64)
- **Linux** — `Noted-<version>.AppImage` / `Noted-<version>-arm64.AppImage`, and
  `noted_<version>_<arch>.deb` (x64 and arm64)

Packaged output lands in `release/`. The MCP server bundle is unpacked from the
asar (`asarUnpack`) so it can be spawned as a child process.

## Signing &amp; notarization

Release builds are signed with an Apple Developer ID and notarized by Apple so
they run without Gatekeeper warnings. Signing runs **locally**, never in CI, so
no Apple credentials are ever exposed to the build servers.

Add your credentials to `.env.local` (copy from `.env.local.example`):

```bash
APPLE_ID=you@example.com
APPLE_TEAM_ID=XXXXXXXXXX
APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
```

Then run:

```bash
bash scripts/release.sh
```

The script:

1. Loads the credentials from `.env.local` (override the path with
   `APPLE_CREDS_ENV=/path/to/creds.env`).
2. Runs `npm run build`, which signs the app with the Developer ID and the
   hardened runtime enabled (entitlements in `build/entitlements.mac.plist`).
3. Submits each version-scoped DMG to Apple with `xcrun notarytool submit --wait`.
4. Staples the notarization ticket to each DMG with `xcrun stapler staple`, so
   the download passes Gatekeeper offline.

::: info Why the DMG is notarized separately
`electron-builder` signs and staples the `.app`, but not the `.dmg` wrapper
itself. `scripts/release.sh` owns DMG notarization, which is why
`mac.notarize` is set to `false` in `package.json`.
:::

After a successful macOS build, notarize and publish the DMGs, then tag the
release to trigger the cross-platform CI build:

```bash
bash scripts/release.sh          # build + notarize + staple the DMGs
git tag v<version>
git push --tags                  # triggers the Windows/Linux CI build below
gh release create v<version> release/Noted-<version>*.dmg
```

## Cross-platform builds (CI) {#cross-platform-builds-ci}

Windows and Linux installers are built in CI, because electron-builder cannot
cross-compile them from macOS. `.github/workflows/release.yml` runs on a `v*`
tag (and on manual dispatch): it builds the Windows and Linux targets on their
own runners with `build:win` / `build:linux` and uploads them — together with
the `latest-*.yml` auto-update metadata — to the GitHub release. The macOS DMGs
are built and notarized locally (above) and added to the same release.

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request to `main`, on a
Node **20.x** and **22.x** matrix:

1. `npm ci`
2. `npm run lint`
3. `npx tsc -b`
4. `npm test` — the full Vitest suite, including a locale-parity test that fails
   if any of the six shipped locales is missing a key.
5. Verify bundles — `vite build` plus the three `esbuild` bundles.

CI never signs or notarizes; that is a local-only step.

Run the same gates locally before opening a pull request:

```bash
npm run lint
npx tsc -b
npm test
```

## Documentation site

This documentation is a VitePress site under `docs/`. It is deployed to GitHub
Pages by `.github/workflows/docs.yml` whenever `docs/**` changes on `main`.

```bash
cd docs
npm install
npm run dev      # local preview at http://localhost:5173
npm run build    # output in docs/.vitepress/dist
```
