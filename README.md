# Kothok (কথক)

AI content, voice and subtitle studio for Windows. Tauri 2 + Rust backend, React + TypeScript UI, English and বাংলা interface.

**Status:** early development (Phase 2 of 8 — app shell, theming, i18n, SQLite). AI features are not built yet; see [ARCHITECTURE.md](ARCHITECTURE.md) for the plan.

## Get the Windows installer
Every push to `main` builds an installer on GitHub Actions:
**Actions → "Build Windows installer" → latest run → Artifacts → `Kothok-windows-installer`.**
Pushing a tag like `v0.1.0` also attaches the `.exe` to a GitHub Release.

## Develop locally
Requires Node 22, pnpm, Rust and the [Tauri 2 Windows prerequisites](https://tauri.app/start/prerequisites/).

```
pnpm install
pnpm tauri dev      # desktop app
pnpm dev            # UI only in a browser (settings fall back to localStorage)
pnpm tauri build    # installer
```
