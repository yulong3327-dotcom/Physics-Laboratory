import type { CircuitGeometry, CircuitAction, CircuitAsset, Shot, VideoProject } from '../../server/videoTypes'
import { getVisualOrientation } from '../data/physicalAssets'
import type { CircuitGraph, ViewMode } from '../types/circuit'
import { layoutCircuitGraph } from './autoLayout'
import { renderSymbol } from './circuitRenderer'
import { getComponentParameters, simulateCircuit, type ComponentSimulationResult } from './circuitSimulation'
import { getPresentedVisual } from './componentPresentation'
import { simulateIdealCircuit, type IdealQuantity } from './idealCircuitSimulation'
import { getComponentPosition } from './viewGeometry'
import { getWireEndpoint, getWireObstacles, getRoutedWirePath } from './wireRenderer'
import { getManualWirePath } from './wireEditing'
import { componentImageSources, escapeSvg, getPhysicalImageSource, renderPhysicalOverlay, symbolOptions } from './simulationVisual'
import { svgPathProperties } from 'svg-path-properties'

export interface CircuitGeometryOptions {
  viewMode?: ViewMode
  currentFlow?: boolean
  mode?: 'numeric' | 'symbolic'
  physicsModel?: 'ideal_textbook' | 'experiment'
  /** Physical assets must be embedded before a project leaves the browser. */
  images?: ReadonlyMap<string, string>
}
export interface PrepareCircuitGeometryOptions extends CircuitGeometryOptions {
  signal?: AbortSignal
  /** Allows local CLI producers to resolve the same public assets without a web server. */
  resolveImage?: (source: string) => Promise<string>
}

function renderingState(graph: CircuitGraph, options: CircuitGeometryOptions) {
  const states: Record<string, ComponentSimulationResult> = {}
  const currents: Record<string, number> = {}
  if (options.mode === 'symbolic' || (options.viewMode !== 'real' && !options.currentFlow)) return { states, currents }
  if (options.physicsModel === 'experiment') {
    const result = simulateCircuit(graph)
    if (result.status !== 'error') {
      Object.assign(states, result.components)
      for (const [id, value] of Object.entries(result.wireCurrents)) if (Number.isFinite(value)) currents[id] = value
    }
    return { states, currents }
  }
  const result = simulateIdealCircuit(graph)
  const value = (quantity?: IdealQuantity) => quantity?.status === 'defined' ? quantity.value : undefined
  for (const [id, quantity] of Object.entries(result.wireCurrents)) {
    const current = value(quantity)
    if (current !== undefined && Number.isFinite(current)) currents[id] = current
  }
  for (const component of graph.components) {
    const state = result.components[component.id]
    if (!state) continue
    const voltage = value(state.voltage), current = value(state.current), power = value(state.power)
    // The legacy overlay accepts only finite operating points. Unknown ideal
    // values are omitted; in particular an undefined meter must not show zero.
    if (voltage === undefined || current === undefined || power === undefined) continue
    const params = getComponentParameters(component)
    const meterStatus = ['ok', 'reverse', 'overload', 'floating', 'miswired'].includes(state.meterStatus || '')
      ? state.meterStatus as ComponentSimulationResult['meterStatus'] : undefined
    states[component.id] = { voltage, current, power, active: Math.abs(current) > 1e-5,
      brightness: component.type === 'lamp' ? Math.max(0, Math.min(1, power / params.ratedPower)) : 0,
      reading: value(state.reading), range: state.range, unit: state.unit, meterStatus }
  }
  return { states, currents }
}

function embeddedImage(source: string, images?: ReadonlyMap<string, string>) {
  const data = images?.get(source) || source
  if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(data)) throw new Error('实物图素材尚未嵌入，请使用 prepareCircuitGeometry：' + source)
  return data
}

/**
 * Independent objects in editor units, with absolute terminal anchors.
 * image width/height are BEFORE rotation; its centre is component.x/y.
 * rotation is clockwise SVG degrees. Positive wire current follows from -> to,
 * which is also the SVG path's first -> last point in BOTH view modes.
 */
export function exportCircuitGeometry(graph: CircuitGraph, options: CircuitGeometryOptions = {}): CircuitGeometry {
  const mode = options.viewMode || 'schematic'
  const currentFlow = Boolean(options.currentFlow && options.mode !== 'symbolic')
  const metadata = { viewMode: mode, currentFlow }
  if (!graph.components.length) return { ...metadata, bounds: { x: 0, y: 0, width: 400, height: 300 }, components: [], wires: [] }
  const obstacles = getWireObstacles(graph.components, mode, graph.connections)
  const byId = new Map(graph.components.map(c => [c.id, c]))
  const { states, currents } = renderingState(graph, { ...options, viewMode: mode })
  const components: CircuitGeometry['components'] = graph.components.map(component => {
    const visual = getPresentedVisual(component, mode, graph.connections)
    const vertical = getVisualOrientation(component, mode) === 'vertical'
    const rotation = vertical ? 90 : 0
    const position = getComponentPosition(component, mode)
    let width = Math.max(vertical ? visual.height : visual.width, 42) + 6
    let height = Math.max(vertical ? visual.width : visual.height, 42) + 6
    const terminals: CircuitGeometry['components'][number]['terminals'] = {}
    for (const t of visual.terminals) {
      const point = getWireEndpoint(component, t.id, mode, graph.connections)
      if (point) terminals[t.id] = { x: point.x, y: point.y }
    }
    const state = states[component.id]
    let image: CircuitGeometry['components'][number]['image']
    let content = renderSymbol(component.type, false, undefined, { ...symbolOptions(component, state, vertical), meterThirdTerminal: visual.meterThirdTerminal })
    if (visual.asset) {
      const asset = visual.asset
      image = { dataUrl: embeddedImage(getPhysicalImageSource(component, asset, state), options.images), width: asset.width, height: asset.height, rotation }
      let overlay = renderPhysicalOverlay(component, asset, state)
      const params = getComponentParameters(component)
      if (asset.meterDial && params.meterMode !== 'manual' && state?.reading === undefined) overlay = overlay.replace(/<g data-meter-needle="true"[\s\S]*?<\/g>/g, '')
      if (asset.lampVisual && !state) overlay = overlay.replace(/<image data-lamp-glow="[^"]*"[^>]*\/>/g, '')
      overlay = overlay.replace(/href="([^"]+)"/g, (_, source: string) => 'href="' + escapeSvg(embeddedImage(source, options.images)) + '"')
      content = '<g transform="translate(' + (-asset.width / 2) + ' ' + (-asset.height / 2) + ') scale(' + (asset.width / asset.sourceWidth) + ')">' + overlay + '</g>'
      // Open switch blades and virtual terminals can lie outside the bitmap.
      const extension = asset.switchVisual ? Math.max(0, -asset.switchVisual.boundsTop) * asset.width / asset.sourceWidth : 0
      width += vertical ? 2 * extension : 0
      height += vertical ? 0 : 2 * extension
      for (const point of Object.values(terminals)) {
        width = Math.max(width, 2 * Math.abs(point.x - position.x) + 6)
        height = Math.max(height, 2 * Math.abs(point.y - position.y) + 6)
      }
    }
    return { id: component.id, label: component.label || '', x: position.x, y: position.y, width, height, terminals, ...(image ? { image } : {}),
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="' + [-width / 2, -height / 2, width, height].join(' ') + '"><g transform="rotate(' + rotation + ')">' + content + '</g></svg>' }
  })
  const wires = graph.connections.map((wire, i) => {
    const [a, at] = wire.from.split('.'), [b, bt] = wire.to.split('.')
    const source = getWireEndpoint(byId.get(a), at, mode, graph.connections)
    const target = getWireEndpoint(byId.get(b), bt, mode, graph.connections)
    if (!source || !target) throw new Error('导线 ' + wire.id + ' 的端口无效')
    const route = wire.routes?.[mode]
    const path = route ? getManualWirePath(mode, source, target, route) : getRoutedWirePath(mode, source, target, obstacles, mode === 'real' ? graph.connections.length - 1 - i : i)
    const current = currents[wire.id]
    return { id: wire.id, path, from: wire.from, to: wire.to, ...(currentFlow && current !== undefined ? { current } : {}) }
  })
  const points = components.flatMap(c => [{ x: c.x - c.width / 2 - 20, y: c.y - c.height / 2 - 32 }, { x: c.x + c.width / 2 + 20, y: c.y + c.height / 2 + 20 }])
  // Browser measurement preserves the editor's bounds. CLI exports sample by
  // arc length with 10 units of padding, also covering curved cable bulges.
  if (typeof document !== 'undefined') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden'
    document.body.append(svg)
    try {
      for (const wire of wires) {
        const p = document.createElementNS(svg.namespaceURI, 'path') as SVGPathElement
        p.setAttribute('d', wire.path); svg.append(p)
        const b = p.getBBox(); points.push({ x: b.x - 10, y: b.y - 10 }, { x: b.x + b.width + 10, y: b.y + b.height + 10 })
      }
    } finally { svg.remove() }
  } else {
    for (const wire of wires) {
      const path = new svgPathProperties(wire.path), length = path.getTotalLength()
      const intervals = Math.max(1, Math.ceil(length / 10))
      for (let i = 0; i <= intervals; i++) {
        const p = path.getPointAtLength(length * i / intervals)
        points.push({ x: p.x - 10, y: p.y - 10 }, { x: p.x + 10, y: p.y + 10 })
      }
    }
  }
  const x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y))
  return { ...metadata, bounds: { x, y, width: Math.max(...points.map(p => p.x)) - x, height: Math.max(...points.map(p => p.y)) - y }, components, wires }
}

async function fetchEmbeddedImage(source: string, signal?: AbortSignal) {
  const response = await fetch(source, { signal })
  if (!response.ok) throw new Error('实物素材读取失败：' + source)
  const mime = response.headers.get('content-type')?.split(';')[0] || 'image/png'
  if (!mime.startsWith('image/')) throw new Error('实物素材不是图片：' + source)
  const bytes = new Uint8Array(await response.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768))
  return 'data:' + mime + ';base64,' + btoa(binary)
}

/** Prepare a portable real scene without mutating or re-laying out its schematic. */
export async function prepareCircuitGeometry(input: CircuitGraph, options: PrepareCircuitGeometryOptions = {}): Promise<{ graph: CircuitGraph; geometry: CircuitGeometry }> {
  options.signal?.throwIfAborted()
  let graph = structuredClone(input)
  if (options.viewMode === 'real') {
    // Once a real layout exists, preserve the teacher's exact placement, even
    // when objects deliberately overlap. Automatic layout is an initial aid only.
    if (graph.components.some(c => !c.realPosition)) graph = await layoutCircuitGraph(graph, 'real')
    const images = new Map(options.images)
    const sources = [...new Set(graph.components.flatMap(componentImageSources))]
    await Promise.all(sources.map(async source => {
      options.signal?.throwIfAborted()
      if (!images.has(source)) images.set(source, await (options.resolveImage ? options.resolveImage(source) : fetchEmbeddedImage(source, options.signal)))
    }))
    options.signal?.throwIfAborted()
    return { graph, geometry: exportCircuitGeometry(graph, { ...options, images }) }
  }
  return { graph, geometry: exportCircuitGeometry(graph, options) }
}

/** State frames share the original topology and placements, and accumulate within one shot. */
export async function prepareCircuitStateGeometry(project: VideoProject, shot: Shot, asset: CircuitAsset, options: PrepareCircuitGeometryOptions = {}): Promise<void> {
  const states = shot.actions.filter(action => action.type === 'state')
  if (!states.length) return
  const order = (action: CircuitAction) => {
    const index = shot.utteranceIds.indexOf(action.cue.utteranceId)
    const text = project.utterances.find(line => line.id === action.cue.utteranceId)?.text || ''
    const phrase = action.cue.phrase
    let position = 0
    if (phrase) {
      position = -phrase.length
      for (let i = 0; i < (action.cue.occurrence ?? 1); i++) position = text.indexOf(phrase, position + phrase.length)
      if (position < 0) throw new Error(shot.title + '：状态动作找不到同步关键词：' + phrase)
    }
    return { index, position, offset: action.cue.offset ?? 0 }
  }
  for (let i = 0; i < states.length; i++) for (let j = i + 1; j < states.length; j++) {
    const a = order(states[i]), b = order(states[j])
    if (a.index === b.index && (a.position - b.position) * (a.offset - b.offset) < 0) throw new Error(shot.title + '：状态动作的同步词与秒偏移顺序冲突，请使用相同偏移或同一同步词的递增偏移')
  }
  states.sort((left, right) => { const a = order(left), b = order(right); return a.index - b.index || a.position - b.position || a.offset - b.offset })
  let graph = structuredClone(asset.graph as CircuitGraph)
  for (const action of states) {
    const state = action.state!
    const component = graph.components.find(item => item.id === state.componentId)
    if (!component) throw new Error(shot.title + '：状态动作引用的元件不存在：' + state.componentId)
    component.parameters = { ...component.parameters, ...state.parameters }
    if (state.parameters.sliderPosition !== undefined && component.rheostatConfig) component.rheostatConfig.sliderPosition = state.parameters.sliderPosition
    const prepared = await prepareCircuitGeometry(graph, { ...options, viewMode: asset.viewMode || 'schematic',
      currentFlow: asset.currentFlow ?? asset.viewMode === 'real', mode: asset.mode, physicsModel: 'ideal_textbook' })
    graph = prepared.graph
    action.geometry = prepared.geometry
  }
}

