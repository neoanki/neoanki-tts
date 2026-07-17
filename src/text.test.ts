import { DEFAULT_PROCESSING, DEFAULT_PROFILE } from './config.js'
import { detectLanguage, processText, renderSource, textForTrack } from './text.js'

const item = { id: 'i', prompt: '<b>Hola</b> [sound:old.mp3] {{c1::mundo::hint}}', answer: 'Hello (formal)', context: 'Greeting', collection: 'Spanish', tags: ['a1', 'verb'], citations: [], mediaIds: [], occlusions: [], createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z' }

describe('text pipeline', () => {
  it('cleans HTML, cloze syntax, and existing sound tags', () => {
    expect(processText(item.prompt, DEFAULT_PROCESSING)).toBe('Hola mundo')
  })

  it('applies literal and regular-expression pronunciation rules', () => {
    const settings = { ...DEFAULT_PROCESSING, replacements: [
      { id: '1', find: 'API', replace: 'A P I', regex: false, caseSensitive: false },
      { id: '2', find: '\\bv(\\d+)\\b', replace: 'version $1', regex: true, caseSensitive: false },
    ] }
    expect(processText('api v2', settings)).toBe('A P I version 2')
  })

  it('renders custom multi-field templates', () => {
    const track = { ...DEFAULT_PROFILE.tracks[0]!, source: 'template' as const, template: '{{prompt}} — {{answer}} — {{tags}}' }
    expect(renderSource(track, item)).toContain('a1, verb')
    expect(textForTrack(track, item, DEFAULT_PROCESSING)).toBe('Hola mundo — Hello (formal) — a1, verb')
  })

  it('detects common scripts for automatic voice matching', () => {
    expect(detectLanguage('こんにちは')).toBe('ja-JP')
    expect(detectLanguage('Привіт')).toBe('uk-UA')
    expect(detectLanguage('مرحبا')).toBe('ar-SA')
  })
})
