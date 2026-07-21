import { createSandboxedUiClient } from '@neo-anki/extension-sdk'
import { onPrimaryColor } from './appearance.js'
import type { ProviderId, VoiceOption } from './types.js'

const style = document.createElement('style')
style.textContent = `:root{color-scheme:light dark;font:var(--neo-font-size,16px)/var(--neo-line-height,1.5) var(--neo-font-family,Inter,ui-sans-serif,system-ui,sans-serif);--text:var(--neo-text,#26241f);--muted:var(--neo-text-soft,#69655d);--surface:var(--neo-surface,#fbfaf7);--surface-strong:var(--neo-surface-strong,#fff);--border:var(--neo-border,#ddd8ce);--border-strong:var(--neo-border-strong,#c9c2b6);--primary:var(--neo-primary,#6246a5);--on-primary:${onPrimaryColor};--danger:var(--neo-danger,#a84343)}*{box-sizing:border-box}body{margin:0;color:var(--text);background:transparent}main{max-width:860px;padding:4px}h2,h3{margin:.2rem 0 .55rem}h2{font-family:ui-serif,Georgia,Cambria,serif}p{margin:.35rem 0 1rem;color:var(--muted);max-width:70ch}.panel{border:1px solid var(--border);border-radius:var(--neo-radius-lg,12px);padding:18px;margin:12px 0;background:var(--surface)}.row{display:flex;flex-wrap:wrap;gap:10px;align-items:end}label{display:grid;gap:5px;font-weight:650;min-width:min(100%,240px)}select,button{min-height:44px;font:inherit;border-radius:var(--neo-radius-md,10px)}select{padding:8px 34px 8px 10px;border:1px solid var(--border-strong);background:var(--surface-strong);color:inherit}button{padding:8px 14px;border:1px solid var(--primary);background:var(--primary);color:var(--on-primary);font-weight:700;cursor:pointer}button.secondary{background:transparent;color:var(--primary)}button.danger{border-color:var(--danger);background:transparent;color:var(--danger)}button:disabled{opacity:.55;cursor:not-allowed}:focus-visible{outline:3px solid var(--neo-focus,color-mix(in srgb,var(--primary) 38%,transparent));outline-offset:2px}.status{min-height:24px;margin:12px 0 0;color:var(--text)}.voices{display:grid;gap:8px;margin:12px 0 0;padding:0;list-style:none}.voice{border:1px solid var(--border);border-radius:var(--neo-radius-sm,8px);padding:10px 12px;background:var(--surface-strong)}.voice strong,.voice code{display:block}.voice code{margin-top:3px;color:var(--muted);overflow-wrap:anywhere}@media(max-width:560px){main{padding:0}.panel{padding:14px}.row>*{width:100%}button,select{width:100%}}:root[data-theme=dark]{--text:var(--neo-text,#f1eee8);--muted:var(--neo-text-soft,#b9b4aa);--surface:var(--neo-surface,#242320);--surface-strong:var(--neo-surface-strong,#2e2c28);--border:var(--neo-border,#403d37);--border-strong:var(--neo-border-strong,#555047);--primary:var(--neo-primary,#a98de4);--danger:var(--neo-danger,#ee9595)}`
document.head.append(style)

const root = document.getElementById('root')!
root.innerHTML = `<main><h2>Text to Speech tools</h2><p>Run provider-dependent and generation workflows here. Configuration and credentials are managed separately under Extensions → Configure.</p><section class="panel" aria-labelledby="batch-title"><h3 id="batch-title">Generate portable audio</h3><p>Create missing or outdated audio for configured cloud tracks. Completed audio is kept if you stop a job.</p><div class="row"><button id="start-batch" type="button">Generate missing and outdated audio</button><button id="stop-batch" class="danger" type="button" disabled>Stop</button><button id="retry-batch" class="secondary" type="button" hidden>Retry failed notes</button></div><p id="batch-status" class="status" role="status" aria-live="polite">No generation job is running.</p></section><section class="panel" aria-labelledby="voices-title"><h3 id="voices-title">Provider connection and voices</h3><p>Load a provider's voice catalog. Remote catalogs also verify that provider's credential and connection; OpenAI's supported list is built in. Copy a voice ID into the declarative configuration form.</p><div class="row"><label for="provider">Provider<select id="provider"><option value="openai">OpenAI</option><option value="elevenlabs">ElevenLabs</option><option value="google">Google Cloud</option><option value="azure">Azure Speech</option><option value="system">System voices</option></select></label><button id="load-voices" type="button">Load voices</button></div><p id="voice-status" class="status" role="status" aria-live="polite"></p><ul id="voices" class="voices" aria-label="Available voices"></ul></section></main>`

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const batchStatus = byId<HTMLParagraphElement>('batch-status')
const voiceStatus = byId<HTMLParagraphElement>('voice-status')
const startButton = byId<HTMLButtonElement>('start-batch')
const stopButton = byId<HTMLButtonElement>('stop-batch')
const retryButton = byId<HTMLButtonElement>('retry-batch')
const loadVoicesButton = byId<HTMLButtonElement>('load-voices')
let pollTimer = 0
let jobId = ''

interface BatchJob {
  id: string
  state: 'running' | 'completed' | 'cancelled' | 'failed'
  completed: number
  total: number
  generated: number
  skipped: number
  failures: number
  error?: string
  canRetry?: boolean
}

const describeJob = (job: BatchJob) => `${job.state}: ${job.completed}/${job.total} notes · ${job.generated} generated · ${job.skipped} skipped · ${job.failures} failed${job.error ? ` · ${job.error}` : ''}`

void createSandboxedUiClient().then((client) => {
  document.documentElement.dataset.theme = client.init.theme
  const call = <T,>(commandId: string, payload?: unknown) => client.call<T>('command', { commandId, payload })

  const setJob = (job: BatchJob) => {
    jobId = job.id
    batchStatus.textContent = describeJob(job)
    const running = job.state === 'running'
    startButton.disabled = running
    stopButton.disabled = !running
    retryButton.hidden = !job.canRetry
    if (!running) window.clearTimeout(pollTimer)
  }

  const poll = async () => {
    if (!jobId) return
    try {
      const job = await call<BatchJob>('batch.status', { jobId })
      setJob(job)
      if (job.state === 'running') pollTimer = window.setTimeout(() => void poll(), 500)
    } catch (error) {
      batchStatus.textContent = error instanceof Error ? error.message : 'Generation status could not be loaded.'
      startButton.disabled = false
      stopButton.disabled = true
    }
  }

  startButton.onclick = async () => {
    startButton.disabled = true
    batchStatus.textContent = 'Starting generation…'
    try { setJob(await call<BatchJob>('batch.start')); void poll() }
    catch (error) { batchStatus.textContent = error instanceof Error ? error.message : 'Generation could not start.'; startButton.disabled = false }
  }
  stopButton.onclick = async () => {
    if (!jobId) return
    stopButton.disabled = true
    try { setJob(await call<BatchJob>('batch.cancel', { jobId })) }
    catch (error) { batchStatus.textContent = error instanceof Error ? error.message : 'Generation could not be stopped.'; stopButton.disabled = false }
  }
  retryButton.onclick = async () => {
    if (!jobId) return
    retryButton.disabled = true
    try { setJob(await call<BatchJob>('batch.retry', { jobId })); void poll() }
    catch (error) { batchStatus.textContent = error instanceof Error ? error.message : 'Failed notes could not be retried.' }
    finally { retryButton.disabled = false }
  }
  loadVoicesButton.onclick = async () => {
    loadVoicesButton.disabled = true
    voiceStatus.textContent = 'Loading voices…'
    byId<HTMLUListElement>('voices').replaceChildren()
    try {
      const provider = byId<HTMLSelectElement>('provider').value as ProviderId
      const voices: VoiceOption[] = provider === 'system' && 'speechSynthesis' in window
        ? window.speechSynthesis.getVoices().map((voice) => ({ id: voice.voiceURI, name: voice.name, language: voice.lang, provider, detail: voice.localService ? 'Local' : 'OS managed' }))
        : await call<VoiceOption[]>('voices.list', { provider })
      const items = voices.slice(0, 100).map((voice) => {
        const item = document.createElement('li'); item.className = 'voice'
        const name = document.createElement('strong'); name.textContent = voice.name
        const identifier = document.createElement('code'); identifier.textContent = voice.id
        const detail = document.createElement('span'); detail.textContent = [voice.language, voice.detail].filter(Boolean).join(' · ')
        item.append(name, identifier, detail)
        return item
      })
      byId<HTMLUListElement>('voices').replaceChildren(...items)
      voiceStatus.textContent = voices.length ? `${voices.length} voice${voices.length === 1 ? '' : 's'} available.` : 'The connection succeeded, but no voices were returned.'
    } catch (error) { voiceStatus.textContent = error instanceof Error ? error.message : 'Provider voices could not be loaded.' }
    finally { loadVoicesButton.disabled = false }
  }
  window.addEventListener('beforeunload', () => window.clearTimeout(pollTimer))
}).catch((error) => {
  batchStatus.textContent = error instanceof Error ? error.message : 'Text to Speech tools could not start.'
  startButton.disabled = true
  loadVoicesButton.disabled = true
})
