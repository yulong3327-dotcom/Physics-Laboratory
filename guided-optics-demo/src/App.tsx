import { useEffect, useRef, useState } from 'react'
import { ArrowDownToLine, ArrowRight, Check, CheckCircle2, CircleHelp, Eye, Focus, LockKeyhole, Printer, RotateCcw, Sparkles, X } from 'lucide-react'
import { Bench } from './Bench'
import { downloadRecords, fresh, load, nextState, STORAGE_KEY, taskText, titles, trials, wrongCells } from './lesson'
import type { LessonState, RecordRow } from './lesson'
import { optics } from './model'

export default function App() {
  const [s, setState] = useState<LessonState>(load)
  const [dialog, setDialog] = useState<'guide' | 'reset' | null>('guide')
  const [choice, setChoice] = useState<number | null>(null)
  const [feedback, setFeedback] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [saved, setSaved] = useState(true)
  const [review, setReview] = useState(0)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const step = s.step
  const trialIndex = step - 3
  const isTrial = trialIndex >= 0 && trialIndex < 5
  const trial = trials[isTrial ? trialIndex : 0]
  const physics = optics(s.u, s.screen, step === 2, s.throughLens)
  const scanned = s.scanned[0] <= 8 && s.scanned[1] >= 34
  const canObserve = step === 2 ? physics.focused : isTrial && s.objectLocked && (trialIndex < 3 ? physics.focused : trialIndex === 3 ? scanned : s.throughLens)
  const viewing: LessonState = step >= 8 ? { ...s, step: 3 + review, phase: 'observe', u: trials[review].u, screen: review < 3 ? Number(trials[review].v) : 24, equipment: 3, objectLocked: true, throughLens: review === 4 } : s

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); setSaved(true) } catch { setSaved(false) }
  }, [s])

  useEffect(() => {
    if (dialog && !dialogRef.current?.open) dialogRef.current?.showModal()
    if (!dialog && dialogRef.current?.open) dialogRef.current.close()
  }, [dialog])

  function patch(values: Partial<LessonState>) { setState(old => ({ ...old, ...values })) }
  function next() {
    setState(nextState(s)); setChoice(null); setFeedback(''); setErrors([])
    if (step < 8) setDialog('guide')
  }
  function moveScreen(screen: number) {
    patch({ screen, scanned: [Math.min(s.scanned[0], screen), Math.max(s.scanned[1], screen)] })
  }
  function restart() {
    setState(fresh()); setReview(0); setChoice(null); setErrors([]); setFeedback(''); setDialog('guide')
  }
  function updateRow(index: number, key: keyof RecordRow, value: string) {
    patch({ records: s.records.map((row, i) => i === index ? { ...row, [key]: value } : row) }); setErrors([])
  }
  function checkAnswer() {
    if (choice !== (step === 2 ? 1 : trial.answer)) {
      setFeedback(step === 2 ? '看看最小光斑此时离透镜多少厘米。' : trialIndex === 3 ? '对比图中的出射光方向，光线有没有交会？' : trialIndex === 4 ? '看观察窗与原始烛焰，比较方向、大小，再想一想光屏能否承接。' : '对比光屏正面与原始烛焰，注意方向、大小，以及光屏能否承接。')
      return
    }
    setFeedback(''); patch({ phase: 'done' })
  }
  const actualTask = step === 0 ? ['放置蜡烛', '放置凸透镜', '放置光屏', '器材已就位'][s.equipment] : step === 1 ? '调节烛焰中心高度' : step === 2 ? '寻找最小、最亮光斑' : isTrial ? !s.objectLocked ? `将物距设为 ${trial.u} cm` : trialIndex < 3 ? '移动光屏，寻找清晰的像' : trialIndex === 3 ? '在导轨上往返移动光屏' : s.throughLens ? '透过透镜观察' : '先移动光屏，再改变观察方式' : step === 8 ? '完成五组实验记录' : '实验记录已生成'
  const taskFeedback = !isTrial ? '' : !s.objectLocked ? `目标物距 ${trial.u} cm，当前 ${s.u.toFixed(1)} cm` : trialIndex < 3 ? physics.focused ? '光屏轮廓清晰，先观察像的方向和大小。' : '继续移动光屏，观察窗会实时变化。' : trialIndex === 3 ? scanned ? '已比较近处和远处，请观察光线。' : '请将光屏分别移到 8 cm 以内、34 cm 以外。' : s.throughLens ? '透过透镜的视野已显示在下方。' : scanned ? '光屏的多处位置已比较，可以换一种观察方式。' : '请将光屏分别移到 8 cm 以内、34 cm 以外。'

  return <div className="app">
    <header className="topbar"><div className="brand"><div className="brand-mark"><Focus size={23}/></div><div><strong>物理实验室</strong><small>教材实验 · 光学</small></div></div><div className="course-title"><span className="course-label">八年级 · 几何光学</span><span className="course-divider"/><strong>凸透镜成像规律</strong></div><div className="header-actions"><span className="save-note"><CheckCircle2 size={15}/>{saved ? '进度已保存' : '暂未保存'}</span><button className="icon-button" onClick={() => setDialog('guide')} title="查看当前步骤提示" aria-label="查看当前步骤提示"><CircleHelp size={18}/></button><button className="icon-button" onClick={() => setDialog('reset')} title="重新开始实验" aria-label="重新开始实验"><RotateCcw size={18}/></button></div></header>
    <div className="workspace"><aside className="sidebar"><div className="sidebar-overline">实验路径 <span>LESSON 01</span></div><h1>凸透镜<br/>成像规律</h1><p className="sidebar-meta">探索物与像的关系</p><div className="progress-summary"><div><strong>{Math.min(step + 1, 9)}</strong><span>/ 9 步</span></div><div className="progress-track"><span style={{ width: `${Math.min(step, 9) / 9 * 100}%` }}/></div></div><nav className="step-list" aria-label="实验步骤">{titles.slice(0, 9).map((title, i) => <div className={`step-item ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`} key={title} aria-current={i === step ? 'step' : undefined}><span className="step-indicator">{i < step ? <Check size={14}/> : String(i + 1).padStart(2, '0')}</span><span>{i >= 3 && i <= 7 ? trials[i - 3].condition : title}</span>{i > step && <LockKeyhole size={12} opacity=".5"/>}</div>)}</nav><div className="sidebar-foot"><Sparkles size={15}/>观察 · 操作 · 归纳</div></aside>
    <main className="main"><div className="main-heading"><div><div className="eyebrow">实验 {String(Math.min(step + 1, 9)).padStart(2, '0')} <span>/ 09</span></div><h2>{titles[step]}</h2><p>{taskText(step)}</p></div><div className="status-pill"><span className="status-dot"/>{step === 9 ? '已完成' : '进行中'}</div></div>
      {step >= 8 && <div className="review-tabs" role="tablist" aria-label="回看实验">{trials.map((t,i) => <button role="tab" aria-selected={review === i} onClick={() => setReview(i)} key={t.u}>{t.condition}<span>u = {t.u} cm</span></button>)}</div>}
      <div className="content-grid"><Bench state={viewing} onPlace={() => { if (s.step === 0 && s.equipment < 3) patch({ equipment: s.equipment + 1, phase: s.equipment === 2 ? 'done' : 'adjust' }) }} onObject={u => patch({ u })} onScreen={moveScreen} onHeight={height => patch({ height })}/>
        <aside className="action-panel" aria-label="当前步骤操作"><div className="panel-index">{s.phase === 'answer' ? '观察判断' : s.phase === 'done' ? '本步已完成' : '当前任务'}<span>{String(Math.min(step + 1, 9)).padStart(2, '0')}</span></div>
          <h3>{s.phase === 'answer' ? step === 2 ? '读出焦距' : '说说你的发现' : actualTask}</h3>
          {step < 8 && <div className="phase-indicators"><span className={s.phase === 'adjust' ? 'current' : 'passed'}>1 操作</span><span className={s.phase === 'observe' ? 'current' : ['answer','done'].includes(s.phase) ? 'passed' : ''}>2 观察</span><span className={s.phase === 'answer' ? 'current' : s.phase === 'done' ? 'passed' : ''}>3 判断</span></div>}
          {s.phase === 'done' && step < 8 ? <><div className="step-success"><CheckCircle2 size={23}/><strong>{step < 2 ? '准备完成' : '观察正确'}</strong></div><p className="panel-description">{step === 0 ? '器材已按顺序放好，接下来让三心同高。' : step === 1 ? '烛焰、透镜和光屏中心已对齐。' : step === 2 ? '最小光斑距透镜 10 cm，即焦距 f = 10 cm。' : `${trial.condition}：${trial.nature === '不成有限远像' ? trial.nature : `${trial.orientation}、${trial.size}的${trial.nature}`}。`}</p>{isTrial && <div className="observed-reading">{trialIndex === 3 ? '不成有限远像' : `像距 ${trial.v} cm · ${trialIndex === 4 ? '物体同侧' : '透镜另一侧'}`}</div>}<button className="primary-button space-top" onClick={next}>进入下一步 <ArrowRight size={17}/></button></> : s.phase === 'answer' && step >= 2 && step < 8 ? <><p className="question-text">{step === 2 ? '光斑最小、最亮时，光屏到透镜的距离是多少？' : trial.question}</p><div className="answer-options">{(step === 2 ? ['5 cm','10 cm','20 cm'] : trial.choices).map((text, i) => <button key={text} aria-pressed={choice === i} className={choice === i ? 'selected' : ''} onClick={() => { setChoice(i); setFeedback('') }}><span>{String.fromCharCode(65 + i)}</span>{text}</button>)}</div>{feedback && <p className="answer-feedback" role="alert">{feedback}</p>}<button className="primary-button" disabled={choice === null} onClick={checkAnswer}>确认判断 <Check size={17}/></button><button className="secondary-button" onClick={() => patch({ phase: 'observe' })}><Eye size={15}/> 再观察一下</button></> : <>
            <p className="panel-description">{taskText(step)}</p>
            {step === 0 && <div className="equipment-list">{['蜡烛','凸透镜','光屏'].map((name,i) => <div key={name}><span className={s.equipment > i ? 'checked' : ''}>{s.equipment > i ? <Check size={14}/> : i + 1}</span>{name}{s.equipment === i && <small>待放置</small>}</div>)}</div>}
            {step === 1 && <><label className="control-label" htmlFor="height"><span>烛焰中心高度偏移</span><strong>{s.height.toFixed(1)} cm</strong></label><input id="height" className="aim-slider" aria-label="调节火焰高度" type="range" min="-3" max="3" step="0.5" value={s.height} onChange={e => patch({ height: Number(e.target.value) })}/><div className={`alignment ${s.height === 0 ? 'ready' : ''}`}><Focus size={17}/><span>{s.height === 0 ? '三个中心已在同一条水平线上' : '调整烛焰，让中心落在主光轴上'}</span></div><button className="primary-button" disabled={s.height !== 0} onClick={() => patch({ phase: 'done' })}>确认三心同高 <Check size={16}/></button></>}
            {isTrial && <><label className="control-label" htmlFor="object-distance"><span>物距 u</span><strong>{s.u.toFixed(1)} cm</strong></label><input id="object-distance" className="aim-slider" aria-label="调节蜡烛与透镜的距离" type="range" min="5" max="35" step="0.5" value={s.u} disabled={s.objectLocked || s.phase !== 'adjust'} onChange={e => patch({ u: Number(e.target.value) })}/>{!s.objectLocked && <button className="secondary-button" disabled={s.u !== trial.u} onClick={() => patch({ objectLocked: true, scanned: [s.screen, s.screen] })}>确认物距 <Check size={15}/></button>}</>}
            {(step === 2 || isTrial && s.objectLocked) && !s.throughLens && <><label className="control-label" htmlFor="screen-distance"><span>光屏距透镜</span><strong>{s.screen.toFixed(1)} cm</strong></label><input id="screen-distance" className="aim-slider" aria-label="调节光屏距透镜的距离" type="range" min="5" max="38" step="0.5" value={s.screen} disabled={s.phase !== 'adjust'} onChange={e => moveScreen(Number(e.target.value))}/><div className="range-labels"><span>靠近透镜</span><span>远离透镜</span></div></>}
            {(step === 2 || isTrial) && <div className={`alignment ${canObserve ? 'ready' : ''}`}><Focus size={17}/><span>{s.phase === 'observe' ? '现在先比较光屏或视野中的结果，准备好后再判断。' : step === 2 ? physics.focused ? '光斑最小、最亮，先记下光屏距离。' : '比较光斑大小，继续移动光屏。' : taskFeedback}</span></div>}
            {isTrial && trialIndex === 4 && s.objectLocked && !s.throughLens && <button className="secondary-button" disabled={!scanned} onClick={() => patch({ throughLens: true })}><Eye size={16}/> 移开光屏，透过透镜观察</button>}
            {(step === 2 || isTrial) && <button className="primary-button space-top" disabled={!canObserve} onClick={() => { if (s.phase === 'adjust') patch({ phase: 'observe' }); else { patch({ phase: 'answer' }); setChoice(null) } }}>{s.phase === 'observe' ? '已观察，开始判断' : '确认位置，观察结果'} <ArrowRight size={17}/></button>}
            {s.phase === 'observe' && <button className="secondary-button" onClick={() => patch({ phase: 'adjust' })}><RotateCcw size={14}/> 继续调整</button>}
            {step === 8 && <div className="task-detail"><CheckCircle2 size={23}/><div><strong>5 组观察已完成</strong><small>回看实验，完成下方记录</small></div></div>}
            {step === 9 && <><div className="complete-stamp"><CheckCircle2 size={26}/> 探究完成</div><button className="primary-button" onClick={downloadRecords}><ArrowDownToLine size={17}/> 下载实验表格</button><button className="secondary-button" onClick={() => window.print()}><Printer size={16}/> 打印实验记录</button></>}
          </>}
          <div className="panel-bottom"><div className="hint-heading"><span/>观察要点</div><p>{step <= 1 ? '烛焰中心、透镜光心和光屏中心应处在同一高度。' : step === 2 ? '平行光会聚到的最小光斑位置，就是焦点所在位置。' : isTrial ? '对照原始烛焰，观察像的方向、大小，以及光屏能否承接。' : '像距按距离的大小记录；虚像另外标注在物体同侧。'}</p></div>
        </aside>
      </div>
      <section className={`record-section ${step < 8 ? 'locked' : ''}`} aria-label="凸透镜成像规律记录表"><div className="record-header"><div><div className="eyebrow">EXPERIMENT RECORD</div><h3>凸透镜成像规律表</h3></div><span>{step < 8 ? '五组观察完成后填写' : step === 8 ? '待归纳' : '已完成'}</span></div><div className="table-scroll"><table className="imaging-table"><thead><tr><th>物距 u</th><th>像距 / cm</th><th>正倒</th><th>大小</th><th>虚实</th></tr></thead><tbody>{trials.map((t,i) => <tr key={t.u}><td><strong>{t.u} cm</strong><small>{t.condition}</small></td><td>{step === 9 ? <><span className="answer-text">{t.v}</span><small>{t.range}</small></> : <input disabled={step < 8} aria-invalid={errors.includes(`${i}-v`)} aria-label={`物距${t.u}厘米时的像距`} placeholder={i === 3 ? '∞ 或无限远' : '填写距离'} value={s.records[i].v} onChange={e => updateRow(i,'v',e.target.value)}/>}</td>{(['orientation','size','nature'] as const).map(key => <td key={key}>{step === 9 ? <span className="answer-text">{t[key]}</span> : <select disabled={step < 8} aria-invalid={errors.includes(`${i}-${key}`)} aria-label={`物距${t.u}厘米时的${key === 'orientation' ? '正倒' : key === 'size' ? '大小' : '虚实'}`} value={s.records[i][key]} onChange={e => updateRow(i,key,e.target.value)}><option value="">请选择</option>{(key === 'orientation' ? ['正立','倒立','—'] : key === 'size' ? ['缩小','等大','放大','—'] : ['实像','虚像','不成有限远像']).map(v => <option key={v}>{v}</option>)}</select>}</td>)}</tr>)}</tbody></table></div>{step >= 8 && <div className="record-note">像距填距离大小。虚像在物体同侧；不成有限远像时填“∞”，正倒和大小填“—”。</div>}{step === 8 && <div className="table-actions">{errors.length > 0 && <span role="alert">有 {errors.length} 处需修正，已标出对应单元格。</span>}<button className="primary-button" onClick={() => { const wrong = wrongCells(s.records); setErrors(wrong); if (!wrong.length) { patch({ step: 9, phase: 'done' }); setDialog(null) } }}>核对并完成实验 <ArrowRight size={17}/></button></div>}{step === 9 && <div className="conclusion"><CheckCircle2 size={19}/><p><strong>一倍焦距分虚实，二倍焦距分大小。</strong><br/>物体在焦点外成倒立实像；焦点内成正立放大虚像；位于焦点时不成有限远像。</p></div>}</section>
    </main></div>
    <dialog ref={dialogRef} className="guide-dialog" onCancel={() => setDialog(null)}><button className="dialog-close" onClick={() => setDialog(null)} aria-label="关闭弹窗"><X size={19}/></button><span className="dialog-icon">{dialog === 'reset' ? <RotateCcw size={24}/> : <Focus size={24}/>}</span><div className="eyebrow">{dialog === 'reset' ? '重新探究' : `步骤 ${String(Math.min(step + 1, 9)).padStart(2, '0')} / 09`}</div><h2>{dialog === 'reset' ? '重新开始实验？' : titles[step]}</h2><p>{dialog === 'reset' ? '将清空本次步骤进度和填写的表格。' : taskText(step)}</p>{dialog !== 'reset' && <div className="dialog-note">{step === 0 ? '依次放置器材，完成本步后再进入下一步。' : step === 1 ? '调节烛焰高度，让三个中心落在同一条水平线上。' : step === 2 ? '比较光屏正面的光斑，记录最小光斑对应的距离。' : isTrial ? '先调整并观察真实变化，再根据你看到的现象作出判断。' : '回看五组观察，完成成像规律的归纳。'}</div>}<button className="primary-button" onClick={dialog === 'reset' ? restart : () => setDialog(null)}>{dialog === 'reset' ? '重新开始' : step === 9 ? '查看实验结果' : '开始操作'} <ArrowRight size={17}/></button></dialog>
  </div>
}
