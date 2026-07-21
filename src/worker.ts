import { defineExtension, exposeExtensionWorker, type ExtensionContentNoteDto, type ExtensionHostV2, type ExtensionManifestV2, type WorkerContributionRequest } from '@neo-anki/extension-sdk'
import manifestDocument from '../manifest.json' with { type: 'json' }
import { EXTENSION_ID, DEFAULT_CONFIG, normalizeConfig, selectMatchingProfile } from './config.js'
import { cacheKeyFor } from './generation.js'
import { metadataKey } from './media.js'
import { listVoices, providerSecretKey, synthesizeWithFallback } from './providers.js'
import { textForTrack } from './text.js'
import type { ItemTtsMetadata, ProviderId, TtsConfig, TtsProfile, TtsTrack } from './types.js'

const manifest = manifestDocument as unknown as ExtensionManifestV2

const fromBase64 = (value: string) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
const toBase64 = (bytes: Uint8Array) => {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  return btoa(binary)
}

const legacyHost = (host: ExtensionHostV2, operationId: string) => ({
  network: { fetch: async (request: { url: string; method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; headers?: Record<string, string>; bodyBase64?: string; timeoutMs?: number }) => {
    const response = await host.fetch({ operationId, url: request.url, method: request.method, headers: request.headers, body: request.bodyBase64 ? fromBase64(request.bodyBase64) : undefined, timeoutMs: request.timeoutMs, maximumResponseBytes: 25 * 1024 * 1024 })
    return { status: response.status, statusText: String(response.status), headers: response.headers, bodyBase64: toBase64(response.body) }
  } },
  secrets: { get: async (key: string) => (await host.secrets.read([key]))[key] },
})

const noteAsItem = (note: ExtensionContentNoteDto) => ({ id: note.noteId, prompt: note.prompt, answer: note.answer, context: note.context, collection: note.deckName, tags: note.tags, citations: [], mediaIds: [], occlusions: [], createdAt: '', updatedAt: '' })
const metadataFrom = (note: ExtensionContentNoteDto): ItemTtsMetadata => {
  const value = note.record?.value as Partial<ItemTtsMetadata> | undefined
  return value?.version === 1 && value.tracks && typeof value.tracks === 'object' ? value as ItemTtsMetadata : { version: 1, tracks: {} }
}
const configFromHost = async (host: ExtensionHostV2) => normalizeConfig(await host.config.read() || DEFAULT_CONFIG)

const queryOne = async (host: ExtensionHostV2, noteId: string) => {
  const page = await host.content.listNotes({ noteIds: [noteId], limit: 1 })
  const note = page.notes[0]
  if (!note) throw new Error('The note no longer exists.')
  return { page, note }
}

const synthesizeRetry = async (host: ExtensionHostV2, track: TtsTrack, text: string, config: TtsConfig, operationId: string, stopped: () => boolean) => {
  let attempt = 0
  while (true) {
    if (stopped()) throw new Error('Generation cancelled.')
    try { return await synthesizeWithFallback(legacyHost(host, operationId) as never, track, text, config.providers) }
    catch (error) {
      if (attempt >= config.batchRetries || stopped()) throw error
      attempt += 1
      await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** (attempt - 1)))
    }
  }
}

const generateOne = async (host: ExtensionHostV2, noteId: string, profileId: string, trackId: string, stopped: () => boolean, onOperation: (operationId?: string) => void = () => undefined, idempotencyKey?: string) => {
  const config = await configFromHost(host)
  if (!config.enabled) throw new Error('Text to Speech is disabled. Enable it in extension settings before generating audio.')
  const initial = await queryOne(host, noteId)
  const profile = config.profiles.find((value) => value.id === profileId) || selectMatchingProfile(config.profiles, noteAsItem(initial.note))
  const track = profile?.tracks.find((value) => value.id === trackId)
  if (!profile || !track) throw new Error('The selected TTS profile or track no longer exists.')
  if (!profile.enabled) throw new Error(`The TTS profile “${profile.name}” is disabled.`)
  if (track.provider === 'system') throw new Error('System voices are real-time only and cannot create portable media.')
  const text = textForTrack(track, noteAsItem(initial.note) as never, profile.processing)
  if (!text) throw new Error('The selected track produces empty text.')
  const operationSuffix = idempotencyKey ? `${idempotencyKey.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80)}:${track.id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40)}` : crypto.randomUUID()
  const operationId = `tts:${operationSuffix}`
  onOperation(operationId)
  const result = await synthesizeRetry(host, track, text, config, operationId, stopped).finally(() => onOperation(undefined))
  if (stopped()) { await host.cancel(operationId); throw new Error('Generation cancelled.') }
  const bytes = fromBase64(result.audioBase64)
  const media = await host.createMedia({ operationId, filename: `neoanki-tts-${profile.id}-${track.id}-${crypto.randomUUID()}.${result.extension}`, mimeType: result.mimeType, bytes, altText: `${track.name} AI-generated speech (${track.provider})` })
  const timestamp = new Date().toISOString()
  const trackMetadata = { profileId: profile.id, trackId: track.id, assetId: media.id, cacheKey: await cacheKeyFor(track, text, config.providers), generatedAt: timestamp, side: track.side, provider: track.provider }
  for (let attempt = 0; ; attempt += 1) {
    if (stopped()) throw new Error('Generation cancelled.')
    const fresh = await queryOne(host, noteId)
    const metadata = metadataFrom(fresh.note)
    metadata.tracks[metadataKey(profile.id, track.id)] = trackMetadata
    const id = fresh.note.record?.id || `extension:${EXTENSION_ID}:note:${noteId}`
    const value = { id, revision: fresh.note.record ? fresh.note.record.revision + 1 : 1, createdAt: fresh.note.record?.createdAt || timestamp, updatedAt: timestamp, profileId: fresh.note.profileId, extensionId: EXTENSION_ID, targetKind: 'note' as const, targetId: noteId, value: metadata }
    try {
      await host.applyPatch({ version: 2, idempotencyKey: idempotencyKey ? `tts-metadata:${operationSuffix}` : `tts-metadata:${crypto.randomUUID()}`, expectedWorkspaceRevision: fresh.page.workspaceRevision, owner: { type: 'extension', extensionId: EXTENSION_ID, scopes: ['content:patch-own'] }, operations: [{ op: fresh.note.record ? 'update' : 'create', kind: 'extensionRecord', id, ...(fresh.note.record ? { expectedRevision: fresh.note.record.revision } : {}), value }] })
      break
    } catch (error) {
      if (attempt >= 19 || !(error instanceof Error) || !/workspace revision conflict/i.test(error.message)) throw error
      await new Promise((resolve) => setTimeout(resolve, Math.min(100, 5 * (attempt + 1))))
    }
  }
  return { assetId: media.id, mimeType: result.mimeType, cacheKey: trackMetadata.cacheKey }
}

interface BatchJob { id: string; state: 'running' | 'completed' | 'cancelled' | 'failed'; completed: number; total: number; generated: number; skipped: number; failures: number; current?: string; error?: string; cancelled: boolean; operationIds: Set<string>; failedNoteIds: Set<string> }
const jobs = new Map<string, BatchJob>()
const MAX_RETAINED_JOBS = 20
const publicJob = (job: BatchJob) => ({ id: job.id, state: job.state, completed: job.completed, total: job.total, generated: job.generated, skipped: job.skipped, failures: job.failures, current: job.current, error: job.error, failedNotes: job.failedNoteIds.size, canRetry: job.state !== 'running' && job.failedNoteIds.size > 0 })

const collectNotes = async (host: ExtensionHostV2, noteIds?: string[]) => {
  const availableMediaIds = new Set<string>()
  if (noteIds !== undefined) {
    const notes: ExtensionContentNoteDto[] = []
    for (let offset = 0; offset < noteIds.length; offset += 500) { const page = await host.content.listNotes({ noteIds: noteIds.slice(offset, offset + 500), limit: 500 }); notes.push(...page.notes); page.availableMediaIds.forEach((id) => availableMediaIds.add(id)) }
    return { notes, availableMediaIds }
  }
  const notes: ExtensionContentNoteDto[] = []; let cursor: string | undefined
  do { const page = await host.content.listNotes({ cursor, limit: 500 }); notes.push(...page.notes); page.availableMediaIds.forEach((id) => availableMediaIds.add(id)); cursor = page.nextCursor } while (cursor)
  return { notes, availableMediaIds }
}

const runBatch = async (host: ExtensionHostV2, job: BatchJob, noteIds?: string[]) => {
  try {
    const config = await configFromHost(host)
    if (!config.enabled) throw new Error('Text to Speech is disabled. Enable it in extension settings before generating audio.')
    const collected = await collectNotes(host, noteIds); job.total = collected.notes.length
    let nextIndex = 0
    const processNext = async (): Promise<void> => {
      const index = nextIndex; nextIndex += 1
      if (job.cancelled || index >= collected.notes.length) return
      const note = collected.notes[index]!; job.current = note.noteId
      const profile = selectMatchingProfile(config.profiles, noteAsItem(note)); const metadata = metadataFrom(note)
      for (const track of profile?.tracks || []) {
        if (job.cancelled) break
        if (track.provider === 'system' || track.mode !== 'generated') { job.skipped += 1; continue }
        const text = textForTrack(track, noteAsItem(note) as never, profile!.processing)
        const cached = metadata.tracks[metadataKey(profile!.id, track.id)]
        if (config.skipCurrentAudio && cached && collected.availableMediaIds.has(cached.assetId) && cached.cacheKey === await cacheKeyFor(track, text, config.providers)) { job.skipped += 1; continue }
        let activeOperationId: string | undefined
        try { await generateOne(host, note.noteId, profile!.id, track.id, () => job.cancelled, (operationId) => { if (activeOperationId) job.operationIds.delete(activeOperationId); activeOperationId = operationId; if (operationId) job.operationIds.add(operationId) }); job.generated += 1 }
        catch (error) { if (job.cancelled) throw error; job.failures += 1; job.failedNoteIds.add(note.noteId); job.error = error instanceof Error ? error.message : 'Track generation failed.' }
        finally { if (activeOperationId) job.operationIds.delete(activeOperationId) }
      }
      job.completed += 1
      await processNext()
    }
    await Promise.all(Array.from({ length: Math.min(config.batchConcurrency, collected.notes.length) }, () => processNext()))
    job.state = job.cancelled ? 'cancelled' : 'completed'; job.current = undefined
  } catch (error) { job.state = job.cancelled ? 'cancelled' : 'failed'; job.error = error instanceof Error ? error.message : 'Generation failed.'; job.current = undefined }
  finally { job.operationIds.clear() }
}

const runAuthoringAction = async (request: Extract<WorkerContributionRequest, { type: 'authoring-action' }>, host: ExtensionHostV2) => {
  if (request.actionId !== 'generate-offline-audio') throw new Error(`Unsupported TTS authoring action ${request.actionId}.`)
  const config = await configFromHost(host)
  if (!config.enabled) throw new Error('Text to Speech is disabled. Enable it in extension settings before generating audio.')
  const { page, note } = await queryOne(host, request.itemId)
  const profile = selectMatchingProfile(config.profiles, noteAsItem(note))
  if (!profile) throw new Error('No enabled TTS profile matches this knowledge item.')
  const metadata = metadataFrom(note)
  const tracks = profile.tracks.filter((track) => track.mode === 'generated' && track.provider !== 'system')
  if (!tracks.length) throw new Error('No portable-audio track matches this knowledge item. Configure an enabled cloud track with “Save for offline playback” first.')
  let generated = 0; let skipped = 0; const mediaIds: string[] = []; const failures: string[] = []
  for (const track of tracks) {
    const text = textForTrack(track, noteAsItem(note) as never, profile.processing)
    if (!text) { skipped += 1; continue }
    const cached = metadata.tracks[metadataKey(profile.id, track.id)]
    if (config.skipCurrentAudio && cached && page.availableMediaIds.includes(cached.assetId) && cached.cacheKey === await cacheKeyFor(track, text, config.providers)) { skipped += 1; mediaIds.push(cached.assetId); continue }
    try { const result = await generateOne(host, note.noteId, profile.id, track.id, () => false, () => undefined, request.idempotencyKey); generated += 1; mediaIds.push(result.assetId) }
    catch (error) { failures.push(`${track.name}: ${error instanceof Error ? error.message : 'generation failed'}`) }
  }
  if (failures.length) throw new Error(`${generated ? `${generated} track${generated === 1 ? '' : 's'} generated; ` : ''}${failures.length} failed. ${failures.join(' · ')}`)
  return { state: 'completed', itemId: note.noteId, generated, skipped, mediaIds, message: generated ? `${generated} portable audio track${generated === 1 ? '' : 's'} generated.` : 'Audio is already current.' }
}

const authoringActionStatus = async (request: Extract<WorkerContributionRequest, { type: 'authoring-action-status' }>, host: ExtensionHostV2) => {
  if (request.actionId !== 'generate-offline-audio') return { available: false, configured: false, reason: 'This TTS action is not available.' }
  const config = await configFromHost(host)
  if (!config.enabled) return { available: false, configured: false, reason: 'Text to Speech is disabled. Enable it in Configure before generating audio.' }
  const item = { collection: request.draft.collection, tags: request.draft.tags }
  const profile = selectMatchingProfile(config.profiles, item)
  if (!profile) return { available: false, configured: false, reason: 'No enabled TTS profile matches this collection and its tags.' }
  const tracks = profile.tracks.filter((track) => track.mode === 'generated' && track.provider !== 'system')
  if (!tracks.length) return { available: false, configured: false, reason: `“${profile.name}” has no generated cloud track. System and realtime voices do not create portable files.` }
  const providers = [...new Set(tracks.map((track) => track.provider as Exclude<ProviderId, 'system'>))]
  const keys = providers.map(providerSecretKey)
  const secrets = await host.secrets.read(keys)
  const configuredTracks = tracks.filter((track) => Boolean(secrets[providerSecretKey(track.provider as Exclude<ProviderId, 'system'>)]))
  if (!configuredTracks.length) return { available: false, configured: false, reason: `Add credentials in Configure for ${providers.join(', ')} before generating portable audio.` }
  return { available: true, configured: true, selectionLabel: `${profile.name} · ${configuredTracks.map((track) => track.name).join(', ')}` }
}

const handleCommand = async (request: Extract<WorkerContributionRequest, { type: 'command' }>, host: ExtensionHostV2) => {
  const payload = request.payload as Record<string, unknown> | undefined
  if (request.commandId === 'voices.list') { const provider = String(payload?.provider) as ProviderId; return listVoices(provider, legacyHost(host, `tts:voices:${crypto.randomUUID()}`) as never, (await configFromHost(host)).providers) }
  if (request.commandId === 'review.get') {
    const noteId = String(payload?.noteId || ''); const { page, note } = await queryOne(host, noteId); const config = await configFromHost(host); const profile = selectMatchingProfile(config.profiles, noteAsItem(note)); const metadata = metadataFrom(note)
    if (!config.enabled) throw new Error('Text to Speech is disabled.')
    const currentTrackIds: string[] = []
    for (const track of profile?.tracks || []) {
      const key = metadataKey(profile!.id, track.id); const cached = metadata.tracks[key]
      const text = textForTrack(track, noteAsItem(note) as never, profile!.processing)
      if (cached && page.availableMediaIds.includes(cached.assetId) && cached.cacheKey === await cacheKeyFor(track, text, config.providers)) currentTrackIds.push(key)
    }
    return { note, profile, metadata, currentTrackIds }
  }
  if (request.commandId === 'generate.one') return generateOne(host, String(payload?.noteId || ''), String(payload?.profileId || ''), String(payload?.trackId || ''), () => false)
  if (request.commandId === 'authoring.status') {
    const noteIds = Array.isArray(payload?.noteIds) ? [...new Set(payload.noteIds.map(String).filter(Boolean))].slice(0, 500) : []
    const config = await configFromHost(host)
    if (!noteIds.length) return { enabled: config.enabled, eligibleNotes: 0, eligibleTracks: 0, notes: [], reason: 'Save this knowledge item before generating portable audio.' }
    const collected = await collectNotes(host, noteIds)
    const notes = await Promise.all(collected.notes.map(async (note) => {
      const profile = selectMatchingProfile(config.profiles, noteAsItem(note))
      const metadata = metadataFrom(note)
      const tracks = await Promise.all((profile?.tracks || []).filter((track) => track.mode === 'generated' && track.provider !== 'system').map(async (track) => {
        const text = textForTrack(track, noteAsItem(note) as never, profile!.processing)
        const cached = metadata.tracks[metadataKey(profile!.id, track.id)]
        const current = Boolean(text && cached && collected.availableMediaIds.has(cached.assetId) && cached.cacheKey === await cacheKeyFor(track, text, config.providers))
        return { profileId: profile!.id, trackId: track.id, name: track.name, provider: track.provider, current, eligible: Boolean(text) }
      }))
      return { noteId: note.noteId, profileName: profile?.name, tracks }
    }))
    const eligibleTracks = notes.flatMap((note) => note.tracks).filter((track) => track.eligible && !track.current).length
    return { enabled: config.enabled, eligibleNotes: notes.filter((note) => note.tracks.some((track) => track.eligible && !track.current)).length, eligibleTracks, notes, ...(!config.enabled ? { reason: 'Text to Speech is disabled in extension settings.' } : eligibleTracks === 0 ? { reason: 'No missing generated cloud tracks match this note. System and real-time voices cannot create portable audio.' } : {}) }
  }
  if (request.commandId === 'authoring.generate') {
    const noteIds = Array.isArray(payload?.noteIds) ? [...new Set(payload.noteIds.map(String).filter(Boolean))].slice(0, 500) : []
    if (!noteIds.length) throw new Error('Save this knowledge item before generating portable audio.')
    const config = await configFromHost(host)
    if (!config.enabled) throw new Error('Text to Speech is disabled. Enable it in extension settings before generating audio.')
    for (const [id, retained] of jobs) if (jobs.size >= MAX_RETAINED_JOBS && retained.state !== 'running') jobs.delete(id)
    if (jobs.size >= MAX_RETAINED_JOBS) throw new Error('Too many TTS batch jobs are still active. Stop or wait for an existing job.')
    const job: BatchJob = { id: crypto.randomUUID(), state: 'running', completed: 0, total: 0, generated: 0, skipped: 0, failures: 0, cancelled: false, operationIds: new Set(), failedNoteIds: new Set() }
    jobs.set(job.id, job); void runBatch(host, job, noteIds); return publicJob(job)
  }
  if (request.commandId === 'batch.start') {
    for (const [id, retained] of jobs) if (jobs.size >= MAX_RETAINED_JOBS && retained.state !== 'running') jobs.delete(id)
    if (jobs.size >= MAX_RETAINED_JOBS) throw new Error('Too many TTS batch jobs are still active. Stop or wait for an existing job.')
    const config = await configFromHost(host)
    if (!config.enabled) throw new Error('Text to Speech is disabled. Enable it in extension settings before generating audio.')
    const job: BatchJob = { id: crypto.randomUUID(), state: 'running', completed: 0, total: 0, generated: 0, skipped: 0, failures: 0, cancelled: false, operationIds: new Set(), failedNoteIds: new Set() }; jobs.set(job.id, job); void runBatch(host, job, Array.isArray(payload?.noteIds) ? [...new Set(payload.noteIds.map(String).filter(Boolean))].slice(0, 100_000) : undefined); return publicJob(job)
  }
  if (request.commandId === 'batch.status') { const job = jobs.get(String(payload?.jobId)); if (!job) throw new Error('Batch job was not found.'); return publicJob(job) }
  if (request.commandId === 'batch.cancel') { const job = jobs.get(String(payload?.jobId)); if (!job) throw new Error('Batch job was not found.'); job.cancelled = true; await Promise.allSettled([...job.operationIds].map((operationId) => host.cancel(operationId))); return publicJob(job) }
  if (request.commandId === 'batch.retry') {
    const previous = jobs.get(String(payload?.jobId))
    if (!previous) throw new Error('Batch job was not found.')
    if (previous.state === 'running') throw new Error('Wait for the current TTS job to finish before retrying.')
    if (!previous.failedNoteIds.size) throw new Error('This TTS job has no failed notes to retry.')
    const config = await configFromHost(host)
    if (!config.enabled) throw new Error('Text to Speech is disabled. Enable it in extension settings before retrying audio.')
    for (const [id, retained] of jobs) if (jobs.size >= MAX_RETAINED_JOBS && retained.state !== 'running') jobs.delete(id)
    if (jobs.size >= MAX_RETAINED_JOBS) throw new Error('Too many TTS batch jobs are still active. Stop or wait for an existing job.')
    const job: BatchJob = { id: crypto.randomUUID(), state: 'running', completed: 0, total: 0, generated: 0, skipped: 0, failures: 0, cancelled: false, operationIds: new Set(), failedNoteIds: new Set() }
    jobs.set(job.id, job); void runBatch(host, job, [...previous.failedNoteIds]); return publicJob(job)
  }
  throw new Error(`Unsupported TTS command ${request.commandId}.`)
}

export const ttsExtension = defineExtension({
  manifest,
  async handle(request: WorkerContributionRequest, host: ExtensionHostV2) {
    const requestId = request.type === 'planning-signals' ? request.request.requestId : request.type === 'cancel' ? request.operationId : request.requestId
    if (request.type !== 'command' && request.type !== 'authoring-action' && request.type !== 'authoring-action-status') return { type: 'error' as const, requestId, code: 'unsupported', message: 'Text to Speech cannot handle this request.' }
    try { return { type: 'result' as const, requestId, value: request.type === 'authoring-action' ? await runAuthoringAction(request, host) : request.type === 'authoring-action-status' ? await authoringActionStatus(request, host) : await handleCommand(request, host) } }
    catch (error) { return { type: 'error' as const, requestId, code: 'tts-command-failed', message: error instanceof Error ? error.message : 'TTS command failed.' } }
  },
})

const workerScope = globalThis as typeof globalThis & { document?: unknown; postMessage?: unknown; addEventListener?: unknown }
if (typeof workerScope.document === 'undefined' && typeof workerScope.postMessage === 'function' && typeof workerScope.addEventListener === 'function') exposeExtensionWorker(ttsExtension)
