import { ConnectionSettingsButton } from './ConnectionSettings'
import { useRef, useState } from 'react'
import { CircuitBoard, MousePointer2, Cable, Hand, Undo2, Redo2, FolderOpen, Download, Trash2, FlaskConical, PanelLeft, SlidersHorizontal, Sparkles, LayoutGrid, FileOutput, Home } from 'lucide-react'
import { useCircuitStore } from '../store/circuitStore'
import { createDemoCircuit } from '../data/demoCircuit'
import { IconButton } from './IconButton'
import { layoutCircuitGraph } from '../lib/autoLayout'
import { SimulationControls } from './SimulationControls'
import { ExportDialog } from './ExportDialog'

export function TopToolbar({ onTogglePanel, onAI, onCancelPlacement, onHome }: { onHome: () => void; onTogglePanel: (panel: 'library' | 'properties') => void; onAI: () => void; onCancelPlacement: () => void }) {
  const store = useCircuitStore()
  const fileRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const [arranging, setArranging] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const arrange = async () => {
    const snapshot = useCircuitStore.getState().graph
    setArranging(true); setError(''); onCancelPlacement()
    try {
      const mode = useCircuitStore.getState().viewMode
      const arranged = await layoutCircuitGraph(snapshot, mode)
      if (useCircuitStore.getState().graph !== snapshot) { setError('电路已发生修改，请重新整理'); return }
      store.loadGraph(arranged)
      window.dispatchEvent(new Event('circuit:fit'))
    } finally { setArranging(false) }
  }
  const exportFile = () => {
    const url = URL.createObjectURL(new Blob([store.exportToJson()], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = `circuit-${new Date().toISOString().slice(0, 10)}.json`; anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <header className="app-toolbar">
    <div className="brand"><CircuitBoard size={25} strokeWidth={1.8} /><span>物理仿真AI实验室</span><span className="workspace-label">工作台</span></div>
    <div className="toolbar-tools">
      <IconButton label="打开元件库" className="mobile-only" onClick={() => onTogglePanel('library')}><PanelLeft size={18} /></IconButton>
      <div className="tool-group" aria-label="画布工具">
        <IconButton label="选择" active={store.toolMode === 'select'} onClick={() => { store.setToolMode('select'); onCancelPlacement() }}><MousePointer2 size={18} /></IconButton>
        <IconButton label="连线" active={store.toolMode === 'wire'} onClick={() => { store.setToolMode('wire'); onCancelPlacement() }}><Cable size={18} /></IconButton>
        <IconButton label="平移" active={store.toolMode === 'pan'} onClick={() => { store.setToolMode('pan'); onCancelPlacement() }}><Hand size={18} /></IconButton>
      </div>
      <span className="control-divider" />
      <IconButton label="撤销" disabled={!store.canUndo} onClick={store.undo}><Undo2 size={18} /></IconButton>
      <IconButton label="重做" disabled={!store.canRedo} onClick={store.redo}><Redo2 size={18} /></IconButton>
      <span className="control-divider" />
      <div className="segmented view-tabs" aria-label="视图">
        <button aria-pressed={store.viewMode === 'schematic'} onClick={() => { store.setViewMode('schematic'); onCancelPlacement(); window.dispatchEvent(new Event('circuit:fit')) }}>电路图</button>
        <button aria-pressed={store.viewMode === 'real'} onClick={() => { store.setViewMode('real'); onCancelPlacement(); window.dispatchEvent(new Event('circuit:fit')) }}>实物图</button>
      </div>
      <SimulationControls />
    </div>
    <div className="toolbar-actions">
      <ConnectionSettingsButton />
      <button className="text-button" onClick={onHome}><Home size={15} />工具首页</button>
      <IconButton label="自动整理" disabled={arranging || !store.graph.components.length} onClick={() => void arrange()}><LayoutGrid size={18} /></IconButton>
      <IconButton label="载入示例" onClick={() => { store.loadGraph(createDemoCircuit()); onCancelPlacement(); window.dispatchEvent(new Event('circuit:fit')) }}><FlaskConical size={18} /></IconButton>
      <IconButton label="导入 JSON" onClick={() => fileRef.current?.click()}><FolderOpen size={18} /></IconButton>
      <IconButton label="导出 JSON" onClick={exportFile}><Download size={18} /></IconButton>
      <IconButton label="更多导出格式" onClick={() => setExportOpen(true)}><FileOutput size={18} /></IconButton>
      <IconButton label="清空画布" danger disabled={!store.graph.components.length} onClick={() => { store.clearGraph(); onCancelPlacement() }}><Trash2 size={18} /></IconButton>
      <button className="text-button ai-button" aria-label="AI 导入" onClick={onAI}><Sparkles size={16} /><span>AI 导入</span></button>
      <IconButton label="打开属性面板" className="compact-only" onClick={() => onTogglePanel('properties')}><SlidersHorizontal size={18} /></IconButton>
    </div>
    <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={async event => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) return
      try {
        if (file.size > 2 * 1024 * 1024) throw new Error('文件不能超过 2 MB')
        if (!store.importFromJson(await file.text())) throw new Error('电路文件无效，请检查元件、坐标和连接端点。')
        setError(''); onCancelPlacement(); window.dispatchEvent(new Event('circuit:fit'))
      } catch (reason) { setError(reason instanceof Error ? reason.message : '文件读取失败') }
    }} />
    {error && <button className="toolbar-error" role="alert" onClick={() => setError('')}>{error}</button>}
    {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
  </header>
}
