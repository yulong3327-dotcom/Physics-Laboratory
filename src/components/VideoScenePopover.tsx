import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { X } from 'lucide-react'
import type { AnimationCue, VideoPreviewElement, VideoProject, Shot } from '../../server/videoTypes'
import type { VideoHighlightSelection } from './VideoSceneEditor'
import { FormulaEditor } from './FormulaEditor'
import { highlightTimingIssue } from '../lib/videoStoryboardTiming'

export interface SceneTextSelection { start: number; end: number; phrase: string; occurrence: number }
export interface ScenePopoverState { element: VideoPreviewElement; mode: 'edit' | 'highlight'; selection?: SceneTextSelection; left: number; top: number }
const colors = [{ value: '#4F80FF', label: '蓝色' }, { value: '#FF6600', label: '橙色' }, { value: '#16C863', label: '绿色' }, { value: '#FF4D4D', label: '红色' }]
export function textSelection(text: string, start: number, end: number): SceneTextSelection {
  const selected = text.slice(start, end), phrase = selected.trim()
  const offset = selected.indexOf(phrase)
  const first = start + Math.max(0, offset)
  let occurrence = 0, position = 0
  while (phrase && position <= first) {
    const found = text.indexOf(phrase, position)
    if (found < 0 || found > first) break
    occurrence++; position = found + Math.max(1, phrase.length)
  }
  return { start: first, end: first + phrase.length, phrase, occurrence: Math.max(1, occurrence) }
}
export function VideoScenePopover({ state, project, shot, onClose, onEdit, onHighlight }: {
  state: ScenePopoverState; project: VideoProject; shot: Shot; onClose: () => void
  onEdit: (element: VideoPreviewElement, text: string) => void
  onHighlight: (element: VideoPreviewElement, selection: VideoHighlightSelection) => void
}) {
  const element = state.element, sourceText = element.text || ''
  const allowEmptyBody = element.source?.type === 'board' && shot.boardTexts?.some(board => board.id === element.source?.id && board.card) && shot.formulas.some(formula => formula.cardId === element.source?.id)
  const [text, setText] = useState(sourceText)
  const [selection, setSelection] = useState<SceneTextSelection>(state.selection || textSelection(sourceText, 0, 0))
  const [color, setColor] = useState('#4F80FF'), [effect, setEffect] = useState<VideoHighlightSelection['effect']>('box')
  const [duration, setDuration] = useState(3)
  const lines = shot.utteranceIds.map(id => project.utterances.find(line => line.id === id)).filter(line => !!line)
  const target = element.source?.type === 'formula' ? shot.formulas.find(item => item.id === element.source?.id) : shot.boardTexts?.find(item => item.id === element.source?.id)
  function visibilityError(cue: AnimationCue): string {
    const issue = target && highlightTimingIssue(project, shot, element.source?.type === 'formula' ? 'formula' : 'board', target.id, cue)
    if (issue === 'before') return '高亮不能早于目标出现，请选择目标出现时或之后的旁白。'
    if (issue === 'replaced') return '目标公式此时已被替换，请提前强调，或将后续公式设为“另起一行，保留前式”。'
    return ''
  }
  const initialCue = (): AnimationCue => {
    const phrase = state.selection?.phrase || ''
    const matched = phrase && lines.find(line => line.text.includes(phrase) && !visibilityError({ utteranceId: line.id, phrase }))
    if (matched) return { utteranceId: matched.id, phrase }
    return target?.cue && shot.utteranceIds.includes(target.cue.utteranceId) ? { ...target.cue } : { utteranceId: shot.utteranceIds[0] || '' }
  }
  const [cue, setCue] = useState(initialCue)
  const container = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const handle = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }
    window.addEventListener('keydown', handle)
    container.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus()
    return () => window.removeEventListener('keydown', handle)
  }, [onClose])
  const line = lines.find(item => item.id === cue.utteranceId)?.text || ''
  const cueValid = !!line && (!cue.phrase || line.includes(cue.phrase))
  const windowError = cueValid ? visibilityError(cue) : ''
  const phraseValid = !!selection.phrase && sourceText.slice(selection.start, selection.end) === selection.phrase
  const [viewport, setViewport] = useState(() => ({ left: window.visualViewport?.offsetLeft || 0, top: window.visualViewport?.offsetTop || 0, width: window.visualViewport?.width || window.innerWidth, height: window.visualViewport?.height || window.innerHeight }))
  useEffect(() => {
    const refresh = () => setViewport({ left: window.visualViewport?.offsetLeft || 0, top: window.visualViewport?.offsetTop || 0, width: window.visualViewport?.width || window.innerWidth, height: window.visualViewport?.height || window.innerHeight })
    window.visualViewport?.addEventListener('resize', refresh); window.visualViewport?.addEventListener('scroll', refresh); window.addEventListener('resize', refresh)
    return () => { window.visualViewport?.removeEventListener('resize', refresh); window.visualViewport?.removeEventListener('scroll', refresh); window.removeEventListener('resize', refresh) }
  }, [])
  const desiredWidth = state.mode === 'edit' && element.textKind === 'latex' ? 640 : 410
  const width = Math.min(desiredWidth, viewport.width - 24)
  const left = Math.max(viewport.left + 12, Math.min(state.left, viewport.left + viewport.width - width - 12))
  const desiredHeight = state.mode === 'highlight' || element.textKind === 'latex' ? 640 : 360
  const top = Math.max(viewport.top + 12, Math.min(state.top, viewport.top + viewport.height - desiredHeight - 16))
  const style: CSSProperties = { left, top, width, maxHeight: Math.max(120, viewport.top + viewport.height - top - 12) }

  function pickPhrase(phrase: string) {
    const index = sourceText.indexOf(phrase)
    setSelection(index >= 0 ? textSelection(sourceText, index, index + phrase.length) : { start: -1, end: -1, phrase, occurrence: 1 })
  }
  return <div ref={container} className="video-scene-popover" role="dialog" aria-label={state.mode === 'edit' ? '编辑画面内容' : '设置选词高亮'} style={style}>
    <div className="video-scene-popover-heading"><strong>{state.mode === 'edit' ? '编辑' : '高亮'} · {element.label}</strong><button type="button" aria-label="关闭画面编辑" onClick={onClose}><X size={16} /></button></div>
    <div className="video-scene-popover-body">{state.mode === 'edit' ? <>
      {element.textKind === 'latex' ? <FormulaEditor value={text} onChange={setText} label="画面公式" /> : <label className="video-scene-popover-field">画面文字<textarea aria-label="画面文字内容" rows={5} value={text} onChange={event => setText(event.target.value)} /></label>}
    </> : <>
      {element.textKind === 'latex' && <label className="video-scene-popover-field">在公式源码中选择需要强调的子式<textarea aria-label="选择公式源码片段" readOnly value={sourceText} rows={2} spellCheck={false} onSelect={event => { const field = event.currentTarget; if (field.selectionEnd > field.selectionStart) setSelection(textSelection(sourceText, field.selectionStart, field.selectionEnd)) }} /></label>}
      <label className="video-scene-popover-field">{element.textKind === 'latex' ? '高亮子式' : '选中文字'}<input aria-label="画面高亮文字" value={selection.phrase} onChange={event => pickPhrase(event.target.value)} /></label>
      {!phraseValid && <p className="video-scene-popover-error">请选中当前对象中存在的文字或完整子式。</p>}
      <fieldset className="video-scene-colors"><legend>颜色</legend>{colors.map(item => <button type="button" key={item.value} aria-label={'高亮' + item.label} aria-pressed={color === item.value} style={{ backgroundColor: item.value }} onClick={() => setColor(item.value)} />)}</fieldset>
      <div className="video-scene-popover-pair"><label>强调方式<select aria-label="画面高亮方式" value={effect} onChange={event => setEffect(event.target.value as VideoHighlightSelection['effect'])}><option value="box">圆角框选</option><option value="marker">圆角底色</option><option value="underline">下划线</option><option value="pointer">指示箭头</option><option value="pulse">脉冲强调</option><option value="check">打勾确认</option><option value="cross">打叉纠错</option></select></label><label>持续 / 秒<input type="number" aria-label="画面高亮持续秒数" min="0.5" max="15" step="0.5" value={duration} onChange={event => setDuration(Math.max(.5, Math.min(15, Number(event.target.value) || 3)))} /></label></div>
      <label className="video-scene-popover-field">同步旁白<select aria-label="画面高亮同步旁白" value={cue.utteranceId} onChange={event => setCue({ utteranceId: event.target.value })}>{lines.map(item => <option value={item.id} key={item.id}>{item.text}</option>)}</select></label>
      <label className="video-scene-popover-field">同步关键词（留空随句首）<input aria-label="画面高亮同步关键词" value={cue.phrase || ''} onChange={event => setCue({ ...cue, phrase: event.target.value || undefined })} /></label>
      {windowError && <p className="video-scene-popover-error">{windowError}</p>}
      {!cueValid && <p className="video-scene-popover-error">同步关键词不在所选旁白中，请调整关键词或选择另一句。</p>}
    </>}</div>
    <div className="video-scene-popover-actions"><button type="button" onClick={onClose}>取消</button>{state.mode === 'edit' ? <button type="button" className="primary" disabled={!text.trim() && !allowEmptyBody} onClick={() => { if (text !== sourceText) onEdit(element, text); onClose() }}>应用内容</button> : <button type="button" className="primary" disabled={!phraseValid || !cueValid || !!windowError} onClick={() => { onHighlight(element, { ...selection, color, effect, durationSeconds: duration, cue }); onClose() }}>应用高亮</button>}</div>
  </div>
}
