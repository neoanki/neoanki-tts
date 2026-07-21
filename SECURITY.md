# Security policy

Report vulnerabilities privately through GitHub Security Advisories for this repository. Never include a real API key, generated private audio, or personal study content in a report.

Text to Speech uses Neo Anki for two permission-protected operations:

- API keys are encrypted by the operating system credential service.
- HTTPS requests are limited to the domains declared in `manifest.json`.

Keys are never intentionally written to local storage, workspace data, diagnostics, generated filenames, or logs. Study text is sent only to the provider configured for its matching track. Generated audio becomes ordinary workspace media and is included in workspace backups and enabled sync transports.

The extension package is open source and fingerprinted by Neo Anki at installation. A fingerprint identifies exact bytes; it is not publisher authentication.
