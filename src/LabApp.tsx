import { useCallback, useContext, useEffect, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { ToolHome } from './components/ToolHome'
import { OpticsLab } from './components/OpticsLab'
import { TopToolbar } from './components/TopToolbar'
import { ComponentPalette } from './components/ComponentPalette'
import { CircuitCanvas } from './components/CircuitCanvas'
import { PropertyPanel } from './components/PropertyPanel'
import { StatusBar } from './components/StatusBar'
import { AIImportDialog } from './components/AIImportDialog'
import { AIConnectionContext } from './components/ConnectionSettings'
import { useCircuitStore } from './store/circuitStore'
import type { ComponentPlacement } from './data/physicalAssets'

const DRAFT_KEY = 'circuit-converter.draft.v1'
const VIEW_KEY = 'circuit-converter.view.v1'
type Workspace = 'home' | 'circuit' | 'optics'
const currentWorkspace = (): Workspace => location.hash === '#optics' ? 'optics' : location.hash === '#circuit' ? 'circuit' : 'home'

export default function LabApp() {
  const requireAI = useContext(AIConnectionContext)
  const [workspace, setWorkspace] = useState<Workspace>(currentWorkspace)
  const [placement, setPlacement] = useState<ComponentPlacement | null>(null)
  const [panel, setPanel] = useState<'library' | 'properties' | null>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const [saveStatus, setSaveStatus] = useState('本地草稿')
  const graphId = useCircuitStore(state => state.graph.id)
  const cancelPlacement = useCallback(() => setPlacement(null), [])
  const navigate = (target: Workspace) => { setWorkspace(target); location.hash = target }

  useEffect(() => { cancelPlacement() }, [graphId, cancelPlacement])
  useEffect(() => {
    const change = () => setWorkspace(currentWorkspace())
    window.addEventListener('hashchange', change)
    return () => window.removeEventListener('hashchange', change)
  }, [])
  useEffect(() => {
    try {
      const savedView = localStorage.getItem(VIEW_KEY)
      const draft = localStorage.getItem(DRAFT_KEY)
      if (draft) {
        if (useCircuitStore.getState().importFromJson(draft)) {
          useCircuitStore.getState().resetHistory()
          setSaveStatus('草稿已恢复')
          window.dispatchEvent(new Event('circuit:fit'))
        } else setSaveStatus('已有草稿无法恢复')
      }
      if (savedView === 'real' || savedView === 'schematic') useCircuitStore.getState().setViewMode(savedView)
    } catch { setSaveStatus('本地存储不可用') }
    let timer: ReturnType<typeof setTimeout> | undefined
    const save = () => {
      try { localStorage.setItem(DRAFT_KEY, useCircuitStore.getState().exportToJson()); setSaveStatus('已保存到本机') }
      catch { setSaveStatus('保存失败，请导出 JSON') }
    }
    const unsubscribe = useCircuitStore.subscribe((state, previous) => {
      if (state.viewMode !== previous.viewMode) {
        try { localStorage.setItem(VIEW_KEY, state.viewMode) } catch { /* Export remains available. */ }
      }
      if (state.graph === previous.graph) return
      setSaveStatus('保存中'); clearTimeout(timer); timer = setTimeout(save, 300)
    })
    const flush = () => { if (timer) { clearTimeout(timer); save() } }
    window.addEventListener('pagehide', flush)
    return () => { unsubscribe(); clearTimeout(timer); window.removeEventListener('pagehide', flush) }
  }, [])

  if (workspace === 'home') return <ToolHome onCircuit={() => navigate('circuit')} onOptics={() => navigate('optics')} />
  if (workspace === 'optics') return <OpticsLab onBack={() => navigate('home')} />
  return <ReactFlowProvider>
    <div className="app-shell">
      <TopToolbar onHome={() => navigate('home')} onTogglePanel={value => setPanel(panel === value ? null : value)} onAI={() => requireAI(() => setAiOpen(true))} onCancelPlacement={cancelPlacement} />
      <div className={`workspace ${panel ? `show-${panel}` : ''}`}>
        {panel && <button aria-label="关闭侧栏" className="panel-backdrop" onClick={() => setPanel(null)} />}
        <ComponentPalette onChoose={value => { setPlacement(value); useCircuitStore.getState().setToolMode('select'); setPanel(null) }} onClose={() => setPanel(null)} />
        <CircuitCanvas placement={placement} onPlaced={cancelPlacement} />
        <PropertyPanel onClose={() => setPanel(null)} />
      </div>
      <StatusBar saveStatus={saveStatus} />
      {aiOpen && <AIImportDialog onClose={() => setAiOpen(false)} />}
    </div>
  </ReactFlowProvider>
}
