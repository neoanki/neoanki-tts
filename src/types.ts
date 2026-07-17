export type ProviderId = 'system' | 'openai' | 'elevenlabs' | 'google' | 'azure'
export type TrackSide = 'prompt' | 'answer'
export type SourceField = 'prompt' | 'answer' | 'context' | 'template'
export type GenerationMode = 'generated' | 'realtime'

export interface ReplacementRule {
  id: string
  find: string
  replace: string
  regex: boolean
  caseSensitive: boolean
}

export interface ProcessingSettings {
  stripHtml: boolean
  unwrapCloze: boolean
  removeSoundTags: boolean
  removeBrackets: boolean
  replacements: ReplacementRule[]
}

export interface TtsTrack {
  id: string
  name: string
  side: TrackSide
  source: SourceField
  template: string
  provider: ProviderId
  mode: GenerationMode
  voice: string
  language: string
  model: string
  speed: number
  autoplay: boolean
  instructions: string
  voiceMode: 'single' | 'priority' | 'random'
  fallbacks: Array<{ id: string; provider: ProviderId; voice: string; model: string }>
}

export interface MatchRules {
  collections: string[]
  tags: string[]
}

export interface TtsProfile {
  id: string
  name: string
  enabled: boolean
  match: MatchRules
  processing: ProcessingSettings
  tracks: TtsTrack[]
}

export interface ProviderConfig {
  openaiModel: string
  elevenLabsModel: string
  googleVoice: string
  googleLanguage: string
  azureRegion: string
  azureVoice: string
}

export interface TtsConfig {
  enabled: boolean
  profiles: TtsProfile[]
  providers: ProviderConfig
  batchConcurrency: number
  batchRetries: number
  skipCurrentAudio: boolean
}

export interface GeneratedTrackMetadata {
  profileId: string
  trackId: string
  assetId: string
  cacheKey: string
  generatedAt: string
  side: TrackSide
  provider: ProviderId
}

export interface ItemTtsMetadata {
  version: 1
  tracks: Record<string, GeneratedTrackMetadata>
}

export interface VoiceOption {
  id: string
  name: string
  language: string
  provider: ProviderId
  detail?: string
}

export interface SynthesisResult {
  audioBase64: string
  mimeType: string
  extension: string
}
