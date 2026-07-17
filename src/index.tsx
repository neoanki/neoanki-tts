import { defineExtension, type AppData } from '@neo-anki/extension-sdk'
import { EXTENSION_ID } from './config.js'
import { attachGeneratedAudio, type AttachAudioPayload } from './media.js'
import { TtsReviewTool } from './ReviewTool.js'
import { TtsSettingsPanel } from './SettingsPanel.js'

const isAttachPayload = (value: unknown): value is AttachAudioPayload => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<AttachAudioPayload>
  return typeof candidate.itemId === 'string' && Boolean(candidate.asset && typeof candidate.asset.id === 'string' && candidate.asset.mimeType?.startsWith('audio/'))
    && Boolean(candidate.metadata && candidate.metadata.assetId === candidate.asset?.id && candidate.metadata.profileId && candidate.metadata.trackId)
}

export default defineExtension({
  manifest: {
    id: EXTENSION_ID,
    name: 'NeoAnki TTS',
    version: '1.0.0',
    sdkVersion: 1,
    publisher: 'NeoAnki contributors',
    description: 'Provider-grade text-to-speech with profiles, batch generation, cached media, and real-time review playback.',
    homepage: 'https://github.com/neoanki/neoanki-tts',
    permissions: ['ui:settings-panels', 'review:tools', 'content:transactions', 'network:fetch', 'storage:secrets'],
    networkDomains: ['api.openai.com', 'api.elevenlabs.io', 'texttospeech.googleapis.com', '*.tts.speech.microsoft.com'],
  },
  commands: [{
    id: 'neoanki-tts.attach-audio',
    run({ data, replaceData }, payload) {
      const payloads = (payload as { payloads?: unknown[] } | null)?.payloads
      if (!Array.isArray(payloads) || !payloads.length || payloads.length > 20 || !payloads.every(isAttachPayload)) throw new Error('TTS generated an invalid audio attachment transaction.')
      const knownItems = new Set(data.items.map((item) => item.id))
      if (payloads.some((entry) => !knownItems.has(entry.itemId) || entry.asset.byteLength > 25 * 1024 * 1024 || !entry.asset.dataUrl.startsWith(`data:${entry.asset.mimeType};base64,`))) throw new Error('TTS audio attachment failed validation.')
      const next = attachGeneratedAudio({ items: [...data.items], assets: [...data.assets] }, payloads)
      replaceData({ ...data, items: next.items, assets: next.assets, updatedAt: new Date().toISOString() } as AppData)
    },
  }],
  settingsPanels: [{ id: 'neoanki-tts.settings', component: TtsSettingsPanel }],
  reviewTools: [{ id: 'neoanki-tts.review', component: TtsReviewTool }],
})
