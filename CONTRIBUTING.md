# Contributing

Keep the extension independent from Neo Anki internals: import only `@neo-anki/extension-sdk`, React, and ordinary browser APIs. New privileges must first become documented SDK capabilities usable by any publisher.

Before opening a pull request, run:

```bash
npm test
npm run typecheck
npm run check
npm run build
```

Changes to speech behavior should include tests for text preparation, language fallback, or settings migration as appropriate. Never commit API keys, generated voice data, or private user content.
