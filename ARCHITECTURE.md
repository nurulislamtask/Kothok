# Kothok (কথক) — Architecture (Phase 1)

> Working name: **Kothok** (কথক = storyteller / narrator). Covers writing, voice, and subtitles, and is easy to type in English. Trademark and domain availability are NOT checked yet.

## 1. Environment findings
| Item | Status |
|---|---|
| Existing project | None (empty directory) |
| Rust / Cargo | 1.97 installed |
| Node / pnpm | 22 / 10.28 installed |
| FFmpeg | 6.1 (Linux dev box; Windows build uses a bundled sidecar) |
| Sandbox limits | No network for package installs; Linux, 2 cores, 7.8 GB RAM. Tauri GUI build, Windows installer and real API tests must run on the user's Windows machine or after network access is enabled |

## 2. Stack decisions
**Backend (Rust, Tauri 2)**
- `reqwest` (rustls) for HTTP; `tokio` for async; `thiserror` for typed errors; `serde`.
- `rusqlite` (bundled SQLite) plus `rusqlite_migration`. Lighter than sqlx and no compile-time DB needed.
- `keyring` crate → Windows Credential Manager. Keys never touch SQLite, logs or the frontend after save.
- Tauri plugins: `updater` (signed), `dialog`, `fs` (scoped), `shell` (sidecars only), `notification`.
- Sidecars (external binaries, not linked): `ffmpeg`, `whisper-cli` (whisper.cpp), optional `piper`.
- Tasks: one `TaskManager` with a `CancellationToken` per job and progress events to the UI. No resident background services.

**Frontend**
- React + TS (strict) + Vite + Tailwind + shadcn/ui + lucide.
- Zustand (small stores per feature), `react-i18next` (en / bn), Noto Sans Bengali bundled locally.
- Rich text: TipTap. Thumbnail canvas: `react-konva`. Waveform: `wavesurfer.js`. DOCX export: `docx`.
- All feature pages lazy-loaded with `React.lazy`.

## 3. Folder structure
```
kothok/
├─ src/                      # React app
│  ├─ app/                   # shell: Sidebar, TopBar, StatusBar, router
│  ├─ components/ui/         # shadcn primitives
│  ├─ features/
│  │  ├─ dashboard/  content/  thumbnail/  voice/  voice-library/
│  │  ├─ audio/  subtitles/  projects/  api-manager/  settings/
│  ├─ stores/                # zustand
│  ├─ lib/                   # ipc client, errors, time/srt utils
│  └─ i18n/locales/{en,bn}/  # JSON namespaces per feature
├─ src-tauri/
│  ├─ src/
│  │  ├─ main.rs  lib.rs
│  │  ├─ commands/           # thin #[tauri::command] layer
│  │  ├─ db/                 # connection, migrations, repos
│  │  ├─ providers/          # trait + adapters (text/ image/ tts/ stt/ clone/)
│  │  ├─ credentials.rs      # keyring wrapper
│  │  ├─ fallback.rs         # chain resolver + paid-confirmation gate
│  │  ├─ audio/              # ffmpeg, whisper, waveform, silence
│  │  ├─ tasks.rs            # job manager + cancellation
│  │  ├─ models.rs           # on-demand model downloads (sha256 verified)
│  │  └─ error.rs            # AppError with stable codes → i18n keys
│  ├─ migrations/
│  ├─ binaries/              # ffmpeg / whisper-cli sidecars (gitignored)
│  └─ tauri.conf.json
├─ docs/
└─ .github/workflows/release.yml
```

## 4. Database schema (SQLite, metadata only)
```sql
CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE folders(id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE projects(id INTEGER PRIMARY KEY, folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
  name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);

-- every saved artefact; file_path is relative to the storage root
CREATE TABLE assets(id INTEGER PRIMARY KEY, project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('content','audio','thumbnail','subtitle','transcript','voice_sample')),
  title TEXT, file_path TEXT, body TEXT, lang TEXT, meta_json TEXT, created_at TEXT NOT NULL);

CREATE TABLE providers(id TEXT PRIMARY KEY, category TEXT NOT NULL, adapter TEXT NOT NULL,
  display_name TEXT NOT NULL, endpoint TEXT, enabled INTEGER NOT NULL DEFAULT 1,
  cost_class TEXT NOT NULL CHECK(cost_class IN ('local','free','free_tier','paid')),
  settings_json TEXT, last_status TEXT, last_error TEXT, last_checked_at TEXT);  -- NO key column
CREATE TABLE provider_defaults(category TEXT PRIMARY KEY, provider_id TEXT, model TEXT);
CREATE TABLE fallback_chains(category TEXT, position INTEGER, provider_id TEXT, model TEXT,
  PRIMARY KEY(category, position));

CREATE TABLE voice_profiles(id INTEGER PRIMARY KEY, name TEXT NOT NULL, engine TEXT NOT NULL,
  sample_path TEXT NOT NULL, lang TEXT, consent_confirmed_at TEXT NOT NULL,
  consent_statement TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE voice_favorites(provider_id TEXT, voice_id TEXT, PRIMARY KEY(provider_id, voice_id));
CREATE TABLE tts_history(id INTEGER PRIMARY KEY, provider_id TEXT, voice_id TEXT, voice_profile_id INTEGER,
  lang TEXT, text_preview TEXT, audio_path TEXT, params_json TEXT, created_at TEXT NOT NULL);

CREATE TABLE subtitle_tracks(id INTEGER PRIMARY KEY, asset_id INTEGER REFERENCES assets(id) ON DELETE CASCADE,
  lang TEXT, source_media TEXT);
CREATE TABLE subtitle_segments(id INTEGER PRIMARY KEY, track_id INTEGER REFERENCES subtitle_tracks(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL, start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL, text TEXT NOT NULL);

CREATE TABLE prompts(id INTEGER PRIMARY KEY, name TEXT, category TEXT, template TEXT, builtin INTEGER DEFAULT 0);
CREATE TABLE generation_log(id INTEGER PRIMARY KEY, category TEXT, provider_id TEXT, model TEXT,
  status TEXT, error_code TEXT, duration_ms INTEGER, created_at TEXT NOT NULL);
CREATE TABLE local_models(id TEXT PRIMARY KEY, kind TEXT, path TEXT, size_bytes INTEGER, sha256 TEXT, installed_at TEXT);
```
API keys live only in Windows Credential Manager under `kothok/<provider_id>`.

## 5. Provider interfaces (Rust)
```rust
pub enum CostClass { Local, Free, FreeTier, Paid }
pub enum Where { Local, Cloud }

pub struct ProviderDescriptor { pub id: String, pub category: Category, pub cost: CostClass,
  pub runs: Where, pub needs_key: bool, pub langs_verified: Vec<LangSupport> /* bn/en, with test date */ }

#[async_trait]
pub trait Provider: Send + Sync {
  fn descriptor(&self) -> &ProviderDescriptor;
  async fn test_connection(&self, cx: &Ctx) -> Result<ConnectionStatus, AppError>;
  async fn list_models(&self, cx: &Ctx) -> Result<Vec<ModelInfo>, AppError>;
}
#[async_trait] pub trait TextProvider: Provider {
  async fn generate(&self, cx: &Ctx, req: TextRequest, cancel: CancelToken) -> Result<TextResponse, AppError>; }
#[async_trait] pub trait ImageProvider: Provider { async fn generate(&self, cx:&Ctx, req: ImageRequest) -> Result<ImageResponse, AppError>; }
#[async_trait] pub trait TtsProvider: Provider {
  async fn list_voices(&self, cx:&Ctx) -> Result<Vec<Voice>, AppError>;  // only what the provider actually returns
  async fn synthesize(&self, cx:&Ctx, req: TtsRequest) -> Result<AudioOut, AppError>; }
#[async_trait] pub trait SttProvider: Provider {
  async fn transcribe(&self, cx:&Ctx, req: SttRequest, cancel: CancelToken, progress: ProgressTx) -> Result<Transcript, AppError>; }
#[async_trait] pub trait CloneProvider: Provider {
  async fn create_profile(&self, cx:&Ctx, sample: &Path, consent: ConsentRecord) -> Result<VoiceProfile, AppError>;
  async fn synthesize(&self, cx:&Ctx, profile:&VoiceProfile, req: TtsRequest) -> Result<AudioOut, AppError>; }
```
Adapters: a generic **OpenAI-compatible** adapter (covers OpenRouter, Groq, local Ollama/LM Studio, etc.), plus Gemini, and a **custom REST** adapter driven by a JSON mapping, so new providers can be added without app changes.

Fallback rule: `fallback.rs` walks the category chain. If the next entry has `cost = Paid` (or unknown), it returns `NeedsConfirmation` to the UI and never calls it silently. The response always carries `handled_by`.

## 6. Engines — what is known vs. must be verified
Nothing below has been tested yet. Items marked ⚠ must be confirmed against official docs and a real Bangla test before the UI advertises them (checked at the start of Phase 3 / 6 / 7).

| Area | Plan | Status |
|---|---|---|
| Text | Gemini API (free tier exists, limits change), OpenRouter (`:free` models), OpenAI-compatible | ⚠ verify current quotas, Bangla quality |
| Image | Gemini image / OpenRouter / OpenAI-compatible; manual editor always works | ⚠ verify which are free |
| STT local | whisper.cpp (sidecar). Whisper supports Bengali but small models are weak; offer base/small/medium (quantized), show CPU speed warning on i5-6500 | ⚠ benchmark Bangla WER on sample audio |
| STT cloud | Whisper-compatible endpoints (e.g. Groq) | ⚠ verify limits |
| TTS cloud | Google Cloud TTS, Gemini TTS | ⚠ pricing/free quota, whether a Bangladeshi (bn-BD) voice exists vs. only bn-IN |
| TTS Edge | Unofficial Microsoft endpoint, has Bangla voices. Off by default, disclosed ToS risk | ⚠ decide whether to ship |
| TTS local | Piper | ⚠ verify a usable Bengali voice exists |
| Cloning | OpenVoice via optional local Python sidecar (GPU/RAM heavy, marked as such) | ⚠ verify Bangla support; may be English-only → UI must say so |

Consent for cloning: required checkbox plus typed confirmation stored in `voice_profiles.consent_*`; samples stay local; no engine call without a stored consent record.

## 7. Low-end PC budget
- Idle target: under ~150 MB RAM. Heavy work (whisper, cloning) runs only on user action, in a child process that is killed on cancel.
- FFmpeg/whisper process outputs are streamed, not buffered; long audio is chunked (30 s windows with overlap).
- Models downloaded only on explicit click, with size shown and sha256 verified.
- Temp files in an app-owned temp dir, swept on startup and exit.

## 8. Updater / release
Tauri updater with a signing keypair (private key only in GitHub Actions secrets), `latest.json` on GitHub Releases, NSIS installer. Configured in Phase 8.

## 9. Phase plan and exit criteria
2 Foundation → 3 API layer → 4 Content → 5 Thumbnail → 6 Voice → 7 Audio/Subtitles → 8 Finalize. Each phase ends with: build passes, tests run, unresolved issues listed. Nothing is marked "done" until it ran against a real provider or real file.
