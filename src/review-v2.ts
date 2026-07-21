import { createSandboxedUiClient, type ExtensionContentNoteDto } from '@neo-anki/extension-sdk'
import { metadataKey } from './media.js'
import { textForTrack } from './text.js'
import type { ItemTtsMetadata, TtsProfile, TtsTrack } from './types.js'

const style = document.createElement('style')
style.textContent = `:root{color-scheme:light dark;font:var(--neo-font-size,16px)/var(--neo-line-height,1.4) var(--neo-font-family,system-ui,sans-serif)}*{box-sizing:border-box}body{margin:0;background:transparent;color:var(--neo-text,#26241f)}.tool{display:flex;align-items:center;gap:8px;padding:2px}.play{width:44px;height:44px;border-radius:var(--neo-radius-md,10px);border:1px solid var(--neo-border-strong,#c9c2b6);background:var(--neo-surface-strong,#fff);color:var(--neo-primary,#6246a5);font:700 18px var(--neo-font-family,system-ui,sans-serif);cursor:pointer}.play:focus-visible{outline:3px solid var(--neo-focus,#a98de4);outline-offset:2px}.play:disabled{opacity:.55}.message{font-size:.82rem;color:var(--neo-text-soft,#69655d);max-width:260px}.disclosure{display:block}`
document.head.append(style)
const root = document.getElementById('root')!
root.innerHTML = `<div class="tool"><button class="play" type="button" aria-label="Play TTS audio" title="Play TTS audio">▶</button><span class="message" role="status" aria-live="polite"><span class="disclosure">Cloud tracks use AI-generated voices.</span></span></div>`
const button = root.querySelector('button')!
const message = root.querySelector('.message')!
let stopped = false
let audio: HTMLAudioElement | null = null

const stop = () => { stopped = true; audio?.pause(); audio = null; speechSynthesis?.cancel(); button.textContent = '▶'; button.setAttribute('aria-label', 'Play TTS audio') }
const playUrl = (url: string) => new Promise<void>((resolve, reject) => {
  if (stopped) { resolve(); return }
  audio = new Audio(url); audio.onended = () => resolve(); audio.onerror = () => reject(new Error('Audio playback failed.')); void audio.play().catch(reject)
})
const speakSystem = (track: TtsTrack, text: string) => new Promise<void>((resolve, reject) => {
  if (!('speechSynthesis' in globalThis)) { reject(new Error('System speech is unavailable.')); return }
  const utterance = new SpeechSynthesisUtterance(text); utterance.rate = track.speed; utterance.lang = track.language === 'auto' ? '' : track.language
  const voices = speechSynthesis.getVoices(); utterance.voice = voices.find((voice) => voice.voiceURI === track.voice || voice.name === track.voice) || null
  utterance.onend = () => resolve(); utterance.onerror = (event) => reject(new Error(event.error || 'System speech failed.')); speechSynthesis.speak(utterance)
})

void createSandboxedUiClient().then(async (client) => {
  document.documentElement.dataset.theme = client.init.theme
  const dto = client.init.dto as { card?: { noteId?: string }; revealed?: boolean }
  const noteId = String(dto.card?.noteId || '')
  const call = <T,>(commandId: string, payload?: unknown) => client.call<T>('command', { commandId, payload })
  const play = async (automatic = false) => {
    stopped = false; button.disabled = true; button.textContent = '■'; button.setAttribute('aria-label', 'Stop TTS playback')
    try {
      const state = await call<{ note: ExtensionContentNoteDto; profile?: TtsProfile; metadata: ItemTtsMetadata; currentTrackIds: string[] }>('review.get', { noteId })
      const side = dto.revealed ? 'answer' : 'prompt'; const tracks = state.profile?.tracks.filter((track) => track.side === side && (!automatic || track.autoplay)) || []
      for (const track of tracks) {
        if (stopped) break
        const item = { ...state.note, collection: state.note.deckName }
        const text = textForTrack(track, item as never, state.profile!.processing); if (!text) continue
        const metadata = state.metadata.tracks[metadataKey(state.profile!.id, track.id)]
        const current = Boolean(metadata && state.currentTrackIds.includes(metadataKey(state.profile!.id, track.id)))
        if (metadata && current) await playUrl(`neoanki-media://asset/${encodeURIComponent(metadata.assetId)}`)
        else if (track.provider === 'system') await speakSystem(track, text)
        else {
          message.textContent = `Generating ${track.name} with ${track.provider} · AI-generated voice`
          const generated = await call<{ assetId: string }>('generate.one', { noteId, profileId: state.profile!.id, trackId: track.id })
          if (!stopped) await playUrl(`neoanki-media://asset/${encodeURIComponent(generated.assetId)}`)
        }
      }
      if (!stopped) message.textContent = 'Cloud tracks use AI-generated voices.'
    } catch (error) { if (!stopped) message.textContent = error instanceof Error ? error.message : 'TTS playback failed.' }
    button.disabled = false; if (!stopped) { button.textContent = '▶'; button.setAttribute('aria-label', 'Play TTS audio') }
  }
  button.onclick = () => { if (button.textContent === '■') stop(); else void play(false) }
  if (noteId) window.setTimeout(() => void play(true), 0)
  window.addEventListener('beforeunload', stop)
})
