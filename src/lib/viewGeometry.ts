import type { CircuitComponent, CircuitGraph, CircuitPoint, ViewMode } from '../types/circuit'

export function getComponentPosition(component: CircuitComponent, mode: ViewMode): CircuitPoint {
  return mode === 'real' ? component.realPosition ?? component.position : component.position
}

export function projectGraphForView(graph: CircuitGraph, mode: ViewMode): CircuitGraph {
  return { ...graph, components: graph.components.map(component => ({ ...component, position: { ...getComponentPosition(component, mode) } })) }
}

export function withComponentPosition(component: CircuitComponent, mode: ViewMode, position: CircuitPoint): CircuitComponent {
  const schematic = mode === 'schematic' ? position : component.position
  const real = mode === 'real' ? position : getComponentPosition(component, 'real')
  const { realPosition: _previous, ...rest } = component
  return { ...rest, position: { ...schematic }, ...(real.x === schematic.x && real.y === schematic.y ? {} : { realPosition: { ...real } }) }
}
