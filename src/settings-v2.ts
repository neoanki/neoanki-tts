import { createSandboxedUiClient } from '@neo-anki/extension-sdk'
import { DEFAULT_PROCESSING, normalizeConfig } from './config.js'
import { providerNames } from './providers.js'
import type { ProviderId, TtsConfig, TtsProfile, TtsTrack } from './types.js'

const style = document.createElement('style')
style.textContent = `:root{color-scheme:light dark;font:16px/1.5 system-ui,sans-serif}*{box-sizing:border-box}body{margin:0;color:#0f172a;background:#fff}main{padding:20px;max-width:980px}h2,h3{margin:.2rem 0 .6rem}p{margin:.35rem 0 1rem;color:#475569}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.panel{border:1px solid #cbd5e1;border-radius:12px;padding:16px;margin:12px 0}label{display:grid;gap:5px;font-weight:650;margin:8px 0}input,select,textarea,button{font:inherit}input,select,textarea{width:100%;min-height:44px;padding:9px 10px;border:1px solid #94a3b8;border-radius:8px;background:transparent;color:inherit}input[type=checkbox]{width:22px;min-height:22px}.check{display:flex;align-items:center;gap:8px}.row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}button{min-height:44px;padding:8px 14px;border-radius:8px;border:1px solid #2563eb;background:#2563eb;color:#fff;font-weight:700;cursor:pointer}button.secondary{background:transparent;color:#1d4ed8}button.danger{border-color:#b91c1c;background:transparent;color:#b91c1c}button:disabled{opacity:.55;cursor:not-allowed}:focus-visible{outline:3px solid #60a5fa;outline-offset:2px}.status{min-height:24px;margin-top:8px}.disclosure{border-left:4px solid #2563eb;padding:10px 12px;background:#eff6ff;color:#1e3a8a}.disclosure a{color:inherit;font-weight:700}.eyebrow{font-size:.8rem;text-transform:uppercase;letter-spacing:.08em;font-weight:750;color:#2563eb}.muted{font-size:.9rem;color:#64748b}:root[data-theme=dark] body{background:#0f172a;color:#f8fafc}:root[data-theme=dark] p,:root[data-theme=dark] .muted{color:#cbd5e1}:root[data-theme=dark] .panel{border-color:#475569}:root[data-theme=dark] .disclosure{background:#172554;color:#dbeafe}:root[data-theme=dark] button.secondary{color:#93c5fd}`
document.head.append(style)

const root = document.getElementById('root')!
root.innerHTML = `<main><div class="eyebrow">Isolated SDK v2 extension</div><h2>NeoAnki TTS</h2><p>Configure local system speech or generated audio without exposing credentials to the workspace.</p><div class="disclosure"><strong>AI voice disclosure.</strong> OpenAI and other cloud-provider tracks create AI-generated speech. Text for a selected track is sent to the named provider. Provider charges and retention terms apply; API keys stay encrypted on this device.</div><section class="panel" aria-labelledby="general-title"><h3 id="general-title">General</h3><div class="grid"><label class="check"><input id="enabled" type="checkbox"> Enable TTS</label><label>Concurrent requests<input id="concurrency" type="number" min="1" max="5"></label><label>Retries<input id="retries" type="number" min="0" max="5"></label></div></section><section class="panel" aria-labelledby="profile-title"><h3 id="profile-title">Profiles and tracks</h3><div class="grid"><label>Profile<select id="profile"></select></label><label>Priority<input id="priority" type="number" min="-1000" max="1000"></label><label>Name<input id="profile-name"></label><label>Collections (comma separated)<input id="collections"></label><label>Tags (comma separated)<input id="tags"></label><label>Track<select id="track"></select></label><label>Track name<input id="track-name"></label><label>Side<select id="side"><option value="prompt">Prompt</option><option value="answer">Answer</option></select></label><label>Source<select id="source"><option>prompt</option><option>answer</option><option>context</option><option>template</option></select></label><label>Provider<select id="provider"></select></label><label>Mode<select id="mode"><option value="realtime">Real-time</option><option value="generated">Generated and cached</option></select></label><label>Voice<input id="voice"></label><label>Language<input id="language"></label><label>Model<input id="model"></label><label>Speed<input id="speed" type="number" min="0.5" max="2" step="0.05"></label><label class="check"><input id="autoplay" type="checkbox"> Autoplay</label></div><p id="precedence" class="muted"></p><p id="overlaps" class="muted"></p><p id="provider-disclosure" class="disclosure"></p><div class="row"><button id="add-profile" class="secondary">Add profile</button><button id="add-track" class="secondary">Add track</button><button id="save">Save synchronized settings</button></div></section><section class="panel" aria-labelledby="credential-title"><h3 id="credential-title">Device-local provider credential</h3><div class="grid"><label>Provider<select id="secret-provider"></select></label><label>API key<input id="secret" type="password" autocomplete="off"></label></div><div class="row"><button id="save-secret">Save key</button><button id="delete-secret" class="danger">Delete key</button></div><p id="secret-status" class="status" role="status"></p></section><section class="panel" aria-labelledby="batch-title"><h3 id="batch-title">Portable audio generation</h3><p>Generated tracks are committed one note at a time, with at most the configured number of notes in flight. You can stop safely; completed notes remain usable.</p><div class="row"><button id="start-batch">Generate missing and stale audio</button><button id="stop-batch" class="danger" disabled>Stop</button></div><p id="batch-status" class="status" role="status" aria-live="polite"></p></section><p id="status" class="status" role="status" aria-live="polite"></p></main>`

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const input = (id: string) => byId<HTMLInputElement>(id)
const select = (id: string) => byId<HTMLSelectElement>(id)
const csv = (value: string) => [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))]
const option = (value: string, label = value) => { const item = document.createElement('option'); item.value = value; item.textContent = label; return item }
let config: TtsConfig
let jobId = ''
let pollTimer = 0
let consecutivePollFailures = 0
let configMutationBusy = false

const retentionLinks: Partial<Record<ProviderId, string>> = {
  openai: 'https://platform.openai.com/docs/models/default-usage-policies-by-endpoint',
  elevenlabs: 'https://elevenlabs.io/privacy-policy',
  google: 'https://cloud.google.com/text-to-speech/docs/data-logging',
  azure: 'https://learn.microsoft.com/en-us/azure/ai-foundry/responsible-ai/speech-service/text-to-speech/data-privacy-security',
}

for (const provider of Object.keys(providerNames) as ProviderId[]) select('provider').append(option(provider, providerNames[provider]))
for (const provider of Object.keys(providerNames).filter((value) => value !== 'system') as ProviderId[]) select('secret-provider').append(option(provider, providerNames[provider]))

const activeProfile = (): TtsProfile => config.profiles.find((value) => value.id === select('profile').value) || config.profiles[0]!
const activeTrack = (): TtsTrack => activeProfile().tracks.find((value) => value.id === select('track').value) || activeProfile().tracks[0]!
const writeTrack = () => {
  const track = activeTrack(); if (!track) return
  track.name = input('track-name').value.slice(0, 100); track.side = select('side').value as TtsTrack['side']; track.source = select('source').value as TtsTrack['source']; track.provider = select('provider').value as ProviderId; track.mode = select('mode').value as TtsTrack['mode']; track.voice = input('voice').value.slice(0, 200); track.language = input('language').value.slice(0, 50); track.model = input('model').value.slice(0, 200); track.speed = Number(input('speed').value); track.autoplay = input('autoplay').checked
}
const renderTrack = () => {
  const track = activeTrack(); if (!track) return
  input('track-name').value = track.name; select('side').value = track.side; select('source').value = track.source; select('provider').value = track.provider; select('mode').value = track.mode; input('voice').value = track.voice; input('language').value = track.language; input('model').value = track.model; input('speed').value = String(track.speed); input('autoplay').checked = track.autoplay
  const disclosure = byId('provider-disclosure'); const link = retentionLinks[track.provider]
  if (track.provider === 'system') disclosure.textContent = `System speech sends no text through this extension's cloud-provider API. The operating system may manage the selected voice online.`
  else {
    const heading = document.createElement('strong'); heading.textContent = 'Before generation: '
    const policy = document.createElement('a'); policy.href = link!; policy.target = '_blank'; policy.rel = 'noreferrer'; policy.textContent = "Review the provider's data-retention terms"
    disclosure.replaceChildren(heading, document.createTextNode(`the processed ${track.source} text is sent to ${providerNames[track.provider]} using model ${track.model || 'the provider default'}. Your provider account pays any charge. The API key remains encrypted and device-local. `), policy, document.createTextNode('.'))
  }
}
const renderProfile = () => {
  const profile = activeProfile(); input('priority').value = String(profile.priority); input('profile-name').value = profile.name; input('collections').value = profile.match.collections.join(', '); input('tags').value = profile.match.tags.join(', ')
  select('track').replaceChildren(...profile.tracks.map((track) => option(track.id, track.name))); renderTrack()
  const catchAll = !profile.match.collections.length && !profile.match.tags.length
  byId('precedence').textContent = catchAll ? 'Catch-all profile: always evaluated after specific matching profiles.' : `Specific profile · priority ${profile.priority}. Overlapping specific matches use priority, specificity, then name.`
  const overlaps = config.profiles.filter((candidate) => candidate.id !== profile.id && (!candidate.match.collections.length || !profile.match.collections.length || candidate.match.collections.some((collection) => profile.match.collections.includes(collection))))
  byId('overlaps').textContent = overlaps.length ? `May overlap: ${overlaps.map((candidate) => `${candidate.name} (priority ${candidate.priority})`).join(', ')}. Matching uses the precedence rule above.` : 'No other profile can match the same configured collections.'
}
const render = () => {
  input('enabled').checked = config.enabled; input('concurrency').value = String(config.batchConcurrency); input('retries').value = String(config.batchRetries)
  select('profile').replaceChildren(...config.profiles.map((profile) => option(profile.id, profile.name))); renderProfile()
}
const commitControls = () => {
  writeTrack(); const profile = activeProfile(); profile.name = input('profile-name').value.slice(0, 100); profile.priority = Number(input('priority').value); profile.match.collections = csv(input('collections').value); profile.match.tags = csv(input('tags').value)
  config.enabled = input('enabled').checked; config.batchConcurrency = Number(input('concurrency').value); config.batchRetries = Number(input('retries').value); config = normalizeConfig(config)
}

void createSandboxedUiClient().then(async (client) => {
  document.documentElement.dataset.theme = client.init.theme
  const call = <T,>(commandId: string, payload?: unknown) => client.call<T>('command', { commandId, payload })
  config = normalizeConfig(await call('config.get')); render()
  const setConfigMutationBusy = (busy: boolean) => {
    configMutationBusy = busy
    ;(byId('save') as HTMLButtonElement).disabled = busy
    ;(byId('start-batch') as HTMLButtonElement).disabled = busy || Boolean(jobId)
  }
  select('profile').onchange = renderProfile; select('track').onchange = renderTrack; select('provider').onchange = () => { writeTrack(); renderTrack() }; select('source').onchange = () => { writeTrack(); renderTrack() }; input('model').oninput = () => { writeTrack(); renderTrack() }
  byId('add-profile').onclick = () => { commitControls(); const baseTrack = structuredClone(config.profiles[0]!.tracks[0]!); const profile: TtsProfile = { id: crypto.randomUUID(), name: `Profile ${config.profiles.length + 1}`, enabled: true, priority: config.profiles.length, match: { collections: [], tags: [] }, processing: structuredClone(DEFAULT_PROCESSING), tracks: [{ ...baseTrack, id: crypto.randomUUID() }] }; config.profiles.push(profile); render(); select('profile').value = profile.id; renderProfile() }
  byId('add-track').onclick = () => { writeTrack(); const profile = activeProfile(); const track: TtsTrack = { ...structuredClone(profile.tracks[0]!), id: crypto.randomUUID(), name: `Track ${profile.tracks.length + 1}` }; profile.tracks.push(track); renderProfile(); select('track').value = track.id; renderTrack() }
  byId('save').onclick = async () => {
    if (configMutationBusy || jobId) return
    setConfigMutationBusy(true)
    byId('status').textContent = 'Saving synchronized settings…'
    try { commitControls(); config = normalizeConfig(await call('config.save', { config })); render(); byId('status').textContent = 'Settings saved to the encrypted workspace.' }
    catch (error) { byId('status').textContent = error instanceof Error ? error.message : 'Save failed.' }
    finally { setConfigMutationBusy(false) }
  }
  const refreshSecret = async () => {
    const provider = select('secret-provider').value
    try {
      const state = await call<{ configured: boolean }>('secret.status', { provider })
      byId('secret-status').textContent = state.configured ? `${providerNames[provider as ProviderId]} key is configured on this device.` : 'No key is stored for this provider.'
    } catch (error) {
      byId('secret-status').textContent = error instanceof Error ? error.message : 'Credential status is unavailable.'
    }
  }
  select('secret-provider').onchange = () => void refreshSecret(); await refreshSecret()
  byId('save-secret').onclick = async () => { try { await call('secret.set', { provider: select('secret-provider').value, value: input('secret').value }); input('secret').value = ''; await refreshSecret() } catch (error) { byId('secret-status').textContent = error instanceof Error ? error.message : 'Credential save failed.' } }
  byId('delete-secret').onclick = async () => { try { await call('secret.delete', { provider: select('secret-provider').value }); input('secret').value = ''; await refreshSecret() } catch (error) { byId('secret-status').textContent = error instanceof Error ? error.message : 'Credential deletion failed.' } }
  const finishPolling = () => {
    jobId = ''
    consecutivePollFailures = 0
    ;(byId('start-batch') as HTMLButtonElement).disabled = configMutationBusy
    ;(byId('stop-batch') as HTMLButtonElement).disabled = true
  }
  const poll = async () => {
    if (!jobId) return
    try {
      const job = await call<{ state: string; completed: number; total: number; generated: number; skipped: number; failures: number; error?: string }>('batch.status', { jobId })
      consecutivePollFailures = 0
      byId('batch-status').textContent = `${job.state}: ${job.completed}/${job.total} notes · ${job.generated} generated · ${job.skipped} skipped · ${job.failures} failed${job.error ? ` · last error: ${job.error}` : ''}`
      if (job.state === 'running') pollTimer = window.setTimeout(() => void poll(), 500)
      else finishPolling()
    } catch (error) {
      consecutivePollFailures += 1
      const message = error instanceof Error ? error.message : 'Batch status is temporarily unavailable.'
      if (consecutivePollFailures >= 10) {
        byId('batch-status').textContent = `Status checks failed after ${consecutivePollFailures} attempts: ${message}`
        finishPolling()
      } else {
        byId('batch-status').textContent = `Waiting for batch status (attempt ${consecutivePollFailures + 1} of 10)…`
        pollTimer = window.setTimeout(() => void poll(), Math.min(2_000, 250 * 2 ** (consecutivePollFailures - 1)))
      }
    }
  }
  byId('start-batch').onclick = async () => {
    if (configMutationBusy || jobId) return
    setConfigMutationBusy(true)
    try { commitControls(); config = normalizeConfig(await call('config.save', { config })); const job = await call<{ id: string }>('batch.start'); jobId = job.id; consecutivePollFailures = 0; (byId('stop-batch') as HTMLButtonElement).disabled = false; void poll() }
    catch (error) { byId('batch-status').textContent = error instanceof Error ? error.message : 'Batch could not start.' }
    finally { setConfigMutationBusy(false) }
  }
  byId('stop-batch').onclick = async () => {
    if (!jobId) return
    try { await call('batch.cancel', { jobId }) }
    catch (error) { byId('batch-status').textContent = error instanceof Error ? error.message : 'Batch cancellation failed.' }
  }
  window.addEventListener('beforeunload', () => window.clearTimeout(pollTimer))
})
