import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { ReviewToolProps } from '@neo-anki/extension-sdk'
import { CONFIG_CHANGED_EVENT, loadConfig, type SpeechSide, type TtsConfig } from './config.js'
import { SpeakerIcon, StopIcon } from './icons.js'
import { speak, stopSpeaking } from './speech.js'

const buttonStyle: CSSProperties = { width: 44, height: 44, display: 'inline-grid', placeItems: 'center', padding: 0, border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-soft)', background: 'var(--surface-strong)', cursor: 'pointer' }

export const TtsReviewTool = ({ card, item, revealed }: ReviewToolProps) => {
  const [config, setConfig] = useState(loadConfig)
  const [speaking, setSpeaking] = useState(false)
  const [message, setMessage] = useState('')
  const lastAutomatic = useRef('')
  const side: SpeechSide = revealed ? 'answer' : 'prompt'
  const text = revealed ? item.answer : item.prompt

  useEffect(() => {
    const update = (event: Event) => setConfig((event as CustomEvent<TtsConfig>).detail || loadConfig())
    window.addEventListener(CONFIG_CHANGED_EVENT, update)
    return () => window.removeEventListener(CONFIG_CHANGED_EVENT, update)
  }, [])

  const play = (automatic = false) => {
    if (!config.enabled) return
    const signature = `${card.id}:${side}`
    if (automatic && lastAutomatic.current === signature) return
    if (automatic) lastAutomatic.current = signature
    setMessage('')
    speak({ side, text, context: item.context, config, onStart: () => setSpeaking(true), onEnd: () => setSpeaking(false), onError: setMessage })
  }

  useEffect(() => {
    const shouldPlay = config.enabled && (side === 'prompt' ? config.autoPrompt : config.autoAnswer)
    const timer = window.setTimeout(() => { if (shouldPlay) play(true) }, 0)
    return () => { window.clearTimeout(timer); stopSpeaking(); setSpeaking(false) }
    // The signature guard intentionally owns automatic replay behavior.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id, side, config.enabled, config.autoPrompt, config.autoAnswer])

  const toggle = () => {
    if (speaking) { stopSpeaking(); setSpeaking(false); return }
    play(false)
  }

  if (!config.enabled) return null
  return <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
    <button type="button" style={buttonStyle} onClick={toggle} aria-label={speaking ? 'Stop speaking' : `Read ${side}`} title={message || (speaking ? 'Stop speaking' : `Read ${side}`)}>
      {speaking ? <StopIcon/> : <SpeakerIcon/>}
    </button>
    <span className="visually-hidden" role="status" aria-live="polite">{message}</span>
  </div>
}
