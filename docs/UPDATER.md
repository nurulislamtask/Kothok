# Updates

Kothok updates from this repository's GitHub Releases.

1. CI builds every push to `main` with the environment variable `KOTHOK_BUILD` = the run number, publishes `build-N` with `Kothok_*_x64-setup.exe` and `Kothok_*_x64-setup.exe.sha256`.
2. The app knows its own build number. **Settings → Updates** (and one quiet check at startup, if enabled) asks the GitHub API for releases, and offers the highest `build-N` that is newer, has an installer **and** a checksum file.
3. "Download and install" downloads the installer over HTTPS (only from `github.com/nurulislamtask/Kothok/releases/download/...`), compares its SHA-256 with the `.sha256` file, deletes it on mismatch, and otherwise starts it and closes the app.

Builds made locally have no build number and never offer updates.

## Not the same as a signed Tauri updater
This scheme protects against corrupted downloads and wrong URLs, but the checksum lives next to the installer, so it does not protect against someone who can publish to the repository. For publisher-signed updates, add `tauri-plugin-updater`, generate a key with `pnpm tauri signer generate`, store the private key as the Actions secret `TAURI_SIGNING_PRIVATE_KEY`, put the public key in `tauri.conf.json`, and set `bundle.createUpdaterArtifacts`. That requires secrets only the repository owner can add, so it is not enabled.
