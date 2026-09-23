import { getBezierPath, getSmoothStepPath, Position, type Node, type Rect } from '@xyflow/react'
import { getSmartEdge, pathfindingAStarDiagonal, pathfindingJumpPointNoDiagonal, svgDrawSmoothLinePath, svgDrawStraightLinePath } from '@tisoap/react-flow-smart-edge'
import { svgPathProperties } from 'svg-path-properties'
import { getVisualOrientation } from '../data/physicalAssets'
import type { CircuitComponent, CircuitConnection, ViewMode } from '../types/circuit'
import { getTerminalAbsolutePosition, getTerminalDirection } from './circuitRenderer'
import { getPresentedVisual } from './componentPresentation'
import { getComponentPosition } from './viewGeometry'

export interface WireEndpoint { x: number; y: number; position: Position; contact?: 'binding-post' | 'socket' | 'pin' }
export interface WireObstacles { nodes: Node[]; labels: Rect[]; routingEnabled: boolean }

const positions = { left: Position.Left, right: Position.Right, top: Position.Top, bottom: Position.Bottom }
export const oppositePosition = {
  [Position.Left]: Position.Right, [Position.Right]: Position.Left,
  [Position.Top]: Position.Bottom, [Position.Bottom]: Position.Top,
}

export function getWireEndpoint(component: CircuitComponent | undefined, terminalId: string | null | undefined, mode: ViewMode, connections: readonly CircuitConnection[] = []): WireEndpoint | undefined {
  if (!component || !terminalId) return undefined
  const terminal = getPresentedVisual(component, mode, connections).terminals.find(item => item.id === terminalId)
  if (!terminal) return undefined
  const orientation = getVisualOrientation(component, mode)
  const position = getComponentPosition(component, mode)
  return {
    ...getTerminalAbsolutePosition(position.x, position.y, terminal.dx, terminal.dy, orientation),
    position: positions[getTerminalDirection(terminal.dir, orientation)],
    contact: terminal.contact,
  }
}

export function getWirePath(mode: ViewMode, source: WireEndpoint, target: WireEndpoint): string {
  const endpoints = {
    sourceX: source.x, sourceY: source.y, sourcePosition: source.position,
    targetX: target.x, targetY: target.y, targetPosition: target.position,
  }
  return mode === 'real'
    ? getBezierPath({ ...endpoints, curvature: 0.35 })[0]
    : getSmoothStepPath({ ...endpoints, borderRadius: 0, offset: 24 })[0]
}

export function getWireObstacles(components: CircuitComponent[], mode: ViewMode, connections: readonly CircuitConnection[] = []): WireObstacles {
  const labels: Rect[] = []
  const nodes = components.map(component => {
    const visual = getPresentedVisual(component, mode, connections)
    const orientation = getVisualOrientation(component, mode)
    const width = orientation === 'vertical' ? visual.height : visual.width
    const height = orientation === 'vertical' ? visual.width : visual.height
    const center = getComponentPosition(component, mode)
    const position = { x: center.x - width / 2, y: center.y - height / 2 }
    const bladeExtension = visual.asset?.switchVisual ? -visual.asset.switchVisual.boundsTop * visual.width / visual.asset.sourceWidth : 0
    const labelClearance = orientation === 'horizontal' ? bladeExtension : 0
    if (component.label) {
      // Match the 120px wrapping label and reserve a conservative line height.
      const textWidth = [...component.label].reduce((sum, character) => sum + (character.charCodeAt(0) > 127 ? 12 : 8), 0)
      const labelWidth = Math.min(120, textWidth)
      const labelHeight = Math.ceil(textWidth / 120) * 16
      const below = mode === 'schematic' && component.type === 'lamp'
      const beside = visual.terminals.some(terminal => getTerminalDirection(terminal.dir, orientation) === 'top')
      labels.push({ x: beside ? position.x + width + 12 : center.x - labelWidth / 2,
        y: beside ? position.y - labelHeight - 9 - labelClearance : below ? position.y + height + 5 : position.y - 9 - labelHeight - labelClearance,
        width: labelWidth, height: labelHeight })
    }
    return { id: component.id, data: {}, position: { x: position.x, y: position.y - labelClearance },
      measured: { width: width + (orientation === 'vertical' ? bladeExtension : 0), height: height + labelClearance } }
  })
  const minX = Math.min(...nodes.map(node => node.position.x))
  const minY = Math.min(...nodes.map(node => node.position.y))
  const maxX = Math.max(...nodes.map(node => node.position.x + node.measured!.width!))
  const maxY = Math.max(...nodes.map(node => node.position.y + node.measured!.height!))
  const cells = Math.ceil((maxX - minX + 160) / 8) * Math.ceil((maxY - minY + 160) / 8)
  return { nodes, labels, routingEnabled: nodes.length <= 80 && cells <= 200_000 }
}

type Point = { x: number; y: number }
const vectors: Record<Position, Point> = {
  [Position.Left]: { x: -1, y: 0 }, [Position.Right]: { x: 1, y: 0 },
  [Position.Top]: { x: 0, y: -1 }, [Position.Bottom]: { x: 0, y: 1 },
}
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const move = (point: Point, vector: Point, length: number): Point => ({ x: point.x + vector.x * length, y: point.y + vector.y * length })
const coordinates = (point: Point) => `${point.x},${point.y}`
const inside = (point: Point, rect: Rect, margin = 0) => point.x > rect.x - margin && point.x < rect.x + rect.width + margin && point.y > rect.y - margin && point.y < rect.y + rect.height + margin
const nodeBounds = (node: Node): Rect => ({ ...node.position, width: node.measured!.width!, height: node.measured!.height! })

function terminalLead(endpoint: WireEndpoint, obstacles: WireObstacles, clearance: number) {
  const node = obstacles.nodes.find(node => inside(endpoint, nodeBounds(node), 1))
  const direction = vectors[endpoint.position]
  if (!node) return { ...move(endpoint, direction, 12), position: endpoint.position }
  const bounds = nodeBounds(node)
  const extension = endpoint.position === Position.Left ? endpoint.x - bounds.x
    : endpoint.position === Position.Right ? bounds.x + bounds.width - endpoint.x
      : endpoint.position === Position.Top ? endpoint.y - bounds.y : bounds.y + bounds.height - endpoint.y
  return { ...move(endpoint, direction, extension + clearance), position: endpoint.position }
}

function naturalCable(source: WireEndpoint, target: WireEndpoint, start: WireEndpoint, end: WireEndpoint, bow: number, tension = 0.3) {
  const span = Math.max(distance(start, end), 1)
  const tangent = { x: (end.x - start.x) / span, y: (end.y - start.y) / span }
  const middle = { x: (start.x + end.x) / 2 - tangent.y * bow, y: (start.y + end.y) / 2 + tangent.x * bow }
  const controlLength = Math.min(180, Math.max(24, span * tension))
  const first = move(start, vectors[source.position], controlLength)
  const last = move(end, vectors[target.position], controlLength)
  return `M${coordinates(source)} L${coordinates(start)} C${coordinates(first)} ${coordinates(move(middle, tangent, -span * 0.18))} ${coordinates(middle)} C${coordinates(move(middle, tangent, span * 0.18))} ${coordinates(last)} ${coordinates(end)} L${coordinates(target)}`
}

function clearCable(path: string, source: WireEndpoint, target: WireEndpoint, start: WireEndpoint, end: WireEndpoint, obstacles: WireObstacles) {
  const properties = new svgPathProperties(path)
  const length = properties.getTotalLength()
  const sourceLead = distance(source, start) + 3, targetLead = distance(target, end) + 3
  const boxes = obstacles.nodes.map(node => nodeBounds(node))
  const steps = Math.min(2400, Math.ceil(length / 4))
  for (let index = 0; index <= steps; index++) {
    const along = steps ? length * index / steps : 0
    const point = properties.getPointAtLength(along)
    for (const rect of boxes) {
      if ((along <= sourceLead && inside(source, rect, 1)) || (length - along <= targetLead && inside(target, rect, 1))) continue
      if (inside(point, rect, 3)) return false
    }
    if (obstacles.labels.some(rect => inside(point, rect, 4))) return false
  }
  return true
}

function smoothCableRoute(source: WireEndpoint, target: WireEndpoint, obstacles: WireObstacles, lane: number): string {
  const direction = vectors[source.position]
  const span = distance(source, target)
  const forwardDistance = (target.x - source.x) * direction.x + (target.y - source.y) * direction.y
  if (oppositePosition[source.position] === target.position && forwardDistance > 0 && span <= 220) {
    const start = terminalLead(source, obstacles, 0), end = terminalLead(target, obstacles, 0)
    const aligned = Math.abs(source.x - target.x) < 0.01 || Math.abs(source.y - target.y) < 0.01
    const path = aligned ? `M${coordinates(source)} L${coordinates(target)}`
      : getBezierPath({ sourceX: source.x, sourceY: source.y, sourcePosition: source.position,
        targetX: target.x, targetY: target.y, targetPosition: target.position, curvature: 0.2 })[0]
    if (clearCable(path, source, target, start, end, obstacles)) return path
  }
  const padding = 18 + (lane % 6) * 5
  const start = terminalLead(source, obstacles, padding + 12), end = terminalLead(target, obstacles, padding + 12)
  const bow = Math.min(76, Math.max(24, distance(start, end) * 0.12)) + (lane % 4) * 7
  // Keep leads aligned to the posts, then use broad bends instead of rounded grid corners.
  for (const offset of [bow, -bow, bow * 1.8, -bow * 1.8, 0]) {
    const path = naturalCable(source, target, start, end, offset)
    if (clearCable(path, source, target, start, end, obstacles)) return path
  }
  for (const extra of [0, 16, 32]) {
    const route = getSmartEdge({ sourceX: start.x, sourceY: start.y, sourcePosition: start.position,
      targetX: end.x, targetY: end.y, targetPosition: end.position, nodes: obstacles.nodes,
      options: { gridRatio: 8, nodePadding: padding + extra, avoidAreas: obstacles.labels,
        generatePath: pathfindingAStarDiagonal, drawEdge: svgDrawSmoothLinePath },
    })
    if (route instanceof Error) continue
    const raw = [start, ...route.points.map(([x, y]) => ({ x, y })), end]
      .filter((point, index, points) => !index || distance(point, points[index - 1]) > 0.1)
    // String-pulling removes grid stair steps; the proven smooth-line renderer rounds the remaining bends.
    const waypoints: Point[] = [raw[0]]
    for (let index = 0; index < raw.length - 1;) {
      let next = raw.length - 1
      while (next > index + 1) {
        const a = raw[index], b = raw[next]
        const samples = Math.ceil(distance(a, b) / 5)
        const blocked = Array.from({ length: samples + 1 }, (_, step) => move(a, { x: b.x - a.x, y: b.y - a.y }, samples ? step / samples : 0))
          .some(point => obstacles.nodes.some(node => inside(point, nodeBounds(node), 12)) || obstacles.labels.some(label => inside(point, label, 12)))
        if (!blocked) break
        next--
      }
      waypoints.push(raw[next])
      index = next
    }
    for (const points of [waypoints, raw]) {
      const firstTangent = move(start, vectors[source.position], 14)
      const lastTangent = move(end, vectors[target.position], 14)
      const path = svgDrawSmoothLinePath(source, target, [start, firstTangent, ...points.slice(1, -1), lastTangent, end].map(point => [point.x, point.y]))
      if (clearCable(path, source, target, start, end, obstacles)) return path
    }
  }
  return naturalCable(source, target, start, end, bow)
}

function compactPoints(points: Point[]) {
  const result: Point[] = []
  for (const point of points) {
    if (result.length && distance(result.at(-1)!, point) < 0.001) continue
    while (result.length > 1) {
      const a = result.at(-2)!, b = result.at(-1)!
      const collinear = (a.x === b.x && b.x === point.x) || (a.y === b.y && b.y === point.y)
      const sameDirection = (b.x - a.x) * (point.x - b.x) + (b.y - a.y) * (point.y - b.y) >= 0
      if (!collinear || !sameDirection) break
      result.pop()
    }
    result.push(point)
  }
  return result
}

function segmentHits(a: Point, b: Point, rect: Rect, margin: number) {
  if (a.x === b.x) return a.x > rect.x - margin && a.x < rect.x + rect.width + margin
    && Math.max(a.y, b.y) > rect.y - margin && Math.min(a.y, b.y) < rect.y + rect.height + margin
  return a.y > rect.y - margin && a.y < rect.y + rect.height + margin
    && Math.max(a.x, b.x) > rect.x - margin && Math.min(a.x, b.x) < rect.x + rect.width + margin
}

function clearOrthogonal(points: Point[], source: WireEndpoint, target: WireEndpoint, obstacles: WireObstacles) {
  if (points.length < 2) return false
  const goesOut = (a: Point, b: Point, position: Position) => (b.x - a.x) * vectors[position].x + (b.y - a.y) * vectors[position].y > 0
  if (!goesOut(points[0], points[1], source.position) || !goesOut(points.at(-1)!, points.at(-2)!, target.position)) return false
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1], b = points[index]
    if (a.x !== b.x && a.y !== b.y) return false
    if (index > 1) {
      const previous = points[index - 2]
      if ((a.x - previous.x) * (b.x - a.x) + (a.y - previous.y) * (b.y - a.y) < 0) return false
    }
    for (const node of obstacles.nodes) {
      const rect = nodeBounds(node)
      if ((index === 1 && inside(source, rect, 1)) || (index === points.length - 1 && inside(target, rect, 1))) continue
      if (segmentHits(a, b, rect, 8)) return false
    }
    if (obstacles.labels.some(rect => segmentHits(a, b, rect, 4))) return false
  }
  return true
}

function simpleOrthogonalRoute(source: WireEndpoint, target: WireEndpoint, obstacles: WireObstacles, lane: number) {
  const clearance = 24 + (lane % 4) * 4
  const start = move(source, vectors[source.position], clearance), end = move(target, vectors[target.position], clearance)
  const boxes = [...obstacles.nodes.map(nodeBounds), ...obstacles.labels]
  const xs = new Set([(source.x + target.x) / 2, Math.min(source.x, target.x) - clearance, Math.max(source.x, target.x) + clearance, start.x, end.x])
  const ys = new Set([(source.y + target.y) / 2, Math.min(source.y, target.y) - clearance, Math.max(source.y, target.y) + clearance, start.y, end.y])
  for (const rect of boxes) { xs.add(rect.x - clearance); xs.add(rect.x + rect.width + clearance); ys.add(rect.y - clearance); ys.add(rect.y + rect.height + clearance) }
  const candidates: Point[][] = [[source, target], [source, { x: source.x, y: target.y }, target], [source, { x: target.x, y: source.y }, target]]
  for (const x of xs) {
    candidates.push([source, { x, y: source.y }, { x, y: target.y }, target])
    candidates.push([source, start, { x, y: start.y }, { x, y: end.y }, end, target])
  }
  for (const y of ys) {
    candidates.push([source, { x: source.x, y }, { x: target.x, y }, target])
    candidates.push([source, start, { x: start.x, y }, { x: end.x, y }, end, target])
  }
  const horizontal = (position: Position) => position === Position.Left || position === Position.Right
  if (horizontal(source.position) !== horizontal(target.position)) {
    const nearest = (values: Set<number>, a: number, b: number) => [...values].sort((x, y) => Math.min(Math.abs(x - a), Math.abs(x - b)) - Math.min(Math.abs(y - a), Math.abs(y - b))).slice(0, 16)
    for (const x of nearest(xs, source.x, target.x)) for (const y of nearest(ys, source.y, target.y)) {
      candidates.push(horizontal(source.position)
        ? [source, { x, y: source.y }, { x, y }, { x: target.x, y }, target]
        : [source, { x: source.x, y }, { x, y }, { x, y: target.y }, target])
    }
  }
  candidates.push([source, start, { x: start.x, y: end.y }, end, target], [source, start, { x: end.x, y: start.y }, end, target])
  const paths = candidates.map(compactPoints).filter(points => clearOrthogonal(points, source, target, obstacles))
  // Readable circuit drawings favor a single rectangle over a shorter grid zigzag.
  const cost = (points: Point[]) => (points.length - 2) * 160 + points.slice(1).reduce((sum, point, index) => sum + distance(points[index], point), 0)
  paths.sort((a, b) => cost(a) - cost(b))
  const best = paths[0]
  return best && svgDrawStraightLinePath(source, target, best.slice(1, -1).map(point => [point.x, point.y]))
}

export function getRoutedWirePath(mode: ViewMode, source: WireEndpoint, target: WireEndpoint, obstacles: WireObstacles, lane = 0): string {
  if (!obstacles.routingEnabled || ![source.x, source.y, target.x, target.y].every(value => Number.isFinite(value) && Math.abs(value) < 1e7)) return getWirePath(mode, source, target)
  if (mode === 'real') return smoothCableRoute(source, target, obstacles, lane)
  const simple = simpleOrthogonalRoute(source, target, obstacles, lane)
  if (simple) return simple
  const padding = 16 + (lane % 8) * 8
  const start = source, end = target
  let route: ReturnType<typeof getSmartEdge>
  try { route = getSmartEdge({ sourceX: start.x, sourceY: start.y, sourcePosition: start.position,
    targetX: end.x, targetY: end.y, targetPosition: end.position, nodes: obstacles.nodes,
    options: { gridRatio: 8, nodePadding: padding, avoidAreas: obstacles.labels,
      generatePath: pathfindingJumpPointNoDiagonal,
      drawEdge: svgDrawStraightLinePath },
  }) } catch { return getWirePath(mode, source, target) }
  if (route instanceof Error) return getWirePath(mode, source, target)
  const raw = [[source.x, source.y], [start.x, start.y], ...route.points, [end.x, end.y], [target.x, target.y]]
  const points: number[][] = []
  const append = (point: number[]) => {
    if (points.length && points[points.length - 1][0] === point[0] && points[points.length - 1][1] === point[1]) return
    while (points.length >= 2) {
      const a = points[points.length - 2], b = points[points.length - 1]
      if (!((a[0] === b[0] && b[0] === point[0]) || (a[1] === b[1] && b[1] === point[1]))) break
      points.pop()
    }
    points.push(point)
  }
  for (const point of raw) {
    const previous = points[points.length - 1]
    if (previous && previous[0] !== point[0] && previous[1] !== point[1]) {
      const horizontal = points.length === 1 ? source.position === Position.Left || source.position === Position.Right : Math.abs(point[0] - previous[0]) > Math.abs(point[1] - previous[1])
      append(horizontal ? [point[0], previous[1]] : [previous[0], point[1]])
    }
    append(point)
  }
  return svgDrawStraightLinePath(source, target, points.slice(1, -1))
}
