import type { ELK, ElkNode } from 'elkjs/lib/elk-api'
import { getComponentVisual } from '../data/physicalAssets'
import { componentLibrary } from '../data/componentLibrary'
import { getPresentedVisual } from './componentPresentation'
import { getComponentPosition, projectGraphForView, withComponentPosition } from './viewGeometry'
import type { CircuitComponent, CircuitGraph, ViewMode } from '../types/circuit'

let engine: Promise<ELK> | undefined

export function getLayoutSize(component: CircuitComponent, mode: ViewMode = 'schematic') {
  const sizes = [mode].map(mode => {
    const visual = getComponentVisual(component, mode)
    const width = Math.max(visual.width, ...visual.terminals.map(term => Math.abs(term.dx) * 2))
    const height = Math.max(visual.height, ...visual.terminals.map(term => Math.abs(term.dy) * 2))
    const orientation = mode === 'real' ? component.realOrientation ?? 'horizontal' : component.orientation
    return orientation === 'vertical' ? { width: height, height: width } : { width, height }
  })
  const labelWidth = Math.min(220, Array.from(component.label || '').length * 12)
  return {
    width: Math.ceil(Math.max(labelWidth, ...sizes.map(size => size.width))) + (mode === 'real' ? 48 : 40),
    height: Math.ceil(Math.max(...sizes.map(size => size.height))) + (mode === 'real' ? 64 : 48),
  }
}

export function hasLayoutOverlap(components: CircuitComponent[], mode: ViewMode = 'schematic'): boolean {
  return projectedOverlap(components.map(component => ({ ...component, position: getComponentPosition(component, mode) })), mode)
}

function projectedOverlap(components: CircuitComponent[], mode: ViewMode): boolean {
  const boxes = components.map(component => ({ ...getLayoutSize(component, mode), ...component.position }))
  return boxes.some((box, index) => boxes.slice(index + 1).some(other =>
    Math.abs(box.x - other.x) < (box.width + other.width) / 2 &&
    Math.abs(box.y - other.y) < (box.height + other.height) / 2))
}

function gridFallback(graph: CircuitGraph, mode: ViewMode): CircuitGraph {
  const sizes = graph.components.map(component => getLayoutSize(component, mode))
  const cellWidth = Math.max(240, ...sizes.map(size => size.width)) + 80
  const cellHeight = Math.max(180, ...sizes.map(size => size.height)) + 80
  const columns = Math.max(1, Math.ceil(Math.sqrt(graph.components.length)))
  return { ...graph, components: graph.components.map((component, index) => ({
    ...component, position: { x: 160 + index % columns * cellWidth, y: 160 + Math.floor(index / columns) * cellHeight },
  })) }
}

interface ElectricalEdge { component: CircuitComponent; nets: [string, string]; ports: [string, string] }
interface ElectricalPath { edges: ElectricalEdge[]; nets: string[] }
interface CircuitStructure {
  source: ElectricalEdge
  main: ElectricalPath
  branches: ElectricalPath[]
  meters: ElectricalEdge[]
}

// Wire endpoints in the same electrical node are interchangeable for layout, even
// when the recognized drawing uses daisy-chained wires instead of explicit junctions.
function findCircuitStructure(graph: CircuitGraph): CircuitStructure | undefined {
  if (graph.components.length > 24) return undefined
  const parent = new Map<string, string>()
  function root(id: string): string {
    if (!parent.has(id)) parent.set(id, id)
    const next = parent.get(id)!
    if (next === id) return id
    const result = root(next)
    parent.set(id, result)
    return result
  }
  function join(a: string, b: string) { parent.set(root(b), root(a)) }
  const wired = new Set(graph.connections.flatMap(wire => [wire.from, wire.to]))
  for (const wire of graph.connections) join(wire.from, wire.to)
  for (const component of graph.components) {
    if (component.type === 'rheostat') join(`${component.id}.c`, `${component.id}.d`)
  }
  const edges: ElectricalEdge[] = []
  for (const component of graph.components) {
    const netPorts = new Map<string, string>()
    for (const port of componentLibrary[component.type].terminals) {
      const id = `${component.id}.${port.id}`
      if (wired.has(id) && !netPorts.has(root(id))) netPorts.set(root(id), port.id)
    }
    if (netPorts.size === 2) edges.push({ component, nets: [...netPorts.keys()] as [string, string], ports: [...netPorts.values()] as [string, string] })
  }
  const sources = edges.filter(edge => edge.component.type === 'battery')
  if (sources.length !== 1) return undefined
  const source = sources[0]
  const adjacency = new Map<string, ElectricalEdge[]>()
  const passive = edges.filter(edge => edge !== source && edge.component.type !== 'voltmeter')
  for (const edge of passive) for (const net of edge.nets) adjacency.set(net, [...adjacency.get(net) || [], edge])
  for (const adjacent of adjacency.values()) adjacent.sort((a, b) => a.component.id.localeCompare(b.component.id))
  const start = root(`${source.component.id}.positive`)
  const end = root(`${source.component.id}.negative`)
  const paths: ElectricalPath[] = []
  let explored = 0
  function walk(net: string, path: ElectricalPath) {
    if (++explored > 2048 || paths.length >= 64) return
    if (net === end) { paths.push(path); return }
    for (const edge of adjacency.get(net) || []) {
      const next = edge.nets.find(value => value !== net)!
      if (!path.nets.includes(next)) walk(next, { edges: [...path.edges, edge], nets: [...path.nets, next] })
    }
  }
  walk(start, { edges: [], nets: [start] })
  function importance(path: ElectricalPath) {
    return path.edges.reduce((sum, edge) => sum + (edge.component.type === 'switch' ? 8 : edge.component.type === 'ammeter' ? 5 : 1), 0)
  }
  paths.sort((a, b) => importance(b) - importance(a))
  const main = paths[0]
  if (!main?.edges.length) return undefined
  const used = new Set(main.edges)
  const branches: ElectricalPath[] = []
  // Each simple parallel branch leaves and rejoins the main circuit. Bridges and
  // nested networks that cannot be decomposed unambiguously use the ELK fallback.
  for (const net of main.nets) for (const first of adjacency.get(net) || []) {
    if (used.has(first)) continue
    const branch: ElectricalPath = { edges: [], nets: [net] }
    let edge = first
    let current = net
    while (!used.has(edge)) {
      used.add(edge); branch.edges.push(edge)
      current = edge.nets.find(value => value !== current)!
      branch.nets.push(current)
      if (main.nets.includes(current)) break
      const next = (adjacency.get(current) || []).filter(item => !used.has(item))
      if (next.length !== 1) break
      edge = next[0]
    }
    if (!main.nets.includes(current) || current === net) return undefined
    branches.push(branch)
  }
  if (passive.some(edge => !used.has(edge))) return undefined
  return { source, main, branches, meters: edges.filter(edge => edge.component.type === 'voltmeter') }
}

function semanticLayout(graph: CircuitGraph, mode: ViewMode): CircuitGraph | undefined {
  const structure = findCircuitStructure(graph)
  if (!structure) return undefined
  const { source, main, branches, meters } = structure
  for (const component of graph.components) {
    if (mode === 'real') component.realOrientation = 'horizontal'
    else component.orientation = 'horizontal'
  }
  const byId = new Map(graph.components.map(component => [component.id, component]))
  const placed = new Set<string>()
  const sizes = graph.components.map(component => getLayoutSize(component, mode))
  const dx = Math.ceil((Math.max(mode === 'real' ? 220 : 140, ...sizes.map(size => size.width)) + (mode === 'real' ? 48 : 40)) / 20) * 20
  const laneHeight = Math.ceil((Math.max(mode === 'real' ? 180 : 100, ...sizes.map(size => size.height)) + (mode === 'real' ? 24 : 40)) / 20) * 20
  const dy = mode === 'real' ? laneHeight : laneHeight * (1 + branches.length + meters.length)
  const origin = { x: 200, y: 180 }
  function place(component: CircuitComponent, x: number, y: number) {
    const target = byId.get(component.id)!
    target.position = { x: Math.round(x / 10) * 10, y: Math.round(y / 10) * 10 }
    placed.add(component.id)
  }
  function horizontalBaseline(edge: ElectricalEdge) {
    const ports = getPresentedVisual(edge.component, 'schematic', graph.connections).terminals
      .filter(port => edge.ports.includes(port.id) && (port.dir === 'left' || port.dir === 'right'))
    return ports.length ? ports.reduce((sum, port) => sum + port.dy, 0) / ports.length : 0
  }
  const allPaths = [main, ...branches]
  function measuredComponents(meter: ElectricalEdge): CircuitComponent[] {
    const direct = allPaths.flatMap(path => path.edges).find(edge =>
      edge.nets.every(net => meter.nets.includes(net)))
    if (direct) return [direct.component]
    for (const path of allPaths) {
      const indices = meter.nets.map(net => path.nets.indexOf(net)).sort((a, b) => a - b)
      if (indices[0] >= 0) return path.edges.slice(indices[0], indices[1]).map(edge => edge.component)
    }
    return []
  }
  if (mode === 'real') {
    for (const component of graph.components) component.realOrientation = 'horizontal'
    const electricalOrder = [source.component, ...allPaths.flatMap(path => path.edges.map(edge => edge.component))]
    const rear = electricalOrder.filter(component => ['source', 'control'].includes(componentLibrary[component.type].category))
    const loads = electricalOrder.filter(component => componentLibrary[component.type].category === 'load')
    const instruments = electricalOrder.filter(component => componentLibrary[component.type].category === 'measure')
    const columns = Math.max(rear.length, loads.length, instruments.length + meters.length, 1)
    function row(components: CircuitComponent[], y: number) {
      components.forEach((component, index) => place(component, origin.x + (columns - components.length) * dx / 2 + index * dx, y))
    }
    row(rear, origin.y)
    row(loads, origin.y + dy)
    const instrumentY = origin.y + 2 * dy
    // Give the voltage measurement the same column as its load; fit series meters
    // in the closest free column, with all dials upright and in the front row.
    for (const meter of meters) {
      const measured = measuredComponents(meter).filter(component => placed.has(component.id))
      const x = measured.length ? measured.reduce((sum, component) => sum + component.position.x, 0) / measured.length : origin.x
      place(meter.component, x, instrumentY)
      while (projectedOverlap(graph.components.filter(component => placed.has(component.id)), mode)) meter.component.position.x += dx
    }
    for (const instrument of instruments) {
      const edge = allPaths.flatMap(path => path.edges).find(item => item.component.id === instrument.id)!
      const neighbor = allPaths.flatMap(path => path.edges).find(item => item !== edge && placed.has(item.component.id) &&
        componentLibrary[item.component.type].category === 'load' && item.nets.some(net => edge.nets.includes(net)))
      const desired = neighbor?.component.position.x ?? origin.x
      const candidates = Array.from({ length: columns + 2 }, (_, index) => origin.x + index * dx)
        .sort((a, b) => Math.abs(a - desired) - Math.abs(b - desired) || a - b)
      for (const x of candidates) {
        place(instrument, x, instrumentY)
        if (!projectedOverlap(graph.components.filter(component => placed.has(component.id)), mode)) break
      }
    }
    function leadCost() {
      return graph.connections.reduce((sum, wire) => {
        const endpoints = [wire.from, wire.to].map(endpoint => {
          const [id, port] = endpoint.split('.')
          const component = byId.get(id)
          if (!component || !placed.has(id)) return undefined
          const terminal = getComponentVisual(component, 'real').terminals.find(item => item.id === port)
          return terminal ? { ...terminal, row: component.position.y, x: component.position.x + terminal.dx, y: component.position.y + terminal.dy } : undefined
        })
        const [a, b] = endpoints
        if (!a || !b) return sum
        let cost = Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
        for (const [from, to] of [[a, b], [b, a]]) {
          const backwards = from.dir === 'left' ? to.x - from.x : from.dir === 'right' ? from.x - to.x
            : from.dir === 'top' ? to.y - from.y : from.y - to.y
          cost += Math.max(0, backwards) * 1.5
        }
        return sum + cost * (a.row === b.row ? 4 : 1)
      }, 0) + meters.reduce((sum, meter) => {
        const measured = measuredComponents(meter)
        const center = measured.reduce((total, component) => total + component.position.x, 0) / Math.max(1, measured.length)
        return sum + Math.abs(meter.component.position.x - center) * 4
      }, 0)
    }
    // Equipment stays upright. Only exchange slots within a bench row, penalizing
    // leads that have to leave a binding post away from the component they join.
    let cost = leadCost()
    for (let pass = 0; pass < 3; pass++) {
      let improved = false
      for (const row of [rear, loads, instruments]) for (let a = 0; a < row.length; a++) for (let b = a + 1; b < row.length; b++) {
        const first = row[a], second = row[b]
        const initialA = first.position, initialB = second.position
        first.position = initialB; second.position = initialA
        const next = leadCost()
        const metersAligned = meters.every(meter => {
          const measured = measuredComponents(meter)
          return !measured.length || Math.abs(meter.component.position.x - measured.reduce((sum, component) => sum + component.position.x, 0) / measured.length) < 20
        })
        if (next < cost && metersAligned && !projectedOverlap(graph.components.filter(component => placed.has(component.id)), mode)) {
          cost = next; improved = true
        } else { first.position = initialA; second.position = initialB }
      }
      if (!improved) break
    }
  } else {
    for (const component of graph.components) component.orientation = 'horizontal'
    source.component.orientation = 'vertical'
    if (main.edges.length === 1) {
      main.edges[0].component.orientation = 'vertical'
      place(source.component, origin.x, origin.y)
      place(main.edges[0].component, origin.x + dx, origin.y)
    } else {
      // Select the fold in the rectangular loop from the real terminal directions,
      // so adjacent horizontal ports face each other wherever their polarity allows.
      let split = 1
      let direction = 1
      let bestScore = Infinity
      for (const candidateDirection of [1, -1]) for (let candidate = 1; candidate < main.edges.length; candidate++) {
        let score = main.edges.reduce((sum, edge, index) => {
          const incoming = edge.ports[edge.nets.indexOf(main.nets[index])]
          const outgoing = edge.ports[edge.nets.indexOf(main.nets[index + 1])]
          const terminals = getPresentedVisual(edge.component, 'schematic', graph.connections).terminals
          const forward = index < candidate ? candidateDirection : -candidateDirection
          const expected = forward > 0 ? ['left', 'right'] : ['right', 'left']
          return sum + (terminals.find(port => port.id === incoming)?.dir === expected[0] ? 0 : 3) +
            (terminals.find(port => port.id === outgoing)?.dir === expected[1] ? 0 : 3)
        }, Math.abs(candidate - (main.edges.length - candidate)) * 0.5)
        for (const parallel of [...branches.map(branch => [branch.nets[0], branch.nets.at(-1)!]), ...meters.map(meter => meter.nets)]) {
          const ends = parallel.map(net => main.nets.indexOf(net)).sort((a, b) => a - b)
          if (ends[0] >= 0 && ends[0] < candidate && ends[1] > candidate) score += 40
        }
        if (score < bestScore) { bestScore = score; split = candidate; direction = candidateDirection }
      }
      const columns = Math.max(split, main.edges.length - split)
      place(source.component, origin.x + (direction < 0 ? columns * dx : 0), origin.y + dy / 2)
      main.edges.forEach((edge, index) => {
        const upper = index < split
        const rowLength = upper ? split : main.edges.length - split
        const column = upper ? index : main.edges.length - index - 1
        const offset = dx + (columns - rowLength) * dx / 2 + column * dx
        place(edge.component, source.component.position.x + direction * offset, origin.y + (upper ? 0 : dy) - horizontalBaseline(edge))
      })
    }
    for (const branch of branches) {
      const endpoints = [branch.nets[0], branch.nets.at(-1)!].map(net => main.nets.indexOf(net)).sort((a, b) => a - b)
      const parallel = main.edges.slice(endpoints[0], endpoints[1]).map(edge => edge.component)
      const x = parallel.reduce((sum, component) => sum + component.position.x, 0) / parallel.length
      const sameRow = new Set(parallel.map(component => component.position.y)).size === 1
      const anchorY = parallel[0].position.y
      const inward = sameRow && anchorY > source.component.position.y ? -1 : 1
      let y = sameRow ? anchorY + laneHeight * inward : Math.max(...parallel.map(component => component.position.y)) + laneHeight
      const tryBranch = () => branch.edges.forEach((edge, index) => place(edge.component, x + (index - (branch.edges.length - 1) / 2) * dx, y - horizontalBaseline(edge)))
      tryBranch()
      while (projectedOverlap(graph.components.filter(component => placed.has(component.id)), mode)) { y += laneHeight * inward; tryBranch() }
    }
    for (const meter of meters) {
      const measured = measuredComponents(meter)
      const direct = allPaths.flatMap(path => path.edges).find(edge => edge.nets.every(net => meter.nets.includes(net)))
      if (direct) {
        const meterPorts = getPresentedVisual(meter.component, 'schematic', graph.connections).terminals
        const loadPorts = getPresentedVisual(direct.component, 'schematic', graph.connections).terminals
        const meterX = meter.ports.map(id => meterPorts.find(port => port.id === id)!.dx)
        const loadX = meter.nets.map(net => loadPorts.find(port => port.id === direct.ports[direct.nets.indexOf(net)])!.dx)
        // Opposite terminal order makes horizontal parallel leads cross. A vertical
        // meter gives each lead its own side without changing electrical polarity.
        if ((meterX[1] - meterX[0]) * (loadX[1] - loadX[0]) < 0) meter.component.orientation = 'vertical'
      }
      const x = measured.length ? measured.reduce((sum, component) => sum + component.position.x, 0) / measured.length : origin.x + dx
      const anchorY = measured.length ? measured.reduce((sum, component) => sum + component.position.y, 0) / measured.length : origin.y
      const inward = anchorY > source.component.position.y ? -1 : 1
      const y = anchorY + laneHeight * inward
      place(meter.component, x, y)
      while (projectedOverlap(graph.components.filter(component => placed.has(component.id)), mode)) meter.component.position.y += laneHeight * inward
    }
  }
  const extras = graph.components.filter(component => !placed.has(component.id))
  const bottom = Math.max(...graph.components.filter(component => placed.has(component.id)).map(component => component.position.y)) + dy
  extras.forEach((component, index) => place(component, origin.x + index % 4 * dx, bottom + Math.floor(index / 4) * dy))
  return projectedOverlap(graph.components, mode) ? undefined : graph
}

// Positions and schematic orientation may change; electrical endpoints and all
// component parameters remain intact. Real objects have a separate upright pose.
export async function layoutCircuitGraph(input: CircuitGraph, mode: ViewMode = 'schematic'): Promise<CircuitGraph> {
  const graph = projectGraphForView(structuredClone(input), mode)
  if (!graph.components.length) return graph
  function commit(arranged: CircuitGraph): CircuitGraph {
    const originals = new Map(structuredClone(input.components).map(component => [component.id, component]))
    return { ...arranged, components: arranged.components.map(component => {
      const original = originals.get(component.id)!
      return { ...withComponentPosition(original, mode, component.position),
        ...(mode === 'real' ? { realOrientation: component.realOrientation } : { orientation: component.orientation }) }
    }), connections: structuredClone(input.connections).map(connection => {
      if (!connection.routes?.[mode]) return structuredClone(connection)
      const { [mode]: _route, ...routes } = connection.routes
      const { routes: _old, ...rest } = connection
      return Object.keys(routes).length ? { ...rest, routes } : rest
    }) }
  }
  if (mode === 'real') for (const component of graph.components) component.realOrientation = 'horizontal'
  const semantic = semanticLayout(structuredClone(graph), mode)
  if (semantic) return commit(semantic)
  const sizes = new Map(graph.components.map(component => [component.id, getLayoutSize(component, mode)]))
  try {
    engine ??= import('elkjs/lib/elk.bundled.js').then(module => new module.default())
    const elk = await engine
    const result = await elk.layout<ElkNode>({
      id: 'layout-root',
      layoutOptions: {
        'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.edgeRouting': 'ORTHOGONAL',
        'elk.spacing.nodeNode': '80', 'elk.layered.spacing.nodeNodeBetweenLayers': '100',
        'elk.spacing.componentComponent': '100', 'elk.layered.spacing.edgeNodeBetweenLayers': '40',
        'elk.padding': '[top=80,left=80,bottom=80,right=80]', 'elk.randomSeed': '1',
      },
      children: graph.components.map(component => ({ id: component.id, ...sizes.get(component.id)! })),
      edges: graph.connections.map(connection => ({
        id: connection.id, sources: [connection.from.split('.')[0]], targets: [connection.to.split('.')[0]],
      })),
    })
    const nodes = new Map(result.children?.map(node => [node.id, node]))
    const arranged = { ...graph, components: graph.components.map(component => {
      const node = nodes.get(component.id)
      if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y)) throw new Error('Invalid layout position')
      const size = sizes.get(component.id)!
      return { ...component, position: {
        x: Math.round((node.x! + size.width / 2) / 20) * 20,
        y: Math.round((node.y! + size.height / 2) / 20) * 20,
      } }
    }) }
    return commit(projectedOverlap(arranged.components, mode) ? gridFallback(graph, mode) : arranged)
  } catch {
    engine = undefined
    return commit(gridFallback(graph, mode))
  }
}
