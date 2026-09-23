import { Matrix, solve } from 'ml-matrix'
import type { CircuitConnection } from '../types/circuit'

/** KCL reconstruction on each ideal-wire net, using minimum-norm flow for redundant loops. */
export function solveWireCurrents(wires: Pick<CircuitConnection, 'id' | 'from' | 'to'>[], injections: Map<string, number>) {
  const result: Record<string, number> = {}
  const adjacent = new Map<string, typeof wires>()
  for (const wire of wires) for (const endpoint of [wire.from, wire.to]) adjacent.set(endpoint, [...(adjacent.get(endpoint) || []), wire])
  const seen = new Set<string>()
  for (const seed of adjacent.keys()) {
    if (seen.has(seed)) continue
    const nodes: string[] = [seed]; seen.add(seed)
    for (let i = 0; i < nodes.length; i++) for (const wire of adjacent.get(nodes[i]) || []) {
      const next = wire.from === nodes[i] ? wire.to : wire.from
      if (!seen.has(next)) { seen.add(next); nodes.push(next) }
    }
    const net = wires.filter(wire => nodes.includes(wire.from))
    const indices = new Map(nodes.slice(1).map((node, i) => [node, i]))
    if (!indices.size) { net.forEach(wire => result[wire.id] = 0); continue }
    const matrix = Matrix.zeros(indices.size, indices.size), rhs = Matrix.zeros(indices.size, 1)
    for (const [node, index] of indices) rhs.set(index, 0, injections.get(node) || 0)
    for (const wire of net) {
      const a = indices.get(wire.from), b = indices.get(wire.to)
      if (a !== undefined) matrix.set(a, a, matrix.get(a, a) + 1)
      if (b !== undefined) matrix.set(b, b, matrix.get(b, b) + 1)
      if (a !== undefined && b !== undefined) { matrix.set(a, b, matrix.get(a, b) - 1); matrix.set(b, a, matrix.get(b, a) - 1) }
    }
    const solution = solve(matrix, rhs)
    const value = (node: string) => indices.has(node) ? solution.get(indices.get(node)!, 0) : 0
    for (const wire of net) {
      const current = value(wire.from) - value(wire.to)
      result[wire.id] = Number.isFinite(current) && Math.abs(current) > 1e-9 ? current : 0
    }
  }
  return result
}
