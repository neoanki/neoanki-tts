import type { SpeechSide, TtsConfig } from './config.js'

export const detectLanguage = (text: string) => {
  if (/[぀-ヿ]/u.test(text)) return 'ja-JP'
  if (/[가-힯]/u.test(text)) return 'ko-KR'
  if (/[一-鿿]/u.test(text)) return 'zh-CN'
  if (/[Ѐ-ӿ]/u.test(text)) return /[єіїґЄІЇҐ]/u.test(text) ? 'uk-UA' : 'ru-RU'
  if (/[؀-ۿ]/u.test(text)) return 'ar-SA'
  if (/[֐-׿]/u.test(text)) return 'he-IL'
  if (/[ऀ-ॿ]/u.test(text)) return 'hi-IN'
  if (/[Ͱ-Ͽ]/u.test(text)) return 'el-GR'
  return 'en-US'
}

const unwrapCloze = (text: string) => {
  let next = text
  for (let pass = 0; pass < 6; pass += 1) {
    const previous = next
    next = next.replace(/\{\{c\d+::([^{}]*?)(?:::[^{}]*?)?\}\}/gi, '$1')
    if (next === previous) break
  }
  return next
}

export const prepareSpeechText = (text: string, omitBracketedText = false) => {
  const parser = new DOMParser()
  const document = parser.parseFromString(unwrapCloze(text), 'text/html')
  let output = document.body.textContent || ''
  if (omitBracketedText) output = output.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
  return output.replace(/[_*`#]+/g, ' ').replace(/\s+/g, ' ').trim()
}

const languageMatches = (voice: SpeechSynthesisVoice, language: string) => {
  const desired = language.toLowerCase()
  const actual = voice.lang.toLowerCase()
  return actual === desired || actual.split('-')[0] === desired.split('-')[0]
}

export const resolveVoice = (
  voices: SpeechSynthesisVoice[],
  preferredURI: string,
  configuredLanguage: string,
  text: string,
) => {
  if (preferredURI) {
    const preferred = voices.find((voice) => voice.voiceURI === preferredURI)
    if (preferred) return preferred
  }
  const language = configuredLanguage === 'auto' ? detectLanguage(text) : configuredLanguage
  const matches = voices.filter((voice) => languageMatches(voice, language))
  return matches.find((voice) => voice.localService) || matches[0] || voices.find((voice) => voice.default) || voices[0]
}

export interface SpeakOptions {
  side: SpeechSide
  text: string
  context?: string
  config: TtsConfig
  onStart?: () => void
  onEnd?: () => void
  onError?: (message: string) => void
}

export const speak = ({ side, text, context, config, onStart, onEnd, onError }: SpeakOptions) => {
  if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
    onError?.('System speech is unavailable in this build.')
    return false
  }
  const prepared = prepareSpeechText(
    side === 'answer' && config.includeContext && context ? `${text}. ${context}` : text,
    config.omitBracketedText,
  )
  if (!prepared) {
    onError?.('There is no readable text on this side of the card.')
    return false
  }

  const language = side === 'prompt' ? config.promptLanguage : config.answerLanguage
  const voiceURI = side === 'prompt' ? config.promptVoiceURI : config.answerVoiceURI
  const utterance = new SpeechSynthesisUtterance(prepared)
  const voice = resolveVoice(window.speechSynthesis.getVoices(), voiceURI, language, prepared)
  if (voice) utterance.voice = voice
  utterance.lang = language === 'auto' ? (voice?.lang || detectLanguage(prepared)) : language
  utterance.rate = config.rate
  utterance.pitch = config.pitch
  utterance.volume = config.volume
  utterance.onstart = () => onStart?.()
  utterance.onend = () => onEnd?.()
  utterance.onerror = (event) => {
    if (event.error !== 'canceled' && event.error !== 'interrupted') onError?.(`Speech stopped: ${event.error}.`)
    onEnd?.()
  }
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(utterance)
  return true
}

export const stopSpeaking = () => {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel()
}
