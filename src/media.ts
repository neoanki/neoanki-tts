import { EXTENSION_ID } from './config.js'
import type { GeneratedTrackMetadata, ItemTtsMetadata, TtsKnowledgeItem, TtsMediaAsset } from './types.js'

export const metadataKey = (profileId: string, trackId: string) => `${profileId}:${trackId}`

export const readTtsMetadata = (item: Pick<TtsKnowledgeItem, 'extensionData'>): ItemTtsMetadata => {
  const value = item.extensionData?.[EXTENSION_ID]
  if (!value || typeof value !== 'object' || (value as ItemTtsMetadata).version !== 1 || typeof (value as ItemTtsMetadata).tracks !== 'object') return { version: 1, tracks: {} }
  return value as ItemTtsMetadata
}

export interface AttachAudioPayload {
  itemId: string
  asset: TtsMediaAsset
  metadata: GeneratedTrackMetadata
}

export const attachGeneratedAudio = (data: { items: TtsKnowledgeItem[]; assets: TtsMediaAsset[] }, payloads: AttachAudioPayload[]) => {
  const byItem = new Map<string, AttachAudioPayload[]>()
  for (const payload of payloads) byItem.set(payload.itemId, [...(byItem.get(payload.itemId) || []), payload])
  const items = data.items.map((item) => {
    const updates = byItem.get(item.id)
    if (!updates?.length) return item
    const current = readTtsMetadata(item)
    const tracks = { ...current.tracks }
    let mediaIds = [...item.mediaIds]
    for (const update of updates) {
      const key = metadataKey(update.metadata.profileId, update.metadata.trackId)
      const previous = tracks[key]
      if (previous && previous.assetId !== update.asset.id) mediaIds = mediaIds.filter((id) => id !== previous.assetId)
      tracks[key] = update.metadata
      if (!mediaIds.includes(update.asset.id)) mediaIds.push(update.asset.id)
    }
    return { ...item, mediaIds, extensionData: { ...item.extensionData, [EXTENSION_ID]: { version: 1, tracks } }, updatedAt: new Date().toISOString() }
  })
  const assets = [...data.assets]
  for (const payload of payloads) if (!assets.some((asset) => asset.id === payload.asset.id)) assets.push(payload.asset)
  return { items, assets }
}
