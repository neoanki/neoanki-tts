import { useEffect, useRef, useState } from 'react'
import type { ReviewToolProps } from '@neo-anki/extension-sdk'
import { CONFIG_CHANGED_EVENT, loadConfig, profileMatches } from './config.js'
import { metadataKey, readTtsMetadata } from './media.js'
import { dataUrl, synthesizeWithFallback } from './providers.js'
import { speakWithSystem, stopSystemSpeech } from './system-speech.js'
import { textForTrack } from './text.js'
import { SpeakerIcon, StopIcon } from './icons.js'
import type { TtsConfig, TtsTrack } from './types.js'

const buttonStyle: React.CSSProperties = { width: 44, height: 44, display: 'inline-grid', placeItems: 'center', padding: 0, border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-soft)', background: 'var(--surface-strong)', cursor: 'pointer' }

export const TtsReviewTool = ({ card, item, assets, revealed, host }: ReviewToolProps) => {
  const [config, setConfig] = useState(loadConfig)
  const [playing, setPlaying] = useState(false)
  const [message, setMessage] = useState('')
  const token = useRef(0)
  const audio = useRef<HTMLAudioElement | null>(null)
  const automatic = useRef('')
  const profile = config.profiles.find((candidate) => profileMatches(candidate, item))
  const side = revealed ? 'answer' : 'prompt'
  const tracks = profile?.tracks.filter((track) => track.side === side) || []

  useEffect(() => {
    const listener = (event: Event) => setConfig((event as CustomEvent<TtsConfig>).detail || loadConfig())
    window.addEventListener(CONFIG_CHANGED_EVENT, listener)
    return () => window.removeEventListener(CONFIG_CHANGED_EVENT, listener)
  }, [])

  const stop = () => {
    token.current += 1
    audio.current?.pause(); audio.current = null
    stopSystemSpeech(); setPlaying(false)
  }

  const playAudio = (src: string, playToken: number) => new Promise<void>((resolve, reject) => {
    if (playToken !== token.current) { resolve(); return }
    const element = new Audio(src); audio.current = element
    element.onended = () => resolve(); element.onerror = () => reject(new Error('Audio playback failed.'))
    void element.play().catch(reject)
  })

  const playSystem = (track: TtsTrack, text: string, playToken: number) => new Promise<void>((resolve, reject) => {
    if (playToken !== token.current) { resolve(); return }
    if (!speakWithSystem(track, text, resolve, (error) => reject(new Error(error)))) reject(new Error('System speech is unavailable.'))
  })

  const play = async (onlyAutomatic = false) => {
    if (!config.enabled || !profile) return
    const selected = onlyAutomatic ? tracks.filter((track) => track.autoplay) : tracks
    if (!selected.length) return
    stop(); const playToken = token.current; setPlaying(true); setMessage('')
    const metadata = readTtsMetadata(item)
    try {
      for (const track of selected) {
        if (playToken !== token.current) break
        const text = textForTrack(track, item, profile.processing)
        if (!text) continue
        const generated = metadata.tracks[metadataKey(profile.id, track.id)]
        const asset = generated ? assets.find((candidate) => candidate.id === generated.assetId) : undefined
        if (asset) await playAudio(asset.dataUrl, playToken)
        else if (track.provider === 'system') await playSystem(track, text, playToken)
        else {
          setMessage(`Generating ${track.name}…`)
          const result = await synthesizeWithFallback(host, track, text, config.providers)
          await playAudio(dataUrl(result), playToken)
        }
      }
      if (playToken === token.current) { setPlaying(false); setMessage('') }
    } catch (error) { if (playToken === token.current) { setPlaying(false); setMessage(error instanceof Error ? error.message : 'Speech failed.') } }
  }

  useEffect(() => {
    const signature = `${card.id}:${side}`
    if (automatic.current === signature) return
    automatic.current = signature
    const timer = window.setTimeout(() => { if (tracks.some((track) => track.autoplay)) void play(true) }, 0)
    return () => { window.clearTimeout(timer); stop() }
    // Card/side changes intentionally own automatic playback. Profile edits arrive on the next card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id, side])

  useEffect(() => () => stop(), [])
  if (!config.enabled || !profile || !tracks.length) return null
  return <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
    <button type="button" style={buttonStyle} onClick={() => playing ? stop() : void play()} aria-label={playing ? 'Stop TTS playback' : `Play ${side} audio`} title={message || (playing ? 'Stop playback' : `Play ${side} audio`)}>{playing ? <StopIcon/> : <SpeakerIcon/>}</button>
    <span className="visually-hidden" role="status" aria-live="polite">{message}</span>
  </div>
}
