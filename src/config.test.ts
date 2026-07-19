import { CONFIG_STORAGE_KEY, DEFAULT_CONFIG, loadConfig, normalizeConfig, profileMatches, saveConfig, selectMatchingProfile } from './config.js'

describe('TTS configuration', () => {
  it('starts with a two-sided language-learning profile', () => {
    const config = loadConfig()
    expect(config.profiles[0]?.tracks.map((track) => track.side)).toEqual(['prompt', 'answer'])
    expect(config.profiles[0]?.tracks.every((track) => track.provider === 'system')).toBe(true)
  })

  it('normalizes unsafe values without discarding valid profiles', () => {
    const config = normalizeConfig({ batchConcurrency: 99, batchRetries: -4, profiles: [{ id: 'x', name: 'Spanish', enabled: true, tracks: [{ id: 'a', side: 'answer', source: 'answer', speed: 99, provider: 'openai', voiceMode: 'priority', fallbacks: [{ provider: 'google', voice: 'es', model: '' }] }] }] })
    expect(config.batchConcurrency).toBe(5)
    expect(config.batchRetries).toBe(0)
    expect(config.profiles[0]?.tracks[0]).toMatchObject({ side: 'answer', speed: 2, provider: 'openai', voiceMode: 'priority' })
    expect(config.profiles[0]?.tracks[0]?.fallbacks[0]?.provider).toBe('google')
  })

  it('persists normalized configuration and announces changes', () => {
    const listener = vi.fn(); window.addEventListener('neoanki-tts:config-changed', listener)
    const saved = saveConfig({ ...DEFAULT_CONFIG, batchConcurrency: 4 })
    expect(JSON.parse(localStorage.getItem(CONFIG_STORAGE_KEY)!)).toMatchObject({ batchConcurrency: 4 })
    expect(saved.batchConcurrency).toBe(4)
    expect(listener).toHaveBeenCalledOnce()
  })

  it('matches collection and required tag rules', () => {
    const profile = { ...DEFAULT_CONFIG.profiles[0]!, match: { collections: ['Spanish'], tags: ['audio', 'verb'] } }
    expect(profileMatches(profile, { collection: 'Spanish', tags: ['verb', 'audio', 'a1'] })).toBe(true)
    expect(profileMatches(profile, { collection: 'Spanish', tags: ['audio'] })).toBe(false)
    expect(profileMatches(profile, { collection: 'Japanese', tags: ['verb', 'audio'] })).toBe(false)
  })

  it('selects a specific higher-priority profile before a catch-all profile', () => {
    const fallback = structuredClone(DEFAULT_CONFIG.profiles[0]!)
    const specific = { ...structuredClone(fallback), id: 'specific', name: 'Spanish', priority: 10, match: { collections: ['Spanish'], tags: [] } }
    expect(selectMatchingProfile([fallback, specific], { collection: 'Spanish', tags: [] })?.id).toBe('specific')
  })
})
