import { useMemo, useRef, useState } from 'react'
import { Eye, MoveHorizontal, Plus } from 'lucide-react'
import type { LessonState } from './lesson'
import { optics } from './model'

export function Flame({ x = 0, y = 0, scale = 1, ghost = false }: { x?: number; y?: number; scale?: number; ghost?: boolean }) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`} opacity={ghost ? .65 : 1}>
    <path d="M0 -14 C-4 -4 -10 0 -7 8 C-4 17 6 16 8 7 C10 -2 2 -5 0 -14Z" fill="#f4aa48" stroke={ghost ? '#77a8a8' : '#db7742'} strokeWidth="1" strokeDasharray={ghost ? '3 2' : undefined}/>
    <path d="M0 0 C-6 7 -3 14 1 13 C6 12 5 5 0 0Z" fill="#fff0b6"/>
  </g>
}

type Props = {
  state: LessonState; onPlace: () => void; onObject: (n: number) => void;
  onScreen: (n: number) => void; onHeight: (n: number) => void;
  replay?: number; onMisplace?: () => void;
}

export function Bench({ state: s, onPlace, onObject, onScreen, onHeight, onMisplace, replay = 0 }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragging = useRef<'object' | 'screen' | 'height' | null>(null)
  const [placing, setPlacing] = useState(false)
  const [dragPoint, setDragPoint] = useState<{ x: number; y: number } | null>(null)
  const placeStart = useRef<{ x: number; y: number } | null>(null)
  const dragWasMove = useRef(false)
  const parallel = s.step === 2
  const active = s.step >= 2
  const trial = s.step >= 3 && s.step <= 7
  const objectX = 460 - s.u * 10
  const screenX = 460 + s.screen * 10
  const objectY = 250 + (s.step === 1 ? s.height * 10 : 0)
  const physics = useMemo(() => optics(s.u, s.screen, parallel, s.throughLens), [s.u, s.screen, parallel, s.throughLens])
  const canObject = trial && !s.objectLocked && s.phase === 'adjust'
  const canScreen = s.phase === 'adjust' && (parallel || trial && s.objectLocked) && !s.throughLens
  const canHeight = s.step === 1 && s.phase === 'adjust'
  const canMove = canObject || canScreen || canHeight
  const phantom = s.throughLens && physics.v < 0 && Number.isFinite(physics.v)
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(value * 2) / 2))

  function move(event: React.PointerEvent<SVGSVGElement>) {
    const matrix = svgRef.current?.getScreenCTM()
    if (!dragging.current || !matrix || !svgRef.current) return
    const point = svgRef.current.createSVGPoint()
    point.x = event.clientX; point.y = event.clientY
    const local = point.matrixTransform(matrix.inverse())
    if (dragging.current === 'object') onObject(clamp((460 - local.x) / 10, 5, 35))
    if (dragging.current === 'screen') onScreen(clamp((local.x - 460) / 10, 5, 38))
    if (dragging.current === 'height') onHeight(clamp((local.y - 250) / 10, -3, 3))
  }
  function grab(kind: typeof dragging.current, event: React.PointerEvent<SVGGElement>) {
    dragging.current = kind
    svgRef.current?.setPointerCapture(event.pointerId)
    event.preventDefault()
  }
  function dropEquipment(event: React.PointerEvent<HTMLButtonElement>) {
    if (!placeStart.current) return
    const moved = Math.hypot(event.clientX - placeStart.current.x, event.clientY - placeStart.current.y) > 12
    dragWasMove.current = moved
    if (moved) {
      const target = document.querySelector('.place-target')?.getBoundingClientRect()
      if (target && event.clientX >= target.left - 24 && event.clientX <= target.right + 24 && event.clientY >= target.top - 24 && event.clientY <= target.bottom + 24) onPlace()
      else onMisplace?.()
    }
    placeStart.current = null; setPlacing(false); setDragPoint(null)
  }

  return <section className="visual-area" aria-label="凸透镜成像实验台">
    <div className="visual-toolbar"><span className="visual-title"><span className="live-dot"/>光具座 · 实时实验</span><span className="scale-label">{s.step >= 3 ? 'f = 10 cm' : '测量与准备'}</span></div>
    <div className="diagram-wrap"><svg ref={svgRef} viewBox="0 0 920 480" role="img" aria-label="蜡烛、凸透镜和光屏实时仿真" onPointerMove={move} onPointerUp={() => { dragging.current = null }} onPointerCancel={() => { dragging.current = null }} style={{ touchAction: canMove ? 'none' : 'auto' }}>
      <defs>
        <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#e6eceb" strokeWidth=".7"/></pattern>
        <linearGradient id="glass"><stop stopColor="#abdae2"/><stop offset=".5" stopColor="#f0fcfb"/><stop offset="1" stopColor="#9dcfdb"/></linearGradient>
        <marker id="ray-arrow" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto"><path d="M0 0L6 3L0 6Z" fill="#d47d3a"/></marker>
        <filter id="main-blur"><feGaussianBlur stdDeviation={physics.blur / 3}/></filter>
      </defs>
      <rect width="920" height="480" fill="#f9fbfa"/><rect width="920" height="480" fill="url(#grid)"/>
      <line x1="48" y1="250" x2="880" y2="250" stroke="#8ea7a8" strokeWidth="1.2" strokeDasharray="8 6"/>
      <text x="810" y="232" className="axis-label">主光轴</text>
      <rect x="50" y="389" width="820" height="13" rx="3" fill="#c9d6d7"/>
      {Array.from({ length: 81 }, (_, i) => <g key={i}><line x1={60 + i * 10} x2={60 + i * 10} y1="390" y2={i % 5 ? 395 : 402} stroke="#7a969b"/>{i % 10 === 0 && <text x={60 + i * 10} y="423" textAnchor="middle" className="ruler-text">{i}</text>}</g>)}<text x="883" y="423" className="ruler-text">cm</text>
      {s.equipment >= 2 ? <g><path d="M460 125 C487 184 487 316 460 375 C433 316 433 184 460 125Z" fill="url(#glass)" stroke="#358b9c" strokeWidth="2.5"/><path d="M460 140C475 196 475 304 460 357" fill="none" stroke="white" strokeWidth="2"/><rect x="456" y="375" width="8" height="15" fill="#8da6a9"/><circle cx="460" cy="250" r="3" fill="#26798a"/><text x="477" y="243" className="diagram-label">O</text><text x="460" y="102" textAnchor="middle" className="diagram-label">凸透镜</text></g> : <path d="M460 125C487 184 487 316 460 375C433 316 433 184 460 125Z" fill="none" stroke="#8eb8c0" strokeWidth="2" strokeDasharray="7 5"/>}
      {s.step >= 3 && [260,360,560,660].map((x,i) => <g key={x}><circle cx={x} cy="250" r="3.5" fill="#d5964c"/><text x={x} y="276" textAnchor="middle" className="focus-label">{['2F₁','F₁','F₂','2F₂'][i]}</text></g>)}
      {active && <g key={replay} className="ray-group" data-testid="ray-paths">{physics.segments.map((seg, i) => <g key={i}><line x1={seg.from.x * 10} y1={seg.from.y * 10} x2={seg.to.x * 10} y2={seg.to.y * 10} stroke={seg.virtual ? '#aa8c65' : ['#e97055','#278da0','#c79a42'][Math.floor(i / 2) % 3]} strokeWidth={seg.virtual ? 1.5 : 2} strokeDasharray={seg.virtual ? '6 5' : undefined}/>{!seg.virtual && <circle r="2.5" fill="#f7ba5e"><animateMotion dur="2.8s" repeatCount="indefinite" path={`M${seg.from.x * 10} ${seg.from.y * 10}L${seg.to.x * 10} ${seg.to.y * 10}`}/></circle>}</g>)}</g>}
      {s.equipment >= 1 && !parallel && <g className={canObject || canHeight ? 'draggable-apparatus' : ''} onPointerDown={e => { if (canObject) grab('object', e); if (canHeight) grab('height', e) }} data-testid="candle">
        <rect x={objectX - 27} y={objectY - 25} width="54" height="165" fill="transparent"/>
        <rect x={objectX - 8} y={objectY + 21} width="16" height="64" rx="2" fill="#f1eee8" stroke="#b39b82" strokeWidth="1.5"/><line x1={objectX} y1={objectY + 13} x2={objectX} y2={objectY + 24} stroke="#395359" strokeWidth="2"/>
        <Flame x={objectX} y={objectY}/><rect x={objectX - 3} y={objectY + 85} width="6" height={389 - objectY - 85} fill="#879fa3"/><rect x={objectX - 20} y="381" width="40" height="8" rx="2" fill="#69868d"/>
        <text x={objectX} y={objectY - 39} textAnchor="middle" className="diagram-label">蜡烛</text>
        {(canObject || canHeight) && <rect x={objectX - 28} y={objectY - 26} width="56" height="129" rx="7" fill="none" stroke="#d69a57" strokeDasharray="4 4"/>}
        {s.step === 1 && <circle cx={objectX} cy={objectY} r="18" fill="none" stroke="#d89550" strokeDasharray="3 3"/>}
      </g>}
      {parallel && <g><rect x="49" y="198" width="22" height="104" rx="4" fill="#45636a"/><text x="80" y="173" className="diagram-label">平行光源</text></g>}
      {s.equipment >= 3 && !s.throughLens && <g className={canScreen ? 'draggable-apparatus' : ''} onPointerDown={e => { if (canScreen) grab('screen', e) }} data-testid="screen">
        <rect x={screenX - 19} y="115" width="38" height="275" fill="transparent"/>
        <rect x={screenX - 4} y="120" width="8" height="260" fill="#e3e9e7" stroke="#75959a" strokeWidth="2"/><rect x={screenX - 3} y="380" width="6" height="9" fill="#879fa3"/>
        <rect x={screenX - 20} y="381" width="40" height="8" rx="2" fill="#69868d"/>
        <text x={screenX} y="102" textAnchor="middle" className="diagram-label">光屏</text>
        {s.step === 1 && <circle cx={screenX} cy="250" r="14" fill="none" stroke="#4797a0"/>}
        {active && physics.screenHits.map((hit, i) => <circle key={i} cx={screenX} cy={hit.point.y * 10} r={parallel ? 3 : 4} fill="#efad60" opacity=".8"/>)}
        {trial && physics.focused && <g filter="url(#main-blur)"><Flame x={screenX} y={250} scale={physics.magnification}/></g>}
      </g>}
      {s.equipment === 0 && <text x="160" y="215" className="ghost-label" textAnchor="middle">放置蜡烛</text>}
      {phantom && <g><Flame x={460 + physics.v * 10} y={250} scale={physics.magnification} ghost/><text x={460 + physics.v * 10} y={250 - 14 * physics.magnification - 20} textAnchor="middle" className="diagram-label">虚像位置</text></g>}
      {s.throughLens && <g transform="translate(820 246)" stroke="#377d89" fill="white"><path d="M-21 0Q0 -24 21 0Q0 24 -21 0Z" strokeWidth="2"/><circle r="6" fill="#377d89"/><text x="0" y="42" textAnchor="middle" className="diagram-label">观察眼</text></g>}
      {trial && <g className="measure-lines"><path d={`M${objectX} 346V353H460V346`} fill="none" stroke="#bc8a54"/><text x={(objectX + 460) / 2} y="373" textAnchor="middle">u = {s.u.toFixed(1)} cm</text>{!s.throughLens && <><path d={`M460 307V314H${screenX}V307`} fill="none" stroke="#6c9da5"/><text x={(screenX + 460) / 2} y="333" textAnchor="middle">光屏距离 {s.screen.toFixed(1)} cm</text></>}</g>}
    </svg>
    {s.step === 0 && s.equipment < 3 && <button className={`diagram-target place-target ${placing ? 'drop-active' : ''}`} style={{ left: `${[460 - s.u * 10, 460, screenX][s.equipment] / 9.2}%`, top: '52.0833%' }} aria-label={['放置蜡烛','放置凸透镜','放置光屏'][s.equipment]} onClick={onPlace}><Plus size={20}/></button>}
    </div>
    {s.step === 0 && s.equipment < 3 && <div className="equipment-tray"><span>器材托盘</span><button className="tray-piece" onClick={e => { if (!dragWasMove.current) onPlace(); dragWasMove.current = false; e.preventDefault() }} onPointerDown={e => { placeStart.current = { x: e.clientX, y: e.clientY }; dragWasMove.current = false; e.currentTarget.setPointerCapture(e.pointerId); setPlacing(true) }} onPointerMove={e => { if (placeStart.current) setDragPoint({ x: e.clientX, y: e.clientY }) }} onPointerUp={dropEquipment} onPointerCancel={() => { placeStart.current = null; setPlacing(false); setDragPoint(null) }} aria-label={`拖拽${['蜡烛','凸透镜','光屏'][s.equipment]}到指定位置`}>{['蜡烛','凸透镜','光屏'][s.equipment]} <MoveHorizontal size={15}/></button><small>拖到圆形位置，或点按器材放置</small></div>}
    {placing && dragPoint && <div className="drag-ghost" style={{ left: dragPoint.x, top: dragPoint.y }} aria-hidden="true">{['蜡烛','凸透镜','光屏'][s.equipment]}</div>}
    <div className="visual-footer"><span><MoveHorizontal size={14}/>{canObject ? '移动蜡烛，改变物距' : canScreen ? '移动光屏，观察画面变化' : canHeight ? '调整烛焰中心的高度' : '观察物与像的位置关系'}</span><span>近轴薄透镜模型</span></div>
  </section>
}

export function ScreenStatus({ state: s }: { state: LessonState }) {
  const active = s.step >= 2
  const parallel = s.step === 2
  const trial = s.step >= 3 && s.step <= 7
  const physics = optics(s.u, s.screen, parallel, s.throughLens)
  return <section className="screen-status" aria-label="光屏状态"><div className="screen-heading"><strong>{s.throughLens ? '透镜观察窗' : '光屏状态'}</strong><span>{active ? `光屏距 ${s.screen.toFixed(1)} cm` : '等待实验'}</span></div>{active ? <div className="observation-strip">
      <div className="observation-view"><div className="view-caption">{s.throughLens ? <Eye size={14}/> : <FocusIcon/>}{s.throughLens ? '透过透镜观察' : '光屏正面'}</div>
        <svg viewBox="0 0 210 142" aria-label={s.throughLens ? '透过透镜观察的烛焰像' : '光屏上的实时光斑或烛焰像'} data-testid="screen-preview" data-blur={physics.blur.toFixed(2)}>
          <defs><filter id="preview-blur"><feGaussianBlur stdDeviation={physics.blur}/></filter></defs>
          <rect x="5" y="4" width="200" height="132" rx="4" fill={s.throughLens ? '#ecf2f1' : '#293c41'} stroke="#738d91"/>
          <path d="M105 9V132M10 70H200" stroke={s.throughLens ? '#c1d4d5' : '#425960'} strokeDasharray="3 4"/>
          {parallel ? <g filter="url(#preview-blur)"><circle cx="105" cy="70" r={Math.max(2.5, Math.abs(s.screen - 10) * 1.5)} fill="#ffe9ac"/></g> : s.throughLens ? <Flame x={105} y={70} scale={Math.max(-5, Math.min(5, physics.magnification * 2))}/> : <g filter="url(#preview-blur)" opacity={Math.max(.3, 1 - physics.blur / 35)}><Flame x={105} y={70} scale={Math.max(-5, -2 * s.screen / s.u)}/></g>}
          <line x1="185" x2="185" y1="20" y2="120" stroke="#8a9c9e"/>{[20,45,70,95,120].map(y => <line key={y} x1="181" x2="189" y1={y} y2={y} stroke="#8a9c9e"/>)}
        </svg>
      </div>
      <div className="observation-view comparison"><div className="view-caption">{parallel ? '透镜至光屏' : '烛焰原始大小'}</div>{parallel ? <div className="focus-reading"><strong>{s.screen.toFixed(1)}</strong><span>cm</span></div> : <svg viewBox="0 0 110 142" aria-label="原始烛焰大小参照"><path d="M6 70H104" stroke="#d7e2df" strokeDasharray="4 4"/><Flame x={55} y={70} scale={2}/><text x="55" y="122" textAnchor="middle" className="ruler-text">相同比例</text></svg>}</div>
      <div className="observation-notes"><div className="hint-heading"><span/>现场观察</div><p>{parallel ? '移动光屏，比较光斑的大小与亮度。' : s.throughLens ? '比较视野中的像与原始烛焰的方向、大小。' : '让光屏前后移动，观察烛焰的轮廓如何变化。'}</p>{trial && s.objectLocked && <span className="record-reading">u = {s.u.toFixed(1)} cm{!s.throughLens && ` · 光屏距离 ${s.screen.toFixed(1)} cm`}</span>}</div>
    </div> : <div className="screen-placeholder"><Eye size={22}/><span>摆好器材并完成对齐后，在这里观察成像</span></div>}</section>
}

function FocusIcon() { return <span className="small-screen-icon"/> }
