# Installation

Noted runs on macOS, Windows, and Linux. macOS is the primary, fully signed
target; Windows and Linux builds are produced for every release but are not
code-signed yet. You can install a ready-made build or build it yourself from
source.

## Requirements

- **macOS 11 (Big Sur) or later** (Apple Silicon or Intel), **Windows 10/11**,
  or a modern **Linux** desktop (x64 or arm64).

## Download a release

Grab the latest build from the
[Releases page](https://github.com/fabriziosalmi/noted/releases/latest):

| Platform | File |
| --- | --- |
| macOS — Apple Silicon (M1 and later) | `Noted-<version>-arm64.dmg` |
| macOS — Intel | `Noted-<version>.dmg` |
| Windows (x64 / arm64) | `Noted-<version>-<arch>-setup.exe` |
| Linux (x64 / arm64) | `Noted-<version>.AppImage` or `.deb` |

**macOS** — open the DMG and drag **Noted** into your Applications folder. The
builds are notarized by Apple, so macOS opens them normally, with no
"unidentified developer" warning. If Gatekeeper ever blocks a build, right-click
the app and choose **Open** once to confirm.

**Windows** — run the `.exe` installer. It is not code-signed yet, so Windows
SmartScreen may warn you: choose **More info → Run anyway**.

**Linux** — mark the `.AppImage` executable (`chmod +x Noted-*.AppImage`) and run
it, or install the `.deb` with `sudo apt install ./Noted-*.deb`.

::: tip Which macOS build do I need?
If you are on an M-series Mac, use the `arm64` DMG. On older Intel Macs, use the
one without an architecture suffix. Installing the wrong one still runs under
Rosetta, but the native build is faster.
:::

## Staying up to date

Noted checks for new releases on launch and can update itself in place — you are
asked before anything downloads, and again before it installs. You can also
trigger a check any time from **{App menu} → Check for Updates…** (in the Help
menu on Windows and Linux). Linux `.deb` installs update through your package
manager instead; the AppImage updates itself.

## Build from source

If you prefer to build it yourself, you need:

- **Node.js 20 or later**
- **npm 10 or later**

Clone the repository and start the app in development mode:

```bash
git clone https://github.com/fabriziosalmi/noted.git
cd noted
npm install
npm run dev
```

`npm run dev` starts the Vite renderer and loads the Electron `main` and
`preload` bundles produced by `esbuild`.

### Produce a local build

To build the app and package an installer locally (unsigned):

```bash
npm run build       # full build for the current platform via electron-builder
npm run build:dmg   # macOS DMG, arm64
npm run build:win   # Windows NSIS installer
npm run build:linux # Linux AppImage + deb
```

The packaged output lands in `release/`. Each platform's installer must be built
on that platform (or a matching CI runner) — electron-builder does not
cross-compile a Windows or Linux binary from macOS.

For a **signed and notarized** release you need an Apple Developer ID and
credentials in `.env.local`. See
[Building &amp; releasing](/contributing/building) for the full flow.

## Next steps

- **[First run](/guide/first-run)** — choose your vault folder and create your
  first note.
