import type { AnimationCue, KeywordHighlight, Shot, VideoPreviewElement, VideoProject } from '../../server/videoTypes'
import { reconcileVideoProjectEdit } from './videoEditDependencies'

export interface CanvasHighlightSelection {
  phrase: string; start: number; end: number; occurrence: number;
  color: string; effect: KeywordHighlight['effect']; durationSeconds: number; cue?: AnimationCue
}
const withShot = (project: VideoProject, shotId: string, change: (shot: Shot) => Shot): VideoProject => reconcileVideoProjectEdit(project, { ...project, shots: project.shots.map(s => s.id === shotId ? change(s) : s) })
function materializeBoard(shot: Shot, element: VideoPreviewElement): Shot {
  const id = element.source?.id
  if (element.source?.type !== 'board' || !id || shot.boardTexts?.some(b => b.id === id)) return shot
  if (shot.boardTexts !== undefined || !['__given', '__problem'].includes(id)) throw new Error('该板书已删除，请选择当前画面中的元素。')
  return { ...shot, boardTexts: [...(shot.boardTexts || []), { id, text: element.text || '', kind: id === '__problem' ? 'problem' : 'given' }] }
}
export function editCanvasElement(project: VideoProject, shotId: string, element: VideoPreviewElement, text: string): VideoProject {
  const boardId = element.source?.type === 'board' ? element.source.id : undefined
  const targetShot = project.shots.find(shot => shot.id === shotId)
  const optionalCardBody = boardId && targetShot?.boardTexts?.some(board => board.id === boardId && board.card) && targetShot.formulas.some(formula => formula.cardId === boardId)
  if (!text.trim() && !optionalCardBody) throw new Error('请填写内容，或使用“删除元素”移除这块板书。')
  return withShot(project, shotId, original => {
    const shot = materializeBoard(original, element), source = element.source
    if (source?.type === 'title') return { ...shot, sectionTitle: text }
    if (source?.type === 'cardTitle') return { ...shot, boardTexts: shot.boardTexts?.map(board => board.id === source.id && board.card ? { ...board, card: { ...board.card, title: text } } : board) }
    if (source?.type === 'action') return { ...shot, actions: shot.actions.map(a => a.id === source.id
      ? a.type === 'annotation' && a.annotation ? { ...a, annotation: { ...a.annotation, label: text } } : { ...a, text }
      : a) }
    if (source?.type !== 'board' && source?.type !== 'formula') return shot
    return source.type === 'board'
      ? { ...shot, boardTexts: shot.boardTexts?.map(b => b.id === source.id ? { ...b, text } : b) }
      : { ...shot, formulas: shot.formulas.map(f => f.id === source.id ? { ...f, latex: text } : f) }
  })
}
export function deleteCanvasElement(project: VideoProject, shotId: string, element: VideoPreviewElement): VideoProject {
  const source = element.source
  if (source?.type === 'formula' && project.shots.some(s => s.formulas.some(f => f.correctionStepId === source.id))) throw new Error('这一步负责纠正学生猜想，请先调整对应猜想，再删除纠正公式。')
  const result = withShot(project, shotId, shot => {
    if (element.id === 'problem-image') return { ...shot, layout: { template: 'auto', elements: {}, ...shot.layout, hideProblemImage: true } }
    const elements = { ...shot.layout?.elements };delete elements[element.id]
    const layout = shot.layout ? { ...shot.layout, elements } : undefined
    if (source?.type === 'board' && element.id.startsWith('board-body:')) {
      if (!shot.formulas.some(formula => formula.cardId === source.id)) throw new Error('这张知识卡需要保留正文或公式。请先添加卡内公式，或选择卡片删除整个知识卡。')
      return { ...shot, layout, boardTexts: shot.boardTexts?.map(board => board.id === source.id ? { ...board, text: '' } : board) }
    }
    if (source?.type === 'board' || source?.type === 'cardTitle') return { ...shot, layout, boardTexts: (shot.boardTexts || []).filter(b => b.id !== source.id), highlights: shot.highlights?.filter(h => h.targetType !== 'board' || h.targetId !== source.id) }
    if (source?.type === 'formula') return { ...shot, layout, formulas: shot.formulas.filter(f => f.id !== source.id), highlights: shot.highlights?.filter(h => h.targetType !== 'formula' || h.targetId !== source.id) }
    if (source?.type === 'action') return { ...shot, layout, actions: shot.actions.filter(a => a.id !== source.id) }
    return shot
  })
  if (source?.type !== 'formula') return result
  const used = new Set(result.shots.flatMap(s => s.formulas.map(f => f.id)))
  return { ...result, circuits: result.circuits.map(c => ({ ...c, quantities: c.quantities.map(q => q.revealStepId === source.id && !used.has(source.id) ? { ...q, revealStepId: undefined } : q) })) }
}
export function highlightCanvasElement(project: VideoProject, shotId: string, element: VideoPreviewElement, selection: CanvasHighlightSelection): VideoProject {
  return withShot(project, shotId, original => {
    const shot = materializeBoard(original, element), source = element.source
    if (source?.type !== 'board' && source?.type !== 'formula') return shot
    const target = source.type === 'board' ? shot.boardTexts?.find(b => b.id === source.id) : shot.formulas.find(f => f.id === source.id)
    const text = target && ('text' in target ? target.text : target.latex)
    if (!text || !selection.phrase || text.split(selection.phrase).length - 1 < selection.occurrence) throw new Error('选中文字已变化，请在当前画面重新选择。')
    const matched = project.utterances.find(u => shot.utteranceIds.includes(u.id) && u.text.includes(selection.phrase))
    const cue = selection.cue || (matched ? { utteranceId: matched.id, phrase: selection.phrase } : target?.cue || { utteranceId: shot.utteranceIds[0] })
    return { ...shot, highlights: [...(shot.highlights || []), { id: `${shot.id}-highlight-${crypto.randomUUID().slice(0, 8)}`, targetType: source.type, targetId: source.id, phrase: selection.phrase, occurrence: selection.occurrence, color: selection.color, effect: selection.effect, durationSeconds: selection.durationSeconds, cue }] }
  })
}
