import { defineExtension } from '@neo-anki/extension-sdk'
import { TtsReviewTool } from './ReviewTool.js'
import { TtsSettingsPanel } from './SettingsPanel.js'

export default defineExtension({
  manifest: {
    id: 'org.neoanki.tts',
    name: 'NeoAnki TTS',
    version: '0.1.0',
    sdkVersion: 1,
    publisher: 'NeoAnki contributors',
    description: 'Language-aware system text-to-speech with automatic prompt and answer playback.',
    homepage: 'https://github.com/neoanki/neoanki-tts',
    permissions: ['ui:settings-panels', 'review:tools'],
  },
  settingsPanels: [{ id: 'neoanki-tts.settings', component: TtsSettingsPanel }],
  reviewTools: [{ id: 'neoanki-tts.review', component: TtsReviewTool }],
})
