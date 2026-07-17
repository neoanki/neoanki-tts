import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import type { ExtensionSettingsPanelProps } from '@neo-anki/extension-sdk'
import { DEFAULT_CONFIG, PRESETS, loadConfig, saveConfig, type SpeechSide, type TtsConfig } from './config.js'
import { SpeakerIcon, StopIcon } from './icons.js'
import { speak, stopSpeaking } from './speech.js'

const commonLanguages = [
  ['auto', 'Automatic'], ['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['es-ES', 'Spanish'],
  ['fr-FR', 'French'], ['de-DE', 'German'], ['it-IT', 'Italian'], ['pt-BR', 'Portuguese (Brazil)'],
  ['uk-UA', 'Ukrainian'], ['ru-RU', 'Russian'], ['ja-JP', 'Japanese'], ['ko-KR', 'Korean'],
  ['zh-CN', 'Chinese (Mandarin)'], ['ar-SA', 'Arabic'], ['he-IL', 'Hebrew'], ['hi-IN', 'Hindi'],
] as const

const fieldStyle: CSSProperties = { width: '100%', minHeight: 44, padding: '0 10px', border: '1px solid var(--border-strong)', borderRadius: 8, color: 'var(--text)', background: 'var(--surface-strong)', font: 'inherit' }
const twoColumn: CSSProperties = { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12, marginTop: 14 }
const smallLabel: CSSProperties = { display: 'grid', gap: 6, color: 'var(--text-soft)', fontSize: '.72rem', fontWeight: 700 }
const checkRow: CSSProperties = { minHeight: 44, display: 'flex', alignItems: 'center', gap: 10, fontSize: '.78rem', fontWeight: 650 }

const Toggle = ({ checked, onChange, children }: { checked: boolean; onChange(value: boolean): void; children: ReactNode }) => (
  <label style={checkRow}><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />{children}</label>
)

const useSystemVoices = () => {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => 'speechSynthesis' in window ? window.speechSynthesis.getVoices() : [])
  useEffect(() => {
    if (!('speechSynthesis' in window)) return
    const update = () => setVoices(window.speechSynthesis.getVoices())
    update()
    window.speechSynthesis.addEventListener('voiceschanged', update)
    return () => window.speechSynthesis.removeEventListener('voiceschanged', update)
  }, [])
  return voices
}

const VoiceSelect = ({ side, config, voices, update }: { side: SpeechSide; config: TtsConfig; voices: SpeechSynthesisVoice[]; update(patch: Partial<TtsConfig>): void }) => {
  const languageKey = side === 'prompt' ? 'promptLanguage' : 'answerLanguage'
  const voiceKey = side === 'prompt' ? 'promptVoiceURI' : 'answerVoiceURI'
  const language = config[languageKey]
  const visibleVoices = useMemo(() => language === 'auto' ? voices : voices.filter((voice) => voice.lang.toLowerCase().split('-')[0] === language.toLowerCase().split('-')[0]), [language, voices])
  return <div style={{ display: 'grid', gap: 10 }}>
    <label style={smallLabel}>{side === 'prompt' ? 'Prompt language' : 'Answer language'}
      <select style={fieldStyle} value={language} onChange={(event) => update({ [languageKey]: event.target.value, [voiceKey]: '' })}>{commonLanguages.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
    </label>
    <label style={smallLabel}>{side === 'prompt' ? 'Prompt voice' : 'Answer voice'}
      <select style={fieldStyle} value={config[voiceKey]} onChange={(event) => update({ [voiceKey]: event.target.value })}>
        <option value="">Best system match</option>
        {visibleVoices.map((voice) => <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name} · {voice.lang}{voice.localService ? ' · local' : ''}</option>)}
      </select>
    </label>
  </div>
}

export const TtsSettingsPanel = (_props: ExtensionSettingsPanelProps) => {
  const [config, setConfig] = useState(loadConfig)
  const [previewing, setPreviewing] = useState(false)
  const [message, setMessage] = useState('')
  const voices = useSystemVoices()
  const update = (patch: Partial<TtsConfig>) => {
    const next = { ...config, ...patch }
    setConfig(next)
    saveConfig(next)
    setMessage('Saved')
  }
  const preview = () => {
    if (previewing) { stopSpeaking(); setPreviewing(false); return }
    setMessage('')
    speak({ side: 'answer', text: 'Neo Anki will use this voice during your reviews.', config, onStart: () => setPreviewing(true), onEnd: () => setPreviewing(false), onError: setMessage })
  }

  return <div className="setting-block" aria-labelledby="tts-settings-title">
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
      <div><strong id="tts-settings-title">Text to speech</strong><p>Natural system voices, automatic language matching, and hands-free review playback.</p></div>
      <Toggle checked={config.enabled} onChange={(enabled) => update({ enabled })}>Enabled</Toggle>
    </div>

    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }} aria-label="Speech presets">
      {Object.entries(PRESETS).map(([id, preset]) => <button className="secondary-button compact" key={id} type="button" onClick={() => update(preset.patch)}>{preset.label}</button>)}
    </div>

    <div style={twoColumn}>
      <Toggle checked={config.autoPrompt} onChange={(autoPrompt) => update({ autoPrompt })}>Read prompts automatically</Toggle>
      <Toggle checked={config.autoAnswer} onChange={(autoAnswer) => update({ autoAnswer })}>Read revealed answers</Toggle>
    </div>

    <div style={twoColumn}>
      <VoiceSelect side="prompt" config={config} voices={voices} update={update}/>
      <VoiceSelect side="answer" config={config} voices={voices} update={update}/>
    </div>

    <label style={{ ...smallLabel, marginTop: 16 }} htmlFor="neoanki-tts-rate">Speed · {config.rate.toFixed(2)}×
      <input id="neoanki-tts-rate" type="range" min="0.5" max="2" step="0.05" value={config.rate} onChange={(event) => update({ rate: Number(event.target.value) })}/>
    </label>

    <details style={{ marginTop: 16 }}>
      <summary style={{ minHeight: 44, display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '.78rem', fontWeight: 750 }}>Advanced speech controls</summary>
      <div style={twoColumn}>
        <label style={smallLabel}>Pitch · {config.pitch.toFixed(2)}<input type="range" min="0.5" max="1.5" step="0.05" value={config.pitch} onChange={(event) => update({ pitch: Number(event.target.value) })}/></label>
        <label style={smallLabel}>Volume · {Math.round(config.volume * 100)}%<input type="range" min="0" max="1" step="0.05" value={config.volume} onChange={(event) => update({ volume: Number(event.target.value) })}/></label>
      </div>
      <Toggle checked={config.includeContext} onChange={(includeContext) => update({ includeContext })}>Read card context after the answer</Toggle>
      <Toggle checked={config.omitBracketedText} onChange={(omitBracketedText) => update({ omitBracketedText })}>Skip text inside brackets and parentheses</Toggle>
    </details>

    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 16 }}>
      <button className="secondary-button" type="button" onClick={preview}>{previewing ? <StopIcon/> : <SpeakerIcon/>}{previewing ? 'Stop preview' : 'Preview voice'}</button>
      <button className="text-button" type="button" onClick={() => update(DEFAULT_CONFIG)}>Reset</button>
    </div>
    <p style={{ minHeight: 18 }} aria-live="polite">{message || (voices.length ? `${voices.length} system voices available.` : 'Waiting for system voices…')}</p>
  </div>
}
