import { memo, useId } from 'react'
import { BaseEdge, type ConnectionLineComponentProps, type Edge, type EdgeProps } from '@xyflow/react'
import { useCircuitStore } from '../store/circuitStore'
import { getWireEndpoint, getWirePath, type WireEndpoint } from '../lib/wireRenderer'
import type { ViewMode } from '../types/circuit'
import { CurrentDots } from './CurrentDots'
import { WireSegmentControls } from './WireSegmentControls'

export type CircuitWireEdge = Edge<{
  viewMode: ViewMode; sourceTerminal?: WireEndpoint; targetTerminal?: WireEndpoint; routedPath?: string; current?: number
}, 'circuitWire'>

export function WirePath({ path, mode, selected = false, preview = false, id, interactionWidth = 20 }: {
  path: string; mode: ViewMode; selected?: boolean; preview?: boolean; id?: string; interactionWidth?: number
}) {
  const real = mode === 'real'
  const className = `circuit-wire ${real ? 'circuit-wire-real' : 'circuit-wire-schematic'}`
  const style = { stroke: real ? '#414748' : '#3e4344', strokeWidth: real ? 5 : 1.75 }
  return <g className={`wire-rendering ${preview ? 'wire-rendering-preview' : ''}`} data-wire-mode={mode}>
    {selected && <path className="wire-selection" d={path} strokeWidth={real ? 11 : 8} />}
    {real && <path className="wire-shadow" d={path} />}
    {id ? <BaseEdge id={id} path={path} className={className} style={style} interactionWidth={interactionWidth} />
      : <path d={path} className={className} style={style} />}
    {real && <path className="wire-highlight" d={path} />}
  </g>
}

export const CircuitWire = memo(function CircuitWire({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, data, interactionWidth }: EdgeProps<CircuitWireEdge>) {
  const clipId = useId().replace(/:/g, '')
  const source = data?.sourceTerminal || { x: sourceX, y: sourceY, position: sourcePosition }
  const target = data?.targetTerminal || { x: targetX, y: targetY, position: targetPosition }
  const mode = data?.viewMode || 'schematic'
  const editing = useCircuitStore(state => state.toolMode === 'select' && state.selectedConnectionId === id)
  const path = data?.routedPath || getWirePath(mode, source, target)
  const hole = (point: WireEndpoint) => `M ${point.x - 15} ${point.y} a 15 15 0 1 0 30 0 a 15 15 0 1 0 -30 0 Z`
  return <><WirePath id={id} path={path} mode={mode} selected={selected} interactionWidth={mode === 'real' ? 0 : interactionWidth} />
    {mode === 'real' && <><defs><clipPath id={clipId} clipPathUnits="userSpaceOnUse"><path clipRule="evenodd" d={`M -1000000 -1000000 H 1000000 V 1000000 H -1000000 Z ${hole(source)} ${hole(target)}`} /></clipPath></defs>
      <path className="real-wire-hitarea" d={path} clipPath={`url(#${clipId})`} fill="none" stroke="transparent" strokeWidth={interactionWidth || 20} style={{ pointerEvents: 'stroke' }} /></>}
    {mode === 'real' && [source, target].map((terminal, i) => {
      const angle = { left: 180, right: 0, top: -90, bottom: 90 }[terminal.position]
      const pin = terminal.contact === 'pin'
      return <g key={i} className="wire-contact" transform={`translate(${terminal.x} ${terminal.y}) rotate(${angle})`} pointerEvents="none">
        <path d="M1 0 H9" stroke="#31383a" strokeWidth={pin ? 2 : 4.2} strokeLinecap="round" />
        <path d="M0 0 H4" stroke="#b8c0c1" strokeWidth={pin ? 1.4 : 3.4} strokeLinecap="round" />
        <path d="M0 -0.7 H4" stroke="#f0f3f3" strokeWidth="0.7" />
      </g>
    })}
    {data?.current !== undefined && Math.abs(data.current) >= 1e-5 && <CurrentDots path={path} current={data.current} />}
    {editing && <WireSegmentControls id={id} mode={mode} path={path} source={source} target={target} />}</>
})

export function CircuitConnectionLine({ fromNode, fromHandle, toNode, toHandle, fromX, fromY, toX, toY, fromPosition, toPosition, connectionLineStyle }: ConnectionLineComponentProps) {
  const { graph, viewMode } = useCircuitStore()
  const source = getWireEndpoint(graph.components.find(component => component.id === fromNode.id), fromHandle.id, viewMode, graph.connections)
    || { x: fromX, y: fromY, position: fromPosition }
  const target = getWireEndpoint(graph.components.find(component => component.id === toNode?.id), toHandle?.id, viewMode, graph.connections)
    || { x: toX, y: toY, position: toPosition }
  return <g style={connectionLineStyle}><WirePath path={getWirePath(viewMode, source, target)} mode={viewMode} preview /></g>
}
