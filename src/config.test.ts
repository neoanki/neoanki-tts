import { CONFIG_STORAGE_KEY, DEFAULT_CONFIG, loadConfig, normalizeConfig, saveConfig } from './config.js'

describe('TTS configuration', () => {
  it('uses safe defaults for missing or damaged data', () => {
    expect(loadConfig()).toEqual(DEFAULT_CONFIG)
    localStorage.setItem(CONFIG_STORAGE_KEY, '{bad')
    expect(loadConfig()).toEqual(DEFAULT_CONFIG)
  })

  it('clamps speech controls to supported browser ranges', () => {
    expect(normalizeConfig({ rate: 99, pitch: -2, volume: 2 })).toMatchObject({ rate: 2, pitch: 0.5, volume: 1 })
  })

  it('persists normalized settings and announces the change', () => {
    const listener = vi.fn()
    window.addEventListener('neoanki-tts:config-changed', listener)
    saveConfig({ ...DEFAULT_CONFIG, rate: 1.25 })
    expect(JSON.parse(localStorage.getItem(CONFIG_STORAGE_KEY)!)).toMatchObject({ rate: 1.25 })
    expect(listener).toHaveBeenCalledOnce()
    window.removeEventListener('neoanki-tts:config-changed', listener)
  })
})
