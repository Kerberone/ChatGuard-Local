# ChatGuard Local — English overview

An experimental **free, MIT-licensed** local backup tool for ChatGPT conversations open in **Brave or Chrome on Windows**. The browser extension reads the available conversation history and recoverable attachments, assembles a ZIP, and sends it over **Native Messaging** to a local Windows helper. It does **not** use the browser's download manager or require changing global download prompts.

## Install

1. Download a compiled ZIP from Releases if available, or build the host from source (Go 1.23+; `scripts/build-windows.ps1`).
2. Extract to a permanent folder. Open `brave://extensions` or `chrome://extensions`, enable Developer mode, select **Load unpacked**, and select the `extension` directory.
3. Copy the extension's 32-character ID. Run `INSTALLA.cmd` as a regular user, paste the ID, and choose your backup directory.
4. Reload the extension, use **Settings → Check connection**, then back up one open chat and inspect its `stato_backup.json` inside the resulting ZIP.

## Scope and limitations

- Backs up **open conversations only**, automatically every 3–60 minutes while the browser runs. This is **not** an account-wide backup.
- May capture available branches, chronological metadata, JSON/CSV/Markdown, and recoverable attachments; marks incomplete snapshots **PARTIAL** rather than silently claiming success.
- Relies on undocumented web endpoints that may change without notice. Old missing messages, expired links and some files cannot be recovered. Max asset 128 MB, ZIP approximately 400 MB.
- ZIPs contain potentially sensitive information, are not encrypted, and must not be published to GitHub.
- Windows 10/11 is the supported platform for the helper. The binary is not code-signed; inspect source before running it. No paid APIs or telemetry are involved.

See the full [Italian README](README.md), [security policy](SECURITY.md), [license](LICENSE), and [contribution guide](CONTRIBUTING.md). This project is **not affiliated with OpenAI or Brave**.
