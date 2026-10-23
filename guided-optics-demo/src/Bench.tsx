import { useEffect, useRef, useState } from 'react'
import { Eye, Maximize2, Minimize2, MoveHorizontal, Plus } from 'lucide-react'
import { focalLength, physicsFor, stages, type LabState } from './curriculum'

export function Flame({x=0,y=0,scale=1,ghost=false}:{x?:number;y?:number;scale?:number;ghost?:boolean}){
  return <g transform={`translate(${x} ${y}) scale(${scale})`} opacity={ghost?.65:1}><path d="M0 -14C-4 -4 -10 0 -7 8C-4 17 6 16 8 7C10 -2 2 -5 0 -14Z" fill="#f4aa48" stroke="#db7742"/><path d="M0 0C-6 7 -3 14 1 13C6 12 5 5 0 0Z" fill="#fff0b6"/></g>
}
function LightObject({x,y,scale=1,source='candle',lit=true}:{x:number;y:number;scale?:number;source?:string;lit?:boolean}){
  return source==='F'?<g transform={`translate(${x} ${y}) scale(${scale})`}><path d="M-9 15V-15H10V-9H-3V-3H7V3H-3V15Z" fill="#edac4e" stroke="#b77730"/></g>:lit?<Flame x={x} y={y} scale={scale}/>:null
}
type Props={state:LabState;onPlace:()=>void;onObject:(n:number)=>void;onScreen:(n:number)=>void;onHeight:(n:number)=>void;onCover:(n:number)=>void;onMisplace:()=>void}
export function Bench({state:s,onPlace,onObject,onScreen,onHeight,onCover,onMisplace}:Props){
  const section=useRef<HTMLElement>(null),svg=useRef<SVGSVGElement>(null),dragging=useRef<'object'|'screen'|'height'|'cover'|null>(null)
  const [expanded,setExpanded]=useState(false),[compact,setCompact]=useState(()=>matchMedia('(orientation: landscape) and (max-height: 600px)').matches)
  const [dragPoint,setDragPoint]=useState<{x:number;y:number}|null>(null),placeStart=useRef<{x:number;y:number}|null>(null),moved=useRef(false)
  const stage=stages[s.step],parallel=!!stage.parallel,placing=stage.id==='setup'&&s.equipment<3
  const sign=s.swapped?-1:1,objectX=460-sign*s.u*10,screenX=460+sign*s.screen*10,objectY=250+s.height*10
  const installed=stage.id!=='graph'||s.touched
  const p=physicsFor(s),f=focalLength(s),active=s.equipment===3&&installed&&!(stage.id==='burn'&&!s.lit)
  const adjusting=s.phase==='adjust',canObject=!!stage.object&&adjusting&&installed,canScreen=!!stage.screenMove&&adjusting&&!s.throughLens&&installed&&(!stage.id.includes('glasses')||s.glasses!=='none')&&(!stage.id.startsWith('water-')||s.waterInstalled),canHeight=!!stage.height&&adjusting,canCover=stage.id==='cover'&&adjusting
  const names=[parallel?'平行光源':'蜡烛',s.waterInstalled?'水透镜':'凸透镜','光屏']
  useEffect(()=>{const media=matchMedia('(orientation: landscape) and (max-height: 600px)'),resize=()=>setCompact(media.matches);media.addEventListener('change',resize);return()=>media.removeEventListener('change',resize)},[])
  useEffect(()=>setExpanded(false),[s.step])
  useEffect(()=>{
    if(!expanded)return
    const previous=document.activeElement as HTMLElement|null
    section.current?.querySelector<HTMLButtonElement>('.bench-expand')?.focus()
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape')setExpanded(false);if(e.key!=='Tab')return;const buttons=[...(section.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')||[])];if(!buttons.length)return;const i=buttons.indexOf(document.activeElement as HTMLButtonElement);e.preventDefault();buttons[(i+(e.shiftKey?-1:1)+buttons.length)%buttons.length].focus()}
    document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);previous?.focus()}
  },[expanded])
  const clamp=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,Math.round(v*10)/10))
  function move(e:React.PointerEvent<SVGSVGElement>){
    if(!dragging.current||!svg.current)return
    const matrix=svg.current.getScreenCTM();if(!matrix)return
    const point=svg.current.createSVGPoint();point.x=e.clientX;point.y=e.clientY
    const local=point.matrixTransform(matrix.inverse())
    if(dragging.current==='object')onObject(clamp(sign*(460-local.x)/10,stage.id==='graph'?14:5,35))
    if(dragging.current==='screen')onScreen(clamp(sign*(local.x-460)/10,5,38))
    if(dragging.current==='height')onHeight(clamp((local.y-250)/10,-6,6))
    if(dragging.current==='cover')onCover(Math.round(clamp((local.y-120)/2.6,0,75)))
  }
  function grab(kind:typeof dragging.current,e:React.PointerEvent<SVGGElement>){dragging.current=kind;svg.current?.setPointerCapture(e.pointerId);e.preventDefault()}
  function drop(e:React.PointerEvent<HTMLButtonElement>){
    if(!placeStart.current)return
    moved.current=Math.hypot(e.clientX-placeStart.current.x,e.clientY-placeStart.current.y)>12
    if(moved.current){const b=section.current?.querySelector('.place-target')?.getBoundingClientRect();if(b&&e.clientX>=b.left-20&&e.clientX<=b.right+20&&e.clientY>=b.top-20&&e.clientY<=b.bottom+20)onPlace();else onMisplace()}
    placeStart.current=null;setDragPoint(null)
  }
  return <section ref={section} className={`visual-area ${compact?'compact-bench':''} ${expanded?'bench-expanded':''}`} role={expanded?'dialog':undefined} aria-modal={expanded||undefined} aria-label="凸透镜成像实验台">
    <div className="visual-toolbar"><span className="visual-title"><span className="live-dot"/>光具座 · 实时实验</span><div className="visual-tools"><span className="scale-label">{['setup','focus','graph'].includes(stage.id)?'刻度 / cm':`f = ${f.toFixed(1)} cm`}</span><button className="bench-expand" title={expanded?'收起实验台':'放大实验台'} aria-label={expanded?'收起实验台':'放大实验台'} onClick={()=>setExpanded(!expanded)}>{expanded?<Minimize2 size={17}/>:<Maximize2 size={17}/>}</button></div></div>
    <div className="diagram-wrap"><svg ref={svg} viewBox={compact?'40 60 860 375':'0 0 920 480'} role="img" aria-label="蜡烛、凸透镜和光屏实时仿真" onPointerMove={move} onPointerUp={()=>dragging.current=null} onPointerCancel={()=>dragging.current=null} style={{touchAction:canObject||canScreen||canHeight||canCover?'none':'auto'}}>
      <defs><pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#e6eceb" strokeWidth=".7"/></pattern><linearGradient id="glass"><stop stopColor="#abdae2"/><stop offset=".5" stopColor="#f0fcfb"/><stop offset="1" stopColor="#9dcfdb"/></linearGradient></defs>
      <rect width="920" height="480" fill="#f9fbfa"/><rect width="920" height="480" fill="url(#grid)"/>
      <line x1="48" y1="250" x2="880" y2="250" stroke="#8ea7a8" strokeWidth="1.2" strokeDasharray="8 6"/><text x="810" y="232" className="axis-label">主光轴</text>
      <rect x="50" y="389" width="820" height="13" rx="3" fill="#c9d6d7"/>{Array.from({length:81},(_,i)=><g key={i}><line x1={60+i*10} x2={60+i*10} y1="390" y2={i%5?395:402} stroke="#7a969b"/>{i%10===0&&<text x={60+i*10} y="423" textAnchor="middle" className="ruler-text">{i}</text>}</g>)}<text x="883" y="423" className="ruler-text">cm</text>
      {s.equipment>=2?<g data-testid="main-lens"><path d={`M460 125C${487+s.water*8} 184 ${487+s.water*8} 316 460 375C${433-s.water*8} 316 ${433-s.water*8} 184 460 125Z`} fill="url(#glass)" stroke="#358b9c" strokeWidth="2.5"/><path d="M460 140C475 196 475 304 460 357" fill="none" stroke="white" strokeWidth="2"/><rect x="456" y="375" width="8" height="15" fill="#8da6a9"/><circle cx="460" cy="250" r="3" fill="#26798a"/><text x="477" y="243" className="diagram-label">O</text><text x="460" y="102" textAnchor="middle" className="diagram-label">{names[1]}</text>{s.waterInstalled&&<path d="M476 160H507V340H522" fill="none" stroke="#4f9cc2" strokeWidth="5"/>}</g>:<path d="M460 125C487 184 487 316 460 375C433 316 433 184 460 125Z" fill="none" stroke="#8eb8c0" strokeWidth="2" strokeDasharray="7 5"/>}
      {!parallel&&[460-20*f,460-10*f,460+10*f,460+20*f].map((x,i)=><g key={i}><circle cx={x} cy="250" r="3.5" fill="#d5964c"/><text x={x} y="276" textAnchor="middle" className="focus-label">{['2F₁','F₁','F₂','2F₂'][i]}</text></g>)}
      {s.glasses!=='none'&&<g data-testid="spectacle"><path d={s.glasses==='near'?'M420 145Q435 250 420 355L440 355Q425 250 440 145Z':'M430 145Q453 250 430 355Q407 250 430 145Z'} fill="#d5e7f0" stroke="#748bc1" strokeWidth="2"/><text x="385" y="78" className="diagram-label">{s.glasses==='near'?'近视镜':'远视镜'}</text></g>}
      {active&&<g className="ray-group" data-testid="ray-paths">{p.segments.map((seg,i)=><g key={i}><line x1={seg.from.x*10} y1={seg.from.y*10} x2={seg.to.x*10} y2={seg.to.y*10} stroke={seg.virtual?'#aa8c65':['#e97055','#278da0','#c79a42'][i%3]} strokeWidth={seg.virtual?1.5:2} strokeDasharray={seg.virtual?'6 5':undefined}/>{!seg.virtual&&<circle r="2.5" fill="#f7ba5e"><animateMotion dur="2.8s" repeatCount="indefinite" path={`M${seg.from.x*10} ${seg.from.y*10}L${seg.to.x*10} ${seg.to.y*10}`}/></circle>}</g>)}</g>}
      {s.equipment>=1&&!parallel&&installed&&<g data-testid="candle" className={canObject||canHeight?'draggable-apparatus':''} onPointerDown={e=>{if(canObject)grab('object',e);if(canHeight)grab('height',e)}}>
        <rect x={objectX-27} y={objectY-25} width="54" height="165" fill="transparent" stroke="transparent" strokeWidth={canObject||canHeight?24:0} vectorEffect="non-scaling-stroke"/>
        {s.source==='candle'?<><rect x={objectX-8} y={objectY+21} width="16" height={Math.max(25,64-s.burned*10)} rx="2" fill="#f1eee8" stroke="#b39b82"/><line x1={objectX} y1={objectY+13} x2={objectX} y2={objectY+24} stroke="#395359" strokeWidth="2"/></>:<rect x={objectX-18} y={objectY-24} width="36" height="48" rx="3" fill="#293c41"/>}
        <LightObject x={objectX} y={objectY} source={s.source} lit={stage.id!=='burn'||s.lit}/><line x1={objectX} y1={objectY+70} x2={objectX} y2="385" stroke="#879fa3" strokeWidth="6"/><rect x={objectX-20} y="381" width="40" height="8" rx="2" fill="#69868d"/><text x={objectX} y={objectY-39} textAnchor="middle" className="diagram-label">{s.source==='F'?'F 光源':'蜡烛'}</text>
        {(canObject||canHeight)&&<rect x={objectX-28} y={objectY-26} width="56" height="129" rx="7" fill="none" stroke="#d69a57" strokeDasharray="4 4"/>}
      </g>}
      {parallel&&s.equipment>=1&&<g><rect x="49" y="198" width="22" height="104" rx="4" fill="#45636a"/><text x="80" y="173" className="diagram-label">平行光源</text></g>}
      {s.equipment>=3&&!s.throughLens&&<g data-testid="screen" className={canScreen?'draggable-apparatus':''} onPointerDown={e=>{if(canScreen)grab('screen',e)}}><rect x={screenX-19} y="115" width="38" height="275" fill="transparent" stroke="transparent" strokeWidth={canScreen?32:0} vectorEffect="non-scaling-stroke"/><rect x={screenX-4} y="120" width="8" height="260" fill="#e3e9e7" stroke="#75959a" strokeWidth="2"/><rect x={screenX-20} y="381" width="40" height="8" rx="2" fill="#69868d"/><text x={screenX} y="102" textAnchor="middle" className="diagram-label">光屏</text>{active&&p.screenHits.map((hit,i)=><circle key={i} cx={screenX} cy={hit.point.y*10} r="3" fill="#efad60" opacity=".7"/>)}{active&&!parallel&&p.focused&&p.imageY>=12&&p.imageY<=38&&<g opacity={p.brightness}><LightObject x={screenX} y={p.imageY*10} scale={p.magnification} source={s.source}/></g>}</g>}
      {stage.id==='cover'&&<g data-testid="cover-board" onPointerDown={e=>{if(canCover)grab('cover',e)}} className={canCover?'draggable-apparatus':''}><rect x="443" y="120" width="34" height={s.cover*1.3} fill="#5d6571"/><rect x="443" y={380-s.cover*1.3} width="34" height={s.cover*1.3} fill="#5d6571"/><rect x="443" y={Math.max(106,105+s.cover*1.3)} width="34" height="16" rx="3" fill="#8994a4"/><text x="510" y="128" className="diagram-label">遮光板</text></g>}
      {s.throughLens&&p.v<0&&<g><LightObject x={460+p.v*10} y={p.imageY*10} scale={p.magnification} source={s.source}/><text x={460+p.v*10} y={p.imageY*10-55} textAnchor="middle" className="diagram-label">虚像位置</text></g>}
      {s.throughLens&&<g transform="translate(820 246)" stroke="#377d89" fill="white"><path d="M-21 0Q0 -24 21 0Q0 24 -21 0Z" strokeWidth="2"/><circle r="6" fill="#377d89"/><text x="0" y="42" textAnchor="middle" className="diagram-label">观察眼</text></g>}
      {s.equipment===3&&<g className="measure-lines">{!parallel&&<><path d={`M${objectX} 346V353H460V346`} fill="none" stroke="#bc8a54"/><text x={(objectX+460)/2} y="373" textAnchor="middle">u = {s.u.toFixed(1)} cm</text></>}{!s.throughLens&&<><path d={`M460 307V314H${screenX}V307`} fill="none" stroke="#6c9da5"/><text x={(screenX+460)/2} y="333" textAnchor="middle">光屏距离 {s.screen.toFixed(1)} cm</text></>}</g>}
    </svg>
    {placing&&<div className="placement-overlay"><button className="diagram-target place-target" style={{left:`${([70,460,screenX][s.equipment]-(compact?40:0))/(compact?8.6:9.2)}%`,top:compact?'50.666667%':'52.083333%'}} aria-label={`放置${names[s.equipment]}`} onClick={onPlace}><Plus size={20}/></button></div>}
    </div>
    {placing&&<div className="equipment-tray"><span>器材托盘</span><button className="tray-piece" aria-label={`拖拽${names[s.equipment]}到指定位置`} onClick={e=>{if(!moved.current)onPlace();moved.current=false;e.preventDefault()}} onPointerDown={e=>{placeStart.current={x:e.clientX,y:e.clientY};moved.current=false;e.currentTarget.setPointerCapture(e.pointerId)}} onPointerMove={e=>{if(placeStart.current)setDragPoint({x:e.clientX,y:e.clientY})}} onPointerUp={drop} onPointerCancel={()=>{placeStart.current=null;setDragPoint(null)}}>{names[s.equipment]}<MoveHorizontal size={15}/></button><small>拖到圆形位置</small></div>}
    {dragPoint&&<div className="drag-ghost" style={{left:dragPoint.x,top:dragPoint.y}}>{names[s.equipment]}</div>}
    <div className="visual-footer"><span><MoveHorizontal size={14}/>{canHeight?'调整焰心高度':canCover?'上下移动遮光板':canObject?'移动蜡烛与光屏':canScreen?'移动光屏，比较清晰度':'观察物与像的位置关系'}</span><span>光具座刻度 / cm</span></div>
  </section>
}
export function ScreenStatus({state:s}:{state:LabState}){
  const stage=stages[s.step],p=physicsFor(s),parallel=!!stage.parallel,active=s.equipment===3&&(stage.id!=='graph'||s.touched)&&!(stage.id==='burn'&&!s.lit)
  const offset=s.throughLens?p.magnification*s.height:-s.screen/s.u*s.height
  const projectedScale=s.glasses==='none'?-2*s.screen/s.u:2*p.magnification*s.screen/p.v
  return <section className={`screen-status ${s.phase==='adjust'?'':'screen-observing'}`} aria-label="光屏状态"><div className="screen-heading"><strong>{s.throughLens?'透镜观察窗':'光屏状态'}</strong><span>{active?`光屏距 ${s.screen.toFixed(1)} cm`:'等待实验'}</span></div>{active?<div className="observation-strip"><div className="observation-view"><div className="view-caption">{s.throughLens?<Eye size={14}/>:<span className="small-screen-icon"/>}{s.throughLens?'透过透镜观察':'光屏正面'}</div>
    <svg viewBox="0 0 210 142" data-testid="screen-preview" data-blur={p.blur.toFixed(2)} data-brightness={p.brightness.toFixed(2)} data-image-y={offset.toFixed(2)} aria-label="实时成像观察窗"><defs><filter id="preview-blur"><feGaussianBlur stdDeviation={p.blur}/></filter><clipPath id="preview-clip"><rect x="5" y="4" width="200" height="132" rx="4"/></clipPath></defs><rect x="5" y="4" width="200" height="132" rx="4" fill={s.throughLens?'#ecf2f1':'#293c41'} stroke="#738d91"/><path d="M105 9V132M10 70H200" stroke={s.throughLens?'#c1d4d5':'#425960'} strokeDasharray="3 4"/>
      <g clipPath="url(#preview-clip)">{parallel?<g filter="url(#preview-blur)"><circle cx="105" cy="70" r={Math.max(2.5,Math.abs(s.screen-focalLength(s))*1.5)} fill="#ffe9ac"/></g>:s.throughLens?<LightObject x={105} y={70+offset*20} scale={Math.min(5,p.magnification*2)} source={s.source}/>:<g filter="url(#preview-blur)" opacity={Math.max(.1,1-p.blur/35)*p.brightness}><LightObject x={105} y={70+offset*20} scale={Math.max(-5,projectedScale)} source={s.source}/></g>}</g><line x1="185" x2="185" y1="20" y2="120" stroke="#8a9c9e"/>{[20,45,70,95,120].map(y=><line key={y} x1="181" x2="189" y1={y} y2={y} stroke="#8a9c9e"/>)}</svg>
    </div><div className="observation-view comparison"><div className="view-caption">{parallel?'透镜至光屏':s.source==='F'?'F 光源原始大小':'烛焰原始大小'}</div>{parallel?<div className="focus-reading"><strong>{s.screen.toFixed(1)}</strong><span>cm</span></div>:<svg viewBox="0 0 110 142"><path d="M6 70H104" stroke="#d7e2df" strokeDasharray="4 4"/><LightObject x={55} y={70} scale={2} source={s.source}/><text x="55" y="122" textAnchor="middle" className="ruler-text">相同比例</text></svg>}</div></div>:<div className="screen-placeholder"><Eye size={22}/><span>{stage.id==='burn'?'点燃蜡烛后观察像的升降':'摆好器材后，观察成像'}</span></div>}</section>
}
