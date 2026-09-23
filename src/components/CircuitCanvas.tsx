import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background, BackgroundVariant, ConnectionMode, Handle, Panel, Position, ReactFlow,
  useReactFlow, useUpdateNodeInternals, getViewportForBounds, type Node, type NodeProps, type Viewport,
} from '@xyflow/react'
import { Focus, Grid2X2, Minus, Plus, RotateCw, Trash2, X } from 'lucide-react'
import { useCircuitStore } from '../store/circuitStore'
import { componentLibrary } from '../data/componentLibrary'
import { getPhysicalAsset, getVisualOrientation, type ComponentPlacement } from '../data/physicalAssets'
import { getPresentedVisual } from '../lib/componentPresentation'
import { getComponentPosition } from '../lib/viewGeometry'
import { getManualWirePath } from '../lib/wireEditing'
import { getComponentParameters, simulateCircuit, type ComponentSimulationResult } from '../lib/circuitSimulation'
import { getPhysicalImageSource, renderPhysicalOverlay, symbolOptions } from '../lib/simulationVisual'
import { formatReading } from './SimulationControls'
import { getTerminalAbsolutePosition, getTerminalDirection, renderSymbol } from '../lib/circuitRenderer'
import { getRoutedWirePath, getWireEndpoint, getWireObstacles, getWirePath, oppositePosition, type WireEndpoint } from '../lib/wireRenderer'
import type { CircuitComponent, CircuitConnection, ComponentType, ViewMode } from '../types/circuit'
import { IconButton } from './IconButton'
import { CircuitConnectionLine, CircuitWire, WirePath, type CircuitWireEdge } from './CircuitWire'
import '@xyflow/react/dist/style.css'

type CircuitNode = Node<{ component: CircuitComponent; wiring: boolean; wireTerm: string | null; viewMode: ViewMode; simulation?: ComponentSimulationResult; connected: string[]; connections: CircuitConnection[] }, 'circuit'>
const positions = { left: Position.Left, right: Position.Right, top: Position.Top, bottom: Position.Bottom }

const ComponentNode = memo(function ComponentNode({ id, data, selected, isConnectable }: NodeProps<CircuitNode>) {
  const { component: comp, wiring, wireTerm, viewMode } = data
  const def = componentLibrary[comp.type]
  const visual = getPresentedVisual(comp, viewMode, data.connections)
  const asset = getPhysicalAsset(comp.type, comp.assetId)
  const orientation = getVisualOrientation(comp, viewMode)
  const vertical = orientation === 'vertical'
  const width = vertical ? visual.height : visual.width
  const height = vertical ? visual.width : visual.height
  const labelBeside = visual.terminals.some(term => getTerminalDirection(term.dir, orientation) === 'top')
  const labelClearance = !vertical && visual.asset?.switchVisual ? -visual.asset.switchVisual.boundsTop * visual.width / visual.asset.sourceWidth : 0
  const parameters = getComponentParameters(comp)
  const source = visual.asset && getPhysicalImageSource(comp, visual.asset, data.simulation)
  const [imageFailed, setImageFailed] = useState(false)
  const imageRetryClick = useRef(0)
  const updateInternals = useUpdateNodeInternals()
  const terminalKey = visual.terminals.map(term => `${term.id}:${term.dx}:${term.dy}`).join('|')
  useEffect(() => { updateInternals(id) }, [id, orientation, viewMode, comp.assetId, width, height, terminalKey, updateInternals])
  useEffect(() => { setImageFailed(false) }, [source, comp.assetId, viewMode])
  useEffect(() => {
    if (!imageFailed) return
    const retry = () => { if (document.visibilityState !== 'hidden') setImageFailed(false) }
    const timer = window.setTimeout(retry, 10_000)
    window.addEventListener('online', retry); window.addEventListener('focus', retry)
    document.addEventListener('visibilitychange', retry)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('online', retry); window.removeEventListener('focus', retry)
      document.removeEventListener('visibilitychange', retry)
    }
  }, [imageFailed])

  return (
    <div className={`circuit-node ${visual.asset ? 'physical-node' : ''} ${selected ? 'is-selected' : ''}`} style={{ width, height }} data-component-type={comp.type} data-asset-id={asset?.id}
      onDoubleClick={event => { if (comp.type !== 'switch' || wiring || Date.now() - imageRetryClick.current < 700) return; event.stopPropagation(); useCircuitStore.getState().updateComponentParameters(id, { switchClosed: !parameters.switchClosed }) }}>
      {visual.asset ? imageFailed ? <button type="button" className="physical-image-error nodrag" aria-label={`重新加载${visual.asset.name}图片`} title="本机服务或图片资源暂不可用，恢复后会自动重试。" onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); imageRetryClick.current = Date.now(); setImageFailed(false) }}>图片暂未加载<br />点击重试</button> : <img
        className="physical-component-image" src={source} alt={visual.asset.name} draggable={false}
        width={visual.width} height={visual.height} onError={() => setImageFailed(true)}
        style={{ width: visual.width, height: visual.height, left: width / 2, top: height / 2, transform: `translate(-50%, -50%) rotate(${vertical ? 90 : 0}deg)` }}
      /> : <svg width={width} height={height} viewBox={`${-width / 2} ${-height / 2} ${width} ${height}`} className="component-symbol" aria-hidden="true">
        <g transform={`rotate(${vertical ? 90 : 0})`} dangerouslySetInnerHTML={{ __html: renderSymbol(comp.type, !!selected, undefined, { ...symbolOptions(comp, data.simulation, vertical), meterThirdTerminal: visual.meterThirdTerminal }) }} />
      </svg>}
      {visual.asset && <svg className="physical-overlay" width={visual.width} height={visual.height} viewBox={`0 0 ${visual.asset.sourceWidth} ${visual.asset.sourceHeight}`}
        style={{ left: width / 2, top: height / 2, transform: `translate(-50%, -50%) rotate(${vertical ? 90 : 0}deg)` }}
        dangerouslySetInnerHTML={{ __html: renderPhysicalOverlay(comp, visual.asset, data.simulation) }} />}
      {(comp.type === 'rheostat' || comp.type === 'potentiometer') && selected && !wiring && <input className="node-slider nodrag nowheel" type="range" aria-label="拖动滑片" min="0" max="100" step="1" value={parameters.sliderPosition * 100}
        onPointerDown={() => useCircuitStore.getState().beginHistoryTransaction()} onPointerUp={() => useCircuitStore.getState().endHistoryTransaction()} onBlur={() => useCircuitStore.getState().endHistoryTransaction()}
        onKeyDown={() => useCircuitStore.getState().beginHistoryTransaction()} onKeyUp={() => useCircuitStore.getState().endHistoryTransaction()}
        onChange={event => useCircuitStore.getState().updateComponentParameters(id, { sliderPosition: Number(event.target.value) / 100 })} />}
      {data.simulation && <output className={`node-reading ${data.simulation.lampStatus === 'overload' ? 'overload' : data.simulation.meterStatus || ''}`} data-testid="node-reading">
        {data.simulation.unit ? `${parameters.meterMode === 'manual' ? '手动 ' : ''}${formatReading(parameters.meterMode === 'manual' ? parameters.manualReading : data.simulation.reading, data.simulation.unit)}`
          : comp.type === 'lamp' ? data.simulation.lampStatus === 'overload'
            ? `过载 ${formatReading(data.simulation.power, 'W')} / 额定 ${formatReading(data.simulation.ratedPower, 'W')}`
            : `${Math.round(data.simulation.brightness * 100)}%` : ''}
      </output>}
      {comp.label && <span className="component-label" style={labelBeside ? { left: 'calc(100% + 12px)', top: 'auto', bottom: `calc(100% + ${9 + labelClearance}px)`, transform: 'none' } : labelClearance ? { bottom: `calc(100% + ${9 + labelClearance}px)` } : undefined}>{comp.label}</span>}
      {visual.terminals.map(term => {
        const p = getTerminalAbsolutePosition(0, 0, term.dx, term.dy, orientation)
        return <Handle key={term.id} id={term.id} type="source"
          isConnectable={isConnectable} isConnectableStart={isConnectable} isConnectableEnd={isConnectable}
          position={positions[getTerminalDirection(term.dir, orientation)]}
          style={{ left: p.x + width / 2, top: p.y + height / 2, right: 'auto', bottom: 'auto', transform: 'translate(-50%, -50%)' }}
          className={`terminal ${term.virtual ? 'virtual-terminal' : ''} ${data.connected.includes(term.id) ? 'is-connected' : ''} ${wiring ? 'wire-mode' : ''} ${wireTerm === term.id ? 'wire-start' : ''}`}
          title={`${def.name} ${term.label || term.id}${term.virtual ? '（示意接点）' : ''}`}
          aria-label={`${comp.id}.${term.id}`} role="button" tabIndex={isConnectable ? 0 : -1} aria-disabled={!isConnectable}
          onClick={event => {
            event.stopPropagation()
            if (!wiring || !isConnectable) return
            const store = useCircuitStore.getState()
            if (store.wireStart) store.finishWire(id, term.id)
            else store.startWire(id, term.id)
          }}
          onKeyDown={event => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            event.stopPropagation()
            if (!isConnectable) return
            const store = useCircuitStore.getState()
            if (store.wireStart) store.finishWire(id, term.id)
            else store.startWire(id, term.id)
          }}
        />
      })}
    </div>
  )
})

const nodeTypes = { circuit: ComponentNode }
const edgeTypes = { circuitWire: CircuitWire }
const defaultEdgeOptions = { type: 'circuitWire' as const, interactionWidth: 20 }

export function CircuitCanvas({ placement, onPlaced }: { placement: ComponentPlacement | null; onPlaced: () => void }) {
  const store = useCircuitStore()
  const { graph, toolMode, wireStart, zoom, pan, viewMode } = store
  const flow = useReactFlow<CircuitNode>()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [snap, setSnap] = useState(true)
  const [pointer, setPointer] = useState<{ x: number; y: number; terminal?: WireEndpoint } | null>(null)
  const draggingRef = useRef(false)
  const suppressDragRef = useRef(false)
  const connectingRef = useRef(false)
  const suppressConnectRef = useRef(false)
  const [connectionCancelled, setConnectionCancelled] = useState(false)
  const panMode = toolMode === 'pan'
  const wireMode = toolMode === 'wire'
  const simulation = useMemo(() => store.simulationEnabled ? simulateCircuit(graph) : null, [graph, store.simulationEnabled])

  const cancelNodeDrag = useCallback(() => {
    if (!draggingRef.current) return false
    draggingRef.current = false
    suppressDragRef.current = true
    useCircuitStore.getState().cancelHistoryTransaction()
    return true
  }, [])

  const cancelNativeConnection = useCallback(() => {
    if (!connectingRef.current) return
    suppressConnectRef.current = true
    setConnectionCancelled(true)
  }, [])

  const nodes = useMemo<CircuitNode[]>(() => graph.components.map(component => ({
    id: component.id, type: 'circuit', position: getComponentPosition(component, viewMode),
    selected: store.selectedComponentId === component.id,
    data: { component, wiring: wireMode, wireTerm: wireStart?.compId === component.id ? wireStart.termId : null, viewMode,
      simulation: simulation?.components[component.id], connections: graph.connections, connected: component.terminals.filter(term => graph.connections.some(wire => wire.from === `${component.id}.${term.id}` || wire.to === `${component.id}.${term.id}`)).map(term => term.id) },
    ariaLabel: `${componentLibrary[component.type].name} ${component.label || ''}`,
    draggable: !panMode && !wireMode && !placement,
  })), [graph.components, graph.connections, store.selectedComponentId, wireMode, wireStart, panMode, placement, viewMode, simulation])

  const wireRoutes = useMemo(() => {
    const components = new Map(graph.components.map(component => [component.id, component]))
    const obstacles = getWireObstacles(graph.components, viewMode, graph.connections)
    return new Map(graph.connections.map((connection, lane) => {
      const [source, sourceHandle] = connection.from.split('.')
      const [target, targetHandle] = connection.to.split('.')
      const sourceTerminal = getWireEndpoint(components.get(source), sourceHandle, viewMode, graph.connections)
      const targetTerminal = getWireEndpoint(components.get(target), targetHandle, viewMode, graph.connections)
      return [connection.id, { viewMode, sourceTerminal, targetTerminal,
        routedPath: sourceTerminal && targetTerminal ? connection.routes?.[viewMode]
          ? getManualWirePath(viewMode, sourceTerminal, targetTerminal, connection.routes[viewMode]!)
          : getRoutedWirePath(viewMode, sourceTerminal, targetTerminal, obstacles, graph.connections.length - 1 - lane) : undefined }]
    }))
  }, [graph.components, graph.connections, viewMode])

  const edges = useMemo<CircuitWireEdge[]>(() => {
    return graph.connections.map(connection => {
      const [source, sourceHandle] = connection.from.split('.')
      const [target, targetHandle] = connection.to.split('.')
      return { id: connection.id, source, sourceHandle, target, targetHandle,
        zIndex: viewMode === 'real' ? 1 : 0,
        selected: connection.id === store.selectedConnectionId, ...defaultEdgeOptions,
        data: { ...wireRoutes.get(connection.id)!, current: simulation?.wireCurrents[connection.id] } }
    })
  }, [graph.connections, store.selectedConnectionId, wireRoutes, viewMode, simulation])

  const fit = useCallback(() => {
    const nodes = flow.getNodes()
    if (!nodes.length) { void flow.setViewport({ x: 0, y: 0, zoom: 1 }); return }
    const bounds = nodes.map(node => {
      const width = node.measured?.width || 100, height = node.measured?.height || 100
      return { x: node.position.x - width / 2 - 20, y: node.position.y - height / 2 - 42, width: width + 100, height: height + 90 }
    })
    wrapperRef.current?.querySelectorAll<SVGPathElement>('.react-flow__edge-path').forEach(path => {
      try { bounds.push(path.getBBox()) } catch { /* An unmounted edge is fitted on the next pass. */ }
    })
    const x = Math.min(...bounds.map(box => box.x)), y = Math.min(...bounds.map(box => box.y))
    const width = Math.max(...bounds.map(box => box.x + box.width)) - x
    const height = Math.max(...bounds.map(box => box.y + box.height)) - y
    const wrapper = wrapperRef.current
    if (wrapper) void flow.setViewport(getViewportForBounds({ x, y, width, height }, wrapper.clientWidth, wrapper.clientHeight, 0.3, 1.2, 0.12), { duration: 180 })
  }, [flow])

  useEffect(() => {
    const handleFit = () => { requestAnimationFrame(() => requestAnimationFrame(fit)) }
    window.addEventListener('circuit:fit', handleFit)
    return () => window.removeEventListener('circuit:fit', handleFit)
  }, [fit])

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (target.closest('input, textarea, select, dialog, [contenteditable="true"], [role="dialog"]')) return
      const state = useCircuitStore.getState()
      const modifier = event.ctrlKey || event.metaKey
      if (modifier && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        cancelNativeConnection()
        const canceledDrag = cancelNodeDrag()
        if (event.shiftKey) state.redo()
        else if (!canceledDrag) state.undo()
      } else if (modifier && event.key.toLowerCase() === 'y') {
        event.preventDefault(); cancelNativeConnection(); cancelNodeDrag(); state.redo()
      } else if (event.key === 'Escape') {
        cancelNodeDrag(); cancelNativeConnection()
        state.cancelWire(); state.selectComponent(null); onPlaced()
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        cancelNodeDrag(); cancelNativeConnection()
        if (state.selectedComponentId) state.removeComponent(state.selectedComponentId)
        else if (state.selectedConnectionId) state.removeConnection(state.selectedConnectionId)
      } else if (!modifier && event.key.toLowerCase() === 'r' && state.selectedComponentId) {
        cancelNodeDrag(); cancelNativeConnection()
        state.rotateComponent(state.selectedComponentId)
      } else if (!modifier && ['v', 'w', 'h'].includes(event.key.toLowerCase())) {
        cancelNodeDrag(); cancelNativeConnection()
        state.setToolMode(event.key.toLowerCase() === 'v' ? 'select' : event.key.toLowerCase() === 'w' ? 'wire' : 'pan')
      }
    }
    // XYFlow can omit its drag-stop callback when the dragged node was deleted.
    const releasePointer = () => { requestAnimationFrame(() => { suppressDragRef.current = false }) }
    const cancelGestures = () => { cancelNodeDrag(); cancelNativeConnection(); useCircuitStore.getState().cancelWire() }
    window.addEventListener('keydown', keyDown)
    window.addEventListener('mouseup', releasePointer)
    window.addEventListener('touchend', releasePointer)
    window.addEventListener('pointercancel', cancelGestures)
    window.addEventListener('blur', cancelGestures)
    return () => {
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('mouseup', releasePointer)
      window.removeEventListener('touchend', releasePointer)
      window.removeEventListener('pointercancel', cancelGestures)
      window.removeEventListener('blur', cancelGestures)
    }
  }, [onPlaced, cancelNodeDrag, cancelNativeConnection])

  useEffect(() => {
    cancelNodeDrag(); cancelNativeConnection()
    store.cancelWire()
  }, [graph.id, toolMode, placement, viewMode, cancelNodeDrag, cancelNativeConnection])

  const place = (type: ComponentType, clientX: number, clientY: number, assetId?: string) => {
    if (!Object.prototype.hasOwnProperty.call(componentLibrary, type)) return
    if (assetId !== undefined && !getPhysicalAsset(type, assetId)) return
    const point = flow.screenToFlowPosition({ x: clientX, y: clientY }, { snapToGrid: snap })
    store.addComponent(type, point.x, point.y, assetId)
    store.setToolMode('select')
    onPlaced()
    wrapperRef.current?.focus()
  }

  const startComp = graph.components.find(c => c.id === wireStart?.compId)
  const startPoint = getWireEndpoint(startComp, wireStart?.termId, viewMode, graph.connections)

  return <main ref={wrapperRef} className={`canvas-workspace ${viewMode === 'real' ? 'real-view' : ''} ${placement ? 'is-placing' : ''}`} tabIndex={-1} aria-label="电路画布"
    onPointerMove={event => {
      if (!wireStart) return
      const handle = (event.target as Element).closest('[data-handleid]')
      const component = graph.components.find(item => item.id === handle?.getAttribute('data-nodeid'))
      setPointer({ ...flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
        terminal: getWireEndpoint(component, handle?.getAttribute('data-handleid'), viewMode, graph.connections) })
    }} onPointerLeave={() => setPointer(null)}
    onDrop={event => {
      event.preventDefault()
      place(event.dataTransfer.getData('componentType') as ComponentType, event.clientX, event.clientY, event.dataTransfer.getData('componentAssetId') || undefined)
    }} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }}>
    <ReactFlow<CircuitNode, CircuitWireEdge> nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} nodeOrigin={[0.5, 0.5]}
      defaultEdgeOptions={defaultEdgeOptions} minZoom={0.3} maxZoom={3} snapToGrid={snap} snapGrid={[20, 20]}
      viewport={{ x: pan.x, y: pan.y, zoom }}
      onViewportChange={(viewport: Viewport) => { store.setPan(viewport.x, viewport.y); store.setZoom(viewport.zoom) }}
      connectionMode={ConnectionMode.Loose} connectOnClick={false} nodesConnectable={!panMode && !placement}
      connectionLineStyle={connectionCancelled ? { display: 'none' } : undefined}
      connectionLineComponent={CircuitConnectionLine}
      panOnDrag={panMode ? true : [1, 2]} panOnScroll={false} selectionOnDrag={false}
      deleteKeyCode={null} multiSelectionKeyCode={null} selectionKeyCode={null} nodesFocusable={true}
      onNodesChange={changes => {
        for (const change of changes) {
          if (change.type === 'position' && change.position && !suppressDragRef.current) store.moveComponent(change.id, change.position.x, change.position.y)
          if (change.type === 'select' && change.selected) store.selectComponent(change.id)
        }
      }}
      onEdgesChange={changes => {
        for (const change of changes) {
          if (change.type === 'select' && change.selected) store.selectConnection(change.id)
        }
      }}
      onNodeDragStart={(_, node) => { draggingRef.current = true; suppressDragRef.current = false; store.selectComponent(node.id); store.beginHistoryTransaction() }}
      onNodeDragStop={() => {
        if (draggingRef.current) store.endHistoryTransaction()
        draggingRef.current = false; suppressDragRef.current = false
      }}
      onNodeClick={(_, node) => { if (!panMode) store.selectComponent(node.id) }}
      onEdgeClick={(_, edge) => { if (!panMode) { store.cancelWire(); store.selectConnection(edge.id) } }}
      onConnectStart={() => {
        connectingRef.current = true; suppressConnectRef.current = false
        setConnectionCancelled(false)
      }}
      onConnectEnd={() => {
        connectingRef.current = false; suppressConnectRef.current = false
        setConnectionCancelled(false)
      }}
      onConnect={({ source, sourceHandle, target, targetHandle }) => {
        if (suppressConnectRef.current || panMode || placement || !sourceHandle || !targetHandle) return
        store.startWire(source, sourceHandle)
        store.finishWire(target, targetHandle)
      }}
      isValidConnection={connection => {
        const from = `${connection.source}.${connection.sourceHandle}`
        const to = `${connection.target}.${connection.targetHandle}`
        return from !== to && !graph.connections.some(c => (c.from === from && c.to === to) || (c.from === to && c.to === from))
      }}
      onPaneClick={event => {
        if (placement) place(placement.type, event.clientX, event.clientY, placement.assetId)
        else { store.selectComponent(null); store.cancelWire() }
      }}
      onPaneContextMenu={event => { event.preventDefault(); store.cancelWire(); onPlaced() }}
      onMoveStart={() => { if (wireStart) store.cancelWire() }}
      proOptions={{ hideAttribution: true }}>
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#cdd6d4" />
      <Panel position="top-left" className="canvas-title">
        <span className="canvas-title-mark" />
        <span>未命名电路</span><span className="canvas-title-kind">{viewMode === 'real' ? '实物图' : '电路图'}</span>
      </Panel>
      {(placement || wireStart) && <Panel position="top-center" className="canvas-pending">
        <span>{placement ? `放置：${placement.assetId ? getPhysicalAsset(placement.type, placement.assetId)?.name : componentLibrary[placement.type].name}` : '连线中'}</span>
        <IconButton label="取消操作" onClick={() => { onPlaced(); store.cancelWire() }}><X size={15} /></IconButton>
      </Panel>}
      {(store.selectedComponentId || store.selectedConnectionId) && <Panel position="top-right" className="canvas-selection-tools">
        {store.selectedComponentId && <IconButton label="旋转元件" onClick={() => store.rotateComponent(store.selectedComponentId!)}><RotateCw size={17} /></IconButton>}
        <IconButton label="删除选中" danger onClick={() => {
          if (store.selectedComponentId) store.removeComponent(store.selectedComponentId)
          else if (store.selectedConnectionId) store.removeConnection(store.selectedConnectionId)
        }}><Trash2 size={17} /></IconButton>
      </Panel>}
      <Panel position="bottom-right" className="canvas-controls">
        <IconButton label="网格吸附" active={snap} onClick={() => setSnap(!snap)}><Grid2X2 size={16} /></IconButton>
        <span className="control-divider" />
        <IconButton label="缩小" disabled={!flow.viewportInitialized || zoom <= 0.3} onClick={() => void flow.zoomOut({ duration: 150 })}><Minus size={17} /></IconButton>
        <button className="zoom-value" title="重置缩放" disabled={!flow.viewportInitialized} onClick={() => void flow.zoomTo(1, { duration: 150 })}>{Math.round(zoom * 100)}%</button>
        <IconButton label="放大" disabled={!flow.viewportInitialized || zoom >= 3} onClick={() => void flow.zoomIn({ duration: 150 })}><Plus size={17} /></IconButton>
        <IconButton label="适应画布" disabled={!flow.viewportInitialized} onClick={fit}><Focus size={17} /></IconButton>
      </Panel>
    </ReactFlow>
    {startPoint && pointer && <svg className="wire-preview" aria-hidden="true">
      <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
        <WirePath mode={viewMode} preview path={getWirePath(viewMode, startPoint,
          pointer.terminal || { x: pointer.x, y: pointer.y, position: oppositePosition[startPoint.position] })} />
      </g>
    </svg>}
    {graph.components.length === 0 && !placement && <div className="canvas-empty"><span>空白电路</span></div>}
  </main>
}
