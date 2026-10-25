import { useEffect, useId, useRef, useState } from 'react'
import { ArrowDownToLine, ArrowLeft, ArrowRight, ArrowLeftRight, Check, CheckCircle2, ChevronDown, Droplets, Eye, Flame as FlameIcon, Focus, Glasses, HelpCircle, House, LayoutGrid, Minus, Plus, Printer, RotateCcw, Sparkles, X } from 'lucide-react'
import { Bench, ScreenStatus } from './Bench'
import { MentorPrompt } from './MentorPrompt'
import { conclusionRows, downloadRecords, fresh, groups, load, physicsFor, ready, selectStep, stages, STORAGE_KEY, topicNames, wrongAnswers, type LabState } from './curriculum'
import { useVoiceGuide } from './useVoiceGuide'
import { snapAdjustment } from './interaction'
import { nativeApp } from './exportTable'

type Hint={text:string;tone:'tip'|'warn'|'good'}
const types=groups.map(group=>({name:topicNames[group]||group,step:stages.findIndex(stage=>stage.group===group),steps:stages.flatMap((stage,step)=>stage.group===group?[step]:[])}))
export default function App({onHome}:{onHome:()=>void}){
  const [s,setState]=useState(load),[answers,setAnswers]=useState<string[]>([]),[errors,setErrors]=useState<number[]>([])
  const [hint,setHint]=useState<Hint|null>(null),[dialog,setDialog]=useState<'help'|'reset'|'more'|null>(null),[graph,setGraph]=useState(()=>stages[s.step].id==='graph'&&s.touched),[saved,setSaved]=useState(true),[toast,setToast]=useState('')
  const dialogRef=useRef<HTMLDialogElement>(null),panelRef=useRef<HTMLDivElement>(null),timer=useRef<number|null>(null),toastTimer=useRef<number|null>(null),spoken=useRef(new Set<string>())
  const stage=stages[s.step],voice=useVoiceGuide(stage.cue),p=physicsFor(s),isReady=ready(s),question=stage.question,scanned=s.scanned[0]<=8&&s.scanned[1]>=34
  const currentGroup=groups.indexOf(stage.group),summary=stage.id==='summary'
  useEffect(()=>{try{localStorage.setItem(STORAGE_KEY,JSON.stringify(s));setSaved(true)}catch{setSaved(false)}},[s])
  useEffect(()=>{if(dialog)dialogRef.current?.showModal();else dialogRef.current?.close()},[dialog])
  useEffect(()=>{if(panelRef.current)panelRef.current.scrollTop=0},[s.step,s.phase])
  useEffect(()=>{speak(s.phase==='done'?stage.resultCue:[stage.cue,...stage.actionCue?[stage.actionCue]:[]],true)},[])
  useEffect(()=>{
    if(!s.motion)return
    const motion=s.motion,step=s.step,burning=motion==='burn',from=burning?s.burned:s.water,to=burning?3:motion==='water-in'?1:-1
    const duration=burning?6000*(3-from)/3:3200*Math.abs(to-from),start=performance.now()
    let frame=0,last=0
    if(timer.current!==null)clearTimeout(timer.current);timer.current=null
    setHint({text:burning?'加速观察：蜡烛逐渐变短，留意焰心与像的移动方向。':motion==='water-in'?'正在注水，透镜逐渐变鼓，观察光线会聚位置的变化。':'正在抽水，透镜逐渐变扁，观察光线会聚位置的变化。',tone:'tip'})
    const tick=(now:number)=>{
      const progress=duration>0?Math.min(1,(now-start)/duration):1
      if(now-last>=32||progress===1){
        last=now
        const value=progress===1?to:from+(to-from)*progress
        setState(prev=>prev.step!==step||prev.motion!==motion?prev:{...prev,...burning?{burned:value,height:value}:{water:value},motion:progress===1?null:motion})
      }
      if(progress<1)frame=requestAnimationFrame(tick)
      else{
        setHint({text:burning?'观察到了吗？焰心逐渐下降，清晰的像向上移动。':`水透镜已${motion==='water-in'?'注水，形状变鼓':'抽水，形状变扁'}，现在移动光屏重新对焦。`,tone:'good'})
        speak(burning?'052':motion==='water-in'?'041':'043')
        if(burning)encourage('观察完成！焰心向下，实像向上。')
      }
    }
    frame=requestAnimationFrame(tick)
    return()=>cancelAnimationFrame(frame)
  },[s.motion,s.step])
  useEffect(()=>()=>{if(timer.current!==null)clearTimeout(timer.current);if(toastTimer.current!==null)clearTimeout(toastTimer.current)},[])
  function patch(values:Partial<LabState>){setState(prev=>({...prev,...values}))}
  function speak(ids:string|string[],interrupt=false){if(timer.current!==null)clearTimeout(timer.current);timer.current=null;voice.announce(ids,{interrupt})}
  function encourage(message:string){setToast(message);if(toastTimer.current!==null)clearTimeout(toastTimer.current);toastTimer.current=window.setTimeout(()=>setToast(''),2400)}
  function openTopics(){setDialog('more')}
  function announce(id:string,delay=0){
    if(timer.current!==null)clearTimeout(timer.current);timer.current=null
    const key=`${s.step}:${id}`;if(spoken.current.has(key))return
    const run=()=>{timer.current=null;spoken.current.add(key);voice.announce(id,{feedback:true})}
    if(delay)timer.current=window.setTimeout(run,delay);else run()
  }
  function jump(step:number,base=s,interrupt=true){
    if(timer.current!==null)clearTimeout(timer.current);timer.current=null;spoken.current.clear()
    const next=selectStep(base,step);setState(next);setAnswers([]);setErrors([]);setHint(null);setGraph(stages[next.step].id==='graph');setDialog(null);setToast('')
    const target=stages[next.step];speak([target.cue,...target.actionCue?[target.actionCue]:[]],interrupt)
  }
  function complete(){patch({phase:'done',completedSteps:[...new Set([...s.completedSteps,s.step])]});setHint({text:summary?'整节课完成！用这张总表回顾五种成像情况。':'观察与判断完成，可以继续下一步。',tone:'good'})}
  function next(){jump(Math.min(stages.length-1,s.step+1),s,false)}
  function move(kind:'u'|'screen'|'height'|'cover',value:number,tolerance=matchMedia('(pointer: coarse)').matches?1.7:1.2){
    if(s.phase!=='adjust'||s.motion)return
    const adjusted=snapAdjustment(s,kind,value,tolerance)
    const values:Partial<LabState>={[kind]:adjusted,touched:true}
    if(kind==='screen')values.scanned=[Math.min(s.scanned[0],value),Math.max(s.scanned[1],value)]
    const next={...s,...values},physics=physicsFor(next)
    patch(values)
    let text='',tone:Hint['tone']='tip',cue:string|undefined
    if(kind==='height'){
      text=adjusted===0?'三个中心已经同高。观察光屏上的像是否回到中央。':adjusted<0?'焰心偏高，向下微调，留意光屏上的像反向移动。':'焰心偏低，向上微调，留意光屏上的像反向移动。';tone=adjusted===0?'good':'warn';cue=adjusted===0?'old-06':'old-05'
    }else if(kind==='cover'){
      text=value===0?'现在无遮挡，记住这个亮度，再挡住一部分透镜。':`已遮挡 ${value}%：仔细比较像是否完整，亮度有什么变化。`;tone=value>0?'good':'tip'
    }else if(stage.id==='graph'){
      text=physics.focused?Math.abs(next.u-20)<.1?'看，物距与像距相等！u = v = 2f，焦距就是这个距离的一半。':'像已清晰，绿点落在曲线上。移动蜡烛，再观察物距与像距怎样变化。':`橙点表示当前光屏位置，还不能当作像距。将光屏${next.screen<physics.v?'远离':'靠近'}透镜，让点回到蓝色曲线上。`;tone=physics.focused?'good':'tip'
    }else if(stage.targetURange&&(next.u<stage.targetURange[0]||next.u>stage.targetURange[1])){
      text=`蜡烛再${next.u<stage.targetURange[0]?'远离':'靠近'}一点，进入目标区域即可，不用对准刻度。`;tone='tip';cue='old-13'
    }else if(stage.screenDirection==='farther'&&next.screen<24||stage.screenDirection==='nearer'&&next.screen>17){
      text=`光屏再向${stage.screenDirection==='farther'?'远':'近'}侧移动一些，进入提示区域后再调蜡烛。`;tone='tip'
    }else if(stage.id==='virtual'||stage.id==='infinity'){
      text=next.scanned[0]>8?'先检查光屏靠近透镜的一端。':next.scanned[1]<34?'再检查远离透镜的一端，比较能否成清晰的像。':stage.id==='virtual'?'光屏两端都试过了，移开光屏，从透镜另一侧观察。':'两端都没有清晰像，观察出射光是否平行。';cue=next.scanned[0]>8?'old-17':next.scanned[1]<34?'old-18':stage.id==='virtual'?'021':'old-19'
    }else if(physics.focused){
      text=stage.parallel?'光斑最小、最亮。读出光屏刻度，再减去透镜刻度。':'像的轮廓已经清晰，先比较大小、方向和位置。';tone='good';cue=stage.parallel?'old-09':['small','equal','large','real'].includes(stage.id)?'old-15':undefined
    }else{
      text=physics.v>38?'清晰像可能在导轨范围以外；留意本题要排查的条件。':physics.v<=0||!Number.isFinite(physics.v)?'这个位置不能在有限距离的光屏上得到清晰像。':next.screen<physics.v?'光屏还偏近，向远离透镜的方向慢慢移动。':'光屏偏远，向靠近透镜的方向慢慢移动。';tone='warn';cue=stage.parallel?'old-08':undefined
    }
    setHint({text,tone})
    const objectReady=kind==='u'&&stage.targetURange&&adjusted>=stage.targetURange[0]&&adjusted<=stage.targetURange[1]&&!(s.u>=stage.targetURange[0]&&s.u<=stage.targetURange[1])
    const screenReady=kind==='screen'&&(stage.screenDirection==='farther'&&adjusted>=24&&s.screen<24||stage.screenDirection==='nearer'&&adjusted<=17&&s.screen>17)
    if(!ready(s)&&ready(next))encourage('太棒了，位置合适！接下来观察成像结果。')
    else if(objectReady)encourage('物体位置选得正合适，接着调节光屏。')
    else if(screenReady)encourage('光屏方向正确，接着移动蜡烛找清晰像。')
    if(cue)announce(cue,tone==='good'?300:650);else if(timer.current!==null){clearTimeout(timer.current);timer.current=null}
  }
  function place(){
    if(s.equipment>=3)return
    const equipment=s.equipment+1
    patch({equipment,...equipment===3?{phase:'done' as const,completedSteps:[...new Set([...s.completedSteps,s.step])]}:{}})
    setHint({text:equipment===3?'器材已到齐，接下来移动光屏寻找焦点。':`已放好${equipment===1?'平行光源':'凸透镜'}，继续放置下一件。`,tone:'good'})
    if(equipment===3){speak('003');encourage('器材都摆好了，开始寻找焦点吧！')}
  }
  function observe(){
    if(s.phase==='adjust'){
      patch({phase:'observe',...stage.id==='causes'?{u:11,screen:38,height:0}:{}})
      setHint({text:stage.id==='causes'?'现在看物距 11.0 cm 的场景，光屏已到导轨远端。':stage.id==='graph'?'结论已经标在图上：u = v = 2f，所以 f = u / 2 = 10 cm。':'先看实验结果，比较物与像，再进入答题。',tone:'tip'})
      if(stage.id==='graph')setGraph(true)
      speak(stage.id==='graph'?'007':stage.id==='water-out'?['044','045']:stage.id==='cover'?'032':stage.id==='alignment'?'old-06':'old-23')
    }else{patch({phase:'answer'});setAnswers([]);setErrors([]);setHint(null)}
  }
  function submit(){
    if(!question)return
    const bad=wrongAnswers(question,answers);setErrors(bad)
    if(bad.length){setHint({text:question.hint,tone:'warn'});const cue=stage.id==='focus'?'old-25':stage.id==='alignment'?'old-24':stage.id==='virtual'?'old-28':['small','equal','large'].includes(stage.id)?'old-26':undefined;if(cue)speak(cue);return}
    complete();speak(stage.id==='large'?[stage.resultCue,'018']:stage.id==='equal'?'018':stage.id==='alignment'?'old-06':stage.resultCue)
  }
  function record(){
    if(!p.focused)return
    if(s.samples.some(point=>Math.abs(point.u-s.u)<.3)){setHint({text:'这一物距已经记录过了，换一个位置，再调清光屏。',tone:'warn'});return}
    const samples=[...s.samples,{u:s.u,v:s.screen}].sort((a,b)=>a.u-b.u)
    patch({samples});setHint({text:`已保存这组清晰成像数据。图中已标出 u = v = 2f，不需要逐个尝试寻找。`,tone:'good'})
    setGraph(true)
  }
  function showEqualPosition(){
    patch({u:20,screen:20,touched:true});setGraph(true)
    setHint({text:'物距和像距都是 20 cm，即二倍焦距；因此焦距是 10 cm。',tone:'good'});speak('007')
    encourage('看到了吗？物距＝像距＝二倍焦距！')
  }
  function glasses(kind:'near'|'far'){
    const index=stages.findIndex(st=>st.id===`${kind}-glasses`),next=selectStep(s,index)
    if(timer.current!==null)clearTimeout(timer.current);spoken.current.clear();setState({...next,glasses:kind});setAnswers([]);setErrors([]);setHint({text:'眼镜已经装好，移动光屏重新找到清晰像。',tone:'tip'});speak(kind==='near'?'035':'037')
  }
  function water(n:number){
    if(s.motion||s.water===n)return
    const target=stages.findIndex(st=>st.id===(n===1?'water-in':'water-out'))
    const base=target===s.step?s:{...selectStep(s,target),waterInstalled:true,water:s.water,u:s.u,screen:s.screen}
    setState({...base,touched:true,motion:n===1?'water-in':'water-out'});setAnswers([]);setErrors([])
    spoken.current.clear()
  }
  function burn(){
    if(s.motion||s.burned>=3)return
    patch({lit:true,motion:'burn'})
  }
  function cause(index:number){
    patch({causes:[...new Set([...s.causes,index])],u:[15,8,11][index],screen:[30,24,38][index],height:index===0?-6:0})
    setHint({text:['焰心偏离主光轴，像可能移出光屏。先调整三个中心的高度。','物体在焦点以内，成虚像，光屏无法承接。','清晰像可能超出光具座范围。'][index],tone:'tip'});speak(['048','049','050'][index]);if(s.causes.length===2)encourage('排查完整了，三种原因都看过啦！')
  }
  function reset(){setState(fresh());setAnswers([]);setErrors([]);setHint(null);setGraph(false);setDialog(null);spoken.current.clear();speak(['001','002'],true)}
  const guidance=hint?.text||(s.phase==='answer'?question?.hint:s.phase==='done'?'已完成本题，可以继续下一步，也可以切换题型。':stage.task)||stage.task
  const installGlasses=stage.id.includes('glasses'),waterStage=stage.id.startsWith('water-')
  const canControls=s.phase==='adjust'&&!s.motion,screenEnabled=canControls&&(!installGlasses||s.glasses!=='none')&&(!waterStage||s.waterInstalled)&&!(stage.id==='graph'&&!s.touched)
  return <div className={`app curriculum-app${summary?' summary-view':''}`}>
    <header className="topbar"><div className="brand"><span className="brand-mark"><Focus size={19}/></span><strong>物理实验室</strong><span className="course-title">凸透镜 · 教材探究</span></div><div className="header-actions"><span className="save-note">{saved?'进度已保存':'进度暂未保存'}</span><button className="icon-button" aria-label="返回实验室首页" title="返回实验室首页" onClick={onHome}><House size={18}/></button><button className="icon-button" aria-label="查看步骤提示" title="查看步骤提示" onClick={()=>setDialog('help')}><HelpCircle size={18}/></button><button className="icon-button" aria-label="重新开始实验" title="重新开始实验" onClick={()=>setDialog('reset')}><RotateCcw size={18}/></button></div></header>
    <main className="main"><nav className="step-nav" aria-label="实验题型"><button className="step-select" aria-label="选择实验题型" onClick={openTopics}><span>当前题型</span><strong title={`题型 ${currentGroup+1} · ${types[currentGroup].name}`}><span className="current-topic-number">题型 {currentGroup+1}</span><span className="current-topic-name">{types[currentGroup].name}</span></strong><ChevronDown size={16}/></button><span className="progress-caption">题型 {currentGroup+1} / {groups.length}<span className="completion-count"> · 已完成 {s.completedSteps.length} / {stages.length} 小节</span></span></nav>
      <div className="question-line"><span className="type-tag">题型 {currentGroup+1}</span><h1>{s.phase==='answer'?question?.prompt||stage.task:stage.task}</h1></div>
      {summary?<><ConclusionTable/><div className="summary-actions"><button className="secondary-button" onClick={openTopics}><LayoutGrid size={16}/>回看题型</button><button className="secondary-button" onClick={()=>void downloadRecords().catch(()=>encourage('也可以直接截图保存这张规律表。'))}><ArrowDownToLine size={16}/>{nativeApp?'保存或分享规律表':'下载规律表'}</button>{!nativeApp&&<button className="secondary-button" onClick={()=>window.print()}><Printer size={16}/>打印规律表</button>}</div></>:<div className="content-grid"><div className="left-workspace">
        {stage.id==='graph'&&s.touched&&<div className="view-switch" role="tablist" aria-label="图像实验视图"><button role="tab" aria-selected={!graph} onClick={()=>setGraph(false)}>光具座</button><button role="tab" aria-selected={graph} onClick={()=>setGraph(true)}>物距—像距图像</button></div>}
        {stage.id==='graph'&&s.touched&&graph?<DistanceGraph state={s} onEqual={showEqualPosition}/>:<Bench state={s} onPlace={place} onObject={(n,t)=>move('u',n,t)} onScreen={(n,t)=>move('screen',n,t)} onHeight={(n,t)=>move('height',n,t)} onCover={n=>move('cover',n)} onMisplace={()=>{setHint({text:'还差一点点，对准圆形标记再松手。',tone:'warn'});announce('old-02')}}/>}
        <MentorPrompt guide={{...voice,close:()=>{if(timer.current!==null)clearTimeout(timer.current);timer.current=null;voice.close()}}} detail={guidance} tone={hint?.tone||'tip'}/>
      </div><div className="right-workspace"><ScreenStatus state={s}/><aside className="action-panel" aria-label="当前步骤操作"><div className="panel-index"><span>{s.phase==='done'?'本节完成':s.phase==='answer'?'观察后作答':s.phase==='observe'?'先观察结果':stage.title}</span><strong>{s.step+1} / {stages.length}</strong></div>
        {question&&<div className="phase-indicators"><span className={s.phase==='adjust'?'current':'passed'}>操作</span><span className={s.phase==='observe'?'current':s.phase==='answer'||s.phase==='done'?'passed':''}>观察</span><span className={s.phase==='answer'?'current':s.phase==='done'?'passed':''}>作答</span></div>}
        <div className="panel-content" ref={panelRef}>
          {s.phase==='done'?<><div className="step-success"><CheckCircle2 size={20}/>本节探究完成</div><p>{question?question.fields.map(f=>`${f.label}：${f.answer}`).join('；'):stage.task}</p></>:s.phase==='answer'&&question?<><div className="question-fields">{question.fields.map((f,i)=><label key={f.label}><span>{f.label}</span><select aria-label={f.label} aria-invalid={errors.includes(i)} value={answers[i]||''} onChange={e=>{setAnswers(a=>question.fields.map((_,j)=>j===i?e.target.value:a[j]||''));setErrors([])}}><option value="">请选择</option>{(f.options||[]).map(v=><option key={v}>{v}</option>)}</select></label>)}</div>{errors.length>0&&<p className="answer-feedback" role="alert">{question.hint}</p>}<button className="secondary-button" onClick={()=>{patch({phase:'adjust'});setErrors([]);setHint(null)}}><RotateCcw size={15}/>返回实验再观察</button></>:s.phase==='observe'?<><p>{stage.id==='graph'?'图中已标出物距＝像距＝2f；本实验中 u = v = 20 cm，因此 f = 10 cm。':stage.id==='causes'?'观察光屏范围与光线会聚位置，判断不能成像的原因。':'先比较光屏上的像与原光源的方向、大小、亮度和位置。'}</p><button className="secondary-button" onClick={()=>{patch({phase:'adjust'});setHint(null)}}><RotateCcw size={15}/>继续调整</button></>:<>
            <p className="action-prompt">{stage.task}</p>
            {stage.id==='setup'&&<div className="equipment-list">{['平行光源','凸透镜','光屏'].map((name,i)=><span key={name} className={s.equipment>i?'checked':''}>{s.equipment>i?<Check size={14}/>:i+1}{name}</span>)}</div>}
            {stage.id==='graph'&&!s.touched&&<button className="secondary-button" onClick={()=>{patch({u:20,screen:20,touched:true});setGraph(true);speak('006')}}><Plus size={16}/>安装蜡烛</button>}
            {stage.id==='f-source'&&<button className="secondary-button" disabled={s.source==='F'} onClick={()=>{patch({source:'F'});speak('011')}}><ArrowLeftRight size={16}/>{s.source==='F'?'F 光源已安装':'换成 F 光源'}</button>}
            {stage.height&&<Slider label="焰心高度偏移" value={s.height} min={-6} max={6} disabled={!canControls} onChange={(n,t)=>move('height',n,t)}/>}
            {stage.object&&(stage.id!=='graph'||s.touched)&&<Slider label="物距 u" value={s.u} min={stage.id==='graph'?14:5} max={35} onChange={(n,t)=>move('u',n,t)} disabled={!canControls}/>}
            {installGlasses&&<div className="mode-buttons" aria-label="选择眼镜"><button className={s.glasses==='near'?'selected':''} onClick={()=>glasses('near')}><Glasses size={15}/>近视镜</button><button className={s.glasses==='far'?'selected':''} onClick={()=>glasses('far')}><Glasses size={15}/>远视镜</button></div>}
            {waterStage&&(!s.waterInstalled?<button className="secondary-button" onClick={()=>{patch({waterInstalled:true});speak('040')}}><Plus size={16}/>安装水透镜</button>:<div className="mode-buttons" aria-label="水透镜操作"><button className={s.water===1||s.motion==='water-in'?'selected':''} disabled={!!s.motion||s.water===1} onClick={()=>water(1)}><Droplets size={15}/>{s.motion==='water-in'?'注水中…':'注水'}</button><button className={s.water===-1||s.motion==='water-out'?'selected':''} disabled={!!s.motion||s.water===-1} onClick={()=>water(-1)}><Droplets size={15}/>{s.motion==='water-out'?'抽水中…':'抽水'}</button></div>)}
            {stage.screenMove&&!s.throughLens&&<Slider label="光屏距透镜" value={s.screen} min={5} max={38} disabled={!screenEnabled} onChange={(n,t)=>move('screen',n,t)}/>}
            {stage.id==='graph'&&s.touched&&<><button className="secondary-button" onClick={showEqualPosition}><Focus size={16}/>查看物距＝像距的位置</button><button className="secondary-button" disabled={!p.focused} onClick={record}><Plus size={15}/>记录此组数据{s.samples.length>0?`（已记录 ${s.samples.length} 组）`:''}</button></>}
            {stage.id==='virtual'&&<button className="secondary-button" disabled={!scanned||s.throughLens} onClick={()=>{patch({throughLens:true});setHint({text:'从透镜另一侧看，比较像的正倒与大小。',tone:'good'});speak('old-22')}}><EyeIcon/>{s.throughLens?'正在透镜另一侧观察':'移开光屏，透过透镜观察'}</button>}
            {stage.id==='cover'&&<Slider label="透镜遮挡比例" value={s.cover} min={0} max={75} unit="%" step={5} onChange={n=>move('cover',n)}/>}
            {stage.id==='causes'&&<div className="cause-list">{['三心不同高','物体在焦点内','光具座太短'].map((text,i)=><button key={text} className={s.causes.includes(i)?'visited':''} onClick={()=>cause(i)}>{s.causes.includes(i)?<Check size={14}/>:i+1}{text}</button>)}</div>}
            {stage.id==='burn'&&<><div className="mode-buttons"><button onClick={()=>{patch({lit:false,burned:0,height:0,motion:null});setHint(null);speak('051')}}><RotateCcw size={15}/>换新蜡烛</button><button disabled={!!s.motion||s.burned>=3} onClick={burn}><FlameIcon size={15}/>{s.motion==='burn'?'燃烧中…':s.burned>=3?'观察完成':'点燃蜡烛'}</button></div><p>{s.lit?'加速观察：比较焰心与像的移动方向。':'点燃后，观察蜡烛逐渐变短的过程。'}</p></>}
            {stage.id==='swap'&&<button className="secondary-button" disabled={s.swapped} onClick={()=>{patch({swapped:true,u:15,screen:30});setHint({text:'蜡烛与光屏已在两侧互换。透镜不动，观察清晰像的大小。',tone:'good'})}}><ArrowLeftRight size={16}/>{s.swapped?'两侧位置已互换':'互换蜡烛与光屏'}</button>}
            {question&&<div className={`alignment ${isReady?'ready':''}`}>{isReady?'操作已完成，先观察结果。':hint?.text||stage.task}</div>}
          </>}
        </div>
        <div className="panel-footer"><div className="footer-navigation"><button className="back-action" aria-label="上一步" title="上一步" disabled={s.step===0} onClick={()=>jump(s.step-1)}><ArrowLeft size={16}/></button>{s.phase==='done'?<button className="primary-button guided-action" onClick={next}>进入下一步<ArrowRight size={16}/></button>:s.phase==='answer'?<button className="primary-button" disabled={!question?.fields.every((_,i)=>!!answers[i]?.trim())} onClick={submit}>确认答案<Check size={16}/></button>:question?<button className={`primary-button ${isReady||s.phase==='observe'?'guided-action':''}`} disabled={!isReady&&s.phase!=='observe'} onClick={observe}>{s.phase==='observe'?'已观察，开始答题':'确认位置，观察结果'}<ArrowRight size={16}/></button>:<button className="primary-button" disabled={!isReady} onClick={next}>进入下一步<ArrowRight size={16}/></button>}</div>{(isReady||s.phase==='done'||s.phase==='observe')&&<span className="compact-next-note"><CheckCircle2 size={13}/>可以继续下一步</span>}</div>
      </aside></div></div>}
    </main>
    {toast&&<div className="feedback-toast" role="status"><Sparkles size={17}/>{toast}</div>}
    <dialog className={`guide-dialog ${dialog==='more'?'topic-dialog':''}`} ref={dialogRef} onCancel={()=>setDialog(null)}><button className="dialog-close" aria-label="关闭弹窗" onClick={()=>setDialog(null)}><X size={18}/></button><h2>{dialog==='more'?'选择题型':dialog==='reset'?'重新开始实验？':stage.title}</h2>{dialog==='more'?<div className="topic-grid">{types.map(({name,step,steps},i)=><button key={i} aria-label={`题型 ${i+1} · ${name}`} aria-current={i===currentGroup?'true':undefined} onClick={()=>jump(step)}><span className="topic-label"><small>题型 {i+1}</small><strong>{name}</strong></span>{steps.every(n=>s.completedSteps.includes(n))&&<CheckCircle2 size={15}/>}</button>)}</div>:<><p>{dialog==='reset'?'将清空本课程的操作进度与记录表。':stage.task}</p>{dialog==='help'&&<div className="dialog-note">{guidance}</div>}<button className="primary-button" onClick={dialog==='reset'?reset:()=>setDialog(null)}>{dialog==='reset'?'确认重新开始':'继续实验'}<ArrowRight size={16}/></button></>}</dialog>
  </div>
}
function EyeIcon(){return <Eye size={15}/>}
function Slider({label,value,min,max,onChange,disabled=false,unit='cm',step=.1}:{label:string;value:number;min:number;max:number;onChange:(n:number,tolerance?:number)=>void;disabled?:boolean;unit?:string;step?:number}){
  const id=useId()
  const adjust=(direction:number)=>onChange(Math.max(min,Math.min(max,Math.round((value+direction*step)*10)/10)),0)
  return <div className="lab-slider"><label htmlFor={id} className="control-label"><span>{label}</span>{unit==='%'&&<strong>{value.toFixed(0)}%</strong>}</label><div className="slider-track"><button className="range-step" aria-label={`减小${label}`} title="微调" disabled={disabled||value<=min} onClick={()=>adjust(-1)}><Minus size={16}/></button><input id={id} className="aim-slider" type="range" aria-label={`调节${label}`} value={value} min={min} max={max} step={step} disabled={disabled} onChange={e=>onChange(Number(e.target.value))}/><button className="range-step" aria-label={`增大${label}`} title="微调" disabled={disabled||value>=max} onClick={()=>adjust(1)}><Plus size={16}/></button></div></div>
}
function DistanceGraph({state:s,onEqual}:{state:LabState;onEqual:()=>void}){
  const x=(u:number)=>58+(u-10)*16,y=(v:number)=>250-(v-5)*4.4
  const {focused}=physicsFor(s),color=focused?'#218767':'#ba692b'
  return <section className="visual-area graph-area" aria-label="物距像距关系图像">
    <div className={`graph-live-reading ${focused?'focused':'unfocused'}`} data-testid="graph-reading"><span><i/> {focused?'当前清晰成像':'光屏待对焦'}</span><strong>u {s.u.toFixed(1)} · {focused?'v':'光屏距'} {s.screen.toFixed(1)} cm</strong><button className="graph-equal-button" aria-label="回到物距像距相等的位置" title="回到物距像距相等的位置" disabled={s.phase!=='adjust'} onClick={onEqual}><Focus size={18}/></button></div>
    <svg viewBox="0 0 600 300" role="img" aria-label="物距像距实时图像，当前点随蜡烛和光屏移动，已标出物距与像距均为二倍焦距的位置">
      <rect width="600" height="300" fill="#f8fafc"/>
      {[5,10,20,30,40,50].map(v=><g key={v}><line x1="58" x2="538" y1={y(v)} y2={y(v)} stroke="#dce4eb"/><text x="46" y={y(v)+6} textAnchor="end">{v}</text></g>)}
      {[10,20,30,40].map(u=><g key={u}><line x1={x(u)} x2={x(u)} y1="52" y2="250" stroke="#dce4eb"/><text x={x(u)} y="276" textAnchor="middle">{u}</text></g>)}
      <path d="M58 45V250H546" fill="none" stroke="#718196" strokeWidth="2"/>
      <path d={`M${x(10)} ${y(10)}L${x(40)} ${y(40)}`} stroke="#a87a3b" strokeDasharray="7 6" fill="none"/>
      <text x="488" y="88">u = v</text><text x="16" y="29">v / cm</text><text x="527" y="296">u / cm</text>
      <path data-testid="distance-curve" d={Array.from({length:111},(_,i)=>{const u=12.5+i*.25;return `${i?'L':'M'}${x(u)} ${y(10*u/(u-10))}`}).join(' ')} stroke="#2875ca" strokeWidth="3" fill="none"/>
      <path d={`M58 ${y(20)}H${x(20)}V250`} stroke="#218767" strokeDasharray="5 5" fill="none"/>
      <circle data-testid="equal-distance-point" cx={x(20)} cy={y(20)} r="13" fill="#e4f5ed" stroke="#218767" strokeWidth="2"/>
      <path d={`M${x(20)+10} ${y(20)-10}L294 138H310`} fill="none" stroke="#218767" strokeWidth="1.5"/>
      <text x="316" y="133" className="graph-equal-label">物距 = 像距 = 2f</text>
      <text x="316" y="159" className="graph-equal-label">20 cm = 2f</text>
      {s.samples.map(point=><circle key={point.u} data-testid="graph-point" cx={x(point.u)} cy={y(point.v)} r="4" fill="#657e9e" stroke="white" strokeWidth="1.5"/>)}
      <path d={`M58 ${y(s.screen)}H${x(s.u)}V250`} stroke={color} strokeDasharray="4 4" fill="none" opacity=".8"/>
      <circle data-testid="graph-live-point" data-focused={focused} cx={x(s.u)} cy={y(s.screen)} r="8" fill={color} stroke="white" strokeWidth="3"/>
    </svg>
    <div className="graph-conclusion" data-testid="graph-conclusion"><strong>物距 = 像距 = 2f</strong><span>本图 20 cm ÷ 2 → 焦距 10 cm</span></div>
  </section>
}
function ConclusionTable(){
  return <section className="record-section conclusion-section" aria-label="凸透镜成像规律总表"><div className="record-header"><strong>凸透镜成像规律总表</strong><span>截图保存</span></div><div className="table-scroll"><table className="imaging-table conclusion-table"><thead><tr><th>物距</th><th>像的位置</th><th>正倒</th><th>大小</th><th>虚实</th><th>应用</th></tr></thead><tbody>{conclusionRows.map(row=><tr key={row.condition}><td><strong>{row.condition}</strong></td><td>{row.position}</td><td>{row.orientation}</td><td>{row.size}</td><td>{row.nature}</td><td>{row.application}</td></tr>)}</tbody></table></div><div className="conclusion-rules"><p>一倍焦距分虚实 · 二倍焦距分大小</p><p>成实像时：物近像远像变大，物远像近像变小。</p></div></section>
}
