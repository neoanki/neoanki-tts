import { useEffect, useMemo, useRef, useState } from 'react'
import type { ExtensionSettingsPanelProps, KnowledgeItem } from '@neo-anki/extension-sdk'
import { CONFIG_CHANGED_EVENT, DEFAULT_PROCESSING, loadConfig, profileMatches, saveConfig } from './config.js'
import { generateTrackPayload, isCurrent } from './generation.js'
import { listVoices, providerNames, providerSecretKey, synthesizeWithFallback, dataUrl } from './providers.js'
import { speakWithSystem, stopSystemSpeech } from './system-speech.js'
import { textForTrack } from './text.js'
import { TtsStyles } from './styles.js'
import type { AttachAudioPayload } from './media.js'
import type { ProviderId, TtsConfig, TtsProfile, TtsTrack, VoiceOption } from './types.js'

type Tab = 'overview' | 'profiles' | 'providers' | 'generate'
const cloudProviders: Array<Exclude<ProviderId, 'system'>> = ['openai', 'elevenlabs', 'google', 'azure']

const Toggle = ({ checked, onChange, children }: { checked: boolean; onChange(value: boolean): void; children: React.ReactNode }) => <label className="tts-check"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)}/>{children}</label>
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => <label className="tts-field"><span>{label}</span>{children}</label>

const Overview = ({ config, configured, setTab, exportConfig, importConfig }: { config: TtsConfig; configured: Record<string, boolean>; setTab(tab: Tab): void; exportConfig(): void; importConfig(): void }) => {
  const generatedTracks = config.profiles.flatMap((profile) => profile.tracks).filter((track) => track.mode === 'generated').length
  return <div style={{ display: 'grid', gap: 14 }}>
    <div className="tts-grid three">
      <div className="tts-card"><h3>{config.profiles.length} profiles</h3><p>Collection and tag rules choose the right voices automatically.</p></div>
      <div className="tts-card"><h3>{generatedTracks} generated tracks</h3><p>Portable audio is cached in the workspace and syncs with cards.</p></div>
      <div className="tts-card"><h3>{Object.values(configured).filter(Boolean).length} cloud providers ready</h3><p>Keys stay encrypted in the operating system’s credential storage.</p></div>
    </div>
    <div className="tts-card">
      <h3>Set up high-quality audio</h3>
      <p>1. Add one provider key. 2. Choose voices for the prompt and answer tracks. 3. Preview the profile. 4. Generate missing or stale audio in one batch.</p>
      <div className="tts-row" style={{ marginTop: 12 }}><button className="tts-button" onClick={() => setTab('providers')}>Configure providers</button><button className="tts-button" onClick={() => setTab('profiles')}>Edit profiles</button><button className="tts-button primary" onClick={() => setTab('generate')}>Generate audio</button></div>
    </div>
    <div className="tts-card"><h3>Real-time and generated audio coexist</h3><p>Use free system voices for instant playback, cloud voices on demand, or generated files for consistent offline reviews. Each profile can mix modes and providers per side.</p></div>
    <div className="tts-card"><div className="tts-between"><div><h3>Portable configuration</h3><p>Export profiles and text rules as JSON or restore them on another device. API keys are deliberately excluded.</p></div><div className="tts-row"><button className="tts-button" onClick={importConfig}>Import config</button><button className="tts-button" onClick={exportConfig}>Export config</button></div></div></div>
  </div>
}

const Providers = ({ config, update, host, configured, refreshConfigured }: { config: TtsConfig; update(next: TtsConfig): void; host: ExtensionSettingsPanelProps['host']; configured: Record<string, boolean>; refreshConfigured(): Promise<void> }) => {
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState('')
  const saveKey = async (provider: Exclude<ProviderId, 'system'>) => {
    const key = keys[provider]?.trim()
    if (!key) { setMessage(`Enter a ${providerNames[provider]} API key first.`); return }
    setBusy(provider); setMessage('')
    try { await host.secrets.set(providerSecretKey(provider), key); setKeys((current) => ({ ...current, [provider]: '' })); await refreshConfigured(); setMessage(`${providerNames[provider]} credentials saved securely.`) }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save credentials.') }
    finally { setBusy('') }
  }
  const removeKey = async (provider: Exclude<ProviderId, 'system'>) => {
    setBusy(provider); setMessage('')
    try { await host.secrets.delete(providerSecretKey(provider)); await refreshConfigured(); setMessage(`${providerNames[provider]} credentials removed.`) }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not remove credentials.') }
    finally { setBusy('') }
  }
  const test = async (provider: Exclude<ProviderId, 'system'>) => {
    setBusy(provider); setMessage('')
    try { const voices = await listVoices(provider, host, config.providers); setMessage(`${providerNames[provider]} connected. ${voices.length} voices available.`) }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Connection failed.') }
    finally { setBusy('') }
  }
  const providerCard = (provider: Exclude<ProviderId, 'system'>, description: string) => <div className="tts-card" key={provider}>
    <div className="tts-between"><div><h3>{providerNames[provider]}</h3><p>{description}</p></div><span className="tts-provider-state"><span className={`tts-dot ${configured[provider] ? 'on' : ''}`}/>{configured[provider] ? 'Configured' : 'Not configured'}</span></div>
    <div className="tts-row" style={{ marginTop: 12 }}>
      <label className="tts-field" style={{ flex: '1 1 240px' }}><span>API key</span><input type="password" autoComplete="off" value={keys[provider] || ''} onChange={(event) => setKeys((current) => ({ ...current, [provider]: event.target.value }))} placeholder={configured[provider] ? 'Saved — enter a replacement' : 'Paste API key'}/></label>
      <button className="tts-button primary" disabled={busy === provider} onClick={() => void saveKey(provider)}>{busy === provider ? 'Working…' : 'Save key'}</button>
      {configured[provider] && <><button className="tts-button" disabled={busy === provider} onClick={() => void test(provider)}>Test</button><button className="tts-button danger" disabled={busy === provider} onClick={() => void removeKey(provider)}>Remove</button></>}
    </div>
  </div>
  return <div style={{ display: 'grid', gap: 12 }}>
    {host.platform !== 'desktop' && <p className="tts-status" role="alert">Cloud providers require the Neo Anki desktop app so keys and requests stay behind the host capability boundary.</p>}
    {providerCard('openai', 'Expressive multilingual speech with optional style instructions.')}
    {providerCard('elevenlabs', 'Large voice library with natural multilingual models.')}
    {providerCard('google', 'Broad language coverage and predictable neural voices.')}
    {providerCard('azure', 'Regional neural speech with extensive locale support.')}
    <div className="tts-grid">
      <Field label="Default OpenAI model"><input value={config.providers.openaiModel} onChange={(event) => update({ ...config, providers: { ...config.providers, openaiModel: event.target.value } })}/></Field>
      <Field label="Default ElevenLabs model"><input value={config.providers.elevenLabsModel} onChange={(event) => update({ ...config, providers: { ...config.providers, elevenLabsModel: event.target.value } })}/></Field>
      <Field label="Azure region"><input value={config.providers.azureRegion} onChange={(event) => update({ ...config, providers: { ...config.providers, azureRegion: event.target.value } })}/></Field>
      <Field label="Default Azure voice"><input value={config.providers.azureVoice} onChange={(event) => update({ ...config, providers: { ...config.providers, azureVoice: event.target.value } })}/></Field>
    </div>
    <p className="tts-status" role={message && /failed|could not|not configured/i.test(message) ? 'alert' : 'status'} aria-live="polite">{message}</p>
  </div>
}

const TrackEditor = ({ track, profile, item, providers, host, update, remove }: { track: TtsTrack; profile: TtsProfile; item?: KnowledgeItem; providers: TtsConfig['providers']; host: ExtensionSettingsPanelProps['host']; update(track: TtsTrack): void; remove(): void }) => {
  const [voices, setVoices] = useState<VoiceOption[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const load = async () => { setBusy(true); setMessage(''); try { const next = await listVoices(track.provider, host, providers); setVoices(next); setMessage(`${next.length} voices loaded.`) } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not load voices.') } finally { setBusy(false) } }
  const preview = async () => {
    if (!item) { setMessage('No knowledge item matches this profile.'); return }
    const text = textForTrack(track, item, profile.processing)
    if (!text) { setMessage('This track produces empty text.'); return }
    setBusy(true); setMessage('Generating preview…')
    try {
      if (track.provider === 'system') { speakWithSystem(track, text, () => { setBusy(false); setMessage('Preview complete.') }, setMessage); return }
      const result = await synthesizeWithFallback(host, track, text, providers)
      audioRef.current?.pause(); const audio = new Audio(dataUrl(result)); audioRef.current = audio
      audio.onended = () => { setBusy(false); setMessage('Preview complete.') }; audio.onerror = () => { setBusy(false); setMessage('Could not play the generated preview.') }; await audio.play()
    } catch (error) { setBusy(false); setMessage(error instanceof Error ? error.message : 'Preview failed.') }
  }
  return <div className="tts-track">
    <div className="tts-track-head"><strong>{track.name || 'Untitled track'}</strong><button className="tts-button danger" onClick={remove}>Remove</button></div>
    <div className="tts-grid three">
      <Field label="Track name"><input value={track.name} onChange={(event) => update({ ...track, name: event.target.value })}/></Field>
      <Field label="Plays on"><select value={track.side} onChange={(event) => update({ ...track, side: event.target.value as TtsTrack['side'] })}><option value="prompt">Prompt</option><option value="answer">Answer</option></select></Field>
      <Field label="Source"><select value={track.source} onChange={(event) => update({ ...track, source: event.target.value as TtsTrack['source'] })}><option value="prompt">Prompt field</option><option value="answer">Answer field</option><option value="context">Context field</option><option value="template">Template</option></select></Field>
    </div>
    {track.source === 'template' && <Field label="Template — use {{prompt}}, {{answer}}, {{context}}, {{collection}}, {{tags}}"><textarea value={track.template} onChange={(event) => update({ ...track, template: event.target.value })}/></Field>}
    <div className="tts-grid three">
      <Field label="Provider"><select value={track.provider} onChange={(event) => { const provider = event.target.value as ProviderId; update({ ...track, provider, mode: provider === 'system' ? 'realtime' : track.mode }) }}>{Object.entries(providerNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></Field>
      <Field label="Mode"><select value={track.mode} disabled={track.provider === 'system'} onChange={(event) => update({ ...track, mode: event.target.value as TtsTrack['mode'] })}><option value="realtime">Real-time</option><option value="generated">Generated & synced</option></select></Field>
      <Field label="Language"><input value={track.language} onChange={(event) => update({ ...track, language: event.target.value })} placeholder="auto or en-US"/></Field>
    </div>
    <div className="tts-grid three">
      <Field label="Voice ID"><input list={`voices-${profile.id}-${track.id}`} value={track.voice} onChange={(event) => update({ ...track, voice: event.target.value })} placeholder="Best match or voice ID"/><datalist id={`voices-${profile.id}-${track.id}`}>{voices.map((voice) => <option key={`${voice.id}:${voice.language}`} value={voice.id}>{voice.name} · {voice.language}</option>)}</datalist></Field>
      <Field label="Model override"><input value={track.model} onChange={(event) => update({ ...track, model: event.target.value })} placeholder="Use provider default"/></Field>
      <Field label={`Speed · ${track.speed.toFixed(2)}×`}><input type="range" min="0.5" max="2" step="0.05" value={track.speed} onChange={(event) => update({ ...track, speed: Number(event.target.value) })}/></Field>
    </div>
    {track.provider === 'openai' && <Field label="Style instructions (optional)"><textarea value={track.instructions} onChange={(event) => update({ ...track, instructions: event.target.value })} placeholder="Speak clearly, warmly, and leave a short pause after the phrase."/></Field>}
    <details className="tts-card"><summary style={{ cursor: 'pointer', fontWeight: 750, minHeight: 32 }}>Voice selection & fallback</summary>
      <div className="tts-grid" style={{ marginTop: 12 }}><Field label="Selection strategy"><select value={track.voiceMode} onChange={(event) => update({ ...track, voiceMode: event.target.value as TtsTrack['voiceMode'] })}><option value="single">Primary only</option><option value="priority">Priority fallback</option><option value="random">Random voice</option></select></Field><p className="tts-muted">Priority tries each target until one succeeds. Random rotates voices while retaining fallbacks on provider errors.</p></div>
      {track.fallbacks.map((fallback) => <div className="tts-grid three" key={fallback.id} style={{ marginTop: 10 }}><Field label="Provider"><select value={fallback.provider} onChange={(event) => update({ ...track, fallbacks: track.fallbacks.map((candidate) => candidate.id === fallback.id ? { ...candidate, provider: event.target.value as ProviderId } : candidate) })}>{Object.entries(providerNames).filter(([id]) => id !== 'system').map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></Field><Field label="Voice ID"><input value={fallback.voice} onChange={(event) => update({ ...track, fallbacks: track.fallbacks.map((candidate) => candidate.id === fallback.id ? { ...candidate, voice: event.target.value } : candidate) })}/></Field><div className="tts-row"><Field label="Model"><input value={fallback.model} onChange={(event) => update({ ...track, fallbacks: track.fallbacks.map((candidate) => candidate.id === fallback.id ? { ...candidate, model: event.target.value } : candidate) })}/></Field><button className="tts-button danger" onClick={() => update({ ...track, fallbacks: track.fallbacks.filter((candidate) => candidate.id !== fallback.id) })}>Remove</button></div></div>)}
      <button className="tts-button" style={{ marginTop: 10 }} onClick={() => update({ ...track, voiceMode: track.voiceMode === 'single' ? 'priority' : track.voiceMode, fallbacks: [...track.fallbacks, { id: crypto.randomUUID(), provider: track.provider === 'system' ? 'openai' : track.provider, voice: '', model: '' }] })}>Add fallback voice</button>
    </details>
    <div className="tts-between"><Toggle checked={track.autoplay} onChange={(autoplay) => update({ ...track, autoplay })}>Play automatically during review</Toggle><div className="tts-row"><button className="tts-button" disabled={busy} onClick={() => void load()}>{busy ? 'Working…' : 'Load voices'}</button><button className="tts-button primary" disabled={busy} onClick={() => void preview()}>Preview</button></div></div>
    <p className="tts-status" aria-live="polite">{message}</p>
  </div>
}

const Profiles = ({ config, update, data, host }: { config: TtsConfig; update(next: TtsConfig): void; data: ExtensionSettingsPanelProps['data']; host: ExtensionSettingsPanelProps['host'] }) => {
  const [selectedId, setSelectedId] = useState(config.profiles[0]?.id || '')
  const profile = config.profiles.find((candidate) => candidate.id === selectedId) || config.profiles[0]
  useEffect(() => { if (profile && profile.id !== selectedId) setSelectedId(profile.id) }, [profile, selectedId])
  if (!profile) return null
  const replace = (next: TtsProfile) => update({ ...config, profiles: config.profiles.map((candidate) => candidate.id === profile.id ? next : candidate) })
  const matchedItem = data.items.find((item) => profileMatches(profile, item))
  const addProfile = () => { const id = crypto.randomUUID(); const next = { id, name: 'New profile', enabled: true, match: { collections: [], tags: [] }, processing: structuredClone(DEFAULT_PROCESSING), tracks: [] }; update({ ...config, profiles: [...config.profiles, next] }); setSelectedId(id) }
  const addTrack = () => replace({ ...profile, tracks: [...profile.tracks, { id: crypto.randomUUID(), name: 'New track', side: 'prompt', source: 'prompt', template: '', provider: 'system', mode: 'realtime', voice: '', language: 'auto', model: '', speed: 1, autoplay: true, instructions: '', voiceMode: 'single', fallbacks: [] }] })
  return <div style={{ display: 'grid', gap: 14 }}>
    <div className="tts-between"><div className="tts-row"><Field label="Profile"><select value={profile.id} onChange={(event) => setSelectedId(event.target.value)}>{config.profiles.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></Field><button className="tts-button" onClick={addProfile}>New profile</button></div>{config.profiles.length > 1 && <button className="tts-button danger" onClick={() => { const remaining = config.profiles.filter((candidate) => candidate.id !== profile.id); update({ ...config, profiles: remaining }); setSelectedId(remaining[0]?.id || '') }}>Delete profile</button>}</div>
    <div className="tts-card">
      <div className="tts-grid three">
        <Field label="Profile name"><input value={profile.name} onChange={(event) => replace({ ...profile, name: event.target.value })}/></Field>
        <Field label="Collections (comma separated)"><input value={profile.match.collections.join(', ')} onChange={(event) => replace({ ...profile, match: { ...profile.match, collections: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) } })} placeholder="Spanish, Japanese"/></Field>
        <Field label="Required tags (comma separated)"><input value={profile.match.tags.join(', ')} onChange={(event) => replace({ ...profile, match: { ...profile.match, tags: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) } })} placeholder="pronunciation"/></Field>
      </div>
      <Toggle checked={profile.enabled} onChange={(enabled) => replace({ ...profile, enabled })}>Profile enabled · first matching profile wins during review</Toggle>
    </div>
    <div className="tts-between"><div><strong style={{ fontSize: '.85rem' }}>Audio tracks</strong><p className="tts-muted">Generate several sides and languages in one job. Generated tracks are portable; real-time tracks are synthesized when reviewed.</p></div><button className="tts-button primary" onClick={addTrack}>Add track</button></div>
    {profile.tracks.map((track) => <TrackEditor key={track.id} track={track} profile={profile} item={matchedItem} providers={config.providers} host={host} update={(next) => replace({ ...profile, tracks: profile.tracks.map((candidate) => candidate.id === track.id ? next : candidate) })} remove={() => replace({ ...profile, tracks: profile.tracks.filter((candidate) => candidate.id !== track.id) })}/>) }
    {!profile.tracks.length && <div className="tts-card"><h3>No tracks yet</h3><p>Add a prompt or answer track to make this profile useful.</p></div>}
    <details className="tts-card"><summary style={{ cursor: 'pointer', fontWeight: 750, minHeight: 32 }}>Text processing</summary><div className="tts-grid" style={{ marginTop: 12 }}><Toggle checked={profile.processing.stripHtml} onChange={(stripHtml) => replace({ ...profile, processing: { ...profile.processing, stripHtml } })}>Strip HTML</Toggle><Toggle checked={profile.processing.unwrapCloze} onChange={(unwrapCloze) => replace({ ...profile, processing: { ...profile.processing, unwrapCloze } })}>Unwrap cloze syntax</Toggle><Toggle checked={profile.processing.removeSoundTags} onChange={(removeSoundTags) => replace({ ...profile, processing: { ...profile.processing, removeSoundTags } })}>Remove existing sound tags</Toggle><Toggle checked={profile.processing.removeBrackets} onChange={(removeBrackets) => replace({ ...profile, processing: { ...profile.processing, removeBrackets } })}>Remove bracketed text</Toggle></div>
      <div className="tts-divider"/>{profile.processing.replacements.map((rule) => <div className="tts-grid three" key={rule.id} style={{ marginTop: 10 }}><Field label="Find"><input value={rule.find} onChange={(event) => replace({ ...profile, processing: { ...profile.processing, replacements: profile.processing.replacements.map((candidate) => candidate.id === rule.id ? { ...candidate, find: event.target.value } : candidate) } })}/></Field><Field label="Replace with"><input value={rule.replace} onChange={(event) => replace({ ...profile, processing: { ...profile.processing, replacements: profile.processing.replacements.map((candidate) => candidate.id === rule.id ? { ...candidate, replace: event.target.value } : candidate) } })}/></Field><div className="tts-row"><Toggle checked={rule.regex} onChange={(regex) => replace({ ...profile, processing: { ...profile.processing, replacements: profile.processing.replacements.map((candidate) => candidate.id === rule.id ? { ...candidate, regex } : candidate) } })}>Regex</Toggle><button className="tts-button danger" onClick={() => replace({ ...profile, processing: { ...profile.processing, replacements: profile.processing.replacements.filter((candidate) => candidate.id !== rule.id) } })}>Remove</button></div></div>)}
      <button className="tts-button" style={{ marginTop: 10 }} onClick={() => replace({ ...profile, processing: { ...profile.processing, replacements: [...profile.processing.replacements, { id: crypto.randomUUID(), find: '', replace: '', regex: false, caseSensitive: false }] } })}>Add replacement rule</button>
    </details>
  </div>
}

const Generate = ({ config, data, host, runCommand }: { config: TtsConfig; data: ExtensionSettingsPanelProps['data']; host: ExtensionSettingsPanelProps['host']; runCommand: ExtensionSettingsPanelProps['runCommand'] }) => {
  const [profileId, setProfileId] = useState(config.profiles[0]?.id || '')
  const [stats, setStats] = useState({ total: 0, current: 0 })
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [running, setRunning] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const stopped = useRef(false)
  const profile = config.profiles.find((candidate) => candidate.id === profileId) || config.profiles[0]
  const items = useMemo(() => profile ? data.items.filter((item) => profileMatches(profile, item)) : [], [data.items, profile])
  const tracks = useMemo(() => profile ? profile.tracks.filter((track) => track.mode === 'generated' && track.provider !== 'system') : [], [profile])
  useEffect(() => {
    let alive = true
    void Promise.all(items.flatMap((item) => tracks.map((track) => isCurrent(item, profile!, track, config.providers)))).then((values) => { if (alive) setStats({ total: values.length, current: values.filter(Boolean).length }) })
    return () => { alive = false }
  }, [items, tracks, profile, config.providers])
  const run = async () => {
    if (!profile || !tracks.length) return
    const jobs = items.flatMap((item) => tracks.map((track) => ({ item, track })))
    stopped.current = false; setRunning(true); setLogs([]); setProgress({ done: 0, total: jobs.length })
    const payloads: AttachAudioPayload[] = []
    let cursor = 0
    const worker = async () => {
      while (!stopped.current) {
        const index = cursor++
        const job = jobs[index]
        if (!job) return
        try {
          if (config.skipCurrentAudio && await isCurrent(job.item, profile, job.track, config.providers)) { setProgress((value) => ({ ...value, done: value.done + 1 })); continue }
          const payload = await generateTrackPayload({ item: job.item, profile, track: job.track, providers: config.providers, host, retries: config.batchRetries, shouldStop: () => stopped.current })
          if (payload) payloads.push(payload)
        } catch (error) { if (!stopped.current) setLogs((current) => [...current.slice(-19), `${job.item.prompt.slice(0, 70)} · ${job.track.name}: ${error instanceof Error ? error.message : 'Generation failed.'}`]) }
        setProgress((value) => ({ ...value, done: value.done + 1 }))
      }
    }
    await Promise.all(Array.from({ length: Math.min(config.batchConcurrency, jobs.length) }, worker))
    if (payloads.length) for (let offset = 0; offset < payloads.length; offset += 20) await runCommand('neoanki-tts.attach-audio', { payloads: payloads.slice(offset, offset + 20) })
    setRunning(false)
    setLogs((current) => [...current, stopped.current ? `Stopped. Saved ${payloads.length} completed tracks.` : `Finished. Saved ${payloads.length} generated tracks.`])
  }
  if (!profile) return <p className="tts-status" role="alert">Create a profile first.</p>
  const percent = progress.total ? Math.round(progress.done / progress.total * 100) : 0
  return <div style={{ display: 'grid', gap: 14 }}>
    <div className="tts-grid">
      <Field label="Profile"><select value={profile.id} onChange={(event) => setProfileId(event.target.value)}>{config.profiles.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></Field>
      <div className="tts-card"><h3>{items.length} matching items · {tracks.length} generated tracks each</h3><p>{stats.current} of {stats.total} outputs are already current. Text or voice changes are detected automatically.</p></div>
    </div>
    {!tracks.length && <p className="tts-status" role="alert">This profile has no cloud track in “Generated & synced” mode.</p>}
    <div className="tts-grid"><Field label="Parallel requests"><input type="number" min="1" max="5" value={config.batchConcurrency} readOnly/></Field><Field label="Retries per failed request"><input type="number" min="0" max="5" value={config.batchRetries} readOnly/></Field></div>
    {running && <><div className="tts-progress" role="progressbar" aria-label="Audio generation progress" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}><span style={{ width: `${percent}%` }}/></div><p className="tts-status">{progress.done} / {progress.total} tracks · {percent}%</p></>}
    <div className="tts-row"><button className="tts-button primary" disabled={running || !tracks.length || !items.length} onClick={() => void run()}>{running ? 'Generating…' : config.skipCurrentAudio ? 'Generate missing & stale' : 'Regenerate all'}</button>{running && <button className="tts-button danger" onClick={() => { stopped.current = true }}>Stop after current requests</button>}</div>
    {logs.length > 0 && <ol className="tts-log" aria-label="Generation log">{logs.map((log, index) => <li key={`${index}:${log}`}>{log}</li>)}</ol>}
    <p className="tts-muted">Generation is idempotent: unchanged text and voice settings reuse the existing track. A changed track replaces only its previous attachment; shared audio remains deduplicated by content hash.</p>
  </div>
}

export const TtsSettingsPanel = ({ data, host, runCommand }: ExtensionSettingsPanelProps) => {
  const [config, setConfig] = useState(loadConfig)
  const [tab, setTab] = useState<Tab>('overview')
  const [configured, setConfigured] = useState<Record<string, boolean>>({})
  const [importMessage, setImportMessage] = useState('')
  const importRef = useRef<HTMLInputElement>(null)
  const update = (next: TtsConfig) => setConfig(saveConfig(next))
  const refreshConfigured = async () => {
    if (host.platform !== 'desktop') { setConfigured({}); return }
    const entries = await Promise.all(cloudProviders.map(async (provider) => [provider, await host.secrets.has(providerSecretKey(provider))] as const))
    setConfigured(Object.fromEntries(entries))
  }
  useEffect(() => { void refreshConfigured() }, [])
  useEffect(() => () => { stopSystemSpeech() }, [])
  const exportConfig = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 'neoanki-tts-config', version: 1, config }, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'neoanki-tts-config.json'; anchor.click(); URL.revokeObjectURL(url)
  }
  const importConfig = async (file?: File) => {
    if (!file) { importRef.current?.click(); return }
    try {
      const value = JSON.parse(await file.text()) as { format?: string; version?: number; config?: unknown }
      if (value.format !== 'neoanki-tts-config' || value.version !== 1 || !value.config) throw new Error('This is not a supported NeoAnki TTS configuration file.')
      setConfig(saveConfig(value.config as TtsConfig)); setImportMessage('Configuration imported. API keys were not changed.')
    } catch (error) { setImportMessage(error instanceof Error ? error.message : 'Could not import configuration.') }
    finally { if (importRef.current) importRef.current.value = '' }
  }
  return <section className="tts-shell" aria-labelledby="neoanki-tts-title">
    <TtsStyles/>
    <div className="tts-head"><div><h2 id="neoanki-tts-title">NeoAnki TTS</h2><p>Provider-grade speech, reusable profiles, deterministic batch generation, and offline review playback.</p></div><Toggle checked={config.enabled} onChange={(enabled) => update({ ...config, enabled })}>{config.enabled ? 'Enabled' : 'Disabled'}</Toggle></div>
    <div className="tts-tabs" role="tablist" aria-label="TTS settings sections">{([['overview', 'Overview'], ['profiles', 'Profiles & tracks'], ['providers', 'Providers'], ['generate', 'Generate']] as const).map(([id, label]) => <button className="tts-tab" role="tab" aria-selected={tab === id} key={id} onClick={() => setTab(id)}>{label}</button>)}</div>
    <div role="tabpanel">
      {tab === 'overview' && <Overview config={config} configured={configured} setTab={setTab} exportConfig={exportConfig} importConfig={() => void importConfig()}/>}
      {tab === 'profiles' && <Profiles config={config} update={update} data={data} host={host}/>}
      {tab === 'providers' && <Providers config={config} update={update} host={host} configured={configured} refreshConfigured={refreshConfigured}/>}
      {tab === 'generate' && <Generate config={config} data={data} host={host} runCommand={runCommand}/>}
    </div>
    {tab === 'generate' && <div className="tts-divider"/>}
    {tab === 'generate' && <div className="tts-grid"><Toggle checked={config.skipCurrentAudio} onChange={(skipCurrentAudio) => update({ ...config, skipCurrentAudio })}>Skip tracks whose text and settings are unchanged</Toggle><div className="tts-row"><Field label="Concurrency"><input type="number" min="1" max="5" value={config.batchConcurrency} onChange={(event) => update({ ...config, batchConcurrency: Number(event.target.value) })}/></Field><Field label="Retries"><input type="number" min="0" max="5" value={config.batchRetries} onChange={(event) => update({ ...config, batchRetries: Number(event.target.value) })}/></Field></div></div>}
    <input ref={importRef} className="visually-hidden" type="file" accept="application/json,.json" onChange={(event) => void importConfig(event.target.files?.[0])}/>
    {importMessage && <p className="tts-status" role="status">{importMessage}</p>}
    <span className="visually-hidden" aria-live="polite">Configuration saved automatically.</span>
  </section>
}
