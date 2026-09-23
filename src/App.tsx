import { useCallback, useEffect, useRef, useState } from 'react'
import { VideoWorkbench } from './components/VideoWorkbench'
import { ToolHome } from './components/ToolHome'
import type { VideoProject } from '../server/videoTypes'
import { parseCircuitGraph } from './lib/graphSchema'
import { prepareCircuitGeometry } from './lib/videoGeometry'
import { reconcileVideoProjectEdit } from './lib/videoEditDependencies'
import './styles/video.css'
import { OpticsLab } from './components/OpticsLab'
import { EchoLab } from './echo/EchoLab'
import { ReactFlowProvider } from '@xyflow/react'
import { TopToolbar } from './components/TopToolbar'
import { ComponentPalette } from './components/ComponentPalette'
import { CircuitCanvas } from './components/CircuitCanvas'
import { PropertyPanel } from './components/PropertyPanel'
import { StatusBar } from './components/StatusBar'
import { AIImportDialog } from './components/AIImportDialog'
import { useCircuitStore } from './store/circuitStore'
import type { ComponentPlacement } from './data/physicalAssets'

const DRAFT_KEY = 'circuit-converter.draft.v1'
const VIEW_KEY = 'circuit-converter.view.v1'
type Workspace = 'home' | 'circuit' | 'video' | 'optics' | 'echo'
const currentWorkspace = (): Workspace => (location.hash === '#video' || location.hash.startsWith('#video/')) ? 'video' : location.hash === '#optics' ? 'optics' : location.hash === '#echo' ? 'echo' : location.hash === '#circuit' ? 'circuit' : 'home'

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace>(currentWorkspace)
  const previousMode = useRef<'schematic' | 'real'>('schematic')
  const [videoDraft, setVideoDraft] = useState<VideoProject>()
  const [applyingAsset, setApplyingAsset] = useState(false)
  const applyingAssetRef = useRef(false)
  const [assetError, setAssetError] = useState('')
  const [editingAsset, setEditingAsset] = useState<{ project: VideoProject; assetId: string }>()
  const [previousGraph, setPreviousGraph] = useState<ReturnType<typeof useCircuitStore.getState>['graph']>()
  const openCircuit = () => { if (applyingAssetRef.current) return; setWorkspace('circuit'); location.hash = 'circuit' }
  const openVideo = () => { if (applyingAssetRef.current) return; setWorkspace('video'); location.hash = 'video' }
  const openOptics = () => { if (applyingAssetRef.current) return; setWorkspace('optics'); location.hash = 'optics' }
  const openEcho = () => { if (applyingAssetRef.current) return; setWorkspace('echo'); location.hash = 'echo' }
  const returnToHome = () => { setVideoDraft(undefined); setWorkspace('home'); location.hash = 'home' }
  const [placement, setPlacement] = useState<ComponentPlacement | null>(null)
  const [panel, setPanel] = useState<'library' | 'properties' | null>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const [saveStatus, setSaveStatus] = useState('本地草稿')
  const graphId = useCircuitStore(state => state.graph.id)
  const cancelPlacement = useCallback(() => setPlacement(null), [])

  useEffect(() => { cancelPlacement() }, [graphId, cancelPlacement])

  useEffect(() => {
    const navigate = () => {
      if (applyingAssetRef.current) return
      setWorkspace(currentWorkspace())
    }
    window.addEventListener('hashchange', navigate)
    return () => window.removeEventListener('hashchange', navigate)
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
        try { localStorage.setItem(VIEW_KEY, state.viewMode) } catch { /* Graph export remains available without local storage. */ }
      }
      if (state.graph === previous.graph) return
      setSaveStatus('保存中'); clearTimeout(timer); timer = setTimeout(save, 300)
    })
    const flush = () => { if (timer) { clearTimeout(timer); save() } }
    window.addEventListener('pagehide', flush)
    return () => { unsubscribe(); clearTimeout(timer); window.removeEventListener('pagehide', flush) }
  }, [])

  const restoreLaboratory = () => {
    if (previousGraph) { useCircuitStore.getState().loadGraph(previousGraph); useCircuitStore.getState().setViewMode(previousMode.current) }
    setPreviousGraph(undefined)
  }
  const applyEditedAsset = async () => {
    if (!editingAsset || applyingAssetRef.current) return
    applyingAssetRef.current = true; setApplyingAsset(true); setAssetError('')
    const sourceGraph = useCircuitStore.getState().graph
    const viewMode = useCircuitStore.getState().viewMode
    try {
      const project = structuredClone(editingAsset.project)
      const asset = project.circuits.find(c => c.id === editingAsset.assetId)
      if (!asset) throw new Error('原视频素材不存在，请取消修改后重新打开素材。')
      const graph = structuredClone(sourceGraph)
      // A dragged object may be stored at its schematic coordinate without an
      // explicit realPosition. Commit every displayed position before preparing.
      if (viewMode === 'real') graph.components = graph.components.map(c => ({ ...c, realPosition: { ...(c.realPosition ?? c.position) } }))
      const prepared = await prepareCircuitGeometry(graph, { viewMode, currentFlow: asset.currentFlow ?? viewMode === 'real', mode: asset.mode,
        physicsModel: 'ideal_textbook', signal: AbortSignal.timeout(30_000) })
      if (useCircuitStore.getState().graph !== sourceGraph || useCircuitStore.getState().viewMode !== viewMode) {
        throw new Error('准备期间电路又有修改，请重新点击应用以保存最新位置。')
      }
      asset.layoutPrepared = true; asset.viewMode = viewMode; asset.graph = prepared.graph; asset.geometry = prepared.geometry; asset.revision++
      if (asset.mode === 'symbolic') asset.currentFlow = false
      project.approvedRevision = undefined; project.updatedAt = new Date().toISOString()
      setVideoDraft(reconcileVideoProjectEdit(editingAsset.project, project)); setEditingAsset(undefined); restoreLaboratory()
      setWorkspace('video'); location.hash = 'video'
    } catch (reason) {
      const detail = reason instanceof Error ? reason.name === 'TimeoutError' ? '素材准备超时' : reason.message : '素材准备失败'
      setAssetError(detail + '；当前编辑已保留，可以重试或取消素材修改。')
    } finally { applyingAssetRef.current = false; setApplyingAsset(false) }
  }

  if (workspace === 'home') return <ToolHome onCircuit={openCircuit} onOptics={openOptics} onEcho={openEcho} onVideo={openVideo} />
  if (workspace === 'video') return <VideoWorkbench onBack={returnToHome} initialProject={videoDraft} onEditCircuit={(assetId, rawGraph, project) => {
    const graph = parseCircuitGraph(rawGraph)
    if (!graph) return
    previousMode.current = useCircuitStore.getState().viewMode
    setPreviousGraph(structuredClone(useCircuitStore.getState().graph))
    setAssetError(''); setEditingAsset({ project: structuredClone(project), assetId })
    useCircuitStore.getState().loadGraph(graph); useCircuitStore.getState().setViewMode(project.circuits.find(c => c.id === assetId)?.viewMode || 'schematic'); openCircuit()
    setTimeout(() => window.dispatchEvent(new Event('circuit:fit')), 0)
  }} />
  if (workspace === 'optics') return <OpticsLab onBack={returnToHome} />
  if (workspace === 'echo') return <EchoLab onBack={returnToHome} />

  return <ReactFlowProvider>
    <div className="app-shell">
      {editingAsset && <div className="video-return-banner" aria-busy={applyingAsset}>
        <span>正在编辑视频素材 · {editingAsset.project.title}</span>
        <button disabled={applyingAsset} onClick={() => void applyEditedAsset()}>{applyingAsset ? '正在准备素材…' : '应用素材并返回分镜'}</button>
        <button disabled={applyingAsset} onClick={() => {
          setVideoDraft(editingAsset.project); setEditingAsset(undefined); setAssetError(''); restoreLaboratory(); openVideo()
        }}>取消素材修改</button>
        {assetError && <span role="alert">{assetError}</span>}
      </div>}
      <TopToolbar onHome={returnToHome} onTogglePanel={value => setPanel(panel === value ? null : value)} onAI={() => setAiOpen(true)} onCancelPlacement={cancelPlacement} />
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
