import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Crosshair, Grid3X3, Magnet, Maximize, Minus, Plus } from 'lucide-react'
import { OpticalImageArrow, OpticalSymbol, opticalSymbolBounds } from './OpticalSymbol'
import { createOpticalComponent, opticalLibrary } from './library'
import { measureImages, simulateOptics, wavelengthColor } from './simulation'
import { useOpticsStore } from './store'
import type { OpticalComponent, OpticsKind, Vec2 } from './types'

type Camera = { x: number; y: number; width: number }
type Drag = { type: 'move'; id: string; start: Vec2; origin: Vec2; pointerId: number } | { type: 'pan'; clientX: number; clientY: number; camera: Camera; pointerId: number }
type Bounds = { x: number; y: number; width: number; height: number }
const finitePoint = (point: Vec2) => Number.isFinite(point.x) && Number.isFinite(point.y)
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value))

function toWorld(c: OpticalComponent, point: Vec2): Vec2 {
  const angle = c.angle * Math.PI / 180
  return { x: c.x + point.x * Math.cos(angle) - point.y * Math.sin(angle), y: c.y + point.x * Math.sin(angle) + point.y * Math.cos(angle) }
}

/** Clip rays before producing SVG paths, including long near-focal image extensions. */
function clipLine(from: Vec2, to: Vec2, box: Bounds): [Vec2, Vec2] | null {
  if (!finitePoint(from) || !finitePoint(to)) return null
  const dx = to.x - from.x, dy = to.y - from.y
  let start = 0, end = 1
  const p = [-dx, dx, -dy, dy]
  const q = [from.x - box.x, box.x + box.width - from.x, from.y - box.y, box.y + box.height - from.y]
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-12) { if (q[i] < 0) return null; continue }
    const t = q[i] / p[i]
    if (p[i] < 0) start = Math.max(start, t)
    else end = Math.min(end, t)
    if (start > end) return null
  }
  return [{ x: from.x + dx * start, y: from.y + dy * start }, { x: from.x + dx * end, y: from.y + dy * end }]
}

export function OpticsCanvas({ placement, onPlaced }: { placement: OpticsKind | null; onPlaced: () => void }) {
  const store = useOpticsStore()
  const { scene, selectedId, running, tool } = store
  const svgRef = useRef<SVGSVGElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const [aspect, setAspect] = useState(1.5)
  const [surfaceWidth, setSurfaceWidth] = useState(980)
  const [camera, setCamera] = useState<Camera>({ x: 50, y: 34, width: 102 })
  const [hover, setHover] = useState<Vec2 | null>(null)
  const [dragging, setDragging] = useState(false)
  const id = useId().replace(/:/g, '')
  const view = useMemo(() => ({ x: camera.x - camera.width / 2, y: camera.y - camera.width / aspect / 2, width: camera.width, height: camera.width / aspect }), [camera, aspect])
  const simulated = useRef<{ simulation: ReturnType<typeof simulateOptics>; measurements: ReturnType<typeof measureImages> } | null>(null)
  const results = useMemo(() => {
    if (running || !simulated.current) simulated.current = { simulation: simulateOptics(scene), measurements: measureImages(scene) }
    return simulated.current
  }, [scene, running])
  const { simulation, measurements } = results
  const fit = useCallback(() => {
    const points = scene.components.flatMap(c => {
      const b = opticalSymbolBounds(c)
      return [{ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y }, { x: b.x, y: b.y + b.height }, { x: b.x + b.width, y: b.y + b.height }].map(p => toWorld(c, p))
    }).concat(measureImages(scene).flatMap(measurement => measurement.imagePoint && measurement.imageBase ? [measurement.imagePoint, measurement.imageBase] : [])).filter(finitePoint)
    if (!points.length) { setCamera({ x: 50, y: 34, width: Math.max(100, 68 * aspect) }); return }
    const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x))
    const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y))
    setCamera({ x: (minX + maxX) / 2, y: (minY + maxY) / 2, width: Math.max(85, maxX - minX + 24, (maxY - minY + 22) * aspect) })
  }, [scene, aspect])

  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect
      if (rect && rect.width > 0 && rect.height > 0) { setAspect(rect.width / rect.height); setSurfaceWidth(rect.width) }
    })
    observer.observe(surface)
    return () => observer.disconnect()
  }, [])
  useEffect(() => { window.addEventListener('optics:fit', fit); return () => window.removeEventListener('optics:fit', fit) }, [fit])
  useEffect(() => () => { if (drag.current?.type === 'move') useOpticsStore.getState().cancelTransaction() }, [])

  const worldPoint = useCallback((clientX: number, clientY: number): Vec2 | null => {
    const svg = svgRef.current, matrix = svg?.getScreenCTM()
    if (!svg || !matrix) return null
    const p = svg.createSVGPoint(); p.x = clientX; p.y = clientY
    const result = p.matrixTransform(matrix.inverse())
    return finitePoint(result) ? { x: result.x, y: result.y } : null
  }, [])
  const snapped = (point: Vec2) => ({ x: clamp(scene.settings.snap ? Math.round(point.x) : Math.round(point.x * 10) / 10, -1000, 1000), y: clamp(scene.settings.snap ? Math.round(point.y) : Math.round(point.y * 10) / 10, -1000, 1000) })
  const place = (kind: OpticsKind, point: Vec2) => { const p = snapped(point); store.add(kind, p.x, p.y); onPlaced(); svgRef.current?.focus() }
  const zoom = useCallback((factor: number, anchor?: Vec2) => {
    setCamera(previous => {
      const width = clamp(previous.width * factor, 12, 2200)
      const center = anchor ?? { x: previous.x, y: previous.y }
      const ratio = width / previous.width
      return { x: center.x + (previous.x - center.x) * ratio, y: center.y + (previous.y - center.y) * ratio, width }
    })
  }, [])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const wheel = (event: WheelEvent) => { event.preventDefault(); const p = worldPoint(event.clientX, event.clientY); if (p) zoom(Math.exp(clamp(event.deltaY, -120, 120) * .0018), p) }
    svg.addEventListener('wheel', wheel, { passive: false })
    return () => svg.removeEventListener('wheel', wheel)
  }, [worldPoint, zoom])

  const beginPan = (event: React.PointerEvent<SVGElement>) => {
    drag.current = { type: 'pan', clientX: event.clientX, clientY: event.clientY, camera, pointerId: event.pointerId }
    svgRef.current?.setPointerCapture(event.pointerId); setDragging(true)
  }
  const componentDown = (event: React.PointerEvent<SVGGElement>, c: OpticalComponent) => {
    if (event.button !== 0 && event.button !== 1) return
    event.preventDefault(); event.stopPropagation(); svgRef.current?.focus()
    if (tool === 'pan' || event.button === 1) { beginPan(event); return }
    if (placement) { const p = worldPoint(event.clientX, event.clientY); if (p) place(placement, p); return }
    const start = worldPoint(event.clientX, event.clientY)
    if (!start) return
    store.select(c.id); store.beginTransaction()
    drag.current = { type: 'move', id: c.id, start, origin: { x: c.x, y: c.y }, pointerId: event.pointerId }
    svgRef.current?.setPointerCapture(event.pointerId); setDragging(true)
  }
  const movePointer = (event: React.PointerEvent<SVGSVGElement>) => {
    const current = drag.current, point = worldPoint(event.clientX, event.clientY)
    if (point) setHover(snapped(point))
    if (!current || event.pointerId !== current.pointerId) return
    if (current.type === 'move' && point) store.update(current.id, snapped({ x: current.origin.x + point.x - current.start.x, y: current.origin.y + point.y - current.start.y }))
    if (current.type === 'pan') {
      const width = svgRef.current?.getBoundingClientRect().width || 1
      setCamera({ ...current.camera, x: current.camera.x - (event.clientX - current.clientX) * current.camera.width / width, y: current.camera.y - (event.clientY - current.clientY) * current.camera.width / width })
    }
  }
  const finishDrag = (cancel = false) => {
    const current = drag.current
    drag.current = null; setDragging(false)
    if (!current) return
    if (current.type === 'move') { if (cancel) store.cancelTransaction(); else store.endTransaction() }
    if (cancel && current.type === 'pan') setCamera(current.camera)
    if (svgRef.current?.hasPointerCapture(current.pointerId)) svgRef.current.releasePointerCapture(current.pointerId)
  }
  const keyDown = (event: React.KeyboardEvent<SVGSVGElement>) => {
    if ((event.target as Element).closest('input,textarea,select,[contenteditable="true"]')) return
    const key = event.key.toLowerCase(), modifier = event.ctrlKey || event.metaKey
    if (key === 'escape') { event.preventDefault(); finishDrag(true); onPlaced(); store.select(null) }
    else if (modifier && key === 'z') { event.preventDefault(); finishDrag(); if (event.shiftKey) store.redo(); else store.undo() }
    else if (modifier && key === 'y') { event.preventDefault(); finishDrag(); store.redo() }
    else if ((key === 'delete' || key === 'backspace') && selectedId) { event.preventDefault(); finishDrag(); store.remove(selectedId) }
    else if (modifier && key === 'd' && selectedId) { event.preventDefault(); store.duplicate(selectedId) }
    else if (key === 'r' && selectedId) { const c = scene.components.find(item => item.id === selectedId); if (c) { event.preventDefault(); store.update(c.id, { angle: c.angle + (event.shiftKey ? -15 : 15) }) } }
    else if (key === 'f' || key === '0') { event.preventDefault(); fit() }
    else if (key === '+' || key === '=') { event.preventDefault(); zoom(.8) }
    else if (key === '-') { event.preventDefault(); zoom(1.25) }
    else if (key.startsWith('arrow') && selectedId) {
      const c = scene.components.find(item => item.id === selectedId)
      if (c) { event.preventDefault(); const amount = event.shiftKey ? 5 : 1; store.update(c.id, { x: clamp(c.x + (key === 'arrowright' ? amount : key === 'arrowleft' ? -amount : 0), -1000, 1000), y: clamp(c.y + (key === 'arrowdown' ? amount : key === 'arrowup' ? -amount : 0), -1000, 1000) }) }
    }
  }
  const raySegments = simulation.segments.filter(r => scene.settings.showVirtual || !r.virtual).flatMap((ray, index) => {
    const clipped = clipLine(ray.from, ray.to, view)
    return clipped ? [{ ray, index, from: clipped[0], to: clipped[1] }] : []
  })
  const arrowScale = view.width / surfaceWidth
  const rayArrows: { x: number; y: number; angle: number; index: number }[] = []
  for (const { ray, index, from, to } of raySegments) {
    if (ray.virtual || Math.hypot(to.x - from.x, to.y - from.y) < 32 * arrowScale) continue
    const x = from.x + (to.x - from.x) * .55, y = from.y + (to.y - from.y) * .55
    // Closely spaced rays share a direction cue instead of overlapping arrows.
    if (rayArrows.some(arrow => Math.hypot(arrow.x - x, arrow.y - y) < 15 * arrowScale)) continue
    rayArrows.push({ x, y, angle: Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI, index })
  }
  const axisComponents = scene.components
    .filter(c => c.enabled && ['convex-lens', 'concave-lens', 'plane-mirror'].includes(c.kind))
  const axisKeys = new Set<string>()
  const axes = axisComponents.filter(c => { const key = `${Math.round(c.angle * 10)}-${Math.round((c.y * Math.cos(c.angle * Math.PI / 180) - c.x * Math.sin(c.angle * Math.PI / 180)) * 10)}`; if (axisKeys.has(key)) return false; axisKeys.add(key); return true })
  const gridSize = camera.width > 600 ? 50 : camera.width > 200 ? 10 : 5
  const preview = placement && hover ? createOpticalComponent(placement, hover.x, hover.y) : null

  return <div className="optics-canvas-surface" ref={surfaceRef} style={{ position: 'relative', width: '100%', height: '100%', minHeight: 260, overflow: 'hidden' }}>
    <svg ref={svgRef} data-testid="optics-canvas" data-optics-svg="true" xmlns="http://www.w3.org/2000/svg" className={`optics-svg ${running && scene.settings.animate ? 'is-running' : ''}`} viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`} tabIndex={0} role="application" aria-label="光学实验画布；拖动组件，滚轮缩放，R 旋转，方向键移动，Delete 删除" style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none', outline: 'none', cursor: placement ? 'crosshair' : tool === 'pan' ? (dragging ? 'grabbing' : 'grab') : 'default' }}
      onKeyDown={keyDown} onPointerMove={movePointer} onPointerUp={() => finishDrag()} onPointerCancel={() => finishDrag(true)} onLostPointerCapture={() => finishDrag()} onPointerLeave={() => { if (!drag.current) setHover(null) }}
      onPointerDown={event => { if (event.button !== 0 && event.button !== 1) return; event.preventDefault(); svgRef.current?.focus(); if (event.button === 1 || tool === 'pan') beginPan(event); else { const point = worldPoint(event.clientX, event.clientY); if (placement && point) place(placement, point); else store.select(null) } }}
      onDragOver={event => { if (event.dataTransfer.types.includes('opticsKind') || event.dataTransfer.types.includes('opticskind')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; const point = worldPoint(event.clientX, event.clientY); if (point) setHover(snapped(point)) } }}
      onDrop={event => { event.preventDefault(); const kind = event.dataTransfer.getData('opticsKind') as OpticsKind; const point = worldPoint(event.clientX, event.clientY); if (opticalLibrary[kind] && point) place(kind, point) }}>
      <defs><pattern id={`${id}-grid`} width={gridSize} height={gridSize} patternUnits="userSpaceOnUse"><path d={`M${gridSize} 0H0V${gridSize}`} fill="none" stroke="#dfe7e1" strokeWidth=".6" vectorEffect="non-scaling-stroke" /></pattern><clipPath id={`${id}-clip`}><rect {...view} /></clipPath><style>{`@keyframes optics-travel-${id}{to{stroke-dashoffset:-12}} .optics-flow-${id}{animation:optics-travel-${id} 1.2s linear infinite} @media(prefers-reduced-motion:reduce){.optics-flow-${id}{animation:none}}`}</style></defs>
      <rect {...view} fill="#f8faf9" />
      {scene.settings.showGrid && <rect {...view} fill={`url(#${id}-grid)`} pointerEvents="none" />}
      <g clipPath={`url(#${id}-clip)`}>
        {scene.settings.showAxis && (axes.length ? axes : [{ x: 50, y: 34, angle: 0, id: 'default-axis' }]).map(c => <g key={c.id} transform={`translate(${c.x} ${c.y}) rotate(${c.angle})`} pointerEvents="none"><line x1={-view.width * 3} x2={view.width * 3} y1="0" y2="0" stroke="#b5c4bb" strokeWidth="1" strokeDasharray="5 5" vectorEffect="non-scaling-stroke" /></g>)}
        {scene.settings.showFoci && scene.components.filter(c => c.enabled && (c.kind === 'convex-lens' || c.kind === 'concave-lens')).map(c => <g key={`foci-${c.id}`} transform={`translate(${c.x} ${c.y}) rotate(${c.angle})`} pointerEvents="none">{[-2, -1, 1, 2].map(multiple => <g key={multiple} transform={`translate(${Math.abs(c.focalLength) * multiple} 0)`}><path d="M-.4 0H.4M0 -.4V.4" stroke="#7d9484" strokeWidth="1.1" vectorEffect="non-scaling-stroke" /><text y="2.3" textAnchor="middle" fill="#7d9484" fontSize="1.5" fontFamily="Inter, sans-serif">{Math.abs(multiple) === 2 ? '2F' : 'F'}</text></g>)}</g>)}
        {scene.components.map(c => {
          const selected = selectedId === c.id, bounds = opticalSymbolBounds(c)
          const labelY = bounds.y + bounds.height + 3
          return <g key={c.id} data-optics-id={c.id} data-optics-kind={c.kind} transform={`translate(${c.x} ${c.y}) rotate(${c.angle})`} className={`optics-component${selected ? ' selected' : ''}`} tabIndex={0} role="button" aria-label={`${c.label}，${opticalLibrary[c.kind].name}，X ${c.x} Y ${c.y}`} aria-pressed={selected} onPointerDown={event => componentDown(event, c)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); store.select(c.id) } }} style={{ cursor: placement ? 'crosshair' : tool === 'pan' ? 'grab' : dragging && selected ? 'grabbing' : 'grab' }}>
            <rect {...bounds} fill="transparent" stroke="none" />
            <OpticalSymbol component={c} />
            {selected && <g pointerEvents="none"><rect x={bounds.x - .8} y={bounds.y - .8} width={bounds.width + 1.6} height={bounds.height + 1.6} rx=".65" fill="#0d948807" stroke="#239c88" strokeWidth="1" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" /><circle r=".65" fill="#fff" stroke="#087f72" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />{[bounds.y - .8, bounds.y + bounds.height + .8].map(y => <rect key={y} x="-.45" y={y - .45} width=".9" height=".9" fill="#fff" stroke="#239c88" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}</g>}
            {scene.settings.showLabels && <text x={bounds.x + bounds.width / 2} y={labelY} textAnchor="middle" fill={selected ? '#287451' : '#66766e'} fontSize="1.6" fontFamily="Inter, PingFang SC, Microsoft YaHei, sans-serif" stroke="none" pointerEvents="none">{c.label}{!c.enabled ? '（停用）' : ''}</text>}
          </g>
        })}
        <g pointerEvents="none">{measurements.filter(m => m.imagePoint && m.imageBase && (m.nature !== 'virtual' || scene.settings.showVirtual)).map(m => {
          const tip = m.imagePoint!, base = m.imageBase!
          if (!finitePoint(tip) || !finitePoint(base) || Math.abs(tip.x) > 100000 || Math.abs(tip.y) > 100000) return null
          const rotation = Math.atan2(tip.y - base.y, tip.x - base.x) * 180 / Math.PI + 90
          const height = Math.hypot(tip.x - base.x, tip.y - base.y)
          if (height < .001) return null
          const source = scene.components.find(c => c.id === m.objectId)
          const imagePose = source ? { ...source, x: base.x, y: base.y, angle: rotation, height } : null
          const imageBounds = imagePose ? opticalSymbolBounds(imagePose) : null
          const bottom = imagePose && imageBounds ? Math.max(...[
            { x: imageBounds.x, y: imageBounds.y }, { x: imageBounds.x + imageBounds.width, y: imageBounds.y },
            { x: imageBounds.x, y: imageBounds.y + imageBounds.height }, { x: imageBounds.x + imageBounds.width, y: imageBounds.y + imageBounds.height },
          ].map(point => toWorld(imagePose, point).y)) : Math.max(base.y, tip.y)
          return <g key={`${m.lensId}-${m.objectId}`} data-testid="optics-image" data-lens-id={m.lensId} data-image-nature={m.nature} data-image-x={tip.x} data-image-y={tip.y} opacity=".9"><g transform={`translate(${base.x} ${base.y}) rotate(${rotation})`}><OpticalImageArrow height={height} virtual={m.nature === 'virtual'} /></g><text x={base.x} y={bottom + 3} textAnchor="middle" fill="#5b84ab" fontSize="1.6">{m.caption || (m.nature === 'virtual' ? '虚像' : '实像')}</text></g>
        })}</g>
        <g className="optics-rays" pointerEvents="none">{raySegments.map(({ ray, index, from, to }) => {
          const color = wavelengthColor(ray.wavelength)
          return <g key={index} opacity={clamp(ray.intensity, .15, .9)}>
            <line data-testid="optics-ray" data-source-id={ray.sourceId} data-virtual={ray.virtual || undefined} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={color} strokeWidth={ray.virtual ? 1.1 : 1.5} strokeDasharray={ray.virtual ? '4 4' : undefined} vectorEffect="non-scaling-stroke" />
            {running && scene.settings.animate && !ray.virtual && <line className={`optics-flow-${id}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={color} strokeWidth="2.4" strokeDasharray="1 11" strokeLinecap="round" opacity=".75" vectorEffect="non-scaling-stroke" />}
          </g>
        })}</g>
        <g pointerEvents="none">{rayArrows.map(arrow => <g key={arrow.index} className="optics-ray-arrow" transform={`translate(${arrow.x} ${arrow.y}) rotate(${arrow.angle}) scale(${arrowScale})`}><path d="M-7 -1.6H1V-3.8L7 0 1 3.8V1.6H-7Z" fill="#0073bb" /></g>)}</g>
        <g pointerEvents="none">{simulation.screenHits.filter(hit => finitePoint(hit.point)).map((hit, i) => <g key={i}><circle cx={hit.point.x} cy={hit.point.y} r=".9" fill={wavelengthColor(hit.wavelength)} opacity=".14" /><circle cx={hit.point.x} cy={hit.point.y} r=".32" fill={wavelengthColor(hit.wavelength)} /></g>)}</g>
        {preview && <g transform={`translate(${preview.x} ${preview.y})`} opacity=".45" pointerEvents="none"><OpticalSymbol component={preview} /><path d="M-1 0H1M0 -1V1" stroke="#459270" strokeWidth="1" vectorEffect="non-scaling-stroke" /></g>}
      </g>
      {!scene.components.length && <g pointerEvents="none"><text x={camera.x} y={camera.y - 1} textAnchor="middle" fill="#71827a" fontSize="2.2">从左侧选择组件，放入画布开始实验</text><text x={camera.x} y={camera.y + 3} textAnchor="middle" fill="#a1ada6" fontSize="1.6">拖动组合光路 · 滚轮缩放 · 随时调整焦距</text></g>}
    </svg>
    {placement && <div className="optics-placement-hint"><Crosshair size={14} />点击放置{opticalLibrary[placement].name}<button onClick={onPlaced}>取消 · Esc</button></div>}
    {!running && <div className="optics-canvas-notice optics-canvas-paused" role="status">光线已暂停，运行后更新光路</div>}
    {simulation.warnings.length > 0 && <div className="optics-canvas-notice optics-canvas-warning" role="status">{simulation.warnings.map(warning => <div key={warning}>{warning}</div>)}</div>}
    <div className="optics-canvas-controls" aria-label="画布视图控制">
      <button aria-label="切换网格" title="显示网格" aria-pressed={scene.settings.showGrid} onClick={() => store.updateSettings({ showGrid: !scene.settings.showGrid })}><Grid3X3 size={15} /></button>
      <button aria-label="切换网格吸附" title="吸附到 1 cm 网格" aria-pressed={scene.settings.snap} onClick={() => store.updateSettings({ snap: !scene.settings.snap })}><Magnet size={15} /></button>
      <span className="optics-control-divider" />
      <button aria-label="缩小画布" title="缩小" onClick={() => zoom(1.25)}><Minus size={15} /></button><span className="optics-zoom-value">{Math.round(10000 / camera.width)}%</span><button aria-label="放大画布" title="放大" onClick={() => zoom(.8)}><Plus size={15} /></button>
      <button aria-label="适应全部组件" title="适应全部组件 (F)" onClick={fit}><Maximize size={14} /></button>
    </div>
    <div className="optics-canvas-scale">{hover ? `X ${hover.x.toFixed(1)} · Y ${hover.y.toFixed(1)} cm` : '坐标单位 cm'}<span>网格 {gridSize} cm</span></div>
  </div>
}
