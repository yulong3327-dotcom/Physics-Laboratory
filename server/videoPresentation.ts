import type { Shot } from './videoTypes.js'

export const VIDEO_BOARD_ENTRANCES = ['appear', 'fade', 'write', 'slide', 'settle'] as const
export const VIDEO_HIGHLIGHT_EFFECTS = ['marker', 'underline', 'box', 'pointer', 'pulse', 'check', 'cross'] as const
export const VIDEO_CONTENT_LAYOUTS = ['auto', 'circuit-left', 'cards-grid'] as const

export function validateVideoShotLayout(shot: Shot): string[] {
  const errors: string[] = [], prefix = (shot.title || shot.id) + '：'
  const layout: unknown = shot.layout
  if (layout === undefined) return errors
  const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
  if (!record(layout) || typeof layout.template !== 'string' || !['auto', 'question', 'explain', 'summary'].includes(layout.template) || !record(layout.elements)) return [prefix + '镜头板式无效：layout 和 elements 必须为对象，template 必须是有效板式名称']
  if (layout.hideProblemImage !== undefined && typeof layout.hideProblemImage !== 'boolean') errors.push(prefix + '题图显示设置无效')
  if (layout.contentLayout !== undefined && !(VIDEO_CONTENT_LAYOUTS as readonly unknown[]).includes(layout.contentLayout)) errors.push(prefix + '内容布局无效')
  if (Object.keys(layout.elements).length > 300) errors.push(prefix + '画面元素过多')
  for (const [key, value] of Object.entries(layout.elements)) {
    if (!/^[A-Za-z0-9_:.-]{1,160}$/.test(key) || !record(value)
      || typeof value.x !== 'number' || !Number.isFinite(value.x) || value.x < 0 || value.x > 1920
      || typeof value.y !== 'number' || !Number.isFinite(value.y) || value.y < 0 || value.y > 1080
      || typeof value.scale !== 'number' || !Number.isFinite(value.scale) || value.scale < .2 || value.scale > 4) errors.push(prefix + '画面元素坐标或缩放无效（' + key + '）')
  }
  return errors
}

/** Card titles are decoration; board highlights continue to index only board.text. */
export function validateVideoShotPresentation(shot: Shot): string[] {
  const errors: string[] = validateVideoShotLayout(shot), prefix = (shot.title || shot.id) + '：'
  const boards = shot.boardTexts || [], cards = new Set(boards.filter(board => board.card).map(board => board.id))
  for (const board of boards) {
    if (board.card !== undefined) {
      if (!board.card || typeof board.card !== 'object' || Array.isArray(board.card) || typeof board.card.title !== 'string' || !board.card.title.trim() || board.card.title.length > 120)
        errors.push(prefix + '知识卡标题不能为空且不能超过120字（' + board.id + '）')
      if (!board.text.trim() && !shot.formulas.some(formula => formula.cardId === board.id && formula.latex.trim())) errors.push(prefix + '知识卡需要正文或绑定公式，不能只有标题（' + board.id + '）')
    } else if (!board.text.trim()) errors.push(prefix + '普通板书正文不能为空（' + board.id + '）')
    if (board.entrance !== undefined && !(VIDEO_BOARD_ENTRANCES as readonly string[]).includes(board.entrance)) errors.push(prefix + '板书入场方式无效（' + board.id + '）')
  }
  for (const formula of shot.formulas) if (formula.cardId !== undefined && (typeof formula.cardId !== 'string' || !cards.has(formula.cardId))) errors.push(prefix + '公式绑定的知识卡不存在（' + formula.id + '）')
  for (const highlight of shot.highlights || []) if (!(VIDEO_HIGHLIGHT_EFFECTS as readonly string[]).includes(highlight.effect)) errors.push(prefix + '强调效果无效（' + highlight.id + '）')
  return errors
}
