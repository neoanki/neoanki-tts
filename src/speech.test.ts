import { detectLanguage, prepareSpeechText, resolveVoice } from './speech.js'

const voice = (name: string, lang: string, localService = true, isDefault = false) => ({ name, lang, localService, default: isDefault, voiceURI: `${name}:${lang}` }) as SpeechSynthesisVoice

describe('speech preparation', () => {
  it('removes markup while preserving cloze answers', () => {
    expect(prepareSpeechText('<b>The {{c1::mitochondrion::organelle}}</b> (hint)', true)).toBe('The mitochondrion')
  })

  it('detects common non-Latin scripts', () => {
    expect(detectLanguage('こんにちは')).toBe('ja-JP')
    expect(detectLanguage('Привіт')).toBe('uk-UA')
    expect(detectLanguage('你好')).toBe('zh-CN')
  })

  it('prefers an explicit voice, then a local language match', () => {
    const voices = [voice('English', 'en-US'), voice('Cloud Japanese', 'ja-JP', false), voice('Local Japanese', 'ja-JP')]
    expect(resolveVoice(voices, voices[0]!.voiceURI, 'ja-JP', '日本語')).toBe(voices[0])
    expect(resolveVoice(voices, '', 'auto', 'こんにちは')).toBe(voices[2])
  })
})
