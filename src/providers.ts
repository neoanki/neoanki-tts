import type { ProviderConfig, ProviderId, SynthesisResult, TtsProviderHost, TtsTrack, VoiceOption } from './types.js'
import { detectLanguage } from './text.js'

const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse']
const providerIdentifier = /^[A-Za-z0-9._:-]{1,200}$/
const languageIdentifier = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/
const requireIdentifier = (value: string, label: string, pattern = providerIdentifier) => {
  if (!pattern.test(value)) throw new Error(`${label} is invalid.`)
  return value
}
const requireTextInput = (value: string) => {
  if (!value.trim()) throw new Error('Speech text is empty.')
  if (value.length > 20_000) throw new Error('Speech text exceeds the 20,000-character provider safety limit.')
}
const requireAudio = (value: string | undefined, provider: string) => {
  if (!value || value.length > 30 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error(`${provider} returned malformed or oversized audio.`)
  const head = Uint8Array.from(atob(value.slice(0, Math.min(value.length, 16))), (character) => character.charCodeAt(0))
  const mp3 = (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) || (head[0] === 0xff && (head[1]! & 0xe0) === 0xe0)
  if (!mp3) throw new Error(`${provider} returned data that is not valid MP3 audio.`)
  return value
}

const decodeText = (base64: string) => new TextDecoder().decode(Uint8Array.from(atob(base64), (character) => character.charCodeAt(0)))
const encodeBase64 = (bytes: Uint8Array) => {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  return btoa(binary)
}
const jsonBase64 = (value: unknown) => encodeBase64(new TextEncoder().encode(JSON.stringify(value)))
const readJson = <T>(bodyBase64: string) => JSON.parse(decodeText(bodyBase64)) as T
const assertResponse = (response: { status: number; statusText: string; bodyBase64: string }) => {
  if (response.status >= 200 && response.status < 300) return
  let detail = decodeText(response.bodyBase64).slice(0, 600)
  try { const parsed = JSON.parse(detail) as { error?: { message?: string } | string; detail?: string }; detail = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message || parsed.detail || detail } catch { /* plain response */ }
  throw new Error(`Provider returned ${response.status}${detail ? `: ${detail}` : ` ${response.statusText}`}`)
}
const requireSecret = async (host: TtsProviderHost, key: string, label: string) => {
  const value = await host.secrets.get(key)
  if (!value) throw new Error(`${label} is not configured.`)
  return value
}
const xml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

export const providerNames: Record<ProviderId, string> = {
  system: 'System voices', openai: 'OpenAI', elevenlabs: 'ElevenLabs', google: 'Google Cloud', azure: 'Azure Speech',
}

export const providerSecretKey = (provider: Exclude<ProviderId, 'system'>) => `${provider}.api-key`

export const listVoices = async (provider: ProviderId, host: TtsProviderHost, config: ProviderConfig): Promise<VoiceOption[]> => {
  if (provider === 'system') return 'speechSynthesis' in window ? window.speechSynthesis.getVoices().map((voice) => ({ id: voice.voiceURI, name: voice.name, language: voice.lang, provider, detail: voice.localService ? 'Local' : 'OS managed' })) : []
  if (provider === 'openai') return OPENAI_VOICES.map((voice) => ({ id: voice, name: voice.charAt(0).toUpperCase() + voice.slice(1), language: 'Multilingual', provider }))
  const key = await requireSecret(host, providerSecretKey(provider), providerNames[provider] + ' API key')
  if (provider === 'elevenlabs') {
    const response = await host.network.fetch({ url: 'https://api.elevenlabs.io/v2/voices?page_size=100', headers: { 'xi-api-key': key } })
    assertResponse(response)
    const data = readJson<{ voices?: Array<{ voice_id: string; name: string; labels?: Record<string, string>; category?: string }> }>(response.bodyBase64)
    return (data.voices || []).map((voice) => ({ id: voice.voice_id, name: voice.name, language: voice.labels?.language || 'Multilingual', provider, detail: voice.category }))
  }
  if (provider === 'google') {
    const response = await host.network.fetch({ url: 'https://texttospeech.googleapis.com/v1/voices', headers: { 'x-goog-api-key': key } })
    assertResponse(response)
    const data = readJson<{ voices?: Array<{ name: string; languageCodes?: string[]; ssmlGender?: string }> }>(response.bodyBase64)
    return (data.voices || []).flatMap((voice) => (voice.languageCodes || ['']).map((language) => ({ id: voice.name, name: voice.name, language, provider, detail: voice.ssmlGender })))
  }
  const region = config.azureRegion.trim().toLowerCase()
  requireIdentifier(region, 'Azure region', /^[a-z0-9-]{1,50}$/)
  const response = await host.network.fetch({ url: `https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`, headers: { 'Ocp-Apim-Subscription-Key': key } })
  assertResponse(response)
  const data = readJson<Array<{ ShortName: string; DisplayName: string; Locale: string; Gender?: string; VoiceType?: string }>>(response.bodyBase64)
  return data.map((voice) => ({ id: voice.ShortName, name: voice.DisplayName || voice.ShortName, language: voice.Locale, provider, detail: [voice.Gender, voice.VoiceType].filter(Boolean).join(' · ') }))
}

export const synthesize = async (host: TtsProviderHost, track: TtsTrack, text: string, config: ProviderConfig): Promise<SynthesisResult> => {
  if (track.provider === 'system') throw new Error('System voices can be used in real-time, but cannot create portable audio files.')
  requireTextInput(text)
  const key = await requireSecret(host, providerSecretKey(track.provider), providerNames[track.provider] + ' API key')
  if (track.provider === 'openai') {
    const voice = track.voice || 'coral'
    if (!OPENAI_VOICES.includes(voice)) throw new Error('Choose a supported OpenAI voice.')
    requireIdentifier(track.model || config.openaiModel, 'OpenAI model')
    const response = await host.network.fetch({
      url: 'https://api.openai.com/v1/audio/speech', method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      bodyBase64: jsonBase64({ model: track.model || config.openaiModel, input: text, voice, response_format: 'mp3', speed: track.speed, ...(track.instructions ? { instructions: track.instructions.slice(0, 2000) } : {}) }), timeoutMs: 120_000,
    })
    assertResponse(response)
    return { audioBase64: requireAudio(response.bodyBase64, 'OpenAI'), mimeType: 'audio/mpeg', extension: 'mp3' }
  }
  if (track.provider === 'elevenlabs') {
    if (!track.voice) throw new Error('Choose an ElevenLabs voice for this track.')
    requireIdentifier(track.voice, 'ElevenLabs voice'); requireIdentifier(track.model || config.elevenLabsModel, 'ElevenLabs model')
    if (track.speed < .7 || track.speed > 1.2) throw new Error('ElevenLabs speed must be between 0.7 and 1.2.')
    const response = await host.network.fetch({
      url: `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(track.voice)}?output_format=mp3_44100_128`, method: 'POST',
      headers: { 'xi-api-key': key, accept: 'audio/mpeg', 'content-type': 'application/json' },
      bodyBase64: jsonBase64({ text, model_id: track.model || config.elevenLabsModel, voice_settings: { speed: track.speed } }), timeoutMs: 120_000,
    })
    assertResponse(response)
    return { audioBase64: requireAudio(response.bodyBase64, 'ElevenLabs'), mimeType: 'audio/mpeg', extension: 'mp3' }
  }
  if (track.provider === 'google') {
    const languageCode = track.language === 'auto' ? detectLanguage(text) : track.language
    requireIdentifier(languageCode, 'Google language', languageIdentifier)
    if (track.voice || config.googleVoice) requireIdentifier(track.voice || config.googleVoice, 'Google voice')
    const response = await host.network.fetch({
      url: 'https://texttospeech.googleapis.com/v1/text:synthesize', method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      bodyBase64: jsonBase64({ input: { text }, voice: { languageCode, ...(track.voice || config.googleVoice ? { name: track.voice || config.googleVoice } : {}) }, audioConfig: { audioEncoding: 'MP3', speakingRate: track.speed } }), timeoutMs: 120_000,
    })
    assertResponse(response)
    const data = readJson<{ audioContent?: string }>(response.bodyBase64)
    return { audioBase64: requireAudio(data.audioContent, 'Google Cloud'), mimeType: 'audio/mpeg', extension: 'mp3' }
  }
  const region = config.azureRegion.trim().toLowerCase()
  const voice = track.voice || config.azureVoice
  const language = track.language === 'auto' ? detectLanguage(text) : track.language
  requireIdentifier(region, 'Azure region', /^[a-z0-9-]{1,50}$/); requireIdentifier(voice, 'Azure voice'); requireIdentifier(language, 'Azure language', languageIdentifier)
  const ssml = `<speak version="1.0" xml:lang="${xml(language)}"><voice name="${xml(voice)}"><prosody rate="${Math.round((track.speed - 1) * 100)}%">${xml(text)}</prosody></voice></speak>`
  const response = await host.network.fetch({
    url: `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3', 'User-Agent': 'NeoAnki-TTS' },
    bodyBase64: encodeBase64(new TextEncoder().encode(ssml)), timeoutMs: 120_000,
  })
  assertResponse(response)
  return { audioBase64: requireAudio(response.bodyBase64, 'Azure Speech'), mimeType: 'audio/mpeg', extension: 'mp3' }
}

export const dataUrl = (result: SynthesisResult) => `data:${result.mimeType};base64,${result.audioBase64}`

export const synthesizeWithFallback = async (host: TtsProviderHost, track: TtsTrack, text: string, config: ProviderConfig) => {
  const alternatives = track.fallbacks.filter((fallback) => fallback.provider !== 'system').map((fallback) => ({ ...track, provider: fallback.provider, voice: fallback.voice, model: fallback.model, fallbacks: [], voiceMode: 'single' as const }))
  const candidates = [{ ...track, fallbacks: [], voiceMode: 'single' as const }, ...alternatives]
  if (track.voiceMode === 'random') candidates.sort(() => Math.random() - 0.5)
  const selected = track.voiceMode === 'single' ? candidates.slice(0, 1) : candidates
  const failures: string[] = []
  for (const candidate of selected) {
    try { return await synthesize(host, candidate, text, config) }
    catch (error) { failures.push(`${providerNames[candidate.provider]}: ${error instanceof Error ? error.message : 'failed'}`) }
  }
  throw new Error(failures.join(' · ') || 'No voice target is configured.')
}
