import type { ExtensionContentNoteDto, ExtensionHostV2, WorkerContributionResponse } from '@neo-anki/extension-sdk'
import { DEFAULT_CONFIG } from './config.js'
import { ttsExtension } from './worker.js'

interface PublicBatchJob { id: string; state: 'running' | 'completed' | 'cancelled' | 'failed'; completed: number; total: number; generated: number; failures: number }

const command = async <T,>(host: ExtensionHostV2, commandId: string, payload: unknown = {}) => {
  const response: WorkerContributionResponse = await ttsExtension.handle!({ type: 'command', requestId: crypto.randomUUID(), commandId, payload }, host)
  if (response.type === 'error') throw new Error(response.message)
  if (response.type !== 'result') throw new Error('Unexpected worker response.')
  return response.value as T
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

const hostWith = (fetch: ExtensionHostV2['fetch'], cancel: ExtensionHostV2['cancel'] = async () => undefined, forcedRevisionConflicts = 0): ExtensionHostV2 => {
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
  config: { read: async <T = unknown>() => config() as T, write: async () => ({ workspaceRevision: 2 }) },
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
})
