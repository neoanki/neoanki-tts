# NeoAnki TTS

An independently installable Neo Anki extension for natural, hands-free review audio. It is maintained in its own repository and uses only the same public SDK available to every third-party publisher.

## What it includes

- automatic prompt and revealed-answer playback;
- separate language and voice selection for each side;
- automatic script detection and resilient voice fallback;
- a unified picker for voices exposed by the operating system;
- Balanced, Language learning, and Fast review presets;
- speed, pitch, volume, context, and text-cleanup controls;
- manual replay/stop control during reviews;
- local settings with no account, telemetry, or API key.

This takes the most durable ideas from AwesomeTTS and HyperTTS—the low-friction review workflow, voice presets, language-aware selection, preview, and configurable text processing—without copying their code or coupling the extension to Neo Anki internals.

## Install

Download the `.neoanki-extension` file from the latest release. In Neo Anki, open **Settings → Extensions → Install from file**, review the two requested UI capabilities, and install it.

The extension uses voices already available through Chromium and your operating system. Install additional system voices in macOS, Windows, or Linux if a language is missing.

## Build locally

Until `@neo-anki/extension-sdk` is published to npm, clone this repository beside the main Neo Anki repository:

```text
projects/
├── neo-anki/
└── neoanki-tts/
```

Then run:

```bash
npm install
npm test
npm run typecheck
npm run check
npm run build
```

The installable artifact is written to `build/org.neoanki.tts-<version>.neoanki-extension`.

## Deliberate boundary

Version 0.1 uses system speech synthesis. Cloud TTS, secret API-key storage, and generated audio attached to knowledge items are not implemented through hidden APIs or relaxed Content Security Policy rules. They require general SDK capabilities that every extension can request and users can review. When those capabilities exist, provider adapters and batch generation can be added here without changing the add-on’s architecture.

## Privacy and permissions

The extension requests only:

- `ui:settings-panels`
- `review:tools`

Text is sent to the selected system voice. Some operating-system voices may themselves be network-backed; that behavior is controlled by the OS, not this extension. The extension makes no network requests and stores preferences only in Neo Anki’s local extension storage namespace.

## License

MIT
