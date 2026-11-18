# Kothok (কথক)

AI content, voice and subtitle studio for Windows. Tauri 2 + Rust backend, React + TypeScript UI, English and বাংলা interface.

## Get the Windows installer
Every push to `main` builds an installer on GitHub Actions and publishes it on the **Releases** page (newest "Kothok build N" → download the `*-setup.exe`). Run it to install. The app can then update itself (Settings → Updates).

## What works
| Area | What you get | Needs |
|---|---|---|
| Content Studio | Generate / continue / rewrite / expand / shorten / grammar-fix / translate; Bangla, English or mixed; fallback chain; export TXT, MD, DOCX | A text provider (Gemini, OpenRouter, OpenAI, Groq, Ollama, LM Studio, any OpenAI-compatible) |
| Thumbnail Studio | Layered canvas editor (text, images, gradient background), presets, PNG/JPG export, AI background images | Image provider only for AI images (manual design is free) |
| Voice Studio / Library | Text → speech (MP3), speed/pitch, history, favourites, voice list as returned by the provider | A TTS provider (Google Cloud TTS incl. Gemini-TTS, or any OpenAI-compatible `/audio/speech`) |
| Audio & Transcription | Audio → text with timestamps | An STT provider (Groq free tier, OpenAI, or a local Whisper server with the OpenAI API) |
| Subtitle Studio | Edit, split, merge, shift, find/replace, audio preview, import/export SRT/VTT/TXT (optional UTF-8 BOM) | — |
| Projects | Folders of content, thumbnails, audio, subtitles, transcripts | — |
| API Manager | Add providers, test connection, defaults, fallback chain, cost class | Keys are kept in Windows Credential Manager |
| Settings | Language, theme, low-end mode, storage cleanup, updates | — |

## Honest limits (this version)
- **Voice cloning:** voice profiles (with a consent statement and sample) can be stored, but **no cloning engine is connected**, so they cannot generate speech yet.
- **Speaker detection:** not supported.
- **Transcription** uploads files up to 25 MB as they are. Bigger recordings (up to 2 GB) need FFmpeg, which Settings → Tools downloads on request (SHA-256 checked); Kothok then compresses and splits them. whisper.cpp download is not built; use a local Whisper server through the OpenAI-compatible provider instead.
- **Bangla speech:** Google's *standard* Bangla voices are `bn-IN`; `bn-BD` needs a Gemini-TTS model. Both need a Cloud project with billing. Quality is not guaranteed by Kothok.
- Provider calls were verified against official documentation and unit-tested for request/response parsing, but **not run against live accounts** in CI. If a provider changes its API, use "Test connection" and the error text to see why.
- Nothing paid is used silently: paid providers are labelled, and fallback to a paid provider asks first.

## Updates
See [docs/UPDATER.md](docs/UPDATER.md). Short version: updates come from this repository's Releases, are verified with a SHA-256 file, and install only when you click.

## Security notes
See [docs/SECURITY.md](docs/SECURITY.md).

## Develop locally
Requires Node 22, pnpm, Rust and the [Tauri 2 Windows prerequisites](https://tauri.app/start/prerequisites/).

```
pnpm install
pnpm tauri dev      # desktop app
pnpm dev            # UI only in a browser (desktop-only actions show a message)
pnpm tauri build    # installer
cargo test --manifest-path src-tauri/Cargo.toml --lib
node --experimental-strip-types tests/srt.test.mjs
```

The plan and design are in [ARCHITECTURE.md](ARCHITECTURE.md).
