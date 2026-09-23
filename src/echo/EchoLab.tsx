import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, BookOpen, Check, ChevronRight, CircleHelp, Download, FileText, FlaskConical, FolderOpen, Home, Library, Pause, Play, Plus, Radio, RotateCcw, Save, ScanText, Trash2, X } from 'lucide-react'
import { analyzeEcho, echoTemplates, solveEcho } from './engine'
import { EchoScene, numberText } from './EchoScene'
import { echoExamples } from './examples'
import { echoCorpus } from './corpus'
import { ECHO_AI_MODEL, requestEchoAssistance } from './ai'
import { questionOnly, splitEchoQuestions, splitEchoScenes } from './input'
import { ConnectionSettingsButton } from '../components/ConnectionSettings'
import { downloadEcho, ECHO_DRAFT_KEY, mergeSamples, parseProject, parseSamples } from './project'
import type { EchoModelId, EchoParameter, EchoProject, EchoSample } from './types'
import '../styles/echo.css'

const labels: Record<EchoParameter, [string, string]> = { soundSpeed: ['声音传播速度', 'm/s'], sourceSpeed: ['声源运动速度', 'm/s'], targetSpeed: ['反射目标速度', 'm/s'], echoTime: ['回声往返时间', 's'], initialDistance: ['发声时初始距离', 'm'], finalSpeed: ['减速后的速度', 'm/s'], trainLength: ['列车 / 车身长度', 'm'], tunnelLength: ['隧道 / 大桥长度', 'm'], passTime: ['完全通过的时间', 's'], sourceTravel: ['回声期间物体路程', 'm'], carriageLength: ['单节车厢长度', 'm'] }
const blank: EchoProject = { kind: 'echo-lab', schemaVersion: 1, text: echoExamples[0].text, modelId: null, overrides: {}, samples: [] }
function restore(): { project: EchoProject; error: string } {
  try { const value = localStorage.getItem(ECHO_DRAFT_KEY); return { project: value ? parseProject(JSON.parse(value)) : blank, error: '' } }
  catch { return { project: blank, error: '已有草稿无法读取，已打开教学示例。可以重新导入保存的工程。' } }
}

export function EchoLab({ onBack }: { onBack: () => void }) {
  const [initial] = useState(restore)
  const [project, setProject] = useState(initial.project)
  const [input, setInput] = useState(initial.project.text)
  const [notice, setNotice] = useState(initial.error)
  const [saveStatus, setSaveStatus] = useState('本地草稿')
  const [tab, setTab] = useState<'problem' | 'library'>('problem')
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(6)
  const [training, setTraining] = useState(false)
  const [sampleTitle, setSampleTitle] = useState('')
  const [sampleKeywords, setSampleKeywords] = useState('')
  const [sampleModel, setSampleModel] = useState<EchoModelId>('approaching')
  const [sampleSearch, setSampleSearch] = useState('')
  const [parseMode, setParseMode] = useState<'deepseek' | 'local'>('deepseek')
  const [aiBusy, setAIBusy] = useState(false)
  const [parseStatus, setParseStatus] = useState(initial.project.assistance ? 'DeepSeek 解析已恢复' : '本地规则预览')
  const requestRef = useRef<AbortController | null>(null)
  const questions = useMemo(() => splitEchoQuestions(input), [input])
  const localScenes = useMemo(() => splitEchoScenes(project.text), [project.text])
  const file = useRef<HTMLInputElement>(null)
  const importKind = useRef<'project' | 'samples'>('project')
  const localAnalysis = useMemo(() => analyzeEcho(questionOnly(project.text), project.samples), [project.text, project.samples])
  const aiScene = project.assistance?.scenarios[project.sceneIndex || 0]
  const analysis = useMemo(() => aiScene ? { ...localAnalysis, modelId: aiScene.modelId, quantities: aiScene.parameters, warnings: aiScene.warnings } : localAnalysis, [localAnalysis, aiScene])
  const modelId = project.modelId ?? analysis.modelId
  const template = echoTemplates.find(m => m.id === modelId)
  const params = useMemo(() => ({ ...Object.fromEntries(Object.entries(analysis.quantities).map(([k, q]) => [k, q!.value])), ...project.overrides }), [analysis.quantities, project.overrides])
  const solution = useMemo(() => modelId ? solveEcho(modelId, params) : { result: null, missing: [], errors: [] }, [modelId, params])
  const result = solution.result
  const dirty = input !== project.text
  useEffect(() => () => requestRef.current?.abort(), [])
  useEffect(() => { requestRef.current?.abort(); setAIBusy(false); if (aiBusy) { setParseStatus('题目已修改，请重新生成'); setNotice('已取消旧题目的模型请求，请生成修改后的题目。') } }, [input])
  useEffect(() => { try { localStorage.setItem(ECHO_DRAFT_KEY, JSON.stringify(project)); setSaveStatus('已保存到本机') } catch { setSaveStatus('保存失败，请导出工程') } }, [project])
  useEffect(() => { setPlaying(false); setTime(0) }, [result])
  useEffect(() => {
    if (!playing || !result) return
    let frame = 0, previous = 0
    const tick = (stamp: number) => {
      const delta = previous ? Math.min(.1, (stamp - previous) / 1000) : 0; previous = stamp
      setTime(value => Math.min(result.echoTime, value + delta * result.echoTime / duration))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame)
  }, [playing, result, duration])
  useEffect(() => { if (result && time >= result.echoTime) setPlaying(false) }, [time, result])
  const generate = async () => {
    if (!input.trim()) { setNotice('请先输入一道题目。'); return }
    if (questions.length > 1) { setNotice(`检测到 ${questions.length} 道题，请先从下方选择一题。`); return }
    requestRef.current?.abort()
    const controller = new AbortController(); requestRef.current = controller
    setProject(p => ({ ...p, text: input, modelId: null, overrides: {}, assistance: undefined, sceneIndex: 0 })); setPlaying(false); setTime(0)
    if (parseMode === 'local') { setParseStatus('本地规则解析'); setNotice('已使用本地规则生成模型。'); return }
    setAIBusy(true); setParseStatus('DeepSeek 正在解析'); setNotice('正在调用 deepseek-v4-pro-zy 整理题意与已知条件…')
    try {
      const assistance = await requestEchoAssistance(input, controller.signal)
      if (controller.signal.aborted || requestRef.current !== controller) return
      setProject(p => ({ ...p, assistance, sceneIndex: 0 })); setParseStatus(`DeepSeek · ${(assistance.elapsedMs / 1000).toFixed(1)} s`); setNotice(`已识别 ${assistance.scenarios.length} 个物理情境，数值由本地求解器计算。`)
    } catch (e) {
      if (controller.signal.aborted || requestRef.current !== controller) return
      setParseStatus('已回退本地规则'); setNotice(`${e instanceof Error ? e.message : '模型解析失败'} 已自动使用本地规则。`)
    } finally { if (requestRef.current === controller) setAIBusy(false) }
  }
  const loadSample = (sample: Pick<EchoSample, 'id' | 'text'>) => { requestRef.current?.abort(); setAIBusy(false); setInput(sample.text); setProject(p => ({ ...p, text: sample.text, modelId: null, overrides: {}, assistance: undefined, sceneIndex: 0 })); setParseStatus('本地规则预览'); setNotice(sample.id.startsWith('demo-') ? '已载入自编教学示例，点击生成模型可使用 DeepSeek 解析。' : '已载入题干，本地规则预览已就绪；点击生成模型使用所选解析方式。'); setTab('problem'); setTime(0); setPlaying(false) }
  const setParam = (key: EchoParameter, value: string) => setProject(p => { const overrides = { ...p.overrides }; if (value.trim() === '') delete overrides[key]; else if (Number.isFinite(Number(value))) overrides[key] = Number(value); return { ...p, overrides } })
  const openImport = (kind: 'project' | 'samples') => { importKind.current = kind; file.current?.click() }
  const exportProject = () => {
    downloadEcho('回声测距实验.json', JSON.stringify({ ...project, modelId, engineVersion: '1.0', extractedParameters: analysis.quantities, resolvedParameters: params, matching: analysis.candidates, simulation: result }, null, 2))
    if (dirty) setNotice('已导出当前生成的模型；输入框中的新题目尚未生成，请生成后再导出新版。')
  }
  const addSample = () => {
    if (!sampleTitle.trim() || !project.text.trim()) { setNotice('请填写样本名称并生成题目。'); return }
    const newSample: EchoSample = { id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, title: sampleTitle.trim(), text: project.text, modelId: sampleModel, keywords: sampleKeywords.split(/[，,、\n]/).map(k => k.trim()).filter(Boolean) }
    try { const samples = mergeSamples(project.samples, parseSamples([newSample])); setProject(p => ({ ...p, samples })); setTraining(false); setNotice('已收录到本地样本库，新题匹配会参考这个样本。') } catch (e) { setNotice((e as Error).message) }
  }
  const fieldList = [...new Set<EchoParameter>([...(template?.fields || []), ...Object.keys(params) as EchoParameter[], ...(analysis.extensions.some(e => /隧道|列车|大桥|通行/.test(e)) ? ['trainLength', 'tunnelLength', 'passTime'] as EchoParameter[] : [])])]
  const samples = [...echoExamples, ...project.samples].filter(s => `${s.title} ${s.text}`.includes(sampleSearch))
  return <div className="echo-lab">
    <header className="echo-header"><div className="echo-brand"><span className="echo-brand-mark"><Radio size={24} /></span><div><strong>回声测距实验室</strong><small>ECHO DISTANCE LAB</small></div></div><nav aria-label="实验室"><button onClick={onBack}><Home size={14} />工具首页</button><button aria-current="page"><Radio size={14} />回声测距</button></nav><span className="echo-local"><i />DeepSeek / 本地双模式</span></header>
    <div className="echo-topline"><div><span className="echo-breadcrumb">物理实验室</span><ChevronRight size={13} /><strong>声音的传播与测距</strong></div><div className="echo-file-actions"><ConnectionSettingsButton /><button onClick={() => openImport('project')}><FolderOpen size={15} />导入工程</button><button onClick={exportProject}><Download size={15} />导出模型</button></div></div>
    {notice && <div className="echo-notice" role="status"><span>{notice}</span><button aria-label="关闭提示" onClick={() => setNotice('')}><X size={14} /></button></div>}
    <div className="echo-workspace">
      <aside className="echo-input-panel"><div className="echo-panel-tabs"><button aria-pressed={tab === 'problem'} onClick={() => setTab('problem')}><FileText size={15} />题目建模</button><button aria-pressed={tab === 'library'} onClick={() => setTab('library')}><Library size={15} />模型与样本</button></div>
        {tab === 'problem' ? <div className="echo-panel-content"><div className="echo-section-label"><span>01</span><h2>输入一道题目</h2><small>自动提取已知条件</small></div><label className="echo-field-label" htmlFor="echo-problem">题目内容</label><textarea id="echo-problem" className="echo-problem" value={input} onChange={e => setInput(e.target.value)} maxLength={20000} placeholder="粘贴回声测距题目，包含数字、单位与运动方向…" /><div className="echo-input-note"><span>{input.length.toLocaleString()} / 20,000</span><button onClick={() => { setInput(''); setNotice('') }}>清空输入</button></div><label className="echo-parser-mode">解析方式<select aria-label="解析方式" value={parseMode} onChange={e => { requestRef.current?.abort(); setAIBusy(false); setParseMode(e.target.value as 'deepseek' | 'local'); if (e.target.value === 'local') { setProject(p => ({ ...p, assistance: undefined, sceneIndex: 0, modelId: null, overrides: {} })); setParseStatus('本地规则解析') } }}><option value="deepseek">DeepSeek 优先 · 失败回退本地</option><option value="local">仅本地规则 · 无需联网</option></select></label><button disabled={aiBusy} className="echo-primary echo-generate" onClick={() => void generate()}><ScanText size={17} />{aiBusy ? '正在解析…' : '生成仿真模型'}<ArrowRight size={16} /></button>{aiBusy && <button className="echo-reset-params" onClick={() => { requestRef.current?.abort(); setAIBusy(false); setParseStatus('本地规则预览'); setNotice('已取消模型请求，保留本地规则结果。') }}>取消解析</button>}<p className="echo-parser-status" data-testid="echo-parser-status">{parseStatus}</p>{questions.length > 1 && <label className="echo-parser-mode">批量题目<select aria-label="选择批量题目" value="" onChange={e => { const q = questions[Number(e.target.value)]; if (q) loadSample({ id: 'pasted', text: q.text }) }}><option value="">检测到 {questions.length} 道题，选择一题</option>{questions.map((q, i) => <option key={i} value={i}>{q.title}</option>)}</select></label>}{dirty && <p className="echo-warning">题目已修改，请重新生成模型。</p>}
          <div className="echo-example-picker"><BookOpen size={15} /><select aria-label="载入回声示例" value="" onChange={e => { const sample = echoExamples.find(s => s.id === e.target.value); if (sample) loadSample(sample) }}><option value="">试试完整教学示例</option>{echoExamples.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></div>
          <div className="echo-example-picker"><BookOpen size={15} /><select aria-label="载入真实例题" value="" onChange={e => { const q = echoCorpus.find(s => s.id === e.target.value); if (q) loadSample(q) }}><option value="">你提供的 17 道真实例题</option>{echoCorpus.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></div>{localScenes.length > 0 && !project.assistance && <div className="echo-case-buttons">{localScenes.map((c, i) => <button key={i} onClick={() => loadSample({ id: `scene-${i}`, text: c.text })}>{c.title}</button>)}</div>}{project.assistance && <label className="echo-parser-mode">物理情境<select aria-label="选择物理情境" value={project.sceneIndex || 0} onChange={e => setProject(p => ({ ...p, sceneIndex: Number(e.target.value), modelId: null, overrides: {} }))}>{project.assistance.scenarios.map((s, i) => <option key={i} value={i}>{s.title}</option>)}</select></label>}<div className="echo-section-label"><span>02</span><h2>模型匹配</h2></div><div className="echo-match-card"><div><span className="echo-mini-icon"><Radio size={18} /></span><strong>{template?.name || '暂未匹配到模型'}</strong></div><p>{template?.description || '请描述发声对象、反射对象、运动方向和回声条件。'}</p><div className="echo-tags">{analysis.keywords.slice(0, 9).map(k => <span key={k}>{k}</span>)}</div>{project.modelId && <small>当前模型由你手动指定。</small>}</div>
          <details className="echo-details"><summary>查看本地规则匹配依据</summary>{analysis.candidates.slice(0, 4).map(c => <div className="echo-candidate" key={c.modelId}><b>{echoTemplates.find(m => m.id === c.modelId)?.name}</b><span>匹配分 {numberText(c.score)}</span><p>{c.evidence.join('；')}</p></div>)}<p>匹配分用于排序，不代表准确率。</p></details>
          <label className="echo-field-label" htmlFor="echo-model">调整模型</label><select id="echo-model" disabled={aiBusy} value={modelId || ''} onChange={e => setProject(p => ({ ...p, modelId: e.target.value as EchoModelId, overrides: {} }))}><option value="" disabled>选择模型</option>{echoTemplates.map(m => <option key={m.id} value={m.id}>{m.name}{m.supported ? '' : ' · 待扩展'}</option>)}</select>
          {analysis.warnings.map((warning, i) => <p className="echo-warning" key={i}>{warning}</p>)}
          <button className="echo-save-sample" onClick={() => { setSampleTitle(''); setSampleKeywords(analysis.keywords.slice(0, 8).join('，')); setSampleModel(modelId || 'approaching'); setTraining(true) }} disabled={!project.text.trim() || dirty || aiBusy}><Plus size={15} />将这道题收录为训练样本</button>
        </div> : <div className="echo-panel-content"><div className="echo-library-heading"><h2>模型库</h2><span>{echoTemplates.filter(m => m.supported).length} 个可计算模型</span></div><p className="echo-help">选择示例观察完整流程，或导入你提供的题目与模型标注，扩展本地匹配。</p><div className="echo-model-list">{echoTemplates.map(m => <button key={m.id} onClick={() => { setProject(p => ({ ...p, modelId: m.id, overrides: {} })); setTab('problem') }}><span>{m.name}<small>{m.supported ? m.formula : '已建分类 · 求解器待扩展'}</small></span><ChevronRight size={14} /></button>)}</div><div className="echo-library-heading"><h2>题目样本</h2><span>{project.samples.length} 条自有样本</span></div><div className="echo-library-actions"><button onClick={() => openImport('samples')}><FolderOpen size={14} />导入样本</button><button onClick={() => downloadEcho('回声训练样本.json', JSON.stringify(project.samples.length ? project.samples : [echoExamples[0]], null, 2))}><Download size={14} />{project.samples.length ? '导出样本' : '下载样本模板'}</button></div><input className="echo-search" aria-label="搜索回声样本" placeholder="搜索例题…" value={sampleSearch} onChange={e => setSampleSearch(e.target.value)} /><div className="echo-sample-list">{samples.map(s => <div key={s.id}><button onClick={() => loadSample(s)}><span>{s.id.startsWith('demo-') ? '教学示例' : '自有样本'}</span><strong>{s.title}</strong><small>{echoTemplates.find(m => m.id === s.modelId)?.name}</small></button>{project.samples.some(item => item.id === s.id) && <button aria-label={`删除样本${s.title}`} onClick={() => setProject(p => ({ ...p, samples: p.samples.filter(item => item.id !== s.id) }))}><Trash2 size={14} /></button>}</div>)}</div><p className="echo-help">收录“题目 + 正确模型 + 关键词”。样本保存在当前浏览器，可导出备份。新增物理规律需扩展模型求解器。</p></div>}
      </aside>
      <main className="echo-main"><div className="echo-main-heading"><div><span className="echo-overline">SIMULATION WORKSPACE</span><h1>{template?.name || '从一道题，开始一次实验'}</h1></div><span className="echo-status-pill"><i />{result ? '模型已就绪' : template?.supported === false ? '模型待扩展' : '等待完整条件'}</span></div>
        <section className="echo-stage"><div className="echo-stage-title"><span><FlaskConical size={15} />传播过程</span><div><span><i className="echo-legend-source" />运动物体</span><span><i className="echo-legend-wave" />声波</span></div></div><EchoScene result={result} time={time} modelId={modelId} train={/列车|火车|高铁|动车/.test(project.text)} /><div className="echo-playback"><button className="echo-play" aria-label={playing ? '暂停仿真' : '播放仿真'} disabled={!result || dirty || aiBusy} onClick={() => { if (result && time >= result.echoTime) setTime(0); setPlaying(!playing) }}>{playing ? <Pause size={17} /> : <Play size={17} fill="currentColor" />}</button><button aria-label="重置仿真" disabled={!result} onClick={() => { setPlaying(false); setTime(0) }}><RotateCcw size={17} /></button><input type="range" aria-label="仿真时间" min="0" max={result?.echoTime || 1} step={result ? result.echoTime / 1000 : .001} value={time} disabled={!result} onChange={e => { setPlaying(false); setTime(Number(e.target.value)) }} /><span className="echo-time">{numberText(time)} / {result ? numberText(result.echoTime) : '—'} s</span><select aria-label="演示播放时长" value={duration} onChange={e => setDuration(Number(e.target.value))}><option value="12">慢速演示</option><option value="6">正常演示</option><option value="3">快速演示</option></select></div><div className="echo-events">{[['发出声音', 0], ['到达反射面', result?.reflectionTime], ['接收到回声', result?.echoTime]].map(([label, value], i) => <button key={String(label)} disabled={!result} onClick={() => { setPlaying(false); setTime(Number(value || 0)) }}><span>{i + 1}</span><div>{label}<small>{result ? `${numberText(Number(value))} s` : '—'}</small></div></button>)}</div></section>
        <div className="echo-readouts" data-testid="echo-readouts">{[['发声时距离', result?.initialDistance, 'm'], ['接收时距离', result?.finalDistance, 'm'], ['物体行驶路程', result?.sourceTravel, 'm'], ['声音传播路程', result?.soundTravel, 'm']].map(([label, value, unit]) => <div key={String(label)}><span>{label}</span><strong>{typeof value === 'number' ? numberText(value) : '—'}<small>{unit}</small></strong></div>)}</div>
        <section className="echo-explanation"><div className="echo-section-label"><span>03</span><h2>理解这个模型</h2></div>{template && <div className="echo-equation">{template.formula}</div>}{result ? <ol>{result.steps.map((step, i) => <li key={i}>{step}</li>)}</ol> : <p className="echo-help">{template?.supported === false ? '已经识别出专用题型。此类题需要额外的过程或图示条件，当前版本暂未提供数值仿真。可先收录完整题目供下一步扩展。' : '补齐右侧的已知条件，模型会自动计算。可以给出往返时间，或给出初始距离来反求时间。'}</p>}{result?.extras.map((extra, i) => <div className="echo-extra" key={i}><span>{extra.label}<small>{extra.formula}</small></span><strong>{numberText(extra.value)} {extra.unit}</strong></div>)}{analysis.extensions.length > 0 && <details className="echo-details"><summary>题目还涉及的过程</summary>{analysis.extensions.map((item, i) => <p key={i}>{item}</p>)}</details>}</section>
      </main>
      <aside className="echo-params-panel"><div className="echo-params-heading"><h2>模型参数</h2><span>统一使用国际单位</span></div><p className="echo-help">题目中的数值会自动填入。修改参数即可观察结果变化。</p>{fieldList.map(key => <label className="echo-param" key={key}><span>{labels[key][0]}{solution.missing.includes(key) && <em>待补全</em>}</span><div><input disabled={aiBusy} aria-label={labels[key][0]} type="number" step="any" value={params[key] ?? ''} placeholder="未提供" onChange={e => setParam(key, e.target.value)} /><small>{labels[key][1]}</small></div><small className="echo-param-source" title={analysis.quantities[key]?.source}>{key in project.overrides ? '手动设置' : analysis.quantities[key] ? `${aiScene ? 'DeepSeek 提取' : '题目提取'} · ${analysis.quantities[key]!.source}` : '题目未提供此条件'}</small></label>)}{Object.keys(project.overrides).length > 0 && <button className="echo-reset-params" onClick={() => setProject(p => ({ ...p, overrides: {} }))}><RotateCcw size={13} />恢复题目提取值</button>}{solution.errors.map((error, i) => <p role="alert" className="echo-warning" key={i}>{error}</p>)}{solution.missing.length > 0 && <p className="echo-warning">还需提供：{solution.missing.map(k => labels[k][0]).join('、')}。{solution.missing.includes('echoTime') && solution.missing.includes('initialDistance') ? '往返时间与初始距离可选填其一。' : ''}</p>}
        <div className="echo-model-notes"><CircleHelp size={17} /><h3>实验约定</h3><p>声音沿直线传播，反射时间忽略。声速相对于传播介质保持不变。</p><p>运动方向以所选模型为准，速度通常填大小。图中物体外观仅作示意。</p></div><div className="echo-local-note"><Check size={16} /><span>{aiScene ? <>DeepSeek 整理题意<br />本地公式求解与仿真</> : <>本地规则独立可用<br />无需联网或配置 SK</>}</span></div>
      </aside>
    </div>
    <footer className="echo-footer"><span><i />回声测距 · {aiScene ? ECHO_AI_MODEL : '本地规则'}</span><span>{echoTemplates.filter(m => m.supported).length} 个求解模型 / {project.samples.length} 条自有样本</span><span><Save size={12} />{saveStatus}</span></footer>
    <input ref={file} hidden aria-label="导入回声文件" type="file" accept=".json,application/json" onChange={async e => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; try { if (f.size > 2 * 1024 * 1024) throw new Error('文件不能超过 2 MB。'); const raw = JSON.parse(await f.text()); if (importKind.current === 'project') { requestRef.current?.abort(); setAIBusy(false); const next = parseProject(raw); setProject(next); setInput(next.text); setParseStatus(next.assistance ? 'DeepSeek 解析已恢复' : '本地规则解析'); setNotice('实验工程已导入。') } else { const samples = mergeSamples(project.samples, parseSamples(raw)); setProject(p => ({ ...p, samples })); setNotice(`样本库已更新，共 ${samples.length} 条自有样本。`) } } catch (e) { setNotice(e instanceof Error ? e.message : '文件读取失败') } }} />
    {training && <div className="echo-modal-backdrop"><section role="dialog" aria-modal="true" aria-label="收录训练样本" className="echo-modal"><div><h2>收录训练样本</h2><button aria-label="关闭样本窗口" onClick={() => setTraining(false)}><X size={18} /></button></div><p>确认这道题应使用的模型，后续匹配会参考你的标注。</p><label>样本名称<input autoFocus maxLength={100} value={sampleTitle} onChange={e => setSampleTitle(e.target.value)} placeholder="例如：汽车驶向山崖 · 日照月考" /></label><label>正确模型<select value={sampleModel} onChange={e => setSampleModel(e.target.value as EchoModelId)}>{echoTemplates.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label><label>关键词 / 同义说法<textarea maxLength={1200} rows={3} value={sampleKeywords} onChange={e => setSampleKeywords(e.target.value)} placeholder="用逗号分隔，例如：开过来，驶向，前方山体" /></label><div className="echo-modal-actions"><button onClick={() => setTraining(false)}>取消</button><button className="echo-primary" onClick={addSample}><Plus size={15} />收录样本</button></div></section></div>}
  </div>
}
