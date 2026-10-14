import { useEffect, useRef, useState } from 'react'
import { ArrowDownToLine, ArrowRight, Check, CheckCircle2, Eye, Focus, HelpCircle, Printer, RotateCcw, X } from 'lucide-react'
import { Bench, ScreenStatus } from './Bench'
import { downloadRecords, fresh, load, nextState, stepQuestions, stepTypes, STORAGE_KEY, taskText, titles, trials, wrongCells } from './lesson'
import type { LessonState, RecordRow } from './lesson'
import { optics } from './model'

type Hint = { text: string; tone: 'tip' | 'warn' | 'good' }
const alignmentChoices = ['三者中心大致处于同一高度', '只需要让蜡烛和光屏靠得更近', '让透镜高于烛焰']

export default function App() {
  const [s, setState] = useState<LessonState>(load)
  const [dialog, setDialog] = useState<'reset' | 'help' | null>(null)
  const [choice, setChoice] = useState<number | null>(null)
  const [feedback, setFeedback] = useState('')
  const [hint, setHint] = useState<Hint | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [saved, setSaved] = useState(true)
  const [review, setReview] = useState(0)
  const [recordView, setRecordView] = useState<'table' | 'bench'>('table')
  const dialogRef = useRef<HTMLDialogElement>(null)
  const step = s.step
  const trialIndex = step - 3
  const isTrial = trialIndex >= 0 && trialIndex < 5
  const trial = trials[isTrial ? trialIndex : 0]
  const physics = optics(s.u, s.screen, step === 2, s.throughLens)
  const scanned = s.scanned[0] <= 8 && s.scanned[1] >= 34
  const canObserve = step === 1 ? s.height === 0 : step === 2 ? physics.focused : isTrial && s.objectLocked && (trialIndex < 3 ? physics.focused : trialIndex === 3 ? scanned : s.throughLens)
  const viewing: LessonState = step >= 8 ? { ...s, step: 3 + review, phase: 'observe', u: trials[review].u, screen: review < 3 ? Number(trials[review].v) : 24, equipment: 3, objectLocked: true, throughLens: review === 4 } : s

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); setSaved(true) } catch { setSaved(false) }
  }, [s])
  useEffect(() => {
    if (dialog && !dialogRef.current?.open) dialogRef.current?.showModal()
    if (!dialog && dialogRef.current?.open) dialogRef.current.close()
  }, [dialog])

  function patch(values: Partial<LessonState>) { setState(old => ({ ...old, ...values })) }
  function showHint(text: string, tone: Hint['tone'] = 'tip') { setHint({ text, tone }) }
  function next() {
    setState(nextState(s)); setChoice(null); setFeedback(''); setErrors([]); setHint(null)
    if (step === 7) setRecordView('table')
  }
  function moveObject(u: number) {
    patch({ u })
    if (Math.abs(u - trial.u) <= .5) showHint('物距已到目标刻度。固定蜡烛后，观察光屏上的变化。', 'good')
    else showHint(u < trial.u ? '蜡烛离透镜太近，沿导轨向左移动。' : '蜡烛离透镜太远，沿导轨向右移动。', 'warn')
  }
  function moveScreen(screen: number) {
    patch({ screen, scanned: [Math.min(s.scanned[0], screen), Math.max(s.scanned[1], screen)] })
    if (step === 2 || isTrial && trialIndex < 3) {
      const target = step === 2 ? 10 : Number(trial.v)
      showHint(Math.abs(screen - target) < .6 ? step === 2 ? '光斑已经最小、最亮。先读出距离，再做判断。' : '像的边缘已经清晰。先比较正倒和大小，再作答。' : screen < target ? '光屏还靠透镜太近，向右缓慢移动，留意画面是否变清晰。' : '光屏离透镜太远，向左缓慢移动，比较画面的清晰度。', Math.abs(screen - target) < .6 ? 'good' : 'warn')
    } else if (isTrial) {
      const low = Math.min(s.scanned[0], screen), high = Math.max(s.scanned[1], screen)
      showHint(low > 8 ? '先把光屏移到靠近透镜的一端，再观察有没有清晰的像。' : high < 34 ? '再把光屏移到远离透镜的一端，比较两处现象。' : trialIndex === 4 ? '两端都试过了。光屏接不到像，试着移开光屏透过透镜观察。' : '两端都试过了。观察折射光线是否在有限距离处交会。', low <= 8 && high >= 34 ? 'good' : 'tip')
    }
  }
  function moveHeight(height: number) {
    patch({ height })
    showHint(height === 0 ? '烛焰中心、透镜光心与光屏中心同高。现在观察光轴。' : height < 0 ? '烛焰中心还偏高，向下微调至主光轴。' : '烛焰中心还偏低，向上微调至主光轴。', height === 0 ? 'good' : 'warn')
  }
  function restart() {
    setState(fresh()); setReview(0); setChoice(null); setErrors([]); setFeedback(''); setHint(null); setDialog(null)
  }
  function updateRow(index: number, key: keyof RecordRow, value: string) {
    patch({ records: s.records.map((row, i) => i === index ? { ...row, [key]: value } : row) }); setErrors([])
  }
  function checkAnswer() {
    const answer = step === 1 ? 0 : step === 2 ? 1 : trial.answer
    if (choice !== answer) {
      const message = step === 1 ? '再看实验台上的主光轴：要让像落在光屏中央，三个中心应如何排列？' : step === 2 ? '看最小光斑对应的刻度，读的是透镜到光屏的距离。' : trialIndex === 3 ? '光屏两端都没有清晰像，再观察出射光线是否交会。' : trialIndex === 4 ? '光屏接不到像；换到透镜右侧观察，比较方向和大小。' : '回看光屏正面，再与原始烛焰比较方向、大小和能否承接。'
      setFeedback(message); showHint(message, 'warn'); return
    }
    setFeedback(''); showHint('判断正确。可以进入下一步。', 'good'); patch({ phase: 'done' })
  }
  function checkRecords() {
    const wrong = wrongCells(s.records); setErrors(wrong)
    if (wrong.length) { showHint(`还有 ${wrong.length} 个单元格需要修正。先回看对应物距下的光屏现象。`, 'warn'); return }
    patch({ step: 9, phase: 'done' }); showHint('记录核对完成，成像规律已经整理好。', 'good')
  }
  const taskFeedback = !isTrial ? '' : !s.objectLocked ? `目标物距 ${trial.u} cm，当前 ${s.u.toFixed(1)} cm` : trialIndex < 3 ? physics.focused ? '光屏轮廓清晰。现在比较像的方向与大小。' : '移动光屏，观察像的轮廓何时最清晰。' : trialIndex === 3 ? scanned ? '已比较近处和远处，观察光线是否交会。' : '分别检查光屏靠近与远离透镜时的画面。' : s.throughLens ? '透过透镜观察，再与原始烛焰比较。' : scanned ? '光屏各处都试过了，换一种观察方式。' : '先在导轨两端移动光屏，检查能否承接像。'
  const guidance = hint?.text || (step === 0 ? `先将${['蜡烛', '凸透镜', '光屏'][Math.min(s.equipment, 2)]}拖到虚线位置。` : s.phase === 'answer' ? '根据刚才看到的结果作答；不确定可以再观察。' : step === 1 ? '对照主光轴，调整烛焰中心高度。' : step === 2 ? '比较光斑大小，找到最小、最亮的位置。' : isTrial ? taskFeedback : '逐行回看现象，再填写实验记录。')
  const choices = step === 1 ? alignmentChoices : step === 2 ? ['5 cm', '10 cm', '20 cm'] : trial.choices

  return <div className="app">
    <header className="topbar"><div className="brand"><span className="brand-mark"><Focus size={19}/></span><strong>物理实验室</strong><span className="course-title">凸透镜成像规律</span></div><div className="header-actions"><span className="save-note">{saved ? '进度已保存' : '暂未保存'}</span><button className="icon-button" onClick={() => setDialog('help')} title="查看步骤提示" aria-label="查看步骤提示"><HelpCircle size={18}/></button><button className="icon-button" onClick={() => setDialog('reset')} title="重新开始实验" aria-label="重新开始实验"><RotateCcw size={18}/></button></div></header>
    <main className="main">
      <nav className="step-nav" aria-label="实验步骤"><span className="progress-caption">{String(Math.min(step + 1, 9)).padStart(2, '0')} / 09</span>{titles.slice(0, 9).map((title, i) => <span className={`step-tick ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`} key={title} title={title} aria-current={i === step ? 'step' : undefined}>{i < step ? <Check size={12}/> : i + 1}</span>)}<strong>{titles[step]}</strong></nav>
      <div className="question-line"><span className="type-tag">{stepTypes[step] || '准备实验'}</span><h1>{step === 0 ? '按顺序摆放蜡烛、凸透镜与光屏。' : stepQuestions[step]}</h1></div>
      <div className="content-grid">
        <div className="left-workspace">
          {step >= 8 && <div className="view-switch" role="tablist" aria-label="实验工作区"><button role="tab" aria-selected={recordView === 'table'} onClick={() => setRecordView('table')}>记录表</button><button role="tab" aria-selected={recordView === 'bench'} onClick={() => setRecordView('bench')}>回看光路</button></div>}
          {(step < 8 || recordView === 'bench') ? <><Bench state={viewing} onPlace={() => { if (step === 0 && s.equipment < 3) { patch({ equipment: s.equipment + 1, phase: s.equipment === 2 ? 'done' : 'adjust' }); showHint(s.equipment === 2 ? '三件器材已就位。下一步调整三心同高。' : `已放好${['蜡烛', '凸透镜'][s.equipment]}，继续放置下一件。`, 'good') } }} onMisplace={() => showHint('还没放到圆形目标处。沿导轨拖到虚线器材位置后松手。', 'warn')} onObject={moveObject} onScreen={moveScreen} onHeight={moveHeight}/>{step >= 8 && <div className="review-tabs" role="tablist" aria-label="回看实验">{trials.map((t, i) => <button role="tab" aria-selected={review === i} onClick={() => setReview(i)} key={t.u}>{t.condition}</button>)}</div>}</> : <RecordTable step={step} records={s.records} errors={errors} updateRow={updateRow} checkRecords={checkRecords}/>}
          <div className={`guidance ${hint?.tone || 'tip'}`} role="status"><span className="guidance-icon"><HelpCircle size={16}/></span><span>{guidance}</span>{hint && <button onClick={() => setHint(null)} aria-label="关闭提示" title="关闭提示"><X size={15}/></button>}</div>
        </div>
        <div className="right-workspace"><ScreenStatus state={viewing}/><aside className="action-panel" aria-label="当前步骤操作"><div className="panel-index"><span>{s.phase === 'answer' ? '观察后判断' : s.phase === 'done' ? '本步已完成' : s.phase === 'observe' ? '先观察结果' : '当前操作'}</span><strong>{String(Math.min(step + 1, 9)).padStart(2, '0')}</strong></div>
          {step < 8 && <div className="phase-indicators"><span className={s.phase === 'adjust' ? 'current' : 'passed'}>操作</span><span className={s.phase === 'observe' ? 'current' : s.phase === 'answer' || s.phase === 'done' ? 'passed' : ''}>观察</span><span className={s.phase === 'answer' ? 'current' : s.phase === 'done' ? 'passed' : ''}>判断</span></div>}
          {s.phase === 'done' && step < 8 ? <div className="panel-content"><div className="step-success"><CheckCircle2 size={19}/><strong>{step === 0 ? '器材已就位' : '本题完成'}</strong></div><p>{step === 0 ? '接下来调整三心同高。' : step === 1 ? '三个中心在同一高度，便于让像落在光屏中央。' : step === 2 ? '最小光斑距透镜 10 cm，焦距 f = 10 cm。' : `${trial.condition}：${trial.nature === '不成有限远像' ? trial.nature : `${trial.orientation}、${trial.size}的${trial.nature}`}。`}</p><button className="primary-button" onClick={next}>进入下一步 <ArrowRight size={16}/></button></div> : s.phase === 'answer' && step < 8 ? <div className="panel-content"><p className="action-prompt">{stepQuestions[step]}</p><div className="answer-options">{choices.map((text, i) => <button key={text} aria-pressed={choice === i} className={choice === i ? 'selected' : ''} onClick={() => { setChoice(i); setFeedback('') }}><span>{String.fromCharCode(65 + i)}</span>{text}</button>)}</div>{feedback && <p className="answer-feedback" role="alert">{feedback}</p>}<button className="primary-button" disabled={choice === null} onClick={checkAnswer}>确认判断 <Check size={16}/></button><button className="secondary-button" onClick={() => { patch({ phase: 'observe' }); setFeedback('') }}><Eye size={15}/> 再观察一下</button></div> : <div className="panel-content"><p className="action-prompt">{s.phase === 'observe' ? '先看实验结果，再决定答案。' : taskText(step)}</p>
            {step === 0 && <div className="equipment-list">{['蜡烛', '凸透镜', '光屏'].map((name, i) => <span className={s.equipment > i ? 'checked' : ''} key={name}>{s.equipment > i ? <Check size={13}/> : i + 1} {name}</span>)}</div>}
            {step === 1 && <><label className="control-label" htmlFor="height">烛焰中心偏移 <strong>{s.height.toFixed(1)} cm</strong></label><input id="height" className="aim-slider" aria-label="调节火焰高度" type="range" min="-3" max="3" step="0.5" value={s.height} disabled={s.phase !== 'adjust'} onChange={e => moveHeight(Number(e.target.value))}/><div className={`alignment ${s.height === 0 ? 'ready' : ''}`}>{s.height === 0 ? '三个中心已对齐' : '让烛焰中心落在主光轴上'}</div></>}
            {isTrial && <><label className="control-label" htmlFor="object-distance">物距 u <strong>{s.u.toFixed(1)} cm</strong></label><input id="object-distance" className="aim-slider" aria-label="调节蜡烛与透镜的距离" type="range" min="5" max="35" step="0.5" value={s.u} disabled={s.objectLocked || s.phase !== 'adjust'} onChange={e => moveObject(Number(e.target.value))}/>{!s.objectLocked && <button className="secondary-button" disabled={s.u !== trial.u} onClick={() => { patch({ objectLocked: true, scanned: [s.screen, s.screen] }); showHint('物距已固定。移动光屏观察画面如何变化。', 'good') }}>确认物距 <Check size={15}/></button>}</>}
            {(step === 2 || isTrial && s.objectLocked) && !s.throughLens && <><label className="control-label" htmlFor="screen-distance">光屏距透镜 <strong>{s.screen.toFixed(1)} cm</strong></label><input id="screen-distance" className="aim-slider" aria-label="调节光屏距透镜的距离" type="range" min="5" max="38" step="0.5" value={s.screen} disabled={s.phase !== 'adjust'} onChange={e => moveScreen(Number(e.target.value))}/><div className="range-labels"><span>靠近透镜</span><span>远离透镜</span></div></>}
            {(step === 2 || isTrial) && <div className={`alignment ${canObserve ? 'ready' : ''}`}>{s.phase === 'observe' ? '看光屏或观察窗中的结果，再开始判断。' : step === 2 ? physics.focused ? '光斑最小、最亮。' : '比较光斑大小，继续移动。' : taskFeedback}</div>}
            {isTrial && trialIndex === 4 && s.objectLocked && !s.throughLens && <button className="secondary-button" disabled={!scanned} onClick={() => { patch({ throughLens: true }); showHint('现在看透镜右侧的视野：像是正立还是倒立？', 'good') }}><Eye size={15}/> 移开光屏，透过透镜观察</button>}
            {step === 1 || step === 2 || isTrial ? <><button className="primary-button" disabled={!canObserve} onClick={() => { if (s.phase === 'adjust') { patch({ phase: 'observe' }); showHint('先观察左侧光路和右上角光屏状态，再进入判断。', 'tip') } else { patch({ phase: 'answer' }); setChoice(null); setHint(null) } }}>{s.phase === 'observe' ? '已观察，开始判断' : '确认位置，观察结果'} <ArrowRight size={16}/></button>{s.phase === 'observe' && <button className="secondary-button" onClick={() => patch({ phase: 'adjust' })}><RotateCcw size={15}/> 继续调整</button>}</> : null}
            {step === 8 && <><p>选择一行物距，对照光路填写像距、正倒、大小和虚实。</p>{recordView === 'bench' && <button className="primary-button" onClick={() => setRecordView('table')}>返回记录表 <ArrowRight size={16}/></button>}</>}
            {step === 9 && <><div className="step-success"><CheckCircle2 size={20}/> 探究完成</div><button className="primary-button" onClick={downloadRecords}><ArrowDownToLine size={16}/> 下载实验表格</button><button className="secondary-button" onClick={() => window.print()}><Printer size={16}/> 打印实验记录</button></>}
          </div>}
        </aside></div>
      </div>
    </main>
    <dialog ref={dialogRef} className="guide-dialog" onCancel={() => setDialog(null)}><button className="dialog-close" onClick={() => setDialog(null)} aria-label="关闭弹窗"><X size={18}/></button><h2>{dialog === 'reset' ? '重新开始实验？' : titles[step]}</h2><p>{dialog === 'reset' ? '将清空当前步骤进度和填写的记录表。' : taskText(step)}</p>{dialog === 'help' && <div className="dialog-note">{guidance}</div>}<button className="primary-button" onClick={dialog === 'reset' ? restart : () => setDialog(null)}>{dialog === 'reset' ? '确认重新开始' : '继续实验'} <ArrowRight size={16}/></button></dialog>
  </div>
}

function RecordTable({ step, records, errors, updateRow, checkRecords }: { step: number; records: RecordRow[]; errors: string[]; updateRow: (i: number, key: keyof RecordRow, value: string) => void; checkRecords: () => void }) {
  return <section className="record-section" aria-label="凸透镜成像规律记录表"><div className="record-header"><strong>凸透镜成像规律表</strong><span>{step === 8 ? '待归纳' : '已完成'}</span></div><div className="table-scroll"><table className="imaging-table"><thead><tr><th>物距 u</th><th>像距/cm</th><th>正倒</th><th>大小</th><th>虚实</th></tr></thead><tbody>{trials.map((t, i) => <tr key={t.u}><td><strong>{t.u} cm</strong><small>{t.condition}</small></td><td>{step === 9 ? <><span>{t.v}</span><small>{t.range}</small></> : <input aria-invalid={errors.includes(`${i}-v`)} aria-label={`物距${t.u}厘米时的像距`} placeholder={i === 3 ? '∞' : '像距'} value={records[i].v} onChange={e => updateRow(i, 'v', e.target.value)}/>}</td>{(['orientation', 'size', 'nature'] as const).map(key => <td key={key}>{step === 9 ? t[key] : <select aria-invalid={errors.includes(`${i}-${key}`)} aria-label={`物距${t.u}厘米时的${key === 'orientation' ? '正倒' : key === 'size' ? '大小' : '虚实'}`} value={records[i][key]} onChange={e => updateRow(i, key, e.target.value)}><option value="">请选择</option>{(key === 'orientation' ? ['正立', '倒立', '—'] : key === 'size' ? ['缩小', '等大', '放大', '—'] : ['实像', '虚像', '不成有限远像']).map(v => <option key={v}>{v}</option>)}</select>}</td>)}</tr>)}</tbody></table></div><div className="record-foot"><span>{errors.length ? <span role="alert">有 {errors.length} 处待修正，已标出单元格。</span> : step === 8 ? '像距填距离大小；焦点处填 ∞。' : '一倍焦距分虚实，二倍焦距分大小。'}</span>{step === 8 && <button className="primary-button" onClick={checkRecords}>核对并完成实验 <ArrowRight size={16}/></button>}</div></section>
}
