import { useMemo } from 'react'
import { RotateCw, RotateCcw, Trash2, X, Cable, Box, CircleDot } from 'lucide-react'
import { useCircuitStore } from '../store/circuitStore'
import { componentLibrary } from '../data/componentLibrary'
import { getPhysicalAsset, getVisualOrientation, physicalAssetList } from '../data/physicalAssets'
import { ComponentExperiment } from './SimulationControls'
import { simulateCircuit } from '../lib/circuitSimulation'
import { getPhysicalImageSource, renderPhysicalOverlay } from '../lib/simulationVisual'
import { getPresentedVisual } from '../lib/componentPresentation'
import { getComponentPosition } from '../lib/viewGeometry'
import { IconButton } from './IconButton'

export function PropertyPanel({ onClose }: { onClose: () => void }) {
  const store = useCircuitStore()
  const { graph } = store
  const simulation = useMemo(() => store.simulationEnabled ? simulateCircuit(graph) : null, [graph, store.simulationEnabled])
  const warnings = simulation ? simulation.warnings : graph.warnings
  const comp = graph.components.find(c => c.id === store.selectedComponentId)
  const physicalAsset = comp && getPhysicalAsset(comp.type, comp.assetId)
  const orientation = comp && getVisualOrientation(comp, store.viewMode)
  const position = comp && getComponentPosition(comp, store.viewMode)
  const availableAssets = comp ? physicalAssetList.filter(asset => asset.type === comp.type) : []
  const displayedTerminals = comp ? getPresentedVisual(comp, store.viewMode, graph.connections).terminals : []
  const connection = graph.connections.find(c => c.id === store.selectedConnectionId)
  const endpoints = new Set(graph.connections.flatMap(c => [c.from, c.to]))
  const unconnected = graph.components.reduce((count, c) => count + componentLibrary[c.type].terminals.filter(t => !endpoints.has(`${c.id}.${t.id}`)).length, 0)
  const endpointName = (value: string) => {
    const [id, termId] = value.split('.')
    const component = graph.components.find(c => c.id === id)
    if (!component) return value
    const asset = store.viewMode === 'real' && getPhysicalAsset(component.type, component.assetId)
    const terminals = asset ? asset.terminals : componentLibrary[component.type].terminals
    return `${component.label || componentLibrary[component.type].name} / ${terminals.find(t => t.id === termId)?.label || termId}`
  }
  return <aside className="property-panel" aria-label="属性面板">
    <div className="section-heading"><span>{comp ? '元件属性' : connection ? '连线属性' : '电路概览'}</span><IconButton label="关闭属性面板" className="compact-only" onClick={onClose}><X size={16} /></IconButton></div>
    <div className="property-content">
      {comp ? <>
        <div className="property-title"><span>{componentLibrary[comp.type].name}</span><span className="subtle-badge">{componentLibrary[comp.type].nameEn}</span></div>
        {physicalAsset && <div className="asset-inspector-preview"><svg role="img" aria-label={physicalAsset.name} viewBox={`0 ${physicalAsset.switchVisual?.boundsTop || 0} ${physicalAsset.sourceWidth} ${physicalAsset.sourceHeight - (physicalAsset.switchVisual?.boundsTop || 0)}`}>
          <image href={getPhysicalImageSource(comp, physicalAsset, simulation?.components[comp.id])} width={physicalAsset.sourceWidth} height={physicalAsset.sourceHeight} />
          <g dangerouslySetInnerHTML={{ __html: renderPhysicalOverlay(comp, physicalAsset, simulation?.components[comp.id]) }} />
        </svg></div>}
        {!!availableAssets.length && <>
          <label className="field-label" htmlFor="component-asset">实物外观</label>
          <select id="component-asset" className="field-input" value={physicalAsset?.id || ''} onChange={event => store.setComponentAsset(comp.id, event.target.value)}>
            {availableAssets.map(asset => <option key={asset.id} value={asset.id}>{asset.name}{comp.parameters?.switchClosed !== undefined && asset.type === 'switch' ? ' · 底图' : ''}</option>)}
          </select>
          {physicalAsset?.connectionNote && <p className="asset-connection-note">{physicalAsset.connectionNote}</p>}
        </>}
        {!physicalAsset && store.viewMode === 'real' && <p className="asset-connection-note">暂无实物素材</p>}
        <label className="field-label" htmlFor="component-label">标签</label>
        <input id="component-label" className="field-input" maxLength={40} value={comp.label || ''}
          onFocus={() => store.beginHistoryTransaction()} onBlur={() => store.endHistoryTransaction()}
          onChange={event => store.updateComponentLabel(comp.id, event.target.value)} />
        <ComponentExperiment component={comp} />
        <div className="field-label">{store.viewMode === 'real' ? '实物方向' : '符号方向'}</div>
        <div className="segmented orientation-control">
          <button aria-pressed={orientation === 'horizontal'} onClick={() => orientation !== 'horizontal' && store.rotateComponent(comp.id)}>水平</button>
          <button aria-pressed={orientation === 'vertical'} onClick={() => orientation !== 'vertical' && store.rotateComponent(comp.id)}>垂直</button>
          <IconButton label="旋转" onClick={() => store.rotateComponent(comp.id)}><RotateCw size={15} /></IconButton>
        </div>
        <div className="field-label">坐标</div>
        <div className="coordinates"><span>X <b data-testid="position-x">{Math.round(position!.x)}</b></span><span>Y <b data-testid="position-y">{Math.round(position!.y)}</b></span></div>
        <div className="field-label">接线柱</div>
        <div className="terminal-list">{displayedTerminals.map(term => <div key={term.id}><CircleDot size={13} /><span>{term.label || term.id}</span><span className={endpoints.has(`${comp.id}.${term.id}`) ? 'connected-text' : ''}>{endpoints.has(`${comp.id}.${term.id}`) ? '已连接' : '未连接'}</span></div>)}</div>
        <button className="text-button danger-button" onClick={() => store.removeComponent(comp.id)}><Trash2 size={15} />删除元件</button>
      </> : connection ? <>
        <div className="property-title"><Cable size={18} /><span>导线</span></div>
        <div className="field-label">起点</div><p className="endpoint-name">{endpointName(connection.from)}</p>
        <div className="field-label">终点</div><p className="endpoint-name">{endpointName(connection.to)}</p>
        <button className="text-button" disabled={!connection.routes?.[store.viewMode]} onClick={() => store.updateConnectionRoute(connection.id, store.viewMode, null)}><RotateCcw size={15} />恢复自动走线</button>
        <button className="text-button danger-button" onClick={() => store.removeConnection(connection.id)}><Trash2 size={15} />删除连线</button>
      </> : <>
        <div className="overview-stats"><div><Box size={17} /><strong>{graph.components.length}</strong><span>元件</span></div><div><Cable size={17} /><strong>{graph.connections.length}</strong><span>连线</span></div></div>
        <dl className="overview-details"><div><dt>视图</dt><dd>{store.viewMode === 'real' ? '实物连接图' : '标准电路图'}</dd></div><div><dt>未连接接线柱</dt><dd>{unconnected}</dd></div><div><dt>来源</dt><dd>{graph.meta.inputType === 'manual' ? '手动搭建' : '导入'}</dd></div></dl>
        <div className="field-label">元件清单</div>
        {graph.components.length ? <div className="component-list">{graph.components.map(c => <button key={c.id} onClick={() => store.selectComponent(c.id)}><span>{componentLibrary[c.type].name}</span><span>{c.label || '-'}</span></button>)}</div> : <p className="empty-property">暂无元件</p>}
      </>}
    </div>
    {!!warnings.length && <section className="validation-section"><h2>{simulation ? '实验诊断' : '基础检查'} <span>{warnings.length}</span></h2>{warnings.slice(0, 10).map((warning, i) => <p key={i} className={`validation-message ${warning.severity}`}>{warning.message}</p>)}</section>}
  </aside>
}
