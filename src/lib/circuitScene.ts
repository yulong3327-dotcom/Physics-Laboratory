import { getVisualOrientation } from '../data/physicalAssets'
import { getPresentedVisual } from './componentPresentation'
import { getComponentPosition } from './viewGeometry'
import { getManualWirePath } from './wireEditing'
import { renderCurrentParticles } from './currentAnimation'
import { getTerminalDirection, renderSymbol } from './circuitRenderer'
import { getComponentParameters, simulateCircuit } from './circuitSimulation'
import { componentImageSources, escapeSvg, getPhysicalImageSource, renderPhysicalOverlay, symbolOptions } from './simulationVisual'
import { getWireEndpoint, getWireObstacles, getRoutedWirePath } from './wireRenderer'
import type { CircuitGraph, ViewMode } from '../types/circuit'

export type ExperimentSequence = 'snapshot' | 'slider' | 'switch' | 'recording'

export function experimentFrame(graph: CircuitGraph, sequence: ExperimentSequence, fraction: number): CircuitGraph {
  const value = Math.max(0, Math.min(1, fraction))
  return { ...graph, components: graph.components.map(component => {
    if (sequence === 'slider' && ['rheostat', 'potentiometer'].includes(component.type)) return { ...component, parameters: { ...component.parameters, sliderPosition: value } }
    if (sequence === 'switch' && component.type === 'switch') return { ...component, parameters: { ...component.parameters, switchClosed: value >= 0.2 } }
    return component
  }) }
}

export async function prepareCircuitScene(graph: CircuitGraph, mode: ViewMode, signal?: AbortSignal, recordedGraphs: CircuitGraph[] = []) {
  const images = new Map<string, string>()
  if (mode === 'real') {
    const sources = [...new Set([graph, ...recordedGraphs].flatMap(graph => graph.components.flatMap(componentImageSources)))]
    await Promise.all(sources.map(async src => {
      const response = await fetch(src, { signal })
      if (!response.ok) throw new Error(`素材读取失败：${src}`)
      const blob = await response.blob()
      const encoded = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob) })
      images.set(src, encoded)
    }))
  }
  const routeCache = new Map<string, { id: string; element: SVGPathElement; markup: string }[]>()
  const routes = (frame: CircuitGraph) => {
    const key = JSON.stringify([frame.components.map(component => [component.id, component.type, component.assetId, component.label, getComponentPosition(component, mode), component.orientation, component.realOrientation, component.parameters?.meterRange]), frame.connections])
    const cached = routeCache.get(key)
    if (cached) return cached
    const obstacles = getWireObstacles(frame.components, mode, frame.connections)
    const components = new Map(frame.components.map(component => [component.id, component]))
    const paths = frame.connections.map((wire, i) => {
    const [a, at] = wire.from.split('.'), [b, bt] = wire.to.split('.')
    const source = getWireEndpoint(components.get(a), at, mode, frame.connections), target = getWireEndpoint(components.get(b), bt, mode, frame.connections)
    if (!source || !target) return null
    const d = wire.routes?.[mode] ? getManualWirePath(mode, source, target, wire.routes[mode]!) : getRoutedWirePath(mode, source, target, obstacles, frame.connections.length - 1 - i)
    const element = document.createElementNS('http://www.w3.org/2000/svg', 'path'); element.setAttribute('d', d)
    const markup = mode === 'real'
      ? `<path d="${d}" fill="none" stroke="#414748" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="#d6dddc" stroke-width="1.2" opacity="0.5" stroke-linecap="round"/>`
      : `<path d="${d}" fill="none" stroke="#3e4344" stroke-width="1.75" stroke-linecap="square" stroke-linejoin="miter"/>`
    return { id: wire.id, element, markup }
    }).filter((path): path is { id: string; element: SVGPathElement; markup: string } => path !== null)
    routeCache.set(key, paths)
    return paths
  }
  const simulations = new WeakMap<CircuitGraph, ReturnType<typeof simulateCircuit>>()
  const body = (frame: CircuitGraph, enabled: boolean, time = 0) => {
    if (enabled && !simulations.has(frame)) simulations.set(frame, simulateCircuit(frame))
    const simulation = enabled ? simulations.get(frame)! : null
    const paths = routes(frame)
    const equipment = frame.components.map(component => {
      const visual = getPresentedVisual(component, mode, frame.connections)
      const position = getComponentPosition(component, mode)
      const vertical = getVisualOrientation(component, mode) === 'vertical'
      const width = vertical ? visual.height : visual.width, height = vertical ? visual.width : visual.height
      const state = simulation?.components[component.id]
      let content = renderSymbol(component.type, false, undefined, { ...symbolOptions(component, state, vertical), meterThirdTerminal: visual.meterThirdTerminal })
      if (visual.asset) {
        const asset = visual.asset
        const src = getPhysicalImageSource(component, asset, state)
        content = `<g transform="translate(${-asset.width / 2} ${-asset.height / 2}) scale(${asset.width / asset.sourceWidth})"><image href="${escapeSvg(images.get(src) || src)}" width="${asset.sourceWidth}" height="${asset.sourceHeight}"/>${renderPhysicalOverlay(component, asset, state)}</g>`
        for (const [path, data] of images) content = content.split(escapeSvg(path)).join(data)
      }
      const parameters = getComponentParameters(component)
      const displayReading = parameters.meterMode === 'manual' ? parameters.manualReading : state?.reading
      const reading = state?.unit ? displayReading === undefined ? '未定义' : `${parameters.meterMode === 'manual' ? '手动 ' : ''}${Number(displayReading.toPrecision(4))} ${state.unit}` : ''
      const label = component.label || ''
      const labelClearance = !vertical && visual.asset?.switchVisual ? -visual.asset.switchVisual.boundsTop * visual.width / visual.asset.sourceWidth : 0
      const labelBeside = visual.terminals.some(terminal => getTerminalDirection(terminal.dir, vertical ? 'vertical' : 'horizontal') === 'top')
      const labelBelow = mode === 'schematic' && component.type === 'lamp' && !labelBeside
      const lines: string[] = []
      let line = '', lineWidth = 0
      for (const character of label) {
        const characterWidth = character.charCodeAt(0) > 127 ? 12 : 8
        if (lineWidth + characterWidth > 120) { lines.push(line); line = ''; lineWidth = 0 }
        line += character; lineWidth += characterWidth
      }
      if (line) lines.push(line)
      const labelX = labelBeside ? width / 2 + 12 : 0
      const labelY = labelBelow ? height / 2 + 17 : -height / 2 - 12 - labelClearance - (lines.length - 1) * 16
      const labelMarkup = lines.length ? `<text x="${labelX}" y="${labelY}" text-anchor="${labelBeside ? 'start' : 'middle'}" font-size="12" font-weight="600" fill="#3e4344">${lines.map((text, index) => `<tspan x="${labelX}" dy="${index ? 16 : 0}">${escapeSvg(text)}</tspan>`).join('')}</text>` : ''
      return `<g transform="translate(${position.x} ${position.y})"><g transform="rotate(${vertical ? 90 : 0})">${content}</g>${labelMarkup}${reading ? `<text x="${width / 2 + 10}" y="${height / 2 - 2}" font-size="13" fill="#087f72">${reading}</text>` : ''}</g>`
    }).join('')
    const wires = paths.map(path => path.markup).join('')
    const dots = simulation ? `<g class="current-particles">${paths.map(path => renderCurrentParticles(path.element, simulation.wireCurrents[path.id] || 0, time)).join('')}</g>` : ''
    return (mode === 'real' ? equipment + wires : wires + equipment) + dots
  }
  // Use the actual SVG geometry, including routed wires, to frame exports.
  const probe = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  probe.style.cssText = 'position:fixed;left:-100000px;top:0;width:1600px;height:1000px;visibility:hidden'
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  probe.append(group); document.body.append(probe)
  const boxes: DOMRect[] = []
  try {
    for (const [index, frame] of [graph, ...recordedGraphs].entries()) {
      signal?.throwIfAborted()
      group.innerHTML = body(frame, true); boxes.push(group.getBBox())
      if (index % 20 === 19) await new Promise(resolve => setTimeout(resolve, 0))
    }
  } finally { probe.remove() }
  const x = Math.min(...boxes.map(box => box.x)), y = Math.min(...boxes.map(box => box.y))
  const box = { x, y, width: Math.max(...boxes.map(box => box.x + box.width)) - x, height: Math.max(...boxes.map(box => box.y + box.height)) - y }
  const bounds = { x: box.x - 60, y: box.y - 60, width: Math.max(400, box.width + 120), height: Math.max(300, box.height + 120) }
  return {
    bounds,
    render: (frame = graph, enabled = true, time = 0) => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1280" height="720" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}" style="background:white;font-family:Arial,'Microsoft YaHei',sans-serif"><rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="white"/>${body(frame, enabled, time)}</svg>`,
  }
}

export async function drawScene(canvas: HTMLCanvasElement, svg: string) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('导出画面渲染失败')); image.src = url })
    const context = canvas.getContext('2d')
    if (!context) throw new Error('画布不可用')
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
  } finally { URL.revokeObjectURL(url) }
}

export function canvasPng(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG 编码失败')), 'image/png'))
}
