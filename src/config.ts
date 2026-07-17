export const CONFIG_STORAGE_KEY = 'neoanki-extension:org.neoanki.tts:config:v1'
export const CONFIG_CHANGED_EVENT = 'neoanki-tts:config-changed'

export type SpeechSide = 'prompt' | 'answer'

export interface TtsConfig {
  enabled: boolean
  autoPrompt: boolean
  autoAnswer: boolean
  includeContext: boolean
  promptLanguage: string
  answerLanguage: string
  promptVoiceURI: string
  answerVoiceURI: string
  rate: number
  pitch: number
  volume: number
  omitBracketedText: boolean
}

export const DEFAULT_CONFIG: TtsConfig = {
  enabled: true,
  autoPrompt: true,
  autoAnswer: true,
  includeContext: false,
  promptLanguage: 'auto',
  answerLanguage: 'auto',
  promptVoiceURI: '',
  answerVoiceURI: '',
  rate: 1,
  pitch: 1,
  volume: 1,
  omitBracketedText: false,
}

const finiteWithin = (value: unknown, fallback: number, minimum: number, maximum: number) => {
  const number = typeof value === 'number' ? value : Number.NaN
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback
}

export const normalizeConfig = (value: unknown): TtsConfig => {
  const candidate = value && typeof value === 'object' ? value as Partial<TtsConfig> : {}
  return {
    enabled: typeof candidate.enabled === 'boolean' ? candidate.enabled : DEFAULT_CONFIG.enabled,
    autoPrompt: typeof candidate.autoPrompt === 'boolean' ? candidate.autoPrompt : DEFAULT_CONFIG.autoPrompt,
    autoAnswer: typeof candidate.autoAnswer === 'boolean' ? candidate.autoAnswer : DEFAULT_CONFIG.autoAnswer,
    includeContext: typeof candidate.includeContext === 'boolean' ? candidate.includeContext : DEFAULT_CONFIG.includeContext,
    promptLanguage: typeof candidate.promptLanguage === 'string' ? candidate.promptLanguage : DEFAULT_CONFIG.promptLanguage,
    answerLanguage: typeof candidate.answerLanguage === 'string' ? candidate.answerLanguage : DEFAULT_CONFIG.answerLanguage,
    promptVoiceURI: typeof candidate.promptVoiceURI === 'string' ? candidate.promptVoiceURI : DEFAULT_CONFIG.promptVoiceURI,
    answerVoiceURI: typeof candidate.answerVoiceURI === 'string' ? candidate.answerVoiceURI : DEFAULT_CONFIG.answerVoiceURI,
    rate: finiteWithin(candidate.rate, DEFAULT_CONFIG.rate, 0.5, 2),
    pitch: finiteWithin(candidate.pitch, DEFAULT_CONFIG.pitch, 0.5, 1.5),
    volume: finiteWithin(candidate.volume, DEFAULT_CONFIG.volume, 0, 1),
    omitBracketedText: typeof candidate.omitBracketedText === 'boolean' ? candidate.omitBracketedText : DEFAULT_CONFIG.omitBracketedText,
  }
}

export const loadConfig = (): TtsConfig => {
  try { return normalizeConfig(JSON.parse(localStorage.getItem(CONFIG_STORAGE_KEY) || 'null')) }
  catch { return { ...DEFAULT_CONFIG } }
}

export const saveConfig = (config: TtsConfig) => {
  const normalized = normalizeConfig(config)
  localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(normalized))
  window.dispatchEvent(new CustomEvent<TtsConfig>(CONFIG_CHANGED_EVENT, { detail: normalized }))
}

export const PRESETS = {
  balanced: { label: 'Balanced', patch: { rate: 1, autoPrompt: true, autoAnswer: true, includeContext: false } },
  language: { label: 'Language learning', patch: { rate: 0.9, autoPrompt: true, autoAnswer: true, includeContext: true } },
  fast: { label: 'Fast review', patch: { rate: 1.25, autoPrompt: false, autoAnswer: true, includeContext: false } },
} as const
