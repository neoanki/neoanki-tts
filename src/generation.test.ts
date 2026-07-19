import { DEFAULT_CONFIG } from './config.js'
import { generateTrackPayload, isCurrent } from './generation.js'
import { stableByteHash } from './text.js'
import type { TtsKnowledgeItem, TtsMediaAsset, TtsProviderHost } from './types.js'

const timestamp = '2025-01-01T00:00:00.000Z'
const item: TtsKnowledgeItem = { id: 'item', prompt: 'Hola', answer: 'Hello', context: '', collection: 'Spanish', tags: [], mediaIds: [], createdAt: timestamp, updatedAt: timestamp }

describe('TTS generation integrity', () => {
  it('hashes decoded audio bytes and requires the referenced asset for current status', async () => {
    const audioBase64 = btoa('ID3decoded audio bytes')
    const host: TtsProviderHost = {
      network: { fetch: vi.fn(async () => ({ status: 200, statusText: 'OK', headers: {}, bodyBase64: audioBase64 })) },
      secrets: { get: vi.fn(async () => 'test-key') },
    }
    const profile = structuredClone(DEFAULT_CONFIG.profiles[0]!)
    const track = { ...profile.tracks[0]!, provider: 'openai' as const, mode: 'generated' as const, autoplay: false }
    const payload = await generateTrackPayload({ item, profile, track, providers: DEFAULT_CONFIG.providers, host, retries: 0 })
    const expected = await stableByteHash(new TextEncoder().encode('ID3decoded audio bytes'))
    expect(payload?.asset).toMatchObject({ hash: expected, byteLength: 22 })

    const itemWithMetadata = { ...item, extensionData: { 'org.neoanki.tts': { version: 1, tracks: { [`${profile.id}:${track.id}`]: payload!.metadata } } } }
    expect(await isCurrent(itemWithMetadata, [], profile, track, DEFAULT_CONFIG.providers)).toBe(false)
    expect(await isCurrent(itemWithMetadata, [payload!.asset as TtsMediaAsset], profile, track, DEFAULT_CONFIG.providers)).toBe(true)
  })
})
