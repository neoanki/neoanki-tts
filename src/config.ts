import type { ProcessingSettings, ProviderConfig, TtsConfig, TtsProfile, TtsTrack } from './types.js'

export const EXTENSION_ID = 'org.neoanki.tts'
export const CONFIG_STORAGE_KEY = 'neoanki-extension:org.neoanki.tts:config:v2'
export const CONFIG_CHANGED_EVENT = 'neoanki-tts:config-changed'

export const DEFAULT_PROCESSING: ProcessingSettings = {
  stripHtml: true,
  unwrapCloze: true,
  removeSoundTags: true,
  removeBrackets: false,
  replacements: [],
}

const track = (value: Partial<TtsTrack> & Pick<TtsTrack, 'id' | 'name' | 'side' | 'source'>): TtsTrack => ({
  template: '', provider: 'system', mode: 'realtime', voice: '', language: 'auto', model: '', speed: 1,
  autoplay: true, instructions: '', ...value,
  voiceMode: value.voiceMode || 'single', fallbacks: value.fallbacks || [],
})

export const DEFAULT_PROFILE: TtsProfile = {
  id: 'language-learning',
  name: 'Language learning',
  enabled: true,
  match: { collections: [], tags: [] },
  processing: { ...DEFAULT_PROCESSING },
  tracks: [
    track({ id: 'prompt', name: 'Prompt', side: 'prompt', source: 'prompt' }),
    track({ id: 'answer', name: 'Answer', side: 'answer', source: 'answer' }),
  ],
}

export const DEFAULT_PROVIDERS: ProviderConfig = {
  openaiModel: 'gpt-4o-mini-tts',
  elevenLabsModel: 'eleven_multilingual_v2',
  googleVoice: '',
  googleLanguage: 'en-US',
  azureRegion: 'eastus',
  azureVoice: 'en-US-AvaMultilingualNeural',
}

export const DEFAULT_CONFIG: TtsConfig = {
  enabled: true,
  profiles: [DEFAULT_PROFILE],
  providers: DEFAULT_PROVIDERS,
  batchConcurrency: 2,
  batchRetries: 2,
  skipCurrentAudio: true,
}

const string = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback
const boolean = (value: unknown, fallback: boolean) => typeof value === 'boolean' ? value : fallback
const number = (value: unknown, fallback: number, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback

const normalizeProcessing = (value: unknown): ProcessingSettings => {
  const input = value && typeof value === 'object' ? value as Partial<ProcessingSettings> : {}
  return {
    stripHtml: boolean(input.stripHtml, true),
    unwrapCloze: boolean(input.unwrapCloze, true),
    removeSoundTags: boolean(input.removeSoundTags, true),
    removeBrackets: boolean(input.removeBrackets, false),
    replacements: Array.isArray(input.replacements) ? input.replacements.slice(0, 100).flatMap((rule, index) => rule && typeof rule === 'object' ? [{
      id: string(rule.id, `rule-${index}`), find: string(rule.find), replace: string(rule.replace), regex: boolean(rule.regex, false), caseSensitive: boolean(rule.caseSensitive, false),
    }] : []) : [],
  }
}

const normalizeTrack = (value: unknown, index: number): TtsTrack => {
  const input = value && typeof value === 'object' ? value as Partial<TtsTrack> : {}
  const side = input.side === 'answer' ? 'answer' : 'prompt'
  const source = ['prompt', 'answer', 'context', 'template'].includes(String(input.source)) ? input.source as TtsTrack['source'] : side
  const provider = ['system', 'openai', 'elevenlabs', 'google', 'azure'].includes(String(input.provider)) ? input.provider as TtsTrack['provider'] : 'system'
  return {
    id: string(input.id, `track-${index}`), name: string(input.name, side === 'prompt' ? 'Prompt' : 'Answer'), side, source,
    template: string(input.template), provider, mode: input.mode === 'generated' ? 'generated' : 'realtime', voice: string(input.voice),
    language: string(input.language, 'auto'), model: string(input.model), speed: number(input.speed, 1, 0.5, 2), autoplay: boolean(input.autoplay, true),
    instructions: string(input.instructions),
    voiceMode: input.voiceMode === 'priority' || input.voiceMode === 'random' ? input.voiceMode : 'single',
    fallbacks: Array.isArray(input.fallbacks) ? input.fallbacks.slice(0, 10).flatMap((fallback, fallbackIndex) => fallback && typeof fallback === 'object' ? [{
      id: string(fallback.id, `fallback-${fallbackIndex}`), provider: ['openai', 'elevenlabs', 'google', 'azure'].includes(String(fallback.provider)) ? fallback.provider as TtsTrack['provider'] : provider === 'system' ? 'openai' : provider,
      voice: string(fallback.voice), model: string(fallback.model),
    }] : []) : [],
  }
}

const normalizeProfile = (value: unknown, index: number): TtsProfile => {
  const input = value && typeof value === 'object' ? value as Partial<TtsProfile> : {}
  return {
    id: string(input.id, `profile-${index}`), name: string(input.name, `Profile ${index + 1}`), enabled: boolean(input.enabled, true),
    match: {
      collections: Array.isArray(input.match?.collections) ? input.match.collections.filter((item): item is string => typeof item === 'string') : [],
      tags: Array.isArray(input.match?.tags) ? input.match.tags.filter((item): item is string => typeof item === 'string') : [],
    },
    processing: normalizeProcessing(input.processing),
    tracks: Array.isArray(input.tracks) && input.tracks.length ? input.tracks.slice(0, 12).map(normalizeTrack) : DEFAULT_PROFILE.tracks.map((item) => ({ ...item })),
  }
}

export const normalizeConfig = (value: unknown): TtsConfig => {
  const input = value && typeof value === 'object' ? value as Partial<TtsConfig> : {}
  const providers = input.providers && typeof input.providers === 'object' ? input.providers : {} as Partial<ProviderConfig>
  return {
    enabled: boolean(input.enabled, true),
    profiles: Array.isArray(input.profiles) && input.profiles.length ? input.profiles.slice(0, 50).map(normalizeProfile) : DEFAULT_CONFIG.profiles.map((profile) => structuredClone(profile)),
    providers: {
      openaiModel: string(providers.openaiModel, DEFAULT_PROVIDERS.openaiModel), elevenLabsModel: string(providers.elevenLabsModel, DEFAULT_PROVIDERS.elevenLabsModel),
      googleVoice: string(providers.googleVoice), googleLanguage: string(providers.googleLanguage, DEFAULT_PROVIDERS.googleLanguage),
      azureRegion: string(providers.azureRegion, DEFAULT_PROVIDERS.azureRegion), azureVoice: string(providers.azureVoice, DEFAULT_PROVIDERS.azureVoice),
    },
    batchConcurrency: number(input.batchConcurrency, 2, 1, 5), batchRetries: number(input.batchRetries, 2, 0, 5), skipCurrentAudio: boolean(input.skipCurrentAudio, true),
  }
}

export const loadConfig = () => {
  try { return normalizeConfig(JSON.parse(localStorage.getItem(CONFIG_STORAGE_KEY) || 'null')) }
  catch { return structuredClone(DEFAULT_CONFIG) }
}

export const saveConfig = (value: TtsConfig) => {
  const config = normalizeConfig(value)
  localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config))
  window.dispatchEvent(new CustomEvent(CONFIG_CHANGED_EVENT, { detail: config }))
  return config
}

export const profileMatches = (profile: TtsProfile, item: { collection: string; tags: string[] }) => profile.enabled
  && (!profile.match.collections.length || profile.match.collections.includes(item.collection))
  && (!profile.match.tags.length || profile.match.tags.every((tag) => item.tags.includes(tag)))
