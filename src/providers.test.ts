import { DEFAULT_CONFIG, DEFAULT_PROFILE } from './config.js'
import { listVoices, synthesizeWithFallback } from './providers.js'
import type { TtsProviderHost } from './types.js'

const encode = (value: string) => btoa(value)
const mp3 = btoa('ID3fixture-audio')
const host = (fetch: TtsProviderHost['network']['fetch'], secrets: Record<string, string> = { 'openai.api-key': 'secret', 'google.api-key': 'google' }): TtsProviderHost => ({ network: { fetch }, secrets: { get: vi.fn(async (key) => secrets[key] || null) } })

describe('provider adapters', () => {
  it('lists OpenAI voices without making a network request', async () => {
    const fetch = vi.fn()
    const voices = await listVoices('openai', host(fetch), DEFAULT_CONFIG.providers)
    expect(voices.some((voice) => voice.id === 'coral')).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('sends secrets in headers and returns provider audio', async () => {
    const fetch = vi.fn(async () => ({ status: 200, statusText: 'OK', headers: { 'content-type': 'audio/mpeg' }, bodyBase64: mp3 }))
    const track = { ...DEFAULT_PROFILE.tracks[0]!, provider: 'openai' as const, voice: 'coral', model: 'gpt-4o-mini-tts' }
    const result = await synthesizeWithFallback(host(fetch), track, 'Hola', DEFAULT_CONFIG.providers)
    expect(result.mimeType).toBe('audio/mpeg')
    expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://api.openai.com/v1/audio/speech', headers: expect.objectContaining({ authorization: 'Bearer secret' }) }))
  })

  it('uses priority fallbacks after a provider error', async () => {
    const fetch = vi.fn(async (request: { url: string }) => request.url.includes('openai')
      ? { status: 429, statusText: 'Rate limited', headers: {}, bodyBase64: encode(JSON.stringify({ error: { message: 'slow down' } })) }
      : { status: 200, statusText: 'OK', headers: {}, bodyBase64: encode(JSON.stringify({ audioContent: mp3 })) })
    const track = { ...DEFAULT_PROFILE.tracks[0]!, provider: 'openai' as const, voiceMode: 'priority' as const, fallbacks: [{ id: 'g', provider: 'google' as const, voice: '', model: '' }] }
    const result = await synthesizeWithFallback(host(fetch), track, 'Hola', DEFAULT_CONFIG.providers)
    expect(result.audioBase64).toBe(mp3)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
