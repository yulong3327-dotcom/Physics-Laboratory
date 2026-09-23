import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { Check, Grip, Highlighter, Loader2, MousePointer2, Pencil, RefreshCw, RotateCcw, Trash2, Undo2 } from 'lucide-react'
import type { AnimationCue, KeywordHighlight, VideoElementPlacement, VideoPreviewElement, VideoProject, VideoScenePreview, VideoShotLayout, Shot } from '../../server/videoTypes'
import { VideoScenePopover, textSelection, type ScenePopoverState, type SceneTextSelection } from './VideoScenePopover'
import { constrainScenePlacement, moveSceneElement, resolveScenePlacement } from '../lib/videoScenePlacement'
import { summaryShotIds } from '../lib/videoSummary'
import './VideoSceneEditor.css'

export interface VideoHighlightSelection extends SceneTextSelection { color: string; effect: KeywordHighlight['effect']; durationSeconds: number; cue?: AnimationCue }

export interface VideoSceneEditorProps {
  project: VideoProject
  shot: Shot
  disabled?: boolean
  onChangeLayout: (layout: VideoShotLayout) => void
  onEditElement?: (element: VideoPreviewElement, text: string) => void
  onDeleteElement?: (element: VideoPreviewElement) => void
  onCreateHighlight?: (element: VideoPreviewElement, selection: VideoHighlightSelection) => void
}
const WIDTH = 1920, HEIGHT = 1080
const blankLayout = (): VideoShotLayout => ({ template: 'auto', elements: {} })
const templates = [
  { id: 'auto', name: '自动', image: '/video/templates/title-reference-thumb.png' },
  { id: 'explain', name: '讲解', image: '/video/templates/title-reference-2-thumb.png' },
  { id: 'summary', name: '总结', image: '/video/templates/summary-reference-thumb.png' },
] as const
const copyLayout = (layout?: VideoShotLayout): VideoShotLayout => ({ ...structuredClone(layout || blankLayout()), template: layout?.template === 'question' ? 'explain' : layout?.template || 'auto' })
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const validBounds = (value: VideoPreviewElement['constraintBounds']) => value === undefined || !!value
  && [value.x, value.y, value.width, value.height].every(finite) && value.x >= 0 && value.y >= 0
  && value.width > 0 && value.height > 0 && value.x + value.width <= WIDTH && value.y + value.height <= HEIGHT
function validPreview(value: unknown): value is VideoScenePreview {
  if (!value || typeof value !== 'object') return false
  const item = value as VideoScenePreview
  return item.width === WIDTH && item.height === HEIGHT && typeof item.template === 'string' && typeof item.stage === 'string'
    && validBounds(item.contentBounds)
    && typeof item.background === 'string' && (item.backgroundImage === undefined || typeof item.backgroundImage === 'string')
    && Array.isArray(item.warnings) && item.warnings.every(warning => typeof warning === 'string')
    && Array.isArray(item.stages) && item.stages.every(stage => typeof stage?.id === 'string' && typeof stage?.label === 'string')
    && Array.isArray(item.elements) && item.elements.every(element => element && [element.id, element.label, element.kind, element.svg].every(text => typeof text === 'string')
      && typeof element.visible === 'boolean' && element.box && [element.box.x, element.box.y, element.box.width, element.box.height].every(finite)
      && element.box.width >= 0 && element.box.height >= 0 && element.placement && [element.placement.x, element.placement.y, element.placement.scale].every(finite) && element.placement.scale > 0)
    && item.elements.every(element => validBounds(element.constraintBounds))
    && new Set(item.elements.map(element => element.id)).size === item.elements.length
}
function round(value: number): number { return Math.round(value * 100) / 100 }
function constrain(element: VideoPreviewElement, placement: VideoElementPlacement): VideoElementPlacement { return constrainScenePlacement(element, placement) }
type PreviewState = { identity: string; requestKey: string; value: VideoScenePreview; circuitAssetId?: string }
type LocalPlacement = { id: string; placement: VideoElementPlacement }
type Drag = LocalPlacement & { pointerId: number; startX: number; startY: number; initial: VideoElementPlacement; element: VideoPreviewElement; width: number; height: number }

/** All scene glyphs are rendered by the video service. The browser only positions its SVG images. */
export function VideoSceneEditor({ project, shot, disabled = false, onChangeLayout, onEditElement, onDeleteElement, onCreateHighlight }: VideoSceneEditorProps) {
  const identity = project.id + ':' + shot.id
  const externalLayoutKey = JSON.stringify(copyLayout(shot.layout))
  const [layout, setLayout] = useState(() => copyLayout(shot.layout))
  const [history, setHistory] = useState<VideoShotLayout[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [stage, setStage] = useState<string | undefined>()
  // Deleted animation stages must never be sent back to the preview service.
  const stageExists = !stage || !stage.includes(':') || [
    ...shot.formulas.map(item => 'formula:' + item.id),
    ...shot.actions.map(item => 'circuit:' + item.id),
    ...(shot.boardTexts || []).filter(item => item.cue).map(item => 'board:' + item.id),
    ...(shot.highlights || []).map(item => 'highlight:' + item.id),
  ].includes(stage)
  const effectiveStage = stageExists ? stage : undefined
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [dragPlacement, setDragPlacement] = useState<LocalPlacement | null>(null)
  const [inputPlacement, setInputPlacement] = useState<LocalPlacement | null>(null)
  const [fields, setFields] = useState({ x: '', y: '', scale: '' })
  const [toolMode, setToolMode] = useState<'move' | 'select'>('move')
  const [textRange, setTextRange] = useState<{ id: string; selection: SceneTextSelection } | null>(null)
  const [popover, setPopover] = useState<ScenePopoverState | null>(null)
  const [deletedIds, setDeletedIds] = useState<string[]>([])
  const textDrag = useRef<{ id: string; pointerId: number; element: VideoPreviewElement; anchor: number; focus: number } | null>(null)
  const requestId = useRef(0), immediate = useRef(true), previousIdentity = useRef(identity), cancelField = useRef(false)
  const drag = useRef<Drag | null>(null), canvas = useRef<HTMLDivElement>(null)
  const propsRef = useRef({ project, shot, onChangeLayout })
  propsRef.current = { project, shot, onChangeLayout }

  useLayoutEffect(() => {
    if (previousIdentity.current !== identity) {
      previousIdentity.current = identity; setHistory([]); setSelectedId(''); setStage(undefined); setPreview(null); setError(''); setDeletedIds([]); setPopover(null); setTextRange(null); setToolMode('move'); immediate.current = true
    }
    drag.current = null; textDrag.current = null; setDragPlacement(null); setInputPlacement(null)
    setLayout(JSON.parse(externalLayoutKey) as VideoShotLayout)
  }, [identity, externalLayoutKey])

  const requestProject = useMemo(() => ({ ...project, shots: project.shots.map(item => {
    const source = item.id === shot.id ? { ...shot, layout } : item
    return { ...source, layout: { ...copyLayout(source.layout), elements: {} } }
  }) }), [project, shot, layout])
  const requestBody = JSON.stringify({ project: requestProject, shotId: shot.id, ...(effectiveStage ? { stage: effectiveStage } : {}) })
  const circuit = project.circuits.find(item => item.id === shot.circuitAssetId)
  // Saving revisions, changing another shot, and moving objects never invalidate scene glyphs.
  const requestKey = JSON.stringify({
    title: project.title, settings: project.settings,
    problem: project.problem ? { text: project.problem.text, imageDataUrl: project.problem.imageDataUrl } : undefined,
    shot: { id: shot.id, story: shot.story, title: shot.title, sectionTitle: shot.sectionTitle, utteranceIds: shot.utteranceIds, circuitAssetId: shot.circuitAssetId, formulas: shot.formulas, actions: shot.actions, boardTexts: shot.boardTexts, highlights: shot.highlights },
    circuit: circuit ? { id: circuit.id, name: circuit.name, mode: circuit.mode, viewMode: circuit.viewMode, currentFlow: circuit.currentFlow, geometry: circuit.geometry, quantities: circuit.quantities, graph: circuit.geometry && !shot.actions.some(action => action.type === 'state') ? undefined : circuit.graph } : undefined,
    utterances: project.utterances.filter(item => shot.utteranceIds.includes(item.id)), speakers: project.speakers.map(({ id, name, color }) => ({ id, name, color })),
    template: layout.template, contentLayout: layout.contentLayout, hideProblemImage: layout.hideProblemImage, stage: effectiveStage,
    summary: summaryShotIds(requestProject).has(shot.id),
  })
  const shown = preview?.identity === identity ? preview : null
  const stale = !!shown && shown.requestKey !== requestKey
  const busy = loading || (stale && !error)
  const value = shown?.value
  const stillPresent = (id: string) => {
    if (id.startsWith('board:') && shot.boardTexts) return shot.boardTexts.some(item => 'board:' + item.id === id)
    if (id.startsWith('board-body:')) return shot.boardTexts?.some(item => !!item.card && 'board-body:' + item.id === id)
    if (id.startsWith('formula:')) return shot.formulas.some(item => 'formula:' + item.id === id)
    if (id.startsWith('circuit-label:')) return shot.actions.some(item => item.type === 'label' && 'circuit-label:' + item.id === id)
    if (id.startsWith('circuit-annotation:')) return shot.actions.some(item => item.type === 'annotation' && 'circuit-annotation:' + item.id === id)
    return id !== 'circuit' || !!shot.circuitAssetId || !shown?.circuitAssetId
  }
  const visibleElements = value?.elements.filter(element => element.visible && stillPresent(element.id) && (!element.parentId || stillPresent(element.parentId)) && !deletedIds.includes(element.id) && !deletedIds.includes(element.parentId || '') && !(layout.hideProblemImage && element.id === 'problem-image')) || []
  const editableElements = visibleElements.filter(element => element.kind !== 'background')
  const selected = editableElements.find(element => element.id === selectedId)
  const canEdit = !disabled && !shot.story && !!value
  const canEditText = !!selected?.source && ['title', 'cardTitle', 'board', 'formula', 'action'].includes(selected.source.type) && typeof selected.text === 'string' && !!onEditElement
    && (selected.source.type !== 'cardTitle' || !!shot.boardTexts?.some(board => board.id === selected.source!.id && board.card))
  const canHighlight = !!selected && !selected.selectionWarning && ['board', 'formula'].includes(selected.source?.type || '') && !!onCreateHighlight
  const canDelete = !!selected && (!!selected.source && ['cardTitle', 'board', 'formula', 'action'].includes(selected.source.type) || selected.id === 'problem-image') && !!onDeleteElement
    && !(selected?.source?.type === 'formula' && project.shots.some(item => item.formulas.some(formula => formula.correctionStepId === selected.source!.id)))
    && !(selected.id.startsWith('board-body:') && !shot.formulas.some(formula => formula.cardId === selected.source?.id))

  useEffect(() => {
    const id = ++requestId.current, controller = new AbortController()
    const delay = immediate.current ? 0 : 350
    immediate.current = false; setLoading(true); setError('')
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch('/api/video/scene-preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: requestBody, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(45_000)]) })
          let body: unknown
          try { body = await response.json() } catch { throw new Error('舞台预览返回了无效数据，请重试。') }
          if (!response.ok) throw new Error(body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : '舞台更新失败（' + response.status + '），请重试。')
          if (!validPreview(body)) throw new Error('舞台预览数据不完整，当前画面不能用于确认，请重试。')
          if (controller.signal.aborted || requestId.current !== id) return
          setPreview({ identity, requestKey, value: body, circuitAssetId: shot.circuitAssetId }); setDeletedIds([])
          setSelectedId(current => body.elements.some(element => element.id === current && element.visible && element.kind !== 'background') ? current : '')
          setLoading(false)
        } catch (reason) {
          if (controller.signal.aborted || requestId.current !== id) return
          setError(reason instanceof Error ? reason.name === 'TimeoutError' ? '舞台更新超时，请重试。' : reason.message : '舞台更新失败，请重试。')
          setLoading(false)
        }
      })()
    }, delay)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [identity, requestKey, retry])

  useEffect(() => {
    if (!stageExists) setStage(undefined)
    if (popover && !stillPresent(popover.element.id)) { setPopover(null); setTextRange(null); setToolMode('move') }
  }, [stageExists, shot.formulas, shot.actions, shot.boardTexts, shot.highlights])
  function currentPlacement(element: VideoPreviewElement): VideoElementPlacement {
    return resolveScenePlacement(value?.elements || [], layout.elements, element, dragPlacement || inputPlacement)
  }

  const selectedPlacement = selected ? currentPlacement(selected) : null
  useEffect(() => {
    if (drag.current || inputPlacement) return
    setFields(selectedPlacement ? { x: String(round(selectedPlacement.x)), y: String(round(selectedPlacement.y)), scale: String(round(selectedPlacement.scale)) } : { x: '', y: '', scale: '' })
  }, [selectedId, selectedPlacement?.x, selectedPlacement?.y, selectedPlacement?.scale, inputPlacement])
  useEffect(() => { if (disabled) { drag.current = null; textDrag.current = null; setDragPlacement(null); setInputPlacement(null); setPopover(null); setTextRange(null); setToolMode('move') } }, [disabled])

  function commit(next: VideoShotLayout) {
    if (disabled || JSON.stringify(next) === JSON.stringify(layout)) return
    setHistory(items => [...items.slice(-29), copyLayout(layout)])
    immediate.current = true; setLayout(next); setInputPlacement(null)
    propsRef.current.onChangeLayout(copyLayout(next))
  }
  function commitPlacement(element: VideoPreviewElement, placement: VideoElementPlacement) {
    const bounded = constrain(element, placement)
    commit({ ...layout, elements: moveSceneElement(value?.elements || [], layout.elements, element, bounded) })
  }
  function beginDrag(event: PointerEvent<HTMLButtonElement>, element: VideoPreviewElement) {
    if (!canEdit || event.button !== 0) return
    event.preventDefault(); setSelectedId(element.id); event.currentTarget.focus({ preventScroll: true })
    if (toolMode === 'select' && selectedId === element.id && element.characters?.length && element.text) {
      const index = characterAt(event, element)
      if (index < 0) return
      textDrag.current = { id: element.id, pointerId: event.pointerId, element, anchor: index, focus: index }
      setTextRange({ id: element.id, selection: rangeFor(element, index, index) }); event.currentTarget.setPointerCapture(event.pointerId); return
    }
    setTextRange(null); setPopover(null); setToolMode('move')
    const rect = canvas.current?.getBoundingClientRect()
    if (!rect?.width || !rect.height) return
    const initial = currentPlacement(element)
    drag.current = { id: element.id, element, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, initial, placement: initial, width: rect.width, height: rect.height }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    const textActive = textDrag.current
    if (textActive?.pointerId === event.pointerId) {
      const index = characterAt(event, textActive.element)
      if (index >= 0) { textActive.focus = index; setTextRange({ id: textActive.id, selection: rangeFor(textActive.element, textActive.anchor, index) }) }
      return
    }
    const active = drag.current
    if (!active || active.pointerId !== event.pointerId) return
    const placement = constrain(active.element, { ...active.initial, x: active.initial.x + (event.clientX - active.startX) * WIDTH / active.width, y: active.initial.y + (event.clientY - active.startY) * HEIGHT / active.height })
    active.placement = placement; setDragPlacement({ id: active.id, placement })
  }
  function endDrag(event: PointerEvent<HTMLButtonElement>, cancel = false) {
    const textActive = textDrag.current
    if (textActive?.pointerId === event.pointerId) {
      textDrag.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      const selection = rangeFor(textActive.element, textActive.anchor, textActive.focus)
      if (!cancel && selection.phrase) openPopover(textActive.element, 'highlight', selection)
      else setTextRange(null)
      return
    }
    const active = drag.current
    if (!active || active.pointerId !== event.pointerId) return
    drag.current = null; setDragPlacement(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (!cancel && (active.placement.x !== active.initial.x || active.placement.y !== active.initial.y)) commitPlacement(active.element, active.placement)
  }
  function nudge(event: KeyboardEvent<HTMLButtonElement>, element: VideoPreviewElement) {
    if (canEdit && ['Delete', 'Backspace'].includes(event.key) && selectedId === element.id) { event.preventDefault(); deleteSelected(); return }
    if (!canEdit || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault(); setSelectedId(element.id)
    const step = event.shiftKey ? 10 : 1, previous = currentPlacement(element)
    commitPlacement(element, { ...previous, x: previous.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0), y: previous.y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0) })
  }
  function changeField(key: keyof VideoElementPlacement, text: string) {
    setFields(current => ({ ...current, [key]: text }))
    if (!selected || !selectedPlacement || !text.trim() || !Number.isFinite(Number(text))) return
    setInputPlacement({ id: selected.id, placement: constrain(selected, { ...selectedPlacement, [key]: Number(text) }) })
  }
  function finishField(key: keyof VideoElementPlacement) {
    if (cancelField.current || !selected || !selectedPlacement || !fields[key].trim() || !Number.isFinite(Number(fields[key]))) {
      cancelField.current = false; setInputPlacement(null)
      if (selected) setFields({ x: String(round((layout.elements[selected.id] || selected.placement).x)), y: String(round((layout.elements[selected.id] || selected.placement).y)), scale: String(round((layout.elements[selected.id] || selected.placement).scale)) })
      return
    }
    const next = constrain(selected, { ...selectedPlacement, [key]: Number(fields[key]) })
    setInputPlacement(null)
    if (next.x !== (layout.elements[selected.id] || selected.placement).x || next.y !== (layout.elements[selected.id] || selected.placement).y || next.scale !== (layout.elements[selected.id] || selected.placement).scale) commitPlacement(selected, next)
  }
  function undo() {
    const previous = history.at(-1)
    if (!previous || disabled) return
    immediate.current = true; setHistory(items => items.slice(0, -1)); setLayout(copyLayout(previous)); setInputPlacement(null)
    propsRef.current.onChangeLayout(copyLayout(previous))
  }
  function elementStyle(element: VideoPreviewElement): CSSProperties {
    const placement = currentPlacement(element), factor = placement.scale / element.placement.scale
    return { left: (placement.x + (element.box.x - element.placement.x) * factor) / WIDTH * 100 + '%', top: (placement.y + (element.box.y - element.placement.y) * factor) / HEIGHT * 100 + '%', width: element.box.width * factor / WIDTH * 100 + '%', height: element.box.height * factor / HEIGHT * 100 + '%' }
  }
  function chooseTemplate(template: VideoShotLayout['template']) { commit({ ...layout, template, elements: {} }) }
  function characterAt(event: PointerEvent<HTMLButtonElement>, element: VideoPreviewElement): number {
    const rect = canvas.current?.getBoundingClientRect(), placement = currentPlacement(element)
    if (!rect?.width || !element.characters?.length) return -1
    const factor = placement.scale / element.placement.scale
    const x = element.placement.x + ((event.clientX - rect.left) / rect.width * WIDTH - placement.x) / factor
    const y = element.placement.y + ((event.clientY - rect.top) / rect.height * HEIGHT - placement.y) / factor
    let best = -1, distance = Infinity
    element.characters.forEach((character, index) => {
      const box = character.box, dx = Math.max(box.x - x, 0, x - box.x - box.width), dy = Math.max(box.y - y, 0, y - box.y - box.height)
      const next = dx * dx + dy * dy * 4
      if (next < distance) { distance = next; best = index }
    })
    return best
  }
  function rangeFor(element: VideoPreviewElement, anchor: number, focus: number): SceneTextSelection {
    const characters = element.characters || [], first = characters[Math.min(anchor, focus)], last = characters[Math.max(anchor, focus)]
    return textSelection(element.text || '', first?.start || 0, last?.end || 0)
  }
  function openPopover(element: VideoPreviewElement, mode: 'edit' | 'highlight', selection?: SceneTextSelection) {
    if (!canEdit || !element.source || !['title', 'cardTitle', 'board', 'formula', 'action'].includes(element.source.type) || typeof element.text !== 'string') return
    if (element.source.type === 'cardTitle' && !shot.boardTexts?.some(board => board.id === element.source!.id && board.card)) return
    if (mode === 'edit' && !onEditElement || mode === 'highlight' && !onCreateHighlight) return
    const node = canvas.current?.querySelector<HTMLElement>('[data-scene-element="' + CSS.escape(element.id) + '"]')
    const rect = node?.getBoundingClientRect() || canvas.current?.getBoundingClientRect()
    const latestText = element.source.type === 'board' ? shot.boardTexts?.find(item => item.id === element.source!.id)?.text : element.source.type === 'formula' ? shot.formulas.find(item => item.id === element.source!.id)?.latex : element.source.type === 'action' ? shot.actions.find(item => item.id === element.source!.id)?.text : shot.sectionTitle || project.title
    const liveElement = latestText === undefined ? element : { ...element, text: latestText }
    setSelectedId(element.id); setPopover({ element: liveElement, mode, selection, left: rect?.left || 12, top: (rect?.bottom || 80) + 8 })
  }
  function beginSelectText() {
    if (!selected || !canHighlight) return
    setPopover(null); setTextRange(null)
    if (selected.textKind === 'latex' || !selected.characters?.length) openPopover(selected, 'highlight')
    else setToolMode('select')
  }
  function deleteSelected() {
    if (!selected || !canDelete || !canEdit) return
    setDeletedIds(ids => [...ids, selected.id]); setSelectedId(''); setPopover(null); setTextRange(null); setStage(undefined)
    onDeleteElement?.(selected)
  }
  function selectionRects(element: VideoPreviewElement) {
    if (textRange?.id !== element.id || !element.box.width || !element.box.height) return null
    return element.characters?.filter(character => character.start < textRange.selection.end && character.end > textRange.selection.start).map((character, index) => <span key={index} className="video-scene-character-selection" style={{ left: (character.box.x - element.box.x) / element.box.width * 100 + '%', top: (character.box.y - element.box.y) / element.box.height * 100 + '%', width: character.box.width / element.box.width * 100 + '%', height: character.box.height / element.box.height * 100 + '%' }} />)
  }

  return <section className="video-scene-editor" aria-label="同源场景编辑器">
    <div className="video-scene-toolbar"><div><strong><MousePointer2 size={16} />{shot.story ? '剧情插画预览' : '画面布局'}</strong><span>{shot.story ? '1920 × 1080 · 插画与字幕' : '1920 × 1080 · 正文 42 px · 固定行距 56 px'}</span></div><div className="video-scene-toolbar-actions"><button type="button" onClick={undo} disabled={disabled || !history.length}><Undo2 size={14} />撤销</button><button type="button" disabled={!canEdit || !Object.keys(layout.elements).length} onClick={() => commit({ ...layout, elements: {} })}><RotateCcw size={14} />整页恢复默认</button></div></div>
    {!shot.story && <div className="video-scene-selectors"><label>画面阶段<select aria-label="舞台画面阶段" value={stage || value?.stage || ''} disabled={disabled || !value?.stages.length} onChange={event => { immediate.current = true; setStage(event.target.value); setInputPlacement(null) }}>{!value && <option value="">正在读取阶段</option>}{value?.stages.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label><label>页面板式<select aria-label="舞台页面板式" value={layout.template} disabled={disabled || !value} onChange={event => chooseTemplate(event.target.value as VideoShotLayout['template'])}>{templates.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>内容布局<select aria-label="舞台内容布局" value={layout.contentLayout || 'auto'} disabled={disabled || !value} onChange={event => commit({ ...layout, contentLayout: event.target.value as VideoShotLayout['contentLayout'], elements: {} })}><option value="auto">自动安排</option><option value="circuit-left">左侧电路 · 右侧知识卡</option><option value="cards-grid">知识卡网格</option></select></label></div>}
    {!shot.story && <details className="video-scene-templates"><summary>查看板式参考</summary><div>{templates.map(item => <button type="button" key={item.id} aria-label={`使用${item.name}板式`} aria-pressed={layout.template === item.id} disabled={disabled || !value} onClick={() => chooseTemplate(item.id)}><img src={item.image} alt="" draggable={false} /><span>{item.name}{layout.template === item.id && <Check size={12} />}</span></button>)}</div></details>}
    {value?.template === 'summary' && <p className="video-scene-summary-hint">总结页内容限定在白色框内。整片渲染进入总结页前，自动播放默认转场。</p>}
    <div ref={canvas} className={`video-scene-canvas ${error ? 'has-error' : ''}`} role="group" aria-label="1920×1080 画面舞台" aria-busy={busy} data-preview-state={error ? 'error' : busy ? 'loading' : 'ready'} style={{ backgroundColor: value?.background || '#ffffff', backgroundImage: value?.backgroundImage ? `url("${value.backgroundImage}")` : undefined }}>
      {selected && canEdit && <div className="video-scene-context-tools" role="toolbar" aria-label="画面对象工具"><button type="button" aria-pressed={toolMode === 'move'} onClick={() => { setToolMode('move'); setTextRange(null) }}><MousePointer2 size={14} />移动</button>{canEditText && <button type="button" onClick={() => openPopover(selected, 'edit')}><Pencil size={14} />编辑内容</button>}{canHighlight && <button type="button" aria-pressed={toolMode === 'select'} onClick={beginSelectText}><Highlighter size={14} />选词高亮</button>}{canDelete && <button type="button" className="danger" onClick={deleteSelected}><Trash2 size={14} />删除对象</button>}</div>}
      {visibleElements.map(element => element.kind === 'background' ? <img className="video-scene-background" key={element.id} data-scene-element={element.id} data-scene-kind={element.kind} src={'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(element.svg)} alt="" draggable={false} style={elementStyle(element)} /> : <button type="button" className={`video-scene-element ${selectedId === element.id ? 'selected' : ''} ${selectedId === element.id && toolMode === 'select' ? 'selecting-text' : ''}`} key={element.id} data-scene-element={element.id} data-scene-kind={element.kind} data-scene-parent={element.parentId} aria-label={`选择元素：${element.label}`} aria-pressed={selectedId === element.id} style={elementStyle(element)} disabled={!canEdit} onPointerDown={event => beginDrag(event, element)} onPointerMove={moveDrag} onPointerUp={event => endDrag(event)} onPointerCancel={event => endDrag(event, true)} onLostPointerCapture={() => { if (drag.current?.id === element.id) { drag.current = null; setDragPlacement(null) } }} onClick={() => setSelectedId(element.id)} onDoubleClick={() => openPopover(element, 'edit')} onKeyDown={event => nudge(event, element)}><img src={'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(element.svg)} alt="" draggable={false} />{selectionRects(element)}</button>)}
      {!value && <div className="video-scene-overlay" role={error ? 'alert' : 'status'}>{error ? <><strong>画面加载失败</strong><p>{error}</p><button type="button" onClick={() => { immediate.current = true; setRetry(current => current + 1) }}><RefreshCw size={14} />重试舞台预览</button></> : <><Loader2 className="video-scene-spin" size={22} /><strong>正在生成画面…</strong></>}</div>}

    </div>
    {!!value && (busy || error) && <div className={`video-scene-refresh-status ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}>{error ? <><span>画面更新失败：{error} 当前显示上次画面，位置仍可调整。</span><button type="button" onClick={() => { immediate.current = true; setRetry(current => current + 1) }}><RefreshCw size={13} />重试舞台预览</button></> : <><Loader2 className="video-scene-spin" size={13} /><span>正在更新内容，可以继续调整位置。</span></>}</div>}
    {popover && !disabled && <VideoScenePopover key={popover.element.id + ':' + popover.mode} state={popover} project={project} shot={shot} onClose={() => { setPopover(null); setToolMode('move'); setTextRange(null) }} onEdit={(element, text) => onEditElement?.(element, text)} onHighlight={(element, selection) => onCreateHighlight?.(element, selection)} />}
    {toolMode === 'select' && selected?.characters?.length && !popover ? <p className="video-scene-selection-hint">在选中对象上拖选文字，松开后设置颜色、时长和同步旁白。</p> : null}
    <p className="video-scene-spec"><Grip size={13} />正文 42 px / 行距 56 px。拖动即时生效，双击文字或公式编辑；方向键移动 1 px，按住 Shift 移动 10 px。缩放从元素左上角展开。</p>
    {!!value?.warnings.length && <div className="video-scene-warnings" aria-label="画面审核提示">{value.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div>}
    <div className="video-scene-properties"><div className="video-scene-element-list" aria-label="舞台可选元素"><strong>选择元素</strong><div>{editableElements.length ? editableElements.map(element => <button type="button" key={element.id} aria-pressed={selectedId === element.id} disabled={!canEdit} onClick={() => { setSelectedId(element.id); setInputPlacement(null); setTextRange(null); setToolMode('move') }} onKeyDown={event => nudge(event, element)}>{element.label}<small>{element.kind}</small></button>) : <span>当前阶段没有可编辑元素。</span>}</div></div><fieldset className="video-scene-position" disabled={!canEdit || !selected}><legend>{selected ? selected.label : '选择一个元素调整位置'}</legend><div>{(['x', 'y', 'scale'] as const).map(key => <label key={key}>{key === 'scale' ? '缩放倍数' : key.toUpperCase() + ' / px'}<input aria-label={`舞台元素${key === 'scale' ? '缩放' : key.toUpperCase()}`} type="number" value={fields[key]} min={key === 'scale' ? .2 : 0} max={key === 'scale' ? 4 : key === 'x' ? WIDTH : HEIGHT} step={key === 'scale' ? .05 : 1} onChange={event => changeField(key, event.target.value)} onBlur={() => finishField(key)} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { cancelField.current = true; event.currentTarget.blur() } }} /></label>)}</div><button type="button" disabled={!canEdit || !selected || !layout.elements[selected.id]} onClick={() => { if (!selected) return; const defaults = { ...layout.elements }; delete defaults[selected.id]; const placement = resolveScenePlacement(value?.elements || [], defaults, selected); const elements = moveSceneElement(value?.elements || [], layout.elements, selected, placement); delete elements[selected.id]; commit({ ...layout, elements }) }}><RotateCcw size={13} />此元素恢复默认</button></fieldset></div>
  </section>
}
