# Foundry Local Explorer

When running AI models on your local machine - everybody thinks of [ollama](https://ollama.com/) or [LM Studio](https://lmstudio.ai/) first. This serves everybody from AI-consumer, hobbyist to developer.
Microsoft [Foundry Local](https://learn.microsoft.com/azure/ai-foundry/foundry-local/) on the other hand is the versatile local AI SDK platform developers use to embed local AI capabilities into their cross-plattform apps.

But why not building a simple GUI around Foundry Local to expose its capabilities, the model catalogue, the local hardware acceleration and the OpenAI compatible API for easier testing and using it as local model runner more easily.

This is considered a Proof of conecpt and is built on the Electron application framework with React and TypeScript — a desktop GUI for .


## Requirements

- **OS**: Windows, macOS, or Linux (the app's hardware/EP detection is powered by the `foundry-local-sdk`, which is cross-platform).
- **Node.js**: 20.x LTS or later, with a matching **npm** (bundled with Node).
- **Foundry Local**: must be [installed](https://learn.microsoft.com/azure/ai-foundry/foundry-local/get-started) on the machine — this app is a GUI on top of it, not a replacement for it. The Foundry Local service is started on demand by the SDK; you don't need to run `foundry` manually first.
- **Build tools for native modules**: this project depends on `better-sqlite3`, which compiles a native Node addon on install. Make sure you have the platform's native build toolchain available before `npm install`:
  - **Windows**: [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/) (Desktop development with C++ workload) or `npm install --global windows-build-tools` equivalent, plus Python 3.
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`).
  - **Linux**: `build-essential`, `python3`, and `make`/`gcc` (e.g. `sudo apt install build-essential python3`).
- **Git** to clone the repository.

## Project Setup

### 1. Clone and install dependencies

```bash
git clone <this-repo-url>
cd "FL Studio"
npm install
```

`npm install` also runs `postinstall` (`electron-builder install-app-deps`), which rebuilds native modules (e.g. `better-sqlite3`) against Electron's Node ABI rather than your system Node — this step requires the native build toolchain listed above.

### 2. Run in development

```bash
npm run dev
```

This starts `electron-vite` in dev mode with hot reload for the renderer and automatic restarts for main-process changes.

Other useful scripts during development:

```bash
npm run typecheck   # TypeScript checks for both main/preload (node) and renderer (web)
npm run lint        # ESLint
npm run format      # Prettier --write
```

### 3. Build for production

`npm run build` type-checks the project and produces an unpacked `electron-vite build` output in `out/`. The platform-specific commands below additionally package that output into an installable artifact via `electron-builder`, written to `dist/`:

```bash
# Windows (produces an NSIS installer, e.g. dist/fl-studio-<version>-setup.exe)
npm run build:win

# macOS (produces a .dmg, e.g. dist/fl-studio-<version>.dmg)
npm run build:mac

# Linux (produces AppImage, snap, and deb packages in dist/)
npm run build:linux
```

Notes:
- Building for Windows works from Windows; cross-compiling `build:win` from macOS/Linux (or vice versa) is not supported/tested here.
- `npm run build:unpack` produces an unpacked app directory (via `electron-builder --dir`) without generating an installer — useful for quickly testing a production build locally.
- Packaged builds are unsigned by default (`notarize: false` on macOS, no code-signing config for Windows/Linux); expect an OS security prompt (SmartScreen/Gatekeeper) on first run of the installer.

### 4. Install the built app

- **Windows**: run the generated `dist/fl-studio-<version>-setup.exe`. It installs via NSIS and creates a desktop shortcut.
- **macOS**: open the generated `dist/fl-studio-<version>.dmg` and drag `fl-studio.app` into `Applications`.
- **Linux**: run the `.AppImage` directly (`chmod +x` first), or install the `.deb` (`sudo dpkg -i dist/fl-studio-<version>.deb`), or install the `.snap`.

In all cases, ensure Foundry Local itself is installed on the target machine before launching the app — the app talks to it via the SDK and won't function without it.
