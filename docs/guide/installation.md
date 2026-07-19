# Installation

Noted targets macOS. You can install a ready-made signed build or build it
yourself from source.

## Requirements

- **macOS 11 (Big Sur) or later.**
- Apple Silicon or Intel — a separate build is provided for each.

## Download a release

Grab the latest **signed and notarized** build from the
[Releases page](https://github.com/fabriziosalmi/noted/releases/latest):

| Mac | File |
| --- | --- |
| Apple Silicon (M1 and later) | `Noted-<version>-arm64.dmg` |
| Intel | `Noted-<version>.dmg` |

Open the DMG and drag **Noted** into your Applications folder.

Because the builds are notarized by Apple, macOS opens them normally — you will
not see the "unidentified developer" warning. If Gatekeeper ever blocks a build,
right-click the app and choose **Open** once to confirm.

::: tip Which build do I need?
If you are on an M-series Mac, use the `arm64` DMG. On older Intel Macs, use the
one without an architecture suffix. Installing the wrong one still runs under
Rosetta, but the native build is faster.
:::

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

To build the app and package a DMG locally (unsigned):

```bash
npm run build       # full build via electron-builder
npm run build:dmg   # macOS DMG, arm64
```

The packaged output lands in `release/`.

For a **signed and notarized** release you need an Apple Developer ID and
credentials in `.env.local`. See
[Building &amp; releasing](/contributing/building) for the full flow.

## Next steps

- **[First run](/guide/first-run)** — choose your vault folder and create your
  first note.
