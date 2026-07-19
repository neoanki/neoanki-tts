# NeoAnki TTS

A full text-to-speech studio for Neo Anki. It combines provider-quality cloud voices, free system voices, reusable profiles, batch generation, and offline review playback in an independently installable extension.

NeoAnki TTS uses only the public SDK v2 contract. Provider logic runs in an isolated worker; Settings and Review run in sandboxed iframes. The host mediates scoped content reads, namespaced metadata patches, media creation, network calls, synchronized non-secret configuration, and device-local credentials.

## Features

- OpenAI, ElevenLabs, Google Cloud Text-to-Speech, Azure Speech, and operating-system voices.
- Encrypted API-key storage through the operating system credential service.
- Provider voice discovery, manual voice IDs, model overrides, language selection, speed, and OpenAI style instructions.
- Profiles selected automatically by collection and required tags.
- Any number of prompt/answer tracks in one profile. A single job can generate Spanish prompt audio and English answer audio together.
- Single, priority-fallback, and random voice strategies, including cross-provider fallbacks.
- Real-time tracks, generated-and-cached tracks, or both in one profile.
- Custom source templates using `{{prompt}}`, `{{answer}}`, `{{context}}`, `{{collection}}`, and `{{tags}}`.
- HTML cleanup, cloze unwrapping, existing sound-tag removal, optional bracket removal, and ordered literal or regular-expression pronunciation rules.
- Bounded batch generation with retries, active-request cancellation, per-track errors, and incremental atomic commits.
- Deterministic stale detection: changed text, voice, model, language, speed, instructions, provider defaults, or fallback configuration is regenerated; unchanged work is skipped.
- Content-addressed media deduplication and per-track replacement.
- Generated audio is stored as verified Neo Anki media, so it works offline and is included in workspace backups. It participates in synchronization when the host’s encrypted sync service is enabled.
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

1. Download `org.neoanki.tts-2.0.1.neoanki-extension` from the latest release.
2. In Neo Anki, open **Settings → Extensions → Install from file**.
3. Review the signed publisher identity, isolated settings/review surfaces, scoped content read and metadata-write capabilities, network access, device-local secret storage, synchronized configuration, and exact allowed HTTPS domains.
4. Install and reload Neo Anki.
5. Open **Settings → NeoAnki TTS**.

Start for free with the default two-track system-voice profile. For portable, consistent audio, add a cloud provider key, choose a provider and voice under **Profiles and tracks**, switch tracks to **Generated and cached**, and run **Generate missing and stale audio**.

## How generated audio works

For every matching item and generated track, the extension renders its source, applies the profile’s text rules, and hashes the effective text plus every synthesis setting. If that cache key is current, the request is skipped. Otherwise the selected provider returns audio, which is content-hashed, stored as a normal media asset, and attached under namespaced track metadata.

This produces three useful guarantees:

- repeated audio bytes are stored once;
- changing one track replaces only that track’s prior attachment;
- a batch can stop and safely resume without repeating completed current work.

## Build locally

Until `@neo-anki/extension-sdk` 2.x is published to npm, clone this repository beside the main Neo Anki repository:

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

The installable, Ed25519-signed artifact is written to `build/org.neoanki.tts-2.0.1.neoanki-extension`. The checked-in private key is deliberately a development-only fixture. Production publishers must supply `NEO_ANKI_EXTENSION_SIGNING_KEY` from protected release secrets and publish the matching public key in the manifest.

Tagged releases also verify the exact core/SDK commit declared by `neoAnki.coreRef` and stamp both the TTS source commit and core commit into the signed package provenance. A release fails if either packaged value differs from the checked-out immutable input.

## Privacy and security

The extension declares these exact network hosts:

- `api.openai.com`
- `api.elevenlabs.io`
- `texttospeech.googleapis.com`
- `*.tts.speech.microsoft.com`

The desktop host rejects plain HTTP, undeclared hosts, unsafe headers, oversized requests/responses, and redirects outside the allowlist. API keys are encrypted at rest by Electron’s operating-system-backed `safeStorage`; they are not stored in workspace data, local storage, generated media, diagnostics, or extension packages. On Linux, Secret Service or KWallet is required—the insecure `basic_text` fallback is rejected and no key is written.

Text is sent only to the provider and model selected by the matching track, using the user’s own billable provider account. The UI explicitly labels cloud output as AI-generated speech. Credentials are encrypted and device-local; non-secret profiles are stored in the workspace configuration namespace. Generated audio becomes verified workspace media and appears in backups and enabled encrypted sync. System voices can be OS-managed online voices; their implementation is controlled by the operating system.

## License

MIT
