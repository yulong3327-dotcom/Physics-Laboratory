import { Position } from '@xyflow/react'
import { svgDrawSmoothLinePath } from '@tisoap/react-flow-smart-edge'
import { svgPathProperties } from 'svg-path-properties'
import type { ViewMode } from '../types/circuit'
import type { WireEndpoint } from './wireRenderer'

export interface WirePoint { x: number; y: number }
export interface ManualWireRoute { points: WirePoint[] }
const same = (a: WirePoint, b: WirePoint) => Math.abs(a.x - b.x) < 0.001 && Math.abs(a.y - b.y) < 0.001
const finite = (point: WirePoint) => Number.isFinite(point.x) && Number.isFinite(point.y)
const xy = (point: WirePoint) => `${point.x},${point.y}`
const vectors: Record<Position, WirePoint> = {
  [Position.Left]: { x: -1, y: 0 }, [Position.Right]: { x: 1, y: 0 },
  [Position.Top]: { x: 0, y: -1 }, [Position.Bottom]: { x: 0, y: 1 },
}

export function simplifyWirePoints(input: readonly WirePoint[]): WirePoint[] {
  const result: WirePoint[] = []
  for (const point of input) {
    if (!finite(point) || (result.length && same(point, result[result.length - 1]))) continue
    while (result.length >= 2) {
      const a = result[result.length - 2], b = result[result.length - 1]
      const straight = (Math.abs(a.x - b.x) < 0.001 && Math.abs(b.x - point.x) < 0.001 && (b.y - a.y) * (point.y - b.y) >= 0)
        || (Math.abs(a.y - b.y) < 0.001 && Math.abs(b.y - point.y) < 0.001 && (b.x - a.x) * (point.x - b.x) >= 0)
      if (!straight) break
      result.pop()
    }
    result.push({ x: point.x, y: point.y })
  }
  return result
}

export function getEditableWirePoints(path: string): WirePoint[] {
  try {
    const properties = new svgPathProperties(path)
    const parts = properties.getParts()
    if (!parts.length) return []
    return simplifyWirePoints([parts[0].start, ...parts.map(part => part.end)]).slice(0, 128)
  } catch { return [] }
}

export function moveWireSegment(points: readonly WirePoint[], index: number, delta: number): WirePoint[] {
  if (index < 0 || index >= points.length - 1 || !Number.isFinite(delta)) return points.map(point => ({ ...point }))
  const a = points[index], b = points[index + 1]
  const horizontal = Math.abs(a.y - b.y) < 0.001
  if (!horizontal && Math.abs(a.x - b.x) >= 0.001) return points.map(point => ({ ...point }))
  const move = (point: WirePoint) => horizontal ? { x: point.x, y: point.y + delta } : { x: point.x + delta, y: point.y }
  const first = index === 0, last = index === points.length - 2
  const start = first ? { x: a.x + (b.x - a.x) * 0.2, y: a.y + (b.y - a.y) * 0.2 } : a
  const end = last ? { x: b.x - (b.x - a.x) * 0.2, y: b.y - (b.y - a.y) * 0.2 } : b
  return simplifyWirePoints([
    ...points.slice(0, index), ...(first ? [a, start] : []), move(start), move(end),
    ...(last ? [end, b] : []), ...points.slice(index + 2),
  ])
}

function connectEndpoint(endpoint: WireEndpoint, anchor: WirePoint): WirePoint[] {
  const direction = vectors[endpoint.position]
  const horizontal = direction.x !== 0
  const along = (anchor.x - endpoint.x) * direction.x + (anchor.y - endpoint.y) * direction.y
  const start = { x: endpoint.x, y: endpoint.y }
  if (along >= 8) return [start, horizontal ? { x: anchor.x, y: endpoint.y } : { x: endpoint.x, y: anchor.y }, anchor]
  const lead = { x: endpoint.x + direction.x * 24, y: endpoint.y + direction.y * 24 }
  return [start, lead, horizontal ? { x: lead.x, y: anchor.y } : { x: anchor.x, y: lead.y }, anchor]
}

export function getManualWirePoints(mode: ViewMode, source: WireEndpoint, target: WireEndpoint, route: ManualWireRoute): WirePoint[] {
  const saved = route.points.filter(finite)
  if (saved.length < 2) return [{ x: source.x, y: source.y }, { x: target.x, y: target.y }]
  if (mode === 'real') return [{ x: source.x, y: source.y }, ...saved.slice(1, -1).map(point => ({ ...point })), { x: target.x, y: target.y }]
  const orthogonalize = (points: WirePoint[]) => {
    const result: WirePoint[] = []
    for (const point of points) {
      const previous = result[result.length - 1]
      if (previous && previous.x !== point.x && previous.y !== point.y) result.push({ x: point.x, y: previous.y })
      result.push(point)
    }
    return simplifyWirePoints(result)
  }
  const follows = (endpoint: WireEndpoint, neighbor: WirePoint) => {
    const direction = vectors[endpoint.position]
    const dx = neighbor.x - endpoint.x, dy = neighbor.y - endpoint.y
    return (direction.x ? Math.abs(dy) < 0.001 : Math.abs(dx) < 0.001) && dx * direction.x + dy * direction.y > 0
  }
  if (same(saved[0], source) && same(saved[saved.length - 1], target)
    && follows(source, saved[1]) && follows(target, saved[saved.length - 2])) return orthogonalize(saved)
  const inner = saved.slice(1, -1)
  if (!inner.length) {
    const middle = { x: (source.x + target.x) / 2, y: (source.y + target.y) / 2 }
    return simplifyWirePoints([...connectEndpoint(source, middle), ...connectEndpoint(target, middle).reverse()])
  }
  return orthogonalize([...connectEndpoint(source, inner[0]), ...inner.slice(1, -1), ...connectEndpoint(target, inner[inner.length - 1]).reverse()])
}

export function getManualWirePath(mode: ViewMode, source: WireEndpoint, target: WireEndpoint, route: ManualWireRoute): string {
  const points = getManualWirePoints(mode, source, target, route)
  if (mode === 'schematic') return points.map((point, index) => `${index ? 'L' : 'M'}${xy(point)}`).join(' ')
  const first = vectors[source.position], last = vectors[target.position]
  const start = { x: source.x + first.x * 24, y: source.y + first.y * 24 }
  const end = { x: target.x + last.x * 24, y: target.y + last.y * 24 }
  return svgDrawSmoothLinePath(source, target, [start, ...points.slice(1, -1), end].map(point => [point.x, point.y]))
}
