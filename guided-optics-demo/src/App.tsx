import { useEffect, useId, useRef, useState } from 'react'
import { ArrowDownToLine, ArrowLeft, ArrowRight, ArrowLeftRight, Check, CheckCircle2, ChevronDown, Droplets, Eye, Flame as FlameIcon, Focus, Glasses, HelpCircle, LayoutGrid, Minus, Plus, Printer, RotateCcw, Sparkles, X } from 'lucide-react'
import { Bench, ScreenStatus } from './Bench'
import { MentorPrompt } from './MentorPrompt'
import { conclusionRows, downloadRecords, fresh, groups, load, physicsFor, ready, selectStep, stages, STORAGE_KEY, wrongAnswers, type LabState } from './curriculum'
import { useVoiceGuide } from './useVoiceGuide'

type Hint={text:string;tone:'tip'|'warn'|'good'}
const examplesByType=groups.map(group=>stages.flatMap((stage,step)=>stage.group===group?[{stage,step}]:[]))
export default function App(){
  const [s,setState]=useState(load),[answers,setAnswers]=useState<string[]>([]),[errors,setErrors]=useState<number[]>([])
  const [hint,setHint]=useState<Hint|null>(null),[dialog,setDialog]=useState<'help'|'reset'|'more'|null>(null),[graph,setGraph]=useState(false),[saved,setSaved]=useState(true),[topicGroup,setTopicGroup]=useState(0),[toast,setToast]=useState('')
  const dialogRef=useRef<HTMLDialogElement>(null),panelRef=useRef<HTMLDivElement>(null),timer=useRef<number|null>(null),toastTimer=useRef<number|null>(null),spoken=useRef(new Set<string>())
  const stage=stages[s.step],voice=useVoiceGuide(stage.cue),p=physicsFor(s),isReady=ready(s),question=stage.question,scanned=s.scanned[0]<=8&&s.scanned[1]>=34
  const currentGroup=groups.indexOf(stage.group),summary=stage.id==='summary'
  useEffect(()=>{try{localStorage.setItem(STORAGE_KEY,JSON.stringify(s));setSaved(true)}catch{setSaved(false)}},[s])
  useEffect(()=>{if(dialog)dialogRef.current?.showModal();else dialogRef.current?.close()},[dialog])
  useEffect(()=>{if(panelRef.current)panelRef.current.scrollTop=0},[s.step,s.phase])
  useEffect(()=>{speak(s.phase==='done'?stage.resultCue:[stage.cue,...stage.actionCue?[stage.actionCue]:[]])},[])
  useEffect(()=>()=>{if(timer.current!==null)clearTimeout(timer.current);if(toastTimer.current!==null)clearTimeout(toastTimer.current)},[])
  function patch(values:Partial<LabState>){setState(prev=>({...prev,...values}))}
  function speak(ids:string|string[]){if(timer.current!==null)clearTimeout(timer.current);timer.current=null;voice.announce(ids)}
  function encourage(message:string){setToast(message);if(toastTimer.current!==null)clearTimeout(toastTimer.current);toastTimer.current=window.setTimeout(()=>setToast(''),2400)}
  function openTopics(){setTopicGroup(currentGroup);setDialog('more')}
  function announce(id:string,delay=0){
    if(timer.current!==null)clearTimeout(timer.current);timer.current=null
    const key=`${s.step}:${id}`;if(spoken.current.has(key))return
    const run=()=>{timer.current=null;spoken.current.add(key);voice.announce(id)}
    if(delay)timer.current=window.setTimeout(run,delay);else run()
  }
  function jump(step:number,base=s){
    if(timer.current!==null)clearTimeout(timer.current);timer.current=null;spoken.current.clear()
    const next=selectStep(base,step);setState(next);setAnswers([]);setErrors([]);setHint(null);setGraph(false);setDialog(null);setToast('')
    const target=stages[next.step];speak([target.cue,...target.actionCue?[target.actionCue]:[]])
  }
  function complete(){patch({phase:'done',completedSteps:[...new Set([...s.completedSteps,s.step])]});setHint({text:summary?'整节课完成！用这张总表回顾五种成像情况。':'观察与判断完成，可以继续下一步。',tone:'good'})}
  function next(){jump(Math.min(stages.length-1,s.step+1),stage.id==='more'?{...s,completedSteps:[...new Set([...s.completedSteps,s.step])]}:s)}
  function move(kind:'u'|'screen'|'height'|'cover',value:number){
    if(s.phase!=='adjust')return
    let adjusted=value
    if(kind==='u'&&stage.targetU&&Math.abs(value-stage.targetU)<=1.2)adjusted=stage.targetU
    if(kind==='height'&&Math.abs(value)<=.4)adjusted=0
    if(kind==='screen'&&stage.parallel&&Math.abs(value-10)<=1.2)adjusted=10
    if(kind==='screen'){
      const predicted=physicsFor({...s,screen:value}).v
      if(predicted>0&&Number.isFinite(predicted)&&Math.abs(value-predicted)<=1.1)adjusted=Math.round(predicted*10)/10
    }
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
      text=physics.focused?'像已清晰，记录这组物距与像距。':'先调清光屏，再记录一组数据；可以试试物距 15、20、30 cm。';tone=physics.focused?'good':'tip'
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
      setHint({text:stage.id==='causes'?'现在看物距 11.0 cm 的场景，光屏已到导轨远端。':stage.id==='graph'?'观察已记录的数据和 u = v 交点，再计算焦距。':'先看实验结果，比较物与像，再进入答题。',tone:'tip'})
      if(stage.id==='graph')setGraph(true)
      speak(stage.id==='water-out'?['044','045']:stage.id==='cover'?'032':stage.id==='alignment'?'old-06':'old-23')
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
    patch({samples});setHint({text:`已记录 ${samples.length} 组。${samples.some(p=>Math.abs(p.u-p.v)<.3)?'已有等距点，再比较曲线趋势。':'别忘了寻找 u = v 的等距点。'}`,tone:'good'})
    if(samples.length>=3)setGraph(true)
  }
  function glasses(kind:'near'|'far'){
    const index=stages.findIndex(st=>st.id===`${kind}-glasses`),next=selectStep(s,index)
    if(timer.current!==null)clearTimeout(timer.current);spoken.current.clear();setState({...next,glasses:kind});setAnswers([]);setErrors([]);setHint({text:'眼镜已经装好，移动光屏重新找到清晰像。',tone:'tip'});speak(kind==='near'?'035':'037')
  }
  function water(n:number){
    const target=stages.findIndex(st=>st.id===(n===1?'water-in':'water-out'))
    if(target!==s.step){if(timer.current!==null)clearTimeout(timer.current);spoken.current.clear();setState({...selectStep(s,target),waterInstalled:true,water:n,touched:true});setAnswers([]);setErrors([])}else patch({water:n,touched:true})
    setHint({text:`水透镜已${n===1?'注水，形状变鼓':'抽水，形状变扁'}，物距保持不变，重新移动光屏对焦。`,tone:'tip'});speak(n===1?'041':'043')
  }
  function cause(index:number){
    patch({causes:[...new Set([...s.causes,index])],u:[15,8,11][index],screen:[30,24,38][index],height:index===0?-6:0})
    setHint({text:['焰心偏离主光轴，像可能移出光屏。先调整三个中心的高度。','物体在焦点以内，成虚像，光屏无法承接。','清晰像可能超出光具座范围。'][index],tone:'tip'});speak(['048','049','050'][index]);if(s.causes.length===2)encourage('排查完整了，三种原因都看过啦！')
  }
  function finishCourse(){complete();encourage('恭喜完成整节实验！记住：一倍焦距分虚实，二倍焦距分大小。');speak('055')}
  function reset(){setState(fresh());setAnswers([]);setErrors([]);setHint(null);setGraph(false);setDialog(null);spoken.current.clear();speak(['001','002'])}
  const guidance=hint?.text||(s.phase==='answer'?question?.hint:s.phase==='done'?'已完成本题，可以继续下一步，也可以切换题型。':stage.task)||stage.task
  const installGlasses=stage.id.includes('glasses'),waterStage=stage.id.startsWith('water-')
  const canControls=s.phase==='adjust',screenEnabled=canControls&&(!installGlasses||s.glasses!=='none')&&(!waterStage||s.waterInstalled)&&!(stage.id==='graph'&&!s.touched)
  return <div className="app curriculum-app">
    <header className="topbar"><div className="brand"><span className="brand-mark"><Focus size={19}/></span><strong>物理实验室</strong><span className="course-title">凸透镜 · 教材探究</span></div><div className="header-actions"><span className="save-note">{saved?'进度已保存':'进度暂未保存'}</span><button className="icon-button" aria-label="更多题型" title="更多题型" onClick={()=>setDialog('more')}><LayoutGrid size={18}/></button><button className="icon-button" aria-label="查看步骤提示" title="查看步骤提示" onClick={()=>setDialog('help')}><HelpCircle size={18}/></button><button className="icon-button" aria-label="重新开始实验" title="重新开始实验" onClick={()=>setDialog('reset')}><RotateCcw size={18}/></button></div></header>
    <main className="main"><nav className="step-nav" aria-label="实验题型"><button className="step-select" aria-label="选择实验题型" onClick={openTopics}><span>当前题型</span><strong>题型 {currentGroup+1}</strong><ChevronDown size={16}/></button><span className="progress-caption">题型 {currentGroup+1} / {groups.length}<span className="completion-count"> · 已完成 {s.completedSteps.length} / {stages.length} 小节</span></span></nav>
      <div className="question-line"><span className="type-tag">题型 {currentGroup+1}</span><h1>{s.phase==='answer'?question?.prompt||stage.task:stage.task}</h1></div>
      <div className="content-grid"><div className="left-workspace">
        {stage.id==='graph'&&s.touched&&<div className="view-switch" role="tablist" aria-label="图像实验视图"><button role="tab" aria-selected={!graph} onClick={()=>setGraph(false)}>光具座</button><button role="tab" aria-selected={graph} onClick={()=>setGraph(true)}>物距—像距图像 · {s.samples.length} 点</button></div>}
        {summary?<ConclusionTable/>:stage.id==='graph'&&graph?<DistanceGraph samples={s.samples}/>:<Bench state={s} onPlace={place} onObject={n=>move('u',n)} onScreen={n=>move('screen',n)} onHeight={n=>move('height',n)} onCover={n=>move('cover',n)} onMisplace={()=>{setHint({text:'还差一点点，对准圆形标记再松手。',tone:'warn'});announce('old-02')}}/>}
        <MentorPrompt guide={{...voice,close:()=>{if(timer.current!==null)clearTimeout(timer.current);timer.current=null;voice.close()}}} detail={guidance} tone={hint?.tone||'tip'}/>
      </div><div className="right-workspace"><ScreenStatus state={s}/><aside className="action-panel" aria-label="当前步骤操作"><div className="panel-index"><span>{s.phase==='done'?'本节完成':s.phase==='answer'?'观察后作答':s.phase==='observe'?'先观察结果':stage.title}</span><strong>{s.step+1} / {stages.length}</strong></div>
        {question&&<div className="phase-indicators"><span className={s.phase==='adjust'?'current':'passed'}>操作</span><span className={s.phase==='observe'?'current':s.phase==='answer'||s.phase==='done'?'passed':''}>观察</span><span className={s.phase==='answer'?'current':s.phase==='done'?'passed':''}>作答</span></div>}
        <div className="panel-content" ref={panelRef}>
          {s.phase==='done'?<><div className="step-success"><CheckCircle2 size={20}/>{summary?'整节课程已完成':'本节探究完成'}</div><p>{summary?'一倍焦距分虚实，二倍焦距分大小。':question?question.fields.map(f=>`${f.label}：${f.answer}`).join('；'):stage.task}</p>{summary&&<><button className="primary-button" onClick={downloadRecords}><ArrowDownToLine size={16}/>下载规律表</button><button className="secondary-button" onClick={()=>window.print()}><Printer size={16}/>打印规律表</button></>}</>:summary?<><p className="action-prompt">{stage.task}</p><p>一倍焦距分虚实，二倍焦距分大小。成实像时：物近像远像变大，物远像近像变小。</p><button className="secondary-button" onClick={openTopics}><LayoutGrid size={16}/>回看题型</button></>:s.phase==='answer'&&question?<><div className="question-fields">{question.fields.map((f,i)=><label key={f.label}><span>{f.label}</span><select aria-label={f.label} aria-invalid={errors.includes(i)} value={answers[i]||''} onChange={e=>{setAnswers(a=>question.fields.map((_,j)=>j===i?e.target.value:a[j]||''));setErrors([])}}><option value="">请选择</option>{(f.options||[]).map(v=><option key={v}>{v}</option>)}</select></label>)}</div>{errors.length>0&&<p className="answer-feedback" role="alert">{question.hint}</p>}<button className="secondary-button" onClick={()=>{patch({phase:'adjust'});setErrors([]);setHint(null)}}><RotateCcw size={15}/>返回实验再观察</button></>:s.phase==='observe'?<><p>{stage.id==='graph'?'找到 u = v 直线与曲线的交点，观察它与焦距的关系。':stage.id==='causes'?'观察光屏范围与光线会聚位置，判断不能成像的原因。':'先比较光屏上的像与原光源的方向、大小、亮度和位置。'}</p><button className="secondary-button" onClick={()=>{patch({phase:'adjust'});setHint(null)}}><RotateCcw size={15}/>继续调整</button></>:<>
            <p className="action-prompt">{stage.task}</p>
            {stage.id==='setup'&&<div className="equipment-list">{['平行光源','凸透镜','光屏'].map((name,i)=><span key={name} className={s.equipment>i?'checked':''}>{s.equipment>i?<Check size={14}/>:i+1}{name}</span>)}</div>}
            {stage.id==='graph'&&!s.touched&&<button className="secondary-button" onClick={()=>{patch({touched:true});speak('006')}}><Plus size={16}/>安装蜡烛</button>}
            {stage.id==='f-source'&&<button className="secondary-button" disabled={s.source==='F'} onClick={()=>{patch({source:'F'});speak('011')}}><ArrowLeftRight size={16}/>{s.source==='F'?'F 光源已安装':'换成 F 光源'}</button>}
            {stage.height&&<Slider label="焰心高度偏移" value={s.height} min={-6} max={6} disabled={!canControls} onChange={n=>move('height',n)}/>}
            {stage.object&&(stage.id!=='graph'||s.touched)&&<Slider label="物距 u" value={s.u} min={stage.id==='graph'?14:5} max={35} onChange={n=>move('u',n)} disabled={!canControls}/>}
            {installGlasses&&<div className="mode-buttons" aria-label="选择眼镜"><button className={s.glasses==='near'?'selected':''} onClick={()=>glasses('near')}><Glasses size={15}/>近视镜</button><button className={s.glasses==='far'?'selected':''} onClick={()=>glasses('far')}><Glasses size={15}/>远视镜</button></div>}
            {waterStage&&(!s.waterInstalled?<button className="secondary-button" onClick={()=>{patch({waterInstalled:true});speak('040')}}><Plus size={16}/>安装水透镜</button>:<div className="mode-buttons" aria-label="水透镜操作"><button className={s.water===1?'selected':''} onClick={()=>water(1)}><Droplets size={15}/>注水</button><button className={s.water===-1?'selected':''} onClick={()=>water(-1)}><Droplets size={15}/>抽水</button></div>)}
            {stage.screenMove&&!s.throughLens&&<Slider label="光屏距透镜" value={s.screen} min={5} max={38} disabled={!screenEnabled} onChange={n=>move('screen',n)}/>}
            {stage.id==='graph'&&s.touched&&<><button className="secondary-button" disabled={!p.focused} onClick={record}><Plus size={15}/>记录此组数据（{s.samples.length} / 3）</button><div className="sample-list">{s.samples.map(v=><span key={v.u}>u {v.u.toFixed(1)} · v {v.v.toFixed(1)}</span>)}</div></>}
            {stage.id==='virtual'&&<button className="secondary-button" disabled={!scanned||s.throughLens} onClick={()=>{patch({throughLens:true});setHint({text:'从透镜另一侧看，比较像的正倒与大小。',tone:'good'});speak('old-22')}}><EyeIcon/>{s.throughLens?'正在透镜另一侧观察':'移开光屏，透过透镜观察'}</button>}
            {stage.id==='cover'&&<Slider label="透镜遮挡比例" value={s.cover} min={0} max={75} unit="%" step={5} onChange={n=>move('cover',n)}/>}
            {stage.id==='causes'&&<div className="cause-list">{['三心不同高','物体在焦点内','光具座太短'].map((text,i)=><button key={text} className={s.causes.includes(i)?'visited':''} onClick={()=>cause(i)}>{s.causes.includes(i)?<Check size={14}/>:i+1}{text}</button>)}</div>}
            {stage.id==='burn'&&<><div className="mode-buttons"><button onClick={()=>patch({lit:false,burned:0,height:0})}><RotateCcw size={15}/>换新蜡烛</button><button disabled={s.burned>=3} onClick={()=>{if(!s.lit)patch({lit:true});else patch({burned:Math.min(3,s.burned+1),height:Math.min(3,s.burned+1)})}}><FlameIcon size={15}/>{s.lit?'继续燃烧':'点燃蜡烛'}</button></div><p>焰心下降了，观察光屏上像的位置</p></>}
            {stage.id==='swap'&&<button className="secondary-button" disabled={s.swapped} onClick={()=>{patch({swapped:true,u:15,screen:30});setHint({text:'蜡烛与光屏已在两侧互换。透镜不动，观察清晰像的大小。',tone:'good'})}}><ArrowLeftRight size={16}/>{s.swapped?'两侧位置已互换':'互换蜡烛与光屏'}</button>}
            {stage.id==='more'&&<button className="secondary-button" onClick={openTopics}><LayoutGrid size={16}/>更多题型</button>}
            {question&&<div className={`alignment ${isReady?'ready':''}`}>{isReady?'操作已完成，先观察结果。':hint?.text||stage.task}</div>}
          </>}
        </div>
        {summary?<div className="panel-footer"><div className="footer-navigation"><button className="back-action" aria-label="上一步" title="上一步" onClick={()=>jump(s.step-1)}><ArrowLeft size={16}/></button><button className="primary-button" disabled={s.phase==='done'} onClick={finishCourse}>{s.phase==='done'?'课程已完成':'完成本课'}<Check size={16}/></button></div></div>:<div className="panel-footer"><div className="footer-navigation"><button className="back-action" aria-label="上一步" title="上一步" disabled={s.step===0} onClick={()=>jump(s.step-1)}><ArrowLeft size={16}/></button>{s.phase==='done'||stage.id==='more'?<button className="primary-button guided-action" onClick={next}>进入下一步<ArrowRight size={16}/></button>:s.phase==='answer'?<button className="primary-button" disabled={!question?.fields.every((_,i)=>!!answers[i]?.trim())} onClick={submit}>确认答案<Check size={16}/></button>:question?<button className={`primary-button ${isReady||s.phase==='observe'?'guided-action':''}`} disabled={!isReady&&s.phase!=='observe'} onClick={observe}>{s.phase==='observe'?'已观察，开始答题':'确认位置，观察结果'}<ArrowRight size={16}/></button>:<button className="primary-button" disabled={!isReady} onClick={next}>进入下一步<ArrowRight size={16}/></button>}</div>{(isReady||s.phase==='done'||s.phase==='observe')&&<span className="compact-next-note"><CheckCircle2 size={13}/>可以继续下一步</span>}</div>}
      </aside></div></div>
    </main>
    {toast&&<div className="feedback-toast" role="status"><Sparkles size={17}/>{toast}</div>}
    <dialog className={`guide-dialog ${dialog==='more'?'topic-dialog':''}`} ref={dialogRef} onCancel={()=>setDialog(null)}><button className="dialog-close" aria-label="关闭弹窗" onClick={()=>setDialog(null)}><X size={18}/></button><h2>{dialog==='more'?'选择题型':dialog==='reset'?'重新开始实验？':stage.title}</h2>{dialog==='more'?<><label className="topic-group-select"><span>题型</span><select aria-label="选择题型" value={topicGroup} onChange={e=>setTopicGroup(Number(e.target.value))}>{groups.map((_,i)=><option value={i} key={i}>题型 {i+1}</option>)}</select></label><div className="topic-grid">{(examplesByType[topicGroup]||[]).map(({stage:example,step},i)=><button key={example.id} aria-label={`例题 ${i+1}`} onClick={()=>jump(step)}><span>例题 {i+1}</span>{s.completedSteps.includes(step)&&<CheckCircle2 size={15}/>}</button>)}</div></>:<><p>{dialog==='reset'?'将清空本课程的操作进度与记录表。':stage.task}</p>{dialog==='help'&&<div className="dialog-note">{guidance}</div>}<button className="primary-button" onClick={dialog==='reset'?reset:()=>setDialog(null)}>{dialog==='reset'?'确认重新开始':'继续实验'}<ArrowRight size={16}/></button></>}</dialog>
  </div>
}
function EyeIcon(){return <Eye size={15}/>}
function Slider({label,value,min,max,onChange,disabled=false,unit='cm',step=.1}:{label:string;value:number;min:number;max:number;onChange:(n:number)=>void;disabled?:boolean;unit?:string;step?:number}){
  const id=useId()
  const adjust=(direction:number)=>onChange(Math.max(min,Math.min(max,Math.round((value+direction*step)*10)/10)))
  return <div className="lab-slider"><label htmlFor={id} className="control-label"><span>{label}</span>{unit==='%'&&<strong>{value.toFixed(0)}%</strong>}</label><div className="slider-track"><button className="range-step" aria-label={`减小${label}`} title="微调" disabled={disabled||value<=min} onClick={()=>adjust(-1)}><Minus size={16}/></button><input id={id} className="aim-slider" type="range" aria-label={`调节${label}`} value={value} min={min} max={max} step={step} disabled={disabled} onChange={e=>onChange(Number(e.target.value))}/><button className="range-step" aria-label={`增大${label}`} title="微调" disabled={disabled||value>=max} onClick={()=>adjust(1)}><Plus size={16}/></button></div></div>
}
function DistanceGraph({samples}:{samples:{u:number;v:number}[]}){
  const x=(u:number)=>65+(u-10)*12,y=(v:number)=>320-(v-10)*6.5
  return <section className="visual-area graph-area" aria-label="物距像距关系图像"><div className="visual-toolbar"><strong>物距 u — 像距 v</strong><span className="scale-label">f = u / 2（u = v 时）</span></div><svg viewBox="0 0 490 380" role="img" aria-label="实验描点图，虚线表示物距等于像距"><rect width="490" height="380" fill="#f8fafc"/>{[10,15,20,25,30,35,40,45,50].map(v=><g key={v}><line x1="65" x2="430" y1={y(v)} y2={y(v)} stroke="#dce4eb"/><text x="53" y={y(v)+4} textAnchor="end">{v}</text></g>)}{[10,15,20,25,30,35,40].map(u=><g key={u}><line x1={x(u)} x2={x(u)} y1="55" y2="320" stroke="#dce4eb"/><text x={x(u)} y="340" textAnchor="middle">{u}</text></g>)}<path d="M65 50V320H435" fill="none" stroke="#718196" strokeWidth="2"/><path d={`M${x(10)} ${y(10)}L${x(40)} ${y(40)}`} stroke="#c28c48" strokeDasharray="6 5" fill="none"/><text x="400" y="110" fill="#aa7838">u = v</text><text x="12" y="30">v / cm</text><text x="415" y="365">u / cm</text>{samples.length>=3&&<path data-testid="distance-curve" d={Array.from({length:111},(_,i)=>{const u=12.5+i*.25;return `${i?'L':'M'}${x(u)} ${y(10*u/(u-10))}`}).join(' ')} stroke="#2875ca" strokeWidth="2.5" fill="none"/>}{samples.map(point=><g key={point.u}><circle data-testid="graph-point" cx={x(point.u)} cy={y(point.v)} r="6" fill="#2d9b72" stroke="white" strokeWidth="2"/><text x={x(point.u)+8} y={y(point.v)-10}>({point.u.toFixed(1)}, {point.v.toFixed(1)})</text></g>)}</svg><div className="graph-caption">已记录 {samples.length} 组 · 蓝线：薄透镜关系曲线 · 虚线：u = v</div></section>
}
function ConclusionTable(){
  return <section className="record-section conclusion-section" aria-label="凸透镜成像规律总表"><div className="record-header"><strong>凸透镜成像规律总表</strong><span>本课结论</span></div><div className="table-scroll"><table className="imaging-table conclusion-table"><thead><tr><th>物距</th><th>像的位置</th><th>正倒</th><th>大小</th><th>虚实</th><th>应用</th></tr></thead><tbody>{conclusionRows.map(row=><tr key={row.condition}><td><strong>{row.condition}</strong></td><td>{row.position}</td><td>{row.orientation}</td><td>{row.size}</td><td>{row.nature}</td><td>{row.application}</td></tr>)}</tbody></table></div><p className="conclusion-rule">一倍焦距分虚实 · 二倍焦距分大小</p></section>
}
