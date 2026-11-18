# Security notes

- **API keys** live in the OS credential store (Windows Credential Manager, service `kothok`). They are never written to SQLite, logs or exports, and the UI can only say whether a key exists.
- **Endpoints** must be `https://`; plain `http://` is accepted only for `localhost`, `127.0.0.1` and `[::1]` (local model servers). URLs with embedded credentials are refused. Error text from the network layer has URLs stripped.
- **Files:** the UI never supplies filesystem paths. Opening/saving uses native dialogs in Rust (imports capped at 30 MB). Generated and imported media are stored in the app-data `media/` folder under random names; names containing `..`, absolute paths or `:` are rejected.
- **Content Security Policy:** `default-src 'self'`, images `self data: blob:`, media `self blob:`, connections only to the Tauri IPC. All network calls to providers go through Rust, not the web view.
- **Database:** SQLite with parameterised queries only; versioned migrations.
- **Updates:** see [UPDATER.md](UPDATER.md) — HTTPS, fixed repository prefix, SHA-256 check, no silent install.
- **Voice profiles** require a consent statement and confirmation; samples are stored locally only and deleted with the profile.
- **Known gaps:** the installer is not code-signed, so Windows SmartScreen may warn; update checksums are unsigned (see UPDATER.md); provider integrations were not exercised with live keys in CI.
