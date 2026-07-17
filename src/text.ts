import type { KnowledgeItem } from '@neo-anki/extension-sdk'
import type { ProcessingSettings, TtsTrack } from './types.js'

const CLOZE = /\{\{c\d+::([^{}]*?)(?:::[^{}]*?)?\}\}/gi
const SOUND = /\[sound:[^\]]+\]/gi

export const renderSource = (track: TtsTrack, item: Pick<KnowledgeItem, 'prompt' | 'answer' | 'context' | 'collection' | 'tags'>) => {
  if (track.source !== 'template') return item[track.source]
  return track.template.replace(/\{\{\s*(prompt|answer|context|collection|tags)\s*\}\}/gi, (_match, key: string) => key === 'tags' ? item.tags.join(', ') : String(item[key.toLowerCase() as keyof typeof item] || ''))
}

const stripHtml = (value: string) => {
  if (typeof DOMParser !== 'undefined') return new DOMParser().parseFromString(value, 'text/html').body.textContent || ''
  return value.replace(/<[^>]*>/g, ' ')
}

export const processText = (value: string, settings: ProcessingSettings) => {
  let text = value
  if (settings.removeSoundTags) text = text.replace(SOUND, ' ')
  if (settings.unwrapCloze) for (let pass = 0; pass < 8; pass += 1) text = text.replace(CLOZE, '$1')
  for (const rule of settings.replacements) {
    if (!rule.find) continue
    try {
      const expression = rule.regex ? rule.find : rule.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      text = text.replace(new RegExp(expression, `${rule.caseSensitive ? 'g' : 'gi'}u`), rule.replace)
    } catch { /* Invalid user patterns are ignored until fixed in the editor. */ }
  }
  if (settings.stripHtml) text = stripHtml(text)
  if (settings.removeBrackets) text = text.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
  return text.replace(/[_*`#]+/g, ' ').replace(/\s+/g, ' ').trim()
}

export const detectLanguage = (text: string) => {
  if (/[぀-ヿ]/u.test(text)) return 'ja-JP'
  if (/[가-힯]/u.test(text)) return 'ko-KR'
  if (/[一-鿿]/u.test(text)) return 'zh-CN'
  if (/[Ѐ-ӿ]/u.test(text)) return /[єіїґЄІЇҐ]/u.test(text) ? 'uk-UA' : 'ru-RU'
  if (/[؀-ۿ]/u.test(text)) return 'ar-SA'
  if (/[֐-׿]/u.test(text)) return 'he-IL'
  if (/[ऀ-ॿ]/u.test(text)) return 'hi-IN'
  return 'en-US'
}

export const textForTrack = (track: TtsTrack, item: KnowledgeItem, settings: ProcessingSettings) => processText(renderSource(track, item), settings)

export const stableHash = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
