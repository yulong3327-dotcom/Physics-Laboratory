import { ConnectionSettingsButton } from './ConnectionSettings'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeftRight, ArrowUpDown, Copy, Download, FlaskConical, FolderOpen, Hand, Home, MousePointer2, PanelLeft, Pause, Play, Plus, Redo2, RotateCw, Search, SlidersHorizontal, Trash2, Undo2, Waves, X } from 'lucide-react'
import { IconButton } from './IconButton'
import { OpticsCanvas } from '../optics/OpticsCanvas'
import { OpticalSymbol, opticalSymbolBounds } from '../optics/OpticalSymbol'
import { isCurvedMirror, isMirror } from '../optics/mirrorGeometry'
import { useOpticsStore } from '../optics/store'
import { createOpticalComponent, opticalLibrary, opticalOrder, categoryNames, opticsPresets, opticalOrientation, opticalOrientationAngle } from '../optics/library'
import { measureImages } from '../optics/simulation'
import type { OpticalComponent, OpticsKind, OpticsScene } from '../optics/types'
import '../styles/optics.css'

const thumbnails = Object.fromEntries(opticalOrder.map(kind => [kind, createOpticalComponent(kind, 0, 0)])) as Record<OpticsKind, OpticalComponent>
const saveLabels: Record<string, string> = { idle: '本地草稿', saved: '已保存到本机', loaded: '草稿已恢复', 'storage-unavailable': '本地保存不可用，请导出', 'invalid-draft': '已有草稿无法恢复' }
const displayOptions = [['showGrid', '显示网格'], ['snap', '网格吸附'], ['showAxis', '主光轴'], ['showFoci', '焦点与二倍焦距'], ['showVirtual', '虚像与反向延长线'], ['showLabels', '组件标签'], ['animate', '光线方向动画']] as const
const fit = () => requestAnimationFrame(() => window.dispatchEvent(new Event('optics:fit')))
function downloadJson(text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a'); a.href = url; a.download = `optics-${new Date().toISOString().slice(0, 10)}.json`; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function OpticsLab({ onBack }: { onBack: () => void }) {
  const store = useOpticsStore()
  const [placement, setPlacement] = useState<OpticsKind | null>(null)
  const [panel, setPanel] = useState<'library' | 'properties' | null>(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => { useOpticsStore.getState().hydrate(); return () => useOpticsStore.getState().endTransaction() }, [])
  const selected = store.scene.components.find(c => c.id === store.selectedId)
  const filtered = opticalOrder.filter(k => `${opticalLibrary[k].name} ${opticalLibrary[k].nameEn}`.toLowerCase().includes(query.trim().toLowerCase()))
  const togglePanel = (next: 'library' | 'properties') => setPanel(p => p === next ? null : next)
  const load = (scene: OpticsScene) => { if (store.load(scene)) { setPlacement(null); setError(''); fit() } }
  const choose = (kind: OpticsKind) => { setPlacement(kind); store.setTool('select'); setPanel(null); requestAnimationFrame(() => document.querySelector<SVGSVGElement>('[data-optics-svg]')?.focus()) }
  return <div className="app-shell optics-lab">
    <header className="app-toolbar optics-toolbar">
      <div className="brand"><Waves size={25} strokeWidth={1.8} /><span>物理仿真AI实验室</span></div>
      <nav className="segmented optics-workspace-tabs" aria-label="实验室"><button onClick={onBack}><Home size={14} />工具首页</button><button aria-pressed="true"><Waves size={14} />光学实验室</button></nav>
      <span className="optics-header-note">探索光的传播与成像</span>
      <ConnectionSettingsButton />
      <button className={`text-button optics-run ${store.running ? 'is-active' : ''}`} aria-pressed={store.running} onClick={() => store.setRunning(!store.running)}>{store.running ? <Pause size={14} /> : <Play size={14} />}{store.running ? '暂停仿真' : '运行仿真'}</button>
    </header>
    <div className="optics-actionbar" role="toolbar" aria-label="光学画布工具">
      <IconButton label="打开光学元件库" className="optics-library-toggle" active={panel === 'library'} onClick={() => togglePanel('library')}><PanelLeft size={17} /></IconButton>
      <div className="tool-group"><IconButton label="选择" active={store.tool === 'select'} onClick={() => { store.setTool('select'); setPlacement(null) }}><MousePointer2 size={17} /></IconButton><IconButton label="平移" active={store.tool === 'pan'} onClick={() => { store.setTool('pan'); setPlacement(null) }}><Hand size={17} /></IconButton></div>
      <span className="control-divider" /><IconButton label="撤销" disabled={!store.canUndo} onClick={store.undo}><Undo2 size={17} /></IconButton><IconButton label="重做" disabled={!store.canRedo} onClick={store.redo}><Redo2 size={17} /></IconButton>
      <span className="control-divider optics-hide-small" /><label className="optics-presets"><FlaskConical size={16} /><select aria-label="载入光学示例" value="" onChange={e => { const preset = opticsPresets.find(p => p.id === e.target.value); if (preset) load(preset.create()) }}><option value="" disabled>实验示例</option>{opticsPresets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <div className="optics-file-actions"><IconButton label="导入光学 JSON" onClick={() => fileRef.current?.click()}><FolderOpen size={17} /></IconButton><IconButton label="导出光学 JSON" onClick={() => downloadJson(store.exportJson())}><Download size={17} /></IconButton><IconButton label="新建空白光学实验" danger disabled={!store.scene.components.length} onClick={() => { store.clear(); setPlacement(null); fit() }}><Trash2 size={17} /></IconButton><IconButton label="打开光学属性面板" className="optics-properties-toggle" active={panel === 'properties'} onClick={() => togglePanel('properties')}><SlidersHorizontal size={17} /></IconButton></div>
      <input ref={fileRef} aria-label="导入光学工程文件" type="file" accept=".json,application/json" hidden onChange={async e => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; try { if (file.size > 2 * 1024 * 1024) throw new Error('光学工程不能超过 2 MB'); if (!store.importJson(await file.text())) throw new Error(useOpticsStore.getState().importError || '光学工程无效'); setPlacement(null); setError(''); fit() } catch (reason) { setError(reason instanceof Error ? reason.message : '文件读取失败') } }} />
    </div>
    {error && <div className="optics-error" role="alert"><span>{error}</span><IconButton label="关闭错误提示" onClick={() => setError('')}><X size={15} /></IconButton></div>}
    <div className={`optics-workspace ${panel ? `optics-show-${panel}` : ''}`}>
      {panel && <button aria-label="关闭光学侧栏" className="optics-panel-backdrop" onClick={() => setPanel(null)} />}
      <aside className="optics-palette" aria-label="光学元件库"><div className="section-heading"><span>光学元件库</span><span className="count-badge">{opticalOrder.length}</span><IconButton label="关闭光学元件库" className="optics-library-toggle" onClick={() => setPanel(null)}><X size={16} /></IconButton></div><div className="palette-search"><Search size={15} /><input aria-label="搜索光学组件" placeholder="搜索光源、透镜、光屏…" value={query} onChange={e => setQuery(e.target.value)} /></div><div className="palette-content">{(['sources', 'lenses', 'reflectors', 'tools'] as const).map(category => { const kinds = filtered.filter(k => opticalLibrary[k].category === category); return kinds.length > 0 && <section key={category} className="palette-group"><h2>{categoryNames[category]}</h2>{kinds.map(kind => <button className={`palette-item optics-palette-item ${placement === kind ? 'is-placing' : ''}`} key={kind} data-testid={`optics-palette-${kind}`} title={`${opticalLibrary[kind].description} · 拖入或点击后在画布放置`} draggable onDragStart={e => { e.dataTransfer.setData('opticsKind', kind); e.dataTransfer.effectAllowed = 'copy' }} onClick={() => choose(kind)}><svg viewBox="-27 -24 54 48" width="54" height="48" aria-hidden="true"><OpticalSymbol component={thumbnails[kind]} thumbnail /></svg><span>{opticalLibrary[kind].name}</span><Plus size={12} className="palette-add" /></button>)}</section> })}{!filtered.length && <p className="empty-search">无匹配组件</p>}</div><div className="palette-footer"><span className="status-dot" />几何光学组件库<span>{opticalOrder.length} 种</span></div></aside>
      <main className="optics-canvas-wrap"><div className="optics-canvas-head"><span><span className="canvas-title-mark" />{store.scene.title}</span><span>长度单位 cm</span></div><OpticsCanvas placement={placement} onPlaced={() => setPlacement(null)} /></main>
      <aside className="optics-properties" aria-label="光学属性面板"><div className="section-heading"><span>{selected ? '组件属性' : '实验概览'}</span><IconButton label="关闭光学属性面板" className="optics-properties-toggle" onClick={() => setPanel(null)}><X size={16} /></IconButton></div><div className="property-content">{selected ? <OpticsProperties key={selected.id} component={selected} /> : <><div className="property-title">光的传播与成像<span className="subtle-badge">Geometrical optics</span></div><p className="optics-description">拖动元件搭建光路，逐片调节透镜焦距与间距，观察多次成像。显微镜、望远镜示例由独立凸透镜组合而成。</p><div className="optics-component-list">{store.scene.components.map(c => <button key={c.id} onClick={() => store.select(c.id)}><span>{c.label || opticalLibrary[c.kind].name}</span><span>{opticalLibrary[c.kind].name}</span></button>)}</div>{!store.scene.components.length && <p className="empty-property">从元件库放置组件，或载入一个实验示例。</p>}</>}
        <ImageReadout />
        <details className="optics-settings" open={!selected}><summary>显示与辅助</summary><div>{displayOptions.map(([key, label]) => <label className="optics-setting-row" key={key}><span>{label}</span><input type="checkbox" checked={store.scene.settings[key]} onChange={e => store.updateSettings({ [key]: e.target.checked })} /></label>)}</div></details>
        <p className="optics-model-note">透镜采用理想薄透镜近轴模型；镜面按实际法线反射，球面镜成像箭头为近轴估计，大口径会出现球差。玻璃板、三棱镜按折射定律追迹。颜色表示波长，暂不模拟色散、衍射和干涉。</p>
      </div></aside>
    </div>
    <footer className="status-bar optics-status"><span className="mode-status"><span className={`status-dot ${!store.running ? 'is-paused' : ''}`} />{store.running ? '实时光线追迹' : '仿真已暂停'}</span><span data-testid="optics-component-count">{store.scene.components.length} 个组件</span><span className="optics-status-help">拖动移动 · 滚轮缩放 · R 旋转 · Delete 删除</span><span className="save-status">{saveLabels[store.saveStatus] || store.saveStatus}</span></footer>
  </div>
}

function NumberControl({ label, value, min, max, step = 1, unit = '', onChange, slider = false }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void; slider?: boolean }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(Number(value.toFixed(3)))), [value])
  const commit = () => { const v = Number(draft); if (!draft.trim() || !Number.isFinite(v)) { setDraft(String(value)); return } const clamped = Math.min(max, Math.max(min, v)); onChange(step >= 1 ? Math.round(clamped / step) * step : clamped); setDraft(String(clamped)) }
  const begin = () => useOpticsStore.getState().beginTransaction()
  const end = () => useOpticsStore.getState().endTransaction()
  return <div className="optics-number-control"><label><span>{label}</span><span className="optics-number-input"><input type="number" aria-label={label} min={min} max={max} step={step} value={draft} onChange={e => setDraft(e.target.value)} onFocus={begin} onBlur={() => { commit(); end() }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />{unit && <small>{unit}</small>}</span></label>{slider && <input type="range" aria-label={`${label}滑块`} min={min} max={max} step={step} value={value} onFocus={begin} onPointerDown={begin} onPointerUp={end} onBlur={end} onKeyUp={end} onChange={e => onChange(Number(e.target.value))} />}</div>
}

function OpticsProperties({ component: c }: { component: OpticalComponent }) {
  const store = useOpticsStore()
  const update = (patch: Partial<OpticalComponent>) => store.update(c.id, patch)
  const orientation = opticalOrientation(c)
  const setOrientation = (next: 'horizontal' | 'vertical') => update({ angle: opticalOrientationAngle(c, next) })
  const lens = c.kind === 'convex-lens' || c.kind === 'concave-lens'
  const mirror = isMirror(c), curvedMirror = isCurvedMirror(c)
  const bounds = opticalSymbolBounds(c)
  const source = c.kind === 'parallel-source' || c.kind === 'point-source' || c.kind === 'laser' || c.kind === 'object'
  return <>
    <div className="property-title optics-property-title"><svg viewBox={`${bounds.x - 3} ${bounds.y - 3} ${bounds.width + 6} ${bounds.height + 6}`} width="54" height="48" aria-hidden="true"><OpticalSymbol component={c} thumbnail /></svg><span>{opticalLibrary[c.kind].name}<small>{opticalLibrary[c.kind].nameEn}</small></span></div>
    <label className="field-label" htmlFor="optics-label">标签</label><input id="optics-label" className="field-input" maxLength={40} value={c.label} onFocus={store.beginTransaction} onBlur={store.endTransaction} onChange={e => update({ label: e.target.value })} />
    <label className="optics-setting-row optics-enable"><span>启用组件</span><input type="checkbox" checked={c.enabled} onChange={e => update({ enabled: e.target.checked })} /></label>
    {lens && <><div className="optics-field-heading">透镜参数</div><NumberControl label="焦距" value={Math.abs(c.focalLength)} min={0.5} max={500} step={0.5} unit="cm" slider onChange={v => update({ focalLength: c.kind === 'concave-lens' ? -v : v })} /><p className="optics-field-note">{c.kind === 'convex-lens' ? '凸透镜 f > 0，使平行光会聚。' : '凹透镜 f < 0，使平行光发散。'} f = {c.focalLength.toFixed(1)} cm</p></>}
    {curvedMirror && <><div className="optics-field-heading">球面镜参数</div><NumberControl label="近轴焦距" value={Math.abs(c.focalLength)} min={Math.max(.5, c.height / 4)} max={500} step={0.5} unit="cm" slider onChange={v => update({ focalLength: c.kind === 'convex-mirror' ? -v : v })} /><p className="optics-field-note">{c.kind === 'concave-mirror' ? '凹面镜 f > 0，焦点在镜前。' : '凸面镜 f < 0，虚焦点在镜后。'} f = {c.focalLength.toFixed(1)} cm，曲率半径 R = {(2 * Math.abs(c.focalLength)).toFixed(1)} cm。镜面口径不能超过球面直径 4|f|。</p></>}
    {mirror && <p className="optics-field-note">无斜线侧反射，斜线侧为不透明背面。旋转 180° 可翻转反射面。</p>}
    {c.kind !== 'point-source' && c.kind !== 'laser' && <NumberControl label={c.kind === 'object' ? '物高' : c.kind === 'parallel-source' ? '光束宽度' : lens ? '透镜口径' : curvedMirror ? '镜面口径' : '组件高度'} value={c.height} min={0.2} max={curvedMirror ? Math.min(200, 4 * Math.abs(c.focalLength)) : 200} step={0.5} unit="cm" slider onChange={v => update({ height: v, ...(c.kind === 'aperture' ? { opening: Math.min(c.opening, v) } : {}) })} />}
    {c.kind === 'aperture' && <NumberControl label="通光孔径" value={c.opening} min={0} max={c.height} step={0.5} unit="cm" slider onChange={v => update({ opening: v })} />}
    {(c.kind === 'prism' || c.kind === 'glass-slab') && <><NumberControl label="折射率" value={c.refractiveIndex} min={1} max={3} step={0.01} slider onChange={v => update({ refractiveIndex: v })} /><NumberControl label="组件宽度" value={c.width} min={0.2} max={200} step={0.5} unit="cm" onChange={v => update({ width: v })} /></>}
    {source && <><div className="optics-field-heading">光源参数</div><NumberControl label="波长" value={c.wavelength} min={380} max={780} step={1} unit="nm" slider onChange={v => update({ wavelength: v })} />{c.kind !== 'object' && c.kind !== 'laser' && <NumberControl label="光线数量" value={c.rayCount} min={1} max={41} step={1} slider onChange={v => update({ rayCount: v })} />}{c.kind === 'point-source' && <NumberControl label="发散角" value={c.spread} min={0} max={160} step={1} unit="°" slider onChange={v => update({ spread: v })} />}{c.kind === 'laser' && <p className="optics-field-note">从笔尖发射一条光线；调节旋转角改变方向，调节波长改变光束颜色。</p>}{c.kind === 'object' && <p className="optics-field-note">同轴透镜前显示三条成像光线；超出透镜口径的光线直接通过。</p>}</>}
    <div className="optics-field-heading">位置与方向</div><div className="optics-coordinate-inputs"><NumberControl label="X 坐标" value={c.x} min={-1000} max={1000} step={0.5} unit="cm" onChange={v => update({ x: v })} /><NumberControl label="Y 坐标" value={c.y} min={-1000} max={1000} step={0.5} unit="cm" onChange={v => update({ y: v })} /></div><div className="segmented optics-orientation-control" aria-label="光轴方向"><button data-testid="optics-orientation-horizontal" aria-pressed={orientation === 'horizontal'} title="光轴水平" onClick={() => setOrientation('horizontal')}><ArrowLeftRight size={14} />水平</button><button data-testid="optics-orientation-vertical" aria-pressed={orientation === 'vertical'} title="光轴垂直" onClick={() => setOrientation('vertical')}><ArrowUpDown size={14} />垂直</button></div><NumberControl label="旋转角" value={c.angle} min={-180} max={180} step={1} unit="°" slider onChange={v => update({ angle: v })} />
    <div className="optics-component-actions"><button className="text-button" onClick={() => update({ angle: c.angle + 15 })}><RotateCw size={14} />旋转 15°</button>{mirror && <button className="text-button" onClick={() => update({ angle: c.angle + 180 })}><ArrowLeftRight size={14} />翻转反射面</button>}<button className="text-button" onClick={() => store.duplicate(c.id)}><Copy size={14} />复制</button><IconButton label="删除光学组件" danger onClick={() => store.remove(c.id)}><Trash2 size={16} /></IconButton></div>
  </>
}

function ImageReadout() {
  const scene = useOpticsStore(s => s.scene)
  const running = useOpticsStore(s => s.running)
  const images = useMemo(() => measureImages(scene), [scene])
  const format = (v: number | null) => v == null ? '∞' : Number.isFinite(v) ? Number(v.toFixed(2)).toString() : '∞'
  return <section className="optics-measurements"><div className="optics-field-heading">成像分析<span>透镜 / 单镜面</span></div>{!images.length ? <p className="optics-field-note">放置物体与透镜或单个镜面，查看物距、像距和放大率。多透镜须同轴；球面镜读数为近轴估计。镜面与透镜混合系统只显示实际光路。</p> : images.map(m => <div key={`${m.lensId}-${m.objectId}`} className="optics-measurement-card" data-testid="optics-image-measurement"><div className="optics-image-nature"><span className="status-dot" /><b>{m.caption || (m.nature === 'infinity' ? '不成有限远像' : `${m.magnification! < 0 ? '倒立' : '正立'}${Math.abs(m.magnification!) > 1.005 ? '放大' : Math.abs(m.magnification!) < 0.995 ? '缩小' : '等大'}${m.nature === 'real' ? '实像' : '虚像'}`)}</b></div><dl><div><dt>物距 u</dt><dd>{format(m.objectDistance)} <small>cm</small></dd></div><div><dt>像距 v</dt><dd>{format(m.imageDistance)} <small>cm</small></dd></div><div><dt>{(m.lensIds?.length || 1) > 1 ? '累计放大率 m' : '放大率 m'}</dt><dd>{format(m.magnification)}</dd></div></dl><div className="optics-formula">{scene.components.find(c => c.id === m.lensId)?.kind === 'plane-mirror' ? 'v = −u' : '1/f = 1/u + 1/v'}<span>{(m.lensIds?.length || 1) > 1 ? 'm = m₁ × m₂ × …' : 'm = −v/u'}</span></div>{m.approximate && <p className="optics-field-note">箭头位置按近轴公式估计；实际反射光线按球面法线计算，大口径或离轴时不一定交于一点。虚线沿实际反射光反向延长。</p>}</div>)}{!running && <p className="optics-field-note">光线已暂停，参数分析仍实时更新。</p>}</section>
}
