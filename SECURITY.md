# Security policy

ChatGuard Local creates **unencrypted local archives** of conversations. Treat both the ZIP files and the extension's access to your authenticated ChatGPT tab as sensitive.

## Threat model and measures

- The Windows helper uses Chromium **Native Messaging**, not a network server. The installed native host manifest restricts allowed origins to the one extension ID supplied by the user.
- Destination paths are restricted to a configured root and validated file/directory names; snapshot filenames are validated. The helper uses temporary files, ZIP integrity verification, SHA-256, and refuses intended overwrites.
- The helper does not intentionally read unrelated user files, run arbitrary shell commands from backup data, or send archives to remote endpoints. It starts PowerShell only in response to an explicit **Change directory** action to show a Windows folder picker.
- The extension makes authenticated requests only to ChatGPT and its permitted media domains, when needed to access content. It cannot guarantee compatibility with undocumented endpoints.

## Known limits

The extension ID check and native host manifest limit browser-initiated access, **not** execution by another program running with the same local user's permissions. A compromised machine/account is outside the threat model. Local backup paths must be trustworthy, and backups should be protected using your operating system's disk encryption and access controls. This is beta software and has not undergone a third-party security audit.

## Reporting a vulnerability

Do not post credentials, raw conversations, or exploit samples containing personal data in public issues. Open a GitHub issue without sensitive details and ask for a private disclosure channel. Avoid publishing sensitive proof-of-concept data.
