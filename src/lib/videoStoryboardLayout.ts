import type { Shot } from '../../server/videoTypes'

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const regions = new Set(['left', 'right', 'top', 'bottom', 'center', 'focus'])
const description = (value: unknown): value is string => typeof value === 'string' && /[\p{L}]/u.test(value)
  && !/^[\s+-]*\d/.test(value) && !/\b(?:x|y|scale)\s*[:=]/i.test(value)
function objectJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try { const parsed: unknown = JSON.parse(value); return record(parsed) ? parsed : value } catch { return value }
}

/** Formatting normalization for new AI output and its generation checkpoints only. */
export function normalizeGeneratedShotLayout(shot: Shot): void {
  const layout = objectJson(shot.layout)
  if (!record(layout)) return
  // Providers sometimes put the documented content layout in the template
  // field. Preserve that exact layout meaning without requesting new content.
  if (['cards-grid', 'circuit-left'].includes(String(layout.template))
    && (layout.contentLayout === undefined || layout.contentLayout === layout.template)) {
    layout.contentLayout = layout.template
    layout.template = 'auto'
  }
  let elements = objectJson(layout.elements === undefined ? {} : layout.elements)
  if (typeof elements === 'string') {
    const entries = elements.split(/[;；]/).map(part => part.trim().match(/^(left|right|top|bottom|center|focus)\s*[:：]\s*(.+)$/))
    if (entries.length && entries.every(entry => entry && description(entry[2]))) elements = Object.fromEntries(entries.map(entry => [entry![1], entry![2]]))
  }
  if (record(elements) && Object.keys(elements).length && Object.entries(elements).every(([key, value]) => regions.has(key) && description(value))) {
    shot.reviewNotes.push('AI 布局语义备注（使用所选内容布局自动排布）：' + JSON.stringify(elements))
    elements = {}
  }
  // Numeric placements and malformed coordinate data pass through unchanged;
  // shared validation still rejects invalid values instead of silently resetting them.
  shot.layout = { ...layout, elements } as Shot['layout']
}
