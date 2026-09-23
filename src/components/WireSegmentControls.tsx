import { useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { useReactFlow, useViewport } from '@xyflow/react'
import { svgPathProperties } from 'svg-path-properties'
import { useCircuitStore } from '../store/circuitStore'
import { getEditableWirePoints, getManualWirePoints, moveWireSegment, type WirePoint } from '../lib/wireEditing'
import type { WireEndpoint } from '../lib/wireRenderer'
import type { ViewMode } from '../types/circuit'
import '../styles/wireEditing.css'

interface Drag { pointerId: number; start: WirePoint; points: WirePoint[]; index: number; horizontal: boolean; original: WirePoint[] | null }
let gestureActive = false

export function WireSegmentControls({ id, mode, path, source, target }: {
  id: string; mode: ViewMode; path: string; source: WireEndpoint; target: WireEndpoint
}) {
  const flow = useReactFlow()
  const flowRef = useRef(flow); flowRef.current = flow
  const { zoom } = useViewport()
  const drag = useRef<Drag | null>(null)
  const route = useCircuitStore(state => state.graph.connections.find(connection => connection.id === id)?.routes?.[mode])
  const points = useMemo(() => {
    if (route) return getManualWirePoints(mode, source, target, route)
    const parsed = getEditableWirePoints(path)
    if (mode === 'schematic' || parsed.length > 2) return parsed
    try {
      const measure = new svgPathProperties(path), length = measure.getTotalLength()
      return [source, measure.getPointAtLength(length / 3), measure.getPointAtLength(length * 2 / 3), target]
    } catch { return parsed }
  }, [route, mode, path, source.x, source.y, source.position, target.x, target.y, target.position])
  const pointsRef = useRef(points); pointsRef.current = points

  const start = (event: ReactPointerEvent<SVGGElement>, index: number, horizontal: boolean) => {
    if (event.button !== 0 || gestureActive) return
    event.preventDefault(); event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const store = useCircuitStore.getState(), graphId = store.graph.id
    store.cancelWire(); store.beginHistoryTransaction()
    drag.current = { pointerId: event.pointerId, start: flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
      points: pointsRef.current.map(point => ({ ...point })), index, horizontal, original: route ? route.points.map(point => ({ ...point })) : null }
    gestureActive = true
    let unsubscribe = () => {}
    // React Flow may remount an edge while node internals update; own the gesture until release.
    const finish = (aborted: boolean) => {
      if (!drag.current) return
      drag.current = null
      gestureActive = false
      window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', pointerCancel, true); window.removeEventListener('blur', cancel)
      window.removeEventListener('keydown', key, true)
      unsubscribe()
      const store = useCircuitStore.getState()
      if (aborted) store.cancelHistoryTransaction()
      else store.endHistoryTransaction()
    }
    const move = (event: PointerEvent) => {
      const gesture = drag.current
      if (!gesture || gesture.pointerId !== event.pointerId) return
      event.preventDefault(); event.stopPropagation()
      const current = flowRef.current.screenToFlowPosition({ x: event.clientX, y: event.clientY })
      const dx = current.x - gesture.start.x, dy = current.y - gesture.start.y
      if ((mode === 'schematic' ? Math.abs(gesture.horizontal ? dy : dx) : Math.hypot(dx, dy)) < 0.1) {
        useCircuitStore.getState().updateConnectionRoute(id, mode, gesture.original)
        return
      }
      const next = mode === 'schematic'
        ? moveWireSegment(gesture.points, gesture.index, gesture.horizontal ? current.y - gesture.start.y : current.x - gesture.start.x)
        : gesture.points.map((point, index) => index === gesture.index ? { x: point.x + current.x - gesture.start.x, y: point.y + current.y - gesture.start.y } : point)
      useCircuitStore.getState().updateConnectionRoute(id, mode, next)
    }
    const up = (event: PointerEvent) => { if (event.pointerId === drag.current?.pointerId) { event.stopPropagation(); finish(false) } }
    const cancel = () => finish(true)
    const pointerCancel = (event: PointerEvent) => { if (event.pointerId === drag.current?.pointerId) finish(true) }
    const key = (event: KeyboardEvent) => {
      if (!drag.current) return
      if (event.key === 'Delete' || event.key === 'Backspace') { finish(true); return }
      if (event.key === 'Escape' || ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase()))) {
        event.preventDefault(); event.stopImmediatePropagation(); finish(true)
      }
    }
    window.addEventListener('pointermove', move, { capture: true, passive: false })
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', pointerCancel, true)
    window.addEventListener('blur', cancel)
    window.addEventListener('keydown', key, true)
    unsubscribe = useCircuitStore.subscribe(state => {
      if (state.graph.id !== graphId || state.viewMode !== mode || state.toolMode !== 'select' || state.selectedConnectionId !== id) finish(true)
    })
  }
  const controls = mode === 'schematic' ? points.slice(0, -1).map((point, index) => {
    const end = points[index + 1], horizontal = Math.abs(point.y - end.y) < 0.001
    return { index, horizontal, x: (point.x + end.x) / 2, y: (point.y + end.y) / 2, length: Math.hypot(end.x - point.x, end.y - point.y) }
  }).filter(control => control.length * zoom >= 28)
    : points.slice(1, -1).map((point, index) => ({ ...point, index: index + 1, horizontal: false, length: 100 }))
  return <g className="wire-edit-controls nodrag nopan" data-wire-edit-id={id}>
    {controls.map(control => <g key={control.index} role="button" tabIndex={0}
      aria-label={mode === 'schematic' ? `调整导线段 ${control.index + 1}` : `调整导线弯曲点 ${control.index}`}
      data-wire-control={control.index} data-axis={mode === 'real' ? 'both' : control.horizontal ? 'y' : 'x'}
      className={`wire-segment-control nodrag nopan ${mode === 'real' ? 'free' : control.horizontal ? 'horizontal' : 'vertical'}`}
      transform={`translate(${control.x} ${control.y}) scale(${1 / zoom})`} onPointerDown={event => start(event, control.index, control.horizontal)}
      onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
      onKeyDown={event => {
        const amount = event.shiftKey ? 20 : 5
        const delta = event.key === 'ArrowLeft' ? { x: -amount, y: 0 } : event.key === 'ArrowRight' ? { x: amount, y: 0 }
          : event.key === 'ArrowUp' ? { x: 0, y: -amount } : event.key === 'ArrowDown' ? { x: 0, y: amount } : null
        if (!delta) return
        event.preventDefault(); event.stopPropagation()
        if (mode === 'schematic' && (control.horizontal ? delta.y : delta.x) === 0) return
        const next = mode === 'schematic' ? moveWireSegment(points, control.index, control.horizontal ? delta.y : delta.x)
          : points.map((point, index) => index === control.index ? { x: point.x + delta.x, y: point.y + delta.y } : point)
        useCircuitStore.getState().updateConnectionRoute(id, mode, next)
      }}>
      <title>{mode === 'schematic' ? '调整线段位置' : '调整线缆弯曲'}</title>
      <circle className="wire-control-hit" r="14" />
      <rect className="wire-control-mark" x="-4" y="-4" width="8" height="8" rx="1" />
    </g>)}
  </g>
}
