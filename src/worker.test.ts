import type { ExtensionContentNoteDto, ExtensionHostV2, WorkerContributionResponse } from '@neo-anki/extension-sdk'
import { DEFAULT_CONFIG } from './config.js'
import { ttsExtension } from './worker.js'

interface PublicBatchJob { id: string; state: 'running' | 'completed' | 'cancelled' | 'failed'; completed: number; total: number; generated: number; failures: number; failedNotes: number; canRetry: boolean }

const command = async <T,>(host: ExtensionHostV2, commandId: string, payload: unknown = {}) => {
  const response: WorkerContributionResponse = await ttsExtension.handle!({ type: 'command', requestId: crypto.randomUUID(), commandId, payload }, host)
  if (response.type === 'error') throw new Error(response.message)
  if (response.type !== 'result') throw new Error('Unexpected worker response.')
  return response.value as T
}

const authoringAction = async <T,>(host: ExtensionHostV2, itemId: string, idempotencyKey: string = crypto.randomUUID()) => {
  const response: WorkerContributionResponse = await ttsExtension.handle!({ type: 'authoring-action', requestId: crypto.randomUUID(), actionId: 'generate-offline-audio', itemId, idempotencyKey, draft: { prompt: 'Prompt', answer: 'Answer', context: '', collection: 'Deck', tags: [], selectedPromptTypes: ['forward'], mediaIds: [] } }, host)
  if (response.type === 'error') throw new Error(response.message)
  if (response.type !== 'result') throw new Error('Unexpected worker response.')
  return response.value as T
}

const authoringStatus = async (host: ExtensionHostV2) => {
  const response: WorkerContributionResponse = await ttsExtension.handle!({ type: 'authoring-action-status', requestId: crypto.randomUUID(), actionId: 'generate-offline-audio', draft: { prompt: 'Prompt', answer: 'Answer', context: '', collection: 'Deck', tags: [], selectedPromptTypes: ['forward'], mediaIds: [] } }, host)
  if (response.type === 'error') throw new Error(response.message)
  if (response.type !== 'result') throw new Error('Unexpected worker response.')
  return response.value as { available: boolean; configured: boolean; reason?: string; selectionLabel?: string }
}

const waitFor = async (predicate: () => boolean | Promise<boolean>, timeoutMs = 2_000) => {
  const started = Date.now()
  while (!await predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for TTS batch state.')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

const notes: ExtensionContentNoteDto[] = [1, 2].map((index) => ({
  noteId: `note-${index}`, profileId: 'profile', prompt: `Prompt ${index}`, answer: `Answer ${index}`, context: '', deckName: 'Deck', tags: [],
}))

const config = () => {
  const value = structuredClone(DEFAULT_CONFIG)
  value.batchConcurrency = 2
  value.profiles[0]!.tracks = [{ ...value.profiles[0]!.tracks[0]!, provider: 'openai', mode: 'generated', voice: 'coral', model: 'gpt-4o-mini-tts' }]
  return value
}

const hostWith = (fetch: ExtensionHostV2['fetch'], cancel: ExtensionHostV2['cancel'] = async () => undefined, forcedRevisionConflicts = 0, configured = config): ExtensionHostV2 => {
  let workspaceRevision = 1
  return {
  applyPatch: async (patch) => {
    if (forcedRevisionConflicts > 0) { forcedRevisionConflicts -= 1; workspaceRevision += 1; throw new Error('Workspace revision conflict.') }
    if (patch.expectedWorkspaceRevision !== workspaceRevision) throw new Error('Workspace revision conflict.')
    workspaceRevision += 1
    return { workspaceRevision }
  },
  createMedia: async (request) => ({ id: `media-${request.operationId}`, sha256: '0'.repeat(64), byteLength: request.bytes.byteLength, workspaceRevision: 2 }),
  fetch,
  cancel,
  secrets: { read: async (keys) => Object.fromEntries(keys.map((key) => [key, 'fixture-secret'])), mutate: async () => undefined },
  config: { read: async <T = unknown>() => configured() as T, write: async () => ({ workspaceRevision: 2 }) },
  content: { listNotes: async (query = {}) => ({ workspaceRevision, notes: query.noteIds ? notes.filter((note) => query.noteIds!.includes(note.noteId)) : notes, availableMediaIds: [] }) },
  migration: { exportWorkspace: async () => ({ document: {}, media: [] }), commit: async () => ({ workspaceRevision }) },
  }
}

describe('SDK v2 TTS worker batches', () => {
  it('honors bounded note concurrency and commits every completed note', async () => {
    let active = 0; let maximum = 0
    const host = hostWith(async () => {
      active += 1; maximum = Math.max(maximum, active)
      await new Promise((resolve) => setTimeout(resolve, 25))
      active -= 1
      return { status: 200, headers: { 'content-type': 'audio/mpeg' }, body: new TextEncoder().encode('ID3fixture-audio') }
    }, async () => undefined, 1)
    const started = await command<PublicBatchJob>(host, 'batch.start')
    let status = started
    await waitFor(async () => { status = await command<PublicBatchJob>(host, 'batch.status', { jobId: started.id }); return status.state !== 'running' })
    expect(status).toMatchObject({ state: 'completed', completed: 2, total: 2, generated: 2, failures: 0 })
    expect(maximum).toBe(2)
  })

  it('cancels every in-flight provider operation and reaches a terminal state', async () => {
    const pending = new Map<string, (error: Error) => void>(); const cancelled: string[] = []
    const host = hostWith((request) => new Promise((_, reject) => { pending.set(request.operationId, reject) }), async (operationId) => {
      cancelled.push(operationId); pending.get(operationId)?.(new Error('Cancelled by test.')); pending.delete(operationId)
    })
    const started = await command<PublicBatchJob>(host, 'batch.start')
    await waitFor(() => pending.size === 2)
    await command(host, 'batch.cancel', { jobId: started.id })
    let status = started
    await waitFor(async () => { status = await command<PublicBatchJob>(host, 'batch.status', { jobId: started.id }); return status.state !== 'running' })
    expect(status.state).toBe('cancelled')
    expect(cancelled).toHaveLength(2)
  })

  it('enforces the global disabled switch for generation', async () => {
    const host = hostWith(async () => ({ status: 200, headers: {}, body: new TextEncoder().encode('ID3fixture-audio') }), async () => undefined, 0, () => ({ ...config(), enabled: false }))
    await expect(command(host, 'batch.start')).rejects.toThrow(/disabled/)
    await expect(command(host, 'authoring.generate', { noteIds: ['note-1'] })).rejects.toThrow(/disabled/)
    await expect(authoringAction(host, 'note-1')).rejects.toThrow(/disabled/)
    await expect(authoringStatus(host)).resolves.toMatchObject({ available: false, configured: false, reason: expect.stringMatching(/disabled/i) })
  })

  it('enables the Create action only for a matching generated track with provider credentials', async () => {
    const host = hostWith(async () => ({ status: 200, headers: {}, body: new Uint8Array() }))
    await expect(authoringStatus(host)).resolves.toMatchObject({ available: true, configured: true, selectionLabel: expect.stringContaining('Prompt') })
    host.secrets.read = async (keys) => Object.fromEntries(keys.map((key) => [key, null]))
    await expect(authoringStatus(host)).resolves.toMatchObject({ available: false, configured: false, reason: expect.stringMatching(/credentials/i) })
  })

  it('completes the host-rendered authoring action for exactly the saved item', async () => {
    const operationIds: string[] = []
    const host = hostWith(async (request) => { operationIds.push(request.operationId); return { status: 200, headers: { 'content-type': 'audio/mpeg' }, body: new TextEncoder().encode('ID3fixture-audio') } })
    await expect(authoringAction<{ generated: number; itemId: string; mediaIds: string[] }>(host, 'note-2', 'create-note-2')).resolves.toMatchObject({ state: 'completed', itemId: 'note-2', generated: 1, mediaIds: ['media-tts:create-note-2:prompt'] })
    expect(operationIds).toEqual(['tts:create-note-2:prompt'])
  })

  it('limits authoring generation to the saved note ids provided by the host', async () => {
    const host = hostWith(async () => ({ status: 200, headers: { 'content-type': 'audio/mpeg' }, body: new TextEncoder().encode('ID3fixture-audio') }))
    const started = await command<PublicBatchJob>(host, 'authoring.generate', { noteIds: ['note-2'] })
    let status = started
    await waitFor(async () => { status = await command<PublicBatchJob>(host, 'batch.status', { jobId: started.id }); return status.state !== 'running' })
    expect(status).toMatchObject({ state: 'completed', completed: 1, total: 1, generated: 1, failures: 0 })
  })

  it('retries only notes that failed in a terminal batch', async () => {
    let failing = true
    const host = hostWith(async () => {
      if (failing) throw new Error('Temporary provider failure.')
      return { status: 200, headers: { 'content-type': 'audio/mpeg' }, body: new TextEncoder().encode('ID3fixture-audio') }
    }, async () => undefined, 0, () => ({ ...config(), batchRetries: 0 }))
    const started = await command<PublicBatchJob>(host, 'authoring.generate', { noteIds: ['note-1'] })
    let failed = started
    await waitFor(async () => { failed = await command<PublicBatchJob>(host, 'batch.status', { jobId: started.id }); return failed.state !== 'running' })
    expect(failed).toMatchObject({ state: 'completed', failedNotes: 1, canRetry: true })
    failing = false
    const retried = await command<PublicBatchJob>(host, 'batch.retry', { jobId: failed.id })
    let completed = retried
    await waitFor(async () => { completed = await command<PublicBatchJob>(host, 'batch.status', { jobId: retried.id }); return completed.state !== 'running' })
    expect(completed).toMatchObject({ state: 'completed', total: 1, generated: 1, failures: 0, canRetry: false })
  })

  it('reports note-scoped authoring status and exercises configuration commands', async () => {
    const mutations: unknown[] = []
    const host = hostWith(async () => ({ status: 200, headers: {}, body: new Uint8Array() }))
    host.secrets.mutate = async (operations) => { mutations.push(...operations) }

    await expect(command(host, 'config.get')).resolves.toMatchObject({ enabled: true })
    await expect(command(host, 'config.save', { config: config() })).resolves.toMatchObject({ enabled: true })
    await expect(command(host, 'secret.status', { provider: 'openai' })).resolves.toEqual({ configured: true })
    await expect(command(host, 'secret.set', { provider: 'openai', value: 'replacement' })).resolves.toEqual({ configured: true })
    await expect(command(host, 'secret.delete', { provider: 'openai' })).resolves.toEqual({ configured: false })
    expect(mutations).toHaveLength(2)

    await expect(command(host, 'authoring.status')).resolves.toMatchObject({ eligibleNotes: 0, eligibleTracks: 0 })
    await expect(command(host, 'authoring.status', { noteIds: ['note-1', '', 'note-1'] })).resolves.toMatchObject({ enabled: true, eligibleNotes: 1, eligibleTracks: 1 })
    await expect(command(host, 'review.get', { noteId: 'note-1' })).resolves.toMatchObject({ note: { noteId: 'note-1' }, currentTrackIds: [] })
    await expect(command(host, 'not-a-command')).rejects.toThrow(/unsupported/i)
  })
})
