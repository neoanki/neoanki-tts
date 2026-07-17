import { attachGeneratedAudio, metadataKey, readTtsMetadata, type AttachAudioPayload } from './media.js'
import { EXTENSION_ID } from './config.js'

const timestamp = '2025-01-01T00:00:00.000Z'
const item = { id: 'item', prompt: 'Hola', answer: 'Hello', context: '', collection: 'Spanish', tags: [], citations: [], mediaIds: ['old'], occlusions: [], createdAt: timestamp, updatedAt: timestamp, extensionData: { [EXTENSION_ID]: { version: 1, tracks: { 'p:t': { profileId: 'p', trackId: 't', assetId: 'old', cacheKey: 'old', generatedAt: timestamp, side: 'prompt', provider: 'openai' } } } } }
const payload = (id: string): AttachAudioPayload => ({ itemId: 'item', asset: { id, filename: `${id}.mp3`, mimeType: 'audio/mpeg', dataUrl: 'data:audio/mpeg;base64,YQ==', byteLength: 1, hash: id, altText: '', createdAt: timestamp, updatedAt: timestamp }, metadata: { profileId: 'p', trackId: 't', assetId: id, cacheKey: id, generatedAt: timestamp, side: 'prompt', provider: 'openai' } })

describe('generated media attachment', () => {
  it('replaces the prior track attachment without losing unrelated metadata', () => {
    const result = attachGeneratedAudio({ items: [item], assets: [] }, [payload('new')])
    expect(result.items[0]?.mediaIds).toEqual(['new'])
    expect(readTtsMetadata(result.items[0]!).tracks[metadataKey('p', 't')]?.assetId).toBe('new')
    expect(result.assets).toHaveLength(1)
  })

  it('deduplicates content-addressed assets', () => {
    const audio = payload('same')
    const result = attachGeneratedAudio({ items: [{ ...item, mediaIds: [] }], assets: [audio.asset] }, [audio])
    expect(result.assets).toHaveLength(1)
  })
})
