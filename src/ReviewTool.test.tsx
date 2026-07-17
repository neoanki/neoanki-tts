import { StrictMode } from 'react'
import { render, waitFor } from '@testing-library/react'
import type { KnowledgeItem, PracticeCard } from '@neo-anki/extension-sdk'
import { TtsReviewTool } from './ReviewTool.js'

class FakeUtterance {
  text: string
  voice: SpeechSynthesisVoice | null = null
  lang = ''
  rate = 1
  pitch = 1
  volume = 1
  onstart: (() => void) | null = null
  onend: (() => void) | null = null
  onerror: ((event: { error: string }) => void) | null = null
  constructor(text: string) { this.text = text }
}

describe('review playback', () => {
  it('auto-reads once after React StrictMode effect replay', async () => {
    const speak = vi.fn((utterance: FakeUtterance) => utterance.onstart?.())
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      cancel: vi.fn(), speak, getVoices: () => [], addEventListener: vi.fn(), removeEventListener: vi.fn(),
    } })
    Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', { configurable: true, value: FakeUtterance })
    const card = { id: 'card-1', variant: 'basic' } as PracticeCard
    const item = { id: 'item-1', prompt: 'Hola', answer: 'Hello', context: '', collection: 'Spanish' } as KnowledgeItem

    render(<StrictMode><TtsReviewTool extensionId="org.neoanki.tts" card={card} item={item} revealed={false} submitRating={vi.fn()}/></StrictMode>)

    await waitFor(() => expect(speak).toHaveBeenCalledOnce())
    expect(speak.mock.calls[0]![0].text).toBe('Hola')
  })
})
