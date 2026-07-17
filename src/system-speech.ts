import { detectLanguage } from './text.js'
import type { TtsTrack } from './types.js'

export const stopSystemSpeech = () => { if ('speechSynthesis' in window) window.speechSynthesis.cancel() }

export const speakWithSystem = (track: TtsTrack, text: string, onEnd?: () => void, onError?: (message: string) => void) => {
  if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') { onError?.('System speech is unavailable.'); return false }
  const utterance = new SpeechSynthesisUtterance(text)
  const voices = window.speechSynthesis.getVoices()
  const language = track.language === 'auto' ? detectLanguage(text) : track.language
  utterance.voice = voices.find((voice) => voice.voiceURI === track.voice) || voices.find((voice) => voice.lang.toLowerCase() === language.toLowerCase()) || voices.find((voice) => voice.lang.toLowerCase().split('-')[0] === language.toLowerCase().split('-')[0]) || null
  utterance.lang = utterance.voice?.lang || language
  utterance.rate = track.speed
  utterance.onend = () => onEnd?.()
  utterance.onerror = (event) => { if (!['canceled', 'interrupted'].includes(event.error)) onError?.(`System speech stopped: ${event.error}.`); onEnd?.() }
  stopSystemSpeech()
  window.speechSynthesis.speak(utterance)
  return true
}
