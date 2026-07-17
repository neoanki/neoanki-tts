# NeoAnki TTS

A full text-to-speech studio for Neo Anki. It combines provider-quality cloud voices, free system voices, reusable profiles, batch generation, and offline review playback in an independently installable extension.

NeoAnki TTS uses only the public extension SDK. Its network, credential, UI, review, and content capabilities are available to any extension publisher through the same permission model.

## Features

- OpenAI, ElevenLabs, Google Cloud Text-to-Speech, Azure Speech, and operating-system voices.
- Encrypted API-key storage through the operating system credential service.
- Provider voice discovery, manual voice IDs, model overrides, language selection, speed, and OpenAI style instructions.
- Profiles selected automatically by collection and required tags.
- Any number of prompt/answer tracks in one profile. A single job can generate Spanish prompt audio and English answer audio together.
- Single, priority-fallback, and random voice strategies, including cross-provider fallbacks.
- Real-time tracks, generated-and-synced tracks, or both in one profile.
- Custom source templates using `{{prompt}}`, `{{answer}}`, `{{context}}`, `{{collection}}`, and `{{tags}}`.
- Configuration export/import for moving profiles and text rules between devices without exporting API keys.
- HTML cleanup, cloze unwrapping, existing sound-tag removal, optional bracket removal, and ordered literal or regular-expression pronunciation rules.
- Preview before generation.
- Concurrent batch generation with retries, stoppable progress, per-item errors, and incremental transaction commits.
- Deterministic stale detection: changed text, voice, model, language, speed, instructions, provider defaults, or fallback configuration is regenerated; unchanged work is skipped.
- Content-addressed media deduplication and per-track replacement.
- Generated audio is stored as normal Neo Anki media, so it works offline and follows workspace backup/sync semantics.
- Automatic and manual playback during review. Missing generated audio can fall back to real-time synthesis.

## Provider matrix

| Provider | Real-time | Generated/offline | Voice discovery | Credentials |
| --- | --- | --- | --- | --- |
| System voices | Yes | No | OS/Chromium | None |
| OpenAI | Yes | Yes | Built-in voice catalog | API key |
| ElevenLabs | Yes | Yes | Account voice library | API key |
| Google Cloud | Yes | Yes | API voice catalog | API key |
| Azure Speech | Yes | Yes | Regional voice catalog | API key + region |

Provider use can incur charges from that provider. NeoAnki TTS does not proxy, resell, or mark up speech requests.

## Install

1. Download `org.neoanki.tts-1.0.0.neoanki-extension` from the latest release.
2. In Neo Anki, open **Settings → Extensions → Install from file**.
3. Review the declared settings, review, content-transaction, network, and secret-storage capabilities and the exact allowed HTTPS domains.
4. Install and reload Neo Anki.
5. Open **Settings → NeoAnki TTS**.

Start for free with the default two-track system-voice profile. For portable, consistent audio, add a cloud provider key, choose voices under **Profiles & tracks**, preview them, switch tracks to **Generated & synced**, and run **Generate missing & stale**.

## How generated audio works

For every matching item and generated track, the extension renders its source, applies the profile’s text rules, and hashes the effective text plus every synthesis setting. If that cache key is current, the request is skipped. Otherwise the selected provider returns audio, which is content-hashed, stored as a normal media asset, and attached under namespaced track metadata.

This produces three useful guarantees:

- repeated audio bytes are stored once;
- changing one track replaces only that track’s prior attachment;
- a batch can stop and safely resume without repeating completed current work.

## Build locally

Until `@neo-anki/extension-sdk` is published to npm, clone this repository beside the main Neo Anki repository:

```text
projects/
├── neo-anki/
└── neoanki-tts/
```

Then run:

```bash
cd ../neo-anki && npm install && npm run extension:sdk
cd ../neoanki-tts && npm install
npm test
npm run typecheck
npm run check
npm run build
```

The installable artifact is written to `build/org.neoanki.tts-1.0.0.neoanki-extension`.

## Privacy and security

The extension declares these exact network hosts:

- `api.openai.com`
- `api.elevenlabs.io`
- `texttospeech.googleapis.com`
- `*.tts.speech.microsoft.com`

The desktop host rejects plain HTTP, undeclared hosts, unsafe headers, oversized requests/responses, and redirects outside the allowlist. API keys are encrypted at rest by Electron’s operating-system-backed `safeStorage`; they are not stored in workspace data, local storage, generated media, diagnostics, or extension packages. On Linux, Secret Service or KWallet is required—the insecure `basic_text` fallback is rejected and no key is written.

Text is sent only to the provider selected by the matching track. Generated audio becomes workspace media and therefore appears in backups and any sync transport the user enables. System voices can be OS-managed online voices; their implementation is controlled by the operating system.

## License

MIT
