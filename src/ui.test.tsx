import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AppData, ExtensionHost } from '@neo-anki/extension-sdk'
import { DEFAULT_CONFIG, saveConfig } from './config.js'
import { TtsReviewTool } from './ReviewTool.js'
import { TtsSettingsPanel } from './SettingsPanel.js'

const timestamp = '2025-01-01T00:00:00.000Z'
const item = { id: 'item', prompt: 'Hola', answer: 'Hello', context: '', collection: 'Spanish', tags: [], citations: [], mediaIds: [], occlusions: [], createdAt: timestamp, updatedAt: timestamp }
const card = { id: 'card', itemId: 'item', variant: 'forward', suspended: false, fsrs: { due: timestamp, stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, reps: 0, lapses: 0, state: 0, learning_steps: 0 }, estimatedSeconds: 12, createdAt: timestamp, updatedAt: timestamp }
const data = { version: 3, deviceId: 'd', items: [item], cards: [card], reviews: [], assets: [], goals: [], views: [], packs: [], packConflicts: [], trash: [], settings: { dailyMinutes: 30, retention: .9, theme: 'light', onboardingComplete: true, recoveryStrategy: 'risk' }, updatedAt: timestamp } as AppData
const makeHost = (): ExtensionHost => ({ platform: 'desktop', network: { fetch: vi.fn() }, secrets: { has: vi.fn(async () => false), get: vi.fn(async () => null), set: vi.fn(async () => undefined), delete: vi.fn(async () => undefined) } })

describe('TTS interface', () => {
  it('exposes the complete profile, provider, and generation workflows', async () => {
    const host = makeHost()
    render(<TtsSettingsPanel extensionId="org.neoanki.tts" data={data} host={host} runCommand={vi.fn()}/>)
    expect(screen.getByRole('heading', { name: 'NeoAnki TTS' })).toBeVisible()
    expect(screen.getByRole('tab', { name: 'Profiles & tracks' })).toBeVisible()
    expect(screen.getByRole('tab', { name: 'Providers' })).toBeVisible()
    expect(screen.getByRole('tab', { name: 'Generate' })).toBeVisible()
    await userEvent.click(screen.getByRole('tab', { name: 'Providers' }))
    expect(screen.getByText('OpenAI')).toBeVisible()
    const key = screen.getAllByLabelText('API key')[0]!
    await userEvent.type(key, 'sk-test')
    await userEvent.click(screen.getAllByRole('button', { name: 'Save key' })[0]!)
    await waitFor(() => expect(host.secrets.set).toHaveBeenCalledWith('openai.api-key', 'sk-test'))
  })

  it('plays the matching system track from the review toolbar', async () => {
    const speak = vi.fn((utterance: { text: string; onend?: () => void }) => utterance.onend?.())
    class Utterance { voice = null; lang = ''; rate = 1; onend?: () => void; onerror?: (event: { error: string }) => void; constructor(public text: string) {} }
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { getVoices: () => [], cancel: vi.fn(), speak } })
    Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', { configurable: true, value: Utterance })
    const config = structuredClone(DEFAULT_CONFIG); config.profiles[0]!.tracks.forEach((track) => { track.autoplay = false }); saveConfig(config)
    render(<TtsReviewTool extensionId="org.neoanki.tts" item={item} card={card} assets={[]} revealed={false} host={makeHost()} submitRating={vi.fn()}/>)
    await userEvent.click(screen.getByRole('button', { name: 'Play prompt audio' }))
    expect(speak).toHaveBeenCalledOnce()
    expect(speak.mock.calls[0]?.[0].text).toBe('Hola')
  })
})
