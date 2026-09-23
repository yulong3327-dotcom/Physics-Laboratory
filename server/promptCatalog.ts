import { PROMPT_TEXTS, PROMPT_METADATA } from './promptCatalog.generated.js'

export { PROMPT_METADATA }

export function getPromptMetadata(id: string) {
  const entry = (PROMPT_METADATA as Record<string, { version: string; sha256: string; variables: readonly string[] }>)[id]
  if (!Object.prototype.hasOwnProperty.call(PROMPT_METADATA, id)) throw new Error(`Unknown prompt: ${id}`)
  return entry
}

/** Templates substitute each supplied value once; values are never interpreted as templates. */
export function renderPrompt(id: string, values: Record<string, string | number> = {}): string {
  const template = (PROMPT_TEXTS as Record<string, string>)[id]
  if (typeof template !== 'string') throw new Error(`Unknown prompt: ${id}`)
  const expected = new Set([...template.matchAll(/\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g)].map(match => match[1]))
  for (const key of expected) {
    if (!Object.prototype.hasOwnProperty.call(values, key)) throw new Error(`Missing prompt variable: ${id}.${key}`)
  }
  for (const key of Object.keys(values)) {
    if (!expected.has(key)) throw new Error(`Unknown prompt variable: ${id}.${key}`)
  }
  return template.replace(/\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g, (_match, key: string) => String(values[key]))
}
