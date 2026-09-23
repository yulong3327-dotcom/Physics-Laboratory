import { ConnectionSettingsButton } from './ConnectionSettings'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Check, CheckCircle2, ChevronRight, CircleAlert, Clapperboard, Download, FileText, Film, FolderOpen, Loader2, Play, Plus, RefreshCw, Save, Settings2, Sparkles, Square, Trash2, Video } from 'lucide-react'
import type { AnimationCue, BoardText, CircuitAsset, FormulaStep, KeywordHighlight, RenderJob, Shot, VideoProject, VideoSystemStatus, GenerationTask, GenerationTaskKind } from '../../server/videoTypes'
import { cleanVideoScript, createPowerLessonProject, createProjectFromScript, createProjectFromProblem, prepareVideoProject, setProjectCircuitView, setProjectSwitchPolicy, validateTeachingProject } from '../lib/videoProject'
import { migrateVideoEditorProject, needsVideoMigrationSave, videoClient } from '../lib/videoClient'
import { VIDEO_PAGE_BACKGROUND } from '../data/videoTheme'
import { FormulaEditor } from './FormulaEditor'
import { VideoCircuitActionEditor, VideoTransitionDuration } from './VideoCircuitActionEditor'
import { createReferenceEffectsProject } from '../data/referenceLesson'
import { createKnowledgeCardsProject } from '../data/knowledgeCardsLesson'
import { VideoSceneEditor } from './VideoSceneEditor'
import { VideoTaskPanel } from './VideoTaskPanel'
import { VideoShotAssistant } from './VideoShotAssistant'
import { VideoTimelinePlayer } from './VideoTimelinePlayer'
import { invalidateVideoWorkflow } from '../../server/videoWorkflow'
import { editCanvasElement, deleteCanvasElement, highlightCanvasElement } from '../lib/videoCanvasEditing'
import { reconcileVideoProjectEdit, videoEditDependencyNotice } from '../lib/videoEditDependencies'
import { mergeProjectChanges, sameProjectContent } from '../../server/videoProjectMerge'
import { loadVideoFonts } from '../lib/videoFonts'
import { getVideoStoryboardReadiness, hasTeachingVisual } from '../../server/videoStoryboardReadiness'
import { resolveVideoRole, VIDEO_ROLE_VOICES } from '../lib/videoRoles'
import { newestVideoTasks, videoTaskSubmissionNotice } from '../lib/videoTaskPresentation'
import { VideoProductionNodes } from './VideoProductionNodes'
import { VideoProjectHub } from './VideoProjectHub'
import { readVideoDraft, writeVideoDraft, videoRoute, videoProjectHash, type VideoDraft as Draft, type GenerationProgress, type VideoStage } from '../lib/videoDrafts'
import '../styles/video.css'

export interface VideoWorkbenchProps {
  onBack: () => void
  onEditCircuit?: (assetId: string, graph: unknown, project: VideoProject) => void
  initialProject?: VideoProject
}

type SpeechProvider = 'azure' | 'fish' | 'edge'
function defaultSpeechVoice(provider: SpeechProvider, speaker: VideoProject['speakers'][number]) {
  return VIDEO_ROLE_VOICES[provider][resolveVideoRole(speaker.name, speaker.id) || 'teacher']
}
const actionNames: Record<FormulaStep['action'], string> = { write: '逐项出现', substitute: '公式代入', transform: '合并变换', cancel: '约去公因子', reciprocal: '逐项取倒数', ratio: '比例化简', result: '结果与份数' }
const jobNames: Record<RenderJob['status'], string> = { queued: '等待中', running: '制作中', completed: '已完成', failed: '制作失败', cancelled: '已取消' }
function message(error: unknown) { return error instanceof Error ? error.message : '操作失败，请重试。' }
const boardKinds: Record<BoardText['kind'], string> = { keyword: '关键词', law: '定律', problem: '题干', given: '已知条件', derivation: '推导' }
const highlightColors = [{ value: '#4F80FF', name: '蓝色' }, { value: '#FF6600', name: '橙色' }, { value: '#16C863', name: '绿色' }, { value: '#FF4D4D', name: '红色' }]
async function readLocalImage(file: File, name: string, maxMB = 4): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error(`${name}支持 PNG、JPEG 或 WebP 图片。`)
  if (file.size > maxMB * 1024 * 1024) throw new Error(`${name}不能超过 ${maxMB} MB。`)
  const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error(`${name}读取失败，请重试。`)); reader.readAsDataURL(file) })
  const bitmap = new Image(); bitmap.src = data
  await bitmap.decode().catch(() => { throw new Error(`${name}无法解码，请选择有效图片。`) })
  return data
}

function CircuitSketch({ asset, preparing, error }: { asset?: CircuitAsset; preparing?: boolean; error?: string }) {
  const geometry = asset?.geometry
  if (!geometry) return <div className="video-sketch-empty"><Clapperboard size={28} /><span>{asset ? error ? '电路草图暂未就绪' : preparing ? '正在准备电路草图' : '电路草图待准备' : '公式与讲解画面'}</span></div>
  const b = geometry.bounds
  return <svg className={`video-circuit-sketch ${asset?.viewMode === 'real' ? 'real' : ''}`} role="img" aria-label={`${asset?.name}${asset?.viewMode === 'real' ? '实物图' : '电路草图'}`} viewBox={`${b.x - 36} ${b.y - 52} ${b.width + 72} ${b.height + 90}`}>
    <g fill="none" stroke="#354b50" strokeWidth={asset?.viewMode === 'real' ? 5 : 2.4} strokeLinecap={asset?.viewMode === 'real' ? 'round' : 'square'} strokeLinejoin="round">{geometry.wires.map(wire => <path key={wire.id} d={wire.path} />)}</g>
    {asset && (asset.currentFlow ?? geometry.currentFlow ?? asset.viewMode === 'real') && asset.mode !== 'symbolic' && <g className="video-current-flow" fill="none" stroke="#21a994" strokeWidth={asset.viewMode === 'real' ? 3.5 : 2.6} strokeLinecap="round">{geometry.wires.filter(wire => typeof wire.current === 'number' && Math.abs(wire.current) > 1e-9).map(wire => <path key={wire.id} data-current-wire={wire.id} data-current-direction={wire.current! < 0 ? 'reverse' : 'forward'} d={wire.path} pathLength="100" strokeDasharray="1.6 8.4" style={{ animationDirection: wire.current! < 0 ? 'reverse' : 'normal' }} />)}</g>}
    {geometry.components.map(component => <g key={component.id}>
      {component.image && <g transform={`translate(${component.x},${component.y}) rotate(${component.image.rotation})`}><image data-physical-component={component.id} href={component.image.dataUrl} x={-component.image.width / 2} y={-component.image.height / 2} width={component.image.width} height={component.image.height} /></g>}
      {component.svg && <image href={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(component.svg)}`} x={component.x - component.width / 2} y={component.y - component.height / 2} width={component.width} height={component.height} />}
      <text x={component.x} y={component.y - component.height / 2 - 12} textAnchor="middle" fill="#354b50" fontSize="14">{component.label}</text>
    </g>)}
  </svg>
}

function CueEditor({ cue, shot, project, onChange, label }: { cue: AnimationCue; shot: Shot; project: VideoProject; onChange: (cue: AnimationCue) => void; label: string }) {
  return <div className="video-cue-row">
    <label>同步旁白<select aria-label={`${label}同步旁白`} value={cue.utteranceId} onChange={event => onChange({ utteranceId: event.target.value })}>
      {shot.utteranceIds.map(id => { const line = project.utterances.find(item => item.id === id); return <option key={id} value={id}>{line?.text.slice(0, 26) || id}</option> })}
    </select></label>
    <label>关键词<input aria-label={`${label}同步关键词`} value={cue.phrase || ''} placeholder="留空即句首" onChange={event => onChange({ ...cue, phrase: event.target.value || undefined })} /></label>
    <label>第几次<input aria-label={`${label}同步词出现次数`} type="number" min="1" max="100" value={cue.occurrence ?? 1} disabled={!cue.phrase} onChange={event => onChange({ ...cue, occurrence: Math.min(100, Math.max(1, Number(event.target.value) || 1)) })} /></label>
    <label className="video-offset">偏移 / 秒<input aria-label={`${label}同步偏移`} type="number" step="0.1" min="0" max="120" value={cue.offset ?? 0} onChange={event => onChange({ ...cue, offset: Math.min(120, Math.max(0, Number(event.target.value) || 0)) })} /></label>
  </div>
}

export function VideoWorkbench({ onBack, onEditCircuit, initialProject }: VideoWorkbenchProps) {
  const [initialDraft] = useState<Draft | null>(() => initialProject ? { project: { ...migrateVideoEditorProject(initialProject).project, approvedRevision: undefined }, dirty: true, saved: true } : readVideoDraft(videoRoute().id))
  const restored = useRef(initialDraft)
  const [project, setProjectState] = useState<VideoProject | null>(restored.current?.project || null)
  const projectRef = useRef(project)
  const preparedBaseline = useRef<VideoProject>()
  const setProject = useCallback((value: VideoProject | null | ((current: VideoProject | null) => VideoProject | null)) => {
    const next = typeof value === 'function' ? value(projectRef.current) : value
    projectRef.current = next
    setProjectState(next)
  }, [])
  const [dirty, setDirty] = useState(restored.current?.dirty || false)
  const [saved, setSaved] = useState(restored.current?.saved || false)
  const [scriptChanged, setScriptChanged] = useState(restored.current?.scriptChanged || false)
  const [hub, setHub] = useState(!initialProject && !videoRoute().id)
  const [hubView, setHubView] = useState<'projects' | 'production'>(!initialProject && videoRoute().view === 'production' ? 'production' : 'projects')
  const [routeReady, setRouteReady] = useState(!!initialProject || !videoRoute().id)
  const routeStarted = useRef(false)
  const [pendingNavigation, setPendingNavigation] = useState<{ action: () => Promise<void> }>()
  const [status, setStatus] = useState<VideoSystemStatus | null>(null)
  const [jobs, setJobs] = useState<RenderJob[]>([])
  const [tasks, setTasks] = useState<GenerationTask[]>([])
  const [taskRefresh, setTaskRefresh] = useState(0)
  const [tasksWarning, setTasksWarning] = useState('')
  const [historyPreview, setHistoryPreview] = useState<{ project: VideoProject; shotId: string } | null>(null)
  const [lastAdoption, setLastAdoption] = useState<{ before: VideoProject; after: VideoProject } | null>(null)
  const [jobsWarning, setJobsWarning] = useState('')
  const [selectedId, setSelectedId] = useState(restored.current?.project.shots[0]?.id || '')
  const [tab, setTab] = useState<VideoStage>(initialProject ? 'storyboard' : videoRoute().stage)
  const [editorTab, setEditorTab] = useState<'narration' | 'board' | 'formulas' | 'actions' | 'circuit'>('narration')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(initialProject ? '已应用实验室的电路修改，请核对并保存分镜。' : restored.current?.dirty ? '已恢复浏览器中的未保存草稿。' : '')
  const [busy, setBusy] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importTitle, setImportTitle] = useState('')
  const [importMode, setImportMode] = useState<'script' | 'problem'>('script')
  const [importImage, setImportImage] = useState('')
  const problemImageInput = useRef<HTMLInputElement>(null)
  const pinInput = useRef<HTMLInputElement>(null)
  const shotEditor = useRef<HTMLElement>(null)
  const [showSystem, setShowSystem] = useState(false)
  const [generation, setGeneration] = useState<GenerationProgress>(() => restored.current?.generation?.state === 'running' ? { state: 'cancelled', kind: restored.current?.generation?.kind, message: '上次生成已中断，可以继续生成。原稿与已有内容已保留。' } : restored.current?.generation || { state: 'idle', message: '' })
  const [generationSeconds, setGenerationSeconds] = useState(0)
  const generationController = useRef<AbortController | null>(null)
  const backgroundInput = useRef<HTMLInputElement>(null)
  const geometryRequest = useRef(0)
  const [geometryBusy, setGeometryBusy] = useState(false)
  const [geometryError, setGeometryError] = useState('')
  const geometryAttempt = useRef('')
  const geometryMounted = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const workingRef = useRef(false)
  const draftFailure = useRef(false)
  const textEditSession = useRef<{ element: Element; baseline: VideoProject; raw: VideoProject } | null>(null)

  // Also migrates the active in-memory draft after a hot update, not just reload.
  useEffect(() => {
    if (!project) return
    const migration = migrateVideoEditorProject(project)
    if (!migration.changed) return
    setProject(migration.project); setDirty(true)
    setNotice('已兼容旧分镜的强调动作，台词与编辑内容已保留，请保存后重新确认。')
  }, [project, setProject])
  useEffect(() => { void loadVideoFonts().catch(error => setError(message(error))) }, [])
  useEffect(() => {
    let active = true
    void videoClient.status().then(value => { if (active) setStatus(value) }).catch(() => {})
    return () => { active = false }
  }, [])
  useEffect(() => {
    if (!project) return
    try { writeVideoDraft({ project, dirty, saved, scriptChanged, generation }); draftFailure.current = false }
    catch { if (!draftFailure.current) { draftFailure.current = true; setError('浏览器草稿空间不足，请使用“保存项目”将当前工程保存到本机服务。') } }
  }, [project, dirty, saved, scriptChanged, generation])
  useEffect(() => {
    if (!project?.id || !saved) return
    let active = true
    let timer: number | undefined
    const controller = new AbortController()
    const refresh = async () => {
      try { const result = await videoClient.jobs(project.id, { signal: controller.signal }); if (active) { setJobs(result); setJobsWarning('') } }
      catch { if (active) setJobsWarning('暂时无法更新制作进度，当前显示上次获取的状态；连接恢复后会自动刷新。') }
      finally { if (active) timer = window.setTimeout(() => void refresh(), 2500) }
    }
    void refresh()
    return () => { active = false; window.clearTimeout(timer); controller.abort() }
  }, [project?.id, saved])

  useEffect(() => { geometryMounted.current = true; return () => { geometryMounted.current = false; generationController.current?.abort() } }, [])
  useEffect(() => {
    if (generation.state !== 'running') return
    const began = Date.now()
    setGenerationSeconds(0)
    const timer = window.setInterval(() => setGenerationSeconds(Math.floor((Date.now() - began) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [generation.state])
  const run = useCallback(async (label: string, task: () => Promise<void>) => {
    if (workingRef.current) return
    workingRef.current = true; setBusy(label); setError(''); setNotice('')
    try { await task() } catch (reason) { setError(message(reason)) }
    finally { workingRef.current = false; setBusy('') }
  }, [])
  const edit = (update: (current: VideoProject) => VideoProject) => {
    const current = projectRef.current
    if (!current) return
    const proposed = update(current)
    if (proposed === current) return
    const session = textEditSession.current?.baseline.id === current.id ? textEditSession.current : null
    // Keep the input session's original anchors while the user clears/retypes
    // text. Preview and autosave use reconciled data, but typing the anchor back
    // before leaving the field restores its animation and timing.
    if (session && session.baseline.id === current.id) session.raw = mergeProjectChanges(current, proposed, session.raw).project
    const next = invalidateVideoWorkflow(current, { ...reconcileVideoProjectEdit(session?.baseline || current, session?.raw || proposed), approvedRevision: undefined })
    const dependencyNotice = videoEditDependencyNotice(current, next)
    setProject(next); setDirty(true)
    setNotice(notice => [notice.includes('恢复副本') ? notice : '', dependencyNotice || '编辑中，修改已保存在本页草稿。'].filter(Boolean).join(' '))
  }
  const shot = project?.shots.find(item => item.id === selectedId) || project?.shots[0]
  const asset = project?.circuits.find(item => item.id === shot?.circuitAssetId)
  const chapterGroups = useMemo(() => {
    const groups: { chapter: number; shots: Shot[] }[] = []
    // Chapter labels may restart across AI batches; narration order always follows shots.
    for (const item of project?.shots || []) {
      const previous = groups.at(-1)
      if (previous?.chapter === item.chapter) previous.shots.push(item)
      else groups.push({ chapter: item.chapter, shots: [item] })
    }
    return groups
  }, [project?.shots])
  const report = useMemo(() => project ? validateTeachingProject(project) : [], [project])
  const storyboardReadiness = useMemo(() => project ? getVideoStoryboardReadiness(project) : null, [project])
  const storyboardReady = storyboardReadiness?.ready === true
  const storyboardUnplanned = !project?.shots.length || (!project.shots.some(s => s.story) && storyboardReadiness?.emptyShotIds.length === project.shots.length)
  const scriptReviewed = !!project?.workflow?.scriptReview && project.workflow.scriptDraft === undefined
  const orderedTasks = useMemo(() => newestVideoTasks(tasks.filter(task => task.projectId === project?.id)), [tasks, project?.id])
  const activeTaskKinds = new Set(orderedTasks.filter(task => task.status === 'running' || task.status === 'queued').map(task => task.kind))
  const preparedTimelineTask = orderedTasks.find(task => task.kind === 'preflight' && task.status === 'completed' && task.expectedRevision === project?.revision)
  const latestTimelineTask = orderedTasks.find(task => task.kind === 'preflight' && task.status === 'completed' && task.expectedRevision === project?.revision && (!task.scope?.length || task.scope.includes(selectedId)))
  const approved = !!project && scriptReviewed && !!project.workflow?.storyboardReview && storyboardReady && !dirty && !scriptChanged && (!project.problem || (project.problem.reviewed === true && project.problem.storyboardReady === true)) && project.approvedRevision === project.revision
  const speechProvider: SpeechProvider = project?.speech?.provider || 'fish'
  const speechName = speechProvider === 'fish' ? 'Fish.audio' : speechProvider === 'edge' ? 'Edge TTS（验证配音）' : 'Azure Speech'
  const providerStatus = status?.speechProviders?.[speechProvider]
  const speechConfigured = providerStatus?.configured ?? (speechProvider === 'azure' ? !!status?.azureConfigured : speechProvider === 'fish' ? !!status?.fishConfigured : false)
  const speechMissing = speechConfigured ? [] : providerStatus?.missingConfiguration || (speechProvider === 'fish'
    ? ['FISH_TTS_BASE_URL（已有配音站点）或 FISH_API_KEY（直连）']
    : speechProvider === 'edge' ? ['Edge TTS 运行依赖（edge-tts）']
      : (status?.missingConfiguration.filter(item => /azure/i.test(item)) || ['AZURE_SPEECH_KEY', 'AZURE_SPEECH_REGION']))
  const systemMessages = status?.messages.filter(item => speechProvider === 'fish' ? !/azure|edge-tts/i.test(item) : speechProvider === 'edge' ? !/azure|fish/i.test(item) : !/fish|edge-tts/i.test(item)) || []
  const runtimeReady = speechConfigured && !!status?.runtime.python && status.runtime.manim && status.runtime.ffmpeg && status.runtime.latex
  const setSpeechProvider = (provider: SpeechProvider) => edit(current => ({
    ...current, speech: { provider, model: provider === 'fish' ? 's1' : provider, chunkLength: current.speech?.chunkLength ?? 200, pauseSeconds: current.speech?.pauseSeconds ?? 0.5 },
    speakers: current.speakers.map(speaker => ({ ...speaker, voice: defaultSpeechVoice(provider, speaker) })),
  }))
  const editSpeech = (update: Partial<NonNullable<VideoProject['speech']>>) => edit(current => ({
    ...current, speech: { provider: speechProvider, model: speechProvider === 'fish' ? 's1' : speechProvider, chunkLength: 200, pauseSeconds: 0.5, ...current.speech, ...update },
  }))
  const lessonCircuitView = useMemo(() => {
    const fallback = project?.settings.defaultCircuitView || 'schematic'
    if (!project?.circuits.length) return fallback
    const views = new Set(project.circuits.map(item => item.viewMode || fallback))
    return views.size === 1 ? [...views][0] : 'mixed'
  }, [project?.circuits, project?.settings.defaultCircuitView])
  const backgroundImage = project?.settings.backgroundImage ?? VIDEO_PAGE_BACKGROUND
  const currentJobs = jobs.filter(job => job.projectRevision === project?.revision)
  const latestVideo = !dirty && [...currentJobs].reverse().find(job => job.status === 'completed' && job.videoUrl && (tab !== 'storyboard' || job.shotIds.includes(shot?.id || '')))
  const editShot = (update: Partial<Shot>) => { if (shot) edit(current => ({ ...current, shots: current.shots.map(item => item.id === shot.id ? { ...item, ...update } : item) })) }
  const editFormula = (id: string, update: Partial<FormulaStep>) => { if (shot) editShot({ formulas: shot.formulas.map(item => item.id === id ? { ...item, ...update } : item) }) }
  const editBoard = (id: string, update: Partial<BoardText>) => { if (shot) editShot({ boardTexts: (shot.boardTexts || []).map(item => item.id === id ? { ...item, ...update } : item) }) }
  const editHighlight = (id: string, update: Partial<KeywordHighlight>) => {
    if (!shot) return
    const target = update.targetType === 'board' ? shot.boardTexts?.find(item => item.id === update.targetId) : shot.formulas.find(item => item.id === update.targetId)
    editShot({ highlights: (shot.highlights || []).map(item => item.id === id ? { ...item, ...update,
      ...(update.targetId ? { cue: target?.cue ? { ...target.cue } : { utteranceId: shot.utteranceIds[0] || '' } } : {}) } : item) })
  }
  const addHighlight = () => {
    if (!shot) return
    const board = shot.boardTexts?.find(item => item.text.trim()), formula = shot.formulas.find(item => item.latex.trim())
    if (!board && !formula) return
    const target = board || formula!
    editShot({ highlights: [...(shot.highlights || []), { id: `${shot.id}-highlight-${crypto.randomUUID().slice(0, 8)}`, targetType: board ? 'board' : 'formula', targetId: target.id, phrase: board?.text || formula!.latex, occurrence: 1, color: '#4F80FF', effect: 'box', durationSeconds: 3, cue: target.cue ? { ...target.cue } : { utteranceId: shot.utteranceIds[0] || '' } }] })
  }
  const persist = async (): Promise<VideoProject> => {
    if (!project) throw new Error('请先创建或打开项目。')
    if (saved && !dirty && projectRef.current === project) return project
    const snapshot = projectRef.current || project
    const prepared = await prepareVideoProject({ ...snapshot, updatedAt: new Date().toISOString(), approvedRevision: undefined }, { allowTimingIssues: true, baseline: preparedBaseline.current })
    preparedBaseline.current = prepared
    const result = await (saved ? videoClient.save(prepared) : videoClient.create(prepared))
    const feedback = videoClient.consumeSaveNotice(result.id)
    if (feedback) setNotice(current => current.includes(feedback) ? current : [current, feedback].filter(Boolean).join(' '))
    const live = projectRef.current
    if (live && live.id !== snapshot.id) throw new Error('先前工程已保存，当前打开的工程保持不变。')
    if (live && live !== snapshot) {
      const merged = mergeProjectChanges(snapshot, live, { ...result, id: snapshot.id }).project
      setProject({ ...merged, id: result.id, revision: result.revision, approvedRevision: undefined }); setSaved(true); setDirty(true)
      throw new Error('本次快照已保存；保存期间的新修改已保留为草稿，请核对后再次保存。')
    }
    try { writeVideoDraft({ project: result, saved: true, dirty: false, scriptChanged, generation }) } catch { /* The server receipt is authoritative; a full browser store cannot undo a successful save. */ }
    setProject(result); setSaved(true); setDirty(false)
    return result
  }
  const confirmProject = async () => {
    if (!projectRef.current || !getVideoStoryboardReadiness(projectRef.current).ready) throw new Error('请先生成有画面内容的分镜，再保存并确认。')
    const value = await persist()
    const confirmed = await videoClient.approve(value)
    const live = projectRef.current
    if (live && live.id !== value.id) {
      setNotice(current => [current, '先前工程已确认，当前打开的工程保持不变。'].filter(Boolean).join(' '))
      return
    }
    if (live && !sameProjectContent(live, value)) {
      setProject({ ...mergeProjectChanges(value, live, confirmed).project, approvedRevision: undefined })
      setDirty(true)
      setNotice(current => [current, '确认期间有新修改，草稿已保留，请保存并重新确认。'].filter(Boolean).join(' '))
      return
    }
    setProject(confirmed); setSaved(true); setDirty(false)
    setNotice(current => [current, '分镜已确认，可以开始制作。'].filter(Boolean).join(' '))
  }
  const create = async (value: VideoProject): Promise<VideoProject> => {
    geometryAttempt.current = ''; setGeometryError(''); setGeneration({ state: 'idle', message: '' }); setScriptChanged(!!value.problem && value.problem.storyboardReady !== true); setProject(value); setSelectedId(value.shots[0]?.id || ''); setDirty(true); setSaved(false); setJobs([]); setJobsWarning(''); setTab('storyboard'); setImportOpen(false); setHub(false)
    const prepared = await prepareVideoProject(value)
    preparedBaseline.current = prepared
    setProject(prepared)
    const result = await videoClient.create(prepared)
    setProject(result); setSaved(true); setDirty(false)
    const feedback = videoClient.consumeSaveNotice(result.id)
    setNotice(current => [current, feedback, getVideoStoryboardReadiness(result).ready ? '项目已创建。请先确认讲稿，再逐镜审核分镜。' : result.problem ? '题目已保存，请先生成并审核解析讲稿。' : '讲稿已保存，请核对并确认讲稿后生成分镜。'].filter(Boolean).join(' '))
    return result
  }
  const render = async (kind: RenderJob['kind'], shotIds?: string[]) => {
    if (!project || !approved) throw new Error('请先保存并确认当前分镜版本。')
    const job = await videoClient.render(project.id, kind, shotIds, project.revision)
    setJobs(current => [...current.filter(item => item.id !== job.id), job]); setTab('output')
    setNotice('制作任务已开始。可在本页查看进度，完成后预览和下载。')
  }
  const openProject = async (id: string, selectedDraft?: Draft) => {
    if (!id) return
    const draft = selectedDraft || readVideoDraft(id)
    let value: VideoProject
    try { value = await videoClient.project(id) } catch (reason) {
      if (draft && !draft.saved && (reason as { status?: number }).status === 404) value = draft.project
      else throw reason
    }
    const useDraft = draft && (draft.dirty || !draft.saved)
    if (useDraft) value = draft.project
    geometryAttempt.current = ''; setGeometryError(''); setGeneration({ state: 'idle', message: '' }); setScriptChanged(!!value.problem && value.problem.storyboardReady !== true); setProject(value); setSelectedId(value.shots[0]?.id || ''); setSaved(useDraft ? draft.saved : true); setDirty(!!useDraft || needsVideoMigrationSave(value)); setJobs([]); setTasks([]); setJobsWarning(''); setTab('script'); setHub(false); setLastAdoption(null); setHistoryPreview(null)
    setNotice(useDraft ? '已恢复此项目的浏览器草稿，保存后才会更新服务端版本。' : '已打开项目。')
  }
  const goToHub = (view: 'projects' | 'production' = 'projects') => {
    setHub(true); setHubView(view); setProject(null); setDirty(false); setSaved(false); setScriptChanged(false)
    setJobs([]); setTasks([]); setLastAdoption(null); setHistoryPreview(null); setNotice('')
    setGeneration({ state: 'idle', message: '' })
  }
  const preserveDraft = () => {
    if (!hub && projectRef.current && (dirty || !saved)) writeVideoDraft({ project: projectRef.current, dirty, saved, scriptChanged, generation })
  }
  const requestNavigation = (action: () => Promise<void>) => {
    if (workingRef.current) return
    if (!hub && project && dirty) { setPendingNavigation({ action }); return }
    void run('切换工作区', async () => { preserveDraft(); await action() })
  }
  const finishNavigation = async (save: boolean) => {
    if (!pendingNavigation) return
    await run('切换工作区', async () => {
      if (save) await persist(); else preserveDraft()
      await pendingNavigation.action(); setPendingNavigation(undefined)
    })
  }
  useEffect(() => {
    if (routeStarted.current) return
    routeStarted.current = true
    const route = videoRoute()
    if (!initialProject && route.id) void run('打开项目', async () => {
      try { await openProject(route.id!); setTab(route.stage) }
      catch (reason) { setHub(true); throw reason }
      finally { setRouteReady(true) }
    })
  }, [])
  useEffect(() => {
    if (!routeReady) return
    const hash = hub || !project ? hubView === 'production' ? '#video/production' : '#video' : videoProjectHash(project.id, tab)
    if (location.hash !== hash) history.replaceState(null, '', hash)
  }, [hub, hubView, project?.id, tab, routeReady])
  useEffect(() => {
    const navigate = () => {
      if (!location.hash.startsWith('#video')) return
      const target = videoRoute()
      if (target.id === project?.id && !hub) { setTab(target.stage); return }
      const previous = hub || !project ? hubView === 'production' ? '#video/production' : '#video' : videoProjectHash(project.id, tab)
      history.replaceState(null, '', previous)
      requestNavigation(async () => {
        if (target.id) { await openProject(target.id); setTab(target.stage) }
        else goToHub(target.view === 'production' ? 'production' : 'projects')
      })
    }
    window.addEventListener('hashchange', navigate)
    return () => window.removeEventListener('hashchange', navigate)
  })
  const startTask = async (kind: GenerationTaskKind, options: { scope?: string[]; instruction?: string; force?: boolean } = {}) => {
    await run('提交后台任务', async () => {
      const current = await persist()
      if (kind !== 'problem_script' && (!current.workflow?.scriptReview || current.workflow.scriptDraft !== undefined)) throw new Error('请先在文稿页确认当前讲稿。')
      let task = await videoClient.createTask(current, kind, options)
      setTasks(items => [task, ...items.filter(item => item.id !== task.id)])
      setTaskRefresh(value => value + 1); setGeneration({ state: 'idle', message: '' })
      if (task.status === 'waiting_retry') {
        task = await videoClient.resumeTask(task.id)
        setTasks(items => [task, ...items.filter(item => item.id !== task.id)])
        setTaskRefresh(value => value + 1)
      }
      setNotice(videoTaskSubmissionNotice(task))
    })
  }
  const generateStoryboard = async () => startTask('storyboard')
  const generateProblemScript = async () => startTask('problem_script')
  const confirmScript = async () => {
    const current = await persist()
    const confirmed = await videoClient.approveScript(current)
    const live = projectRef.current
    if (live?.id !== current.id) return
    if (!sameProjectContent(live, current)) {
      setProject(invalidateVideoWorkflow(confirmed, mergeProjectChanges(current, live, confirmed).project)); setDirty(true)
      setNotice('确认期间的新修改已保留，请核对后再次确认。'); return
    }
    setProject(confirmed); setSaved(true); setDirty(false); setScriptChanged(false)
    setNotice('讲稿已确认，可以生成分镜。'); setTaskRefresh(v => v + 1)
  }
  const applyTask = async (task: GenerationTask, acceptConflicts = false) => {
    const current = await persist()
    const next = await videoClient.applyTask(task.id, current, acceptConflicts)
    setTaskRefresh(value => value + 1)
    const live = projectRef.current
    if (live?.id !== current.id) return
    if (!sameProjectContent(live, current)) {
      setProject(invalidateVideoWorkflow(next, mergeProjectChanges(current, live, next).project)); setDirty(true)
      setNotice('结果已保存，采用期间的新编辑仍保留在草稿中。'); return
    }
    setLastAdoption({ before: current, after: next }); setProject(next); setSaved(true); setDirty(false); setScriptChanged(false)
    setSelectedId(id => next.shots.some(shot => shot.id === id) ? id : next.shots[0]?.id || '')
    setTab(task.kind === 'problem_script' ? 'script' : 'storyboard')
    setNotice(task.kind === 'problem_script' ? '解析讲稿已生成并保存，请核对后确认讲稿。' : '分镜已生成并保存，请核对画面与时机后确认分镜。')
  }
  const undoAdoption = () => {
    if (!lastAdoption || !project) return
    const merged = mergeProjectChanges(lastAdoption.after, lastAdoption.before, project)
    if (merged.conflicts.length) { setError('后续编辑与这次修改有重叠，请对照上次版本手动调整：' + merged.conflicts.join('、')); return }
    edit(() => merged.project); setLastAdoption(null); setNotice('已撤销上次采用，其他独立修改保留。')
  }
  const viewRevision = async (revision: number) => {
    if (!project) return
    const snapshot = await videoClient.revision(project.id, revision)
    setHistoryPreview({ project: snapshot, shotId: snapshot.shots[0]?.id || '' })
  }
  const importCourse = async () => {
    if (workingRef.current) return
    await run(importMode === 'problem' ? '导入题目' : '导入讲稿', async () => {
      await create(importMode === 'problem' ? createProjectFromProblem(importText, importTitle || undefined, importImage || undefined) : createProjectFromScript(importText, importTitle || undefined))
      setTab('script')
    })
  }
  useEffect(() => {
    if (!project?.id || !saved) { setTasks([]); return }
    let active = true, polling = false
    const refresh = async () => {
      if (polling) return
      polling = true
      try { const value = await videoClient.tasks(project.id); if (active) { setTasks(value); setTasksWarning(''); if (value.length) setGeneration(current => current.state === 'idle' ? current : { state: 'idle', message: '' }) } }
      catch { if (active) setTasksWarning('暂时无法读取后台进度。任务会在本机继续运行，连接恢复后自动更新。') }
      finally { polling = false }
    }
    void refresh(); const timer = setInterval(() => void refresh(), 2000)
    return () => { active = false; clearInterval(timer) }
  }, [project?.id, saved, taskRefresh])

  const prepareMissingGeometry = async (value: VideoProject) => {
    const requestId = ++geometryRequest.current
    setGeometryBusy(true); setGeometryError('')
    try {
      const prepared = await prepareVideoProject(value)
      if (!geometryMounted.current || geometryRequest.current !== requestId) return
      if (prepared.circuits.some(item => !item.geometry)) throw new Error('部分电路素材未能生成草图，请检查接线后重试。')
      setProject(current => current?.id === value.id ? { ...current, circuits: current.circuits.map(item => {
        const ready = prepared.circuits.find(candidate => candidate.id === item.id && candidate.revision === item.revision && candidate.viewMode === item.viewMode)
        return !item.geometry && ready ? { ...item, graph: ready.graph, geometry: ready.geometry } : item
      }) } : current)
    } catch (reason) { if (geometryMounted.current && geometryRequest.current === requestId) setGeometryError(message(reason)) }
    finally { if (geometryMounted.current && geometryRequest.current === requestId) setGeometryBusy(false) }
  }
  useEffect(() => {
    if (!project || geometryBusy || busy || !project.circuits.some(item => !item.geometry)) return
    const key = project.id + ':' + project.circuits.filter(item => !item.geometry).map(item => `${item.id}:${item.revision}:${item.viewMode || 'schematic'}`).join('|')
    if (geometryAttempt.current === key) return
    geometryAttempt.current = key
    void prepareMissingGeometry(project)
  }, [project, geometryBusy, busy])
  const updateLessonView = async (view: 'schematic' | 'real') => {
    if (!project) return
    ++geometryRequest.current; setGeometryError(''); setGeometryBusy(true)
    try { const prepared = await setProjectCircuitView(project, view); setProject({ ...prepared, approvedRevision: undefined }); setDirty(true); setNotice('已统一全课电路画面。保存并确认后制作更新。') }
    finally { setGeometryBusy(false) }
  }
  const updateCircuitDisplay = async (update: Pick<Partial<CircuitAsset>, 'viewMode' | 'currentFlow'>) => {
    if (!project || !asset) return
    const requestId = ++geometryRequest.current
    const targetAsset = { ...asset, ...update, revision: asset.revision + 1, geometry: undefined }
    const next = { ...project, approvedRevision: undefined, settings: { ...project.settings, ...(update.viewMode ? { defaultCircuitView: undefined } : {}) }, circuits: project.circuits.map(item => item.id === targetAsset.id ? targetAsset : item) }
    setProject(next); setDirty(true); setNotice(''); setGeometryBusy(true); setGeometryError('')
    try {
      const prepared = await prepareVideoProject(next)
      if (!geometryMounted.current || geometryRequest.current !== requestId) return
      const preparedAsset = prepared.circuits.find(item => item.id === targetAsset.id)
      setProject(current => current?.id === next.id ? { ...current, circuits: current.circuits.map(item => item.id === targetAsset.id && item.revision === targetAsset.revision ? { ...item, graph: preparedAsset?.graph ?? item.graph, geometry: preparedAsset?.geometry } : item) } : current)
    } catch (reason) { if (geometryMounted.current && geometryRequest.current === requestId) setGeometryError(message(reason)) }
    finally { if (geometryMounted.current && geometryRequest.current === requestId) setGeometryBusy(false) }
  }
  const importBackground = async (file: File) => { const data = await readLocalImage(file, '底纹图片', 2); edit(current => ({ ...current, settings: { ...current.settings, backgroundImage: data } })) }
  return <div className="video-workbench">
    <header className="video-topbar">
      <button className="video-back" aria-label="工具首页" onClick={() => requestNavigation(async () => onBack())} disabled={!!busy}><ArrowLeft size={18} /><span>工具首页</span></button><span className="video-top-divider" />
      <div className="video-brand"><Clapperboard size={22} /><div><strong>教学视频工作台</strong><small>从一份讲稿，到一堂可观看的课</small></div></div>
      <div className="video-top-actions"><button className="video-button" onClick={() => setShowSystem(value => !value)} aria-expanded={showSystem} aria-label="制作环境"><Settings2 size={16} /><span className="video-wide-label">制作环境</span><i className={`video-status-dot ${runtimeReady ? 'ready' : ''}`} /></button>
        <ConnectionSettingsButton />
        {!hub && project && <button className="video-button" onClick={() => void run('保存项目', async () => { await persist(); setNotice(current => current.includes('恢复副本') ? current : '修改已保存。') })} disabled={!!busy || (!dirty && saved)}><Save size={16} />保存项目{dirty && <span className="video-unsaved-dot" />}</button>}
      </div>
    </header>
    {showSystem && <section className="video-system-panel" aria-label="制作环境详情"><div><strong>本机制作环境</strong><button className="video-link-button" onClick={() => void run('检查环境', async () => setStatus(await videoClient.status()))}><RefreshCw size={13} />重新检查</button></div>
      <div className="video-runtime-chips">{(['python', 'manim', 'ffmpeg', 'latex'] as const).map(key => <span key={key} className={status?.runtime[key] ? 'ready' : ''}>{status?.runtime[key] ? <Check size={13} /> : <CircleAlert size={13} />}{key === 'latex' ? 'LaTeX' : key === 'ffmpeg' ? 'FFmpeg' : key === 'python' ? 'Python' : 'Manim'}</span>)}<span className={speechConfigured ? 'ready' : ''}>{speechConfigured ? <Check size={13} /> : <CircleAlert size={13} />}{speechName}</span></div>
      {speechMissing.length ? <p>待配置：{speechMissing.join('、')}。分镜编辑与保存可以正常使用。</p> : null}{systemMessages.map((text, index) => <p key={index}>{text}</p>)}{!status && <p>尚未获取制作环境，请确认本机视频服务已启动。</p>}
    </section>}
    <div className="video-messages" aria-live="polite">{error && <div className="video-message error" role="alert"><CircleAlert size={17} /><span>{error}</span><button onClick={() => setError('')} aria-label="关闭错误">×</button></div>}{notice && <div className="video-message"><CheckCircle2 size={17} /><span>{notice}</span><button onClick={() => setNotice('')} aria-label="关闭提示">×</button></div>}{busy && <div className="video-message working"><Loader2 className="video-spin" size={16} /><span>{generation.state === 'running' ? generation.message : `${busy}…`}</span>{generation.state === 'running' && <><small>{generationSeconds} 秒</small><button className="video-cancel-generation" onClick={() => generationController.current?.abort()} aria-label="取消分镜生成"><Square size={12} />取消</button></>}</div>}</div>
    {hub || !project ? <VideoProjectHub disabled={!!busy} view={hubView} onView={view => { location.hash = view === 'production' ? '#video/production' : '#video' }} onOpen={(id, draft) => requestNavigation(async () => { await openProject(id, draft) })} onCreate={mode => requestNavigation(async () => { setImportMode(mode); setImportOpen(true) })} onSample={() => requestNavigation(async () => { await create(createPowerLessonProject()) })} /> : <>
      <section className="video-project-bar"><div className="video-project-title"><input aria-label="视频项目名称" value={project.title} disabled={!!busy} onChange={event => edit(current => ({ ...current, title: event.target.value }))} /><span>{storyboardUnplanned ? '画面待规划' : `${project.shots.length} 个分镜`} · {project.utterances.length} 段旁白 · 16:9</span></div><div className="video-project-switch"><button className="video-button" disabled={!!busy} onClick={() => { location.hash = '#video/production' }}><Clapperboard size={16} />生产中心</button><button className="video-button" disabled={!!busy} onClick={() => requestNavigation(async () => { goToHub() })}><FolderOpen size={16} />项目中心</button></div></section>
      <section className="video-global-view" aria-label="全课画面设置"><label>全课电路画面<select aria-label="全课电路画面" value={lessonCircuitView} disabled={!!busy || geometryBusy} onChange={event => void run('统一电路画面', async () => updateLessonView(event.target.value as 'schematic' | 'real'))}><option value="mixed" disabled>按镜头设置</option><option value="schematic">标准电路图</option><option value="real">实物图</option></select></label><label>开关策略<select aria-label="全课开关策略" value={project.settings.switchPolicy || 'contextual'} disabled={!!busy || geometryBusy} onChange={event => void run('更新开关策略', async () => { const next = await setProjectSwitchPolicy(project, event.target.value as 'contextual' | 'preserve' | 'include'); setProject({ ...next, approvedRevision: undefined }); setDirty(true) })}><option value="contextual">按题意决定</option><option value="preserve">保留已有接法</option><option value="include" disabled={!!project.problem}>完整电路包含开关</option></select></label><span>{geometryBusy ? '正在准备电路画面…' : project.problem ? '题目电路保留原题接法；统一画面选择应用于全课。' : '统一选择应用于全课电路，单个素材可在分镜中调整。'}</span></section>
      <nav className="video-tabs" aria-label="视频工作流程"><button aria-selected={tab === 'script'} onClick={() => setTab('script')}><FileText size={16} />文稿</button><button aria-selected={tab === 'storyboard'} onClick={() => setTab('storyboard')}><Clapperboard size={16} />分镜审核<span>{storyboardUnplanned ? '待生成' : project.shots.length}</span></button><button aria-selected={tab === 'timeline'} onClick={() => setTab('timeline')}><Play size={16} />配音与时间轴</button><button aria-selected={tab === 'output'} onClick={() => setTab('output')}><Video size={16} />制作输出{jobs.some(job => job.status === 'running' || job.status === 'queued') && <i className="video-unsaved-dot" />}</button><span className={`video-approval-state ${approved ? 'approved' : ''}`}>{approved ? <CheckCircle2 size={14} /> : <span className="video-unsaved-dot" />}{approved ? '分镜已确认' : !scriptReviewed ? '讲稿待确认' : !storyboardReady ? '画面待生成' : dirty ? '修改待保存与确认' : '分镜待确认'}</span></nav>
      <section className="video-workflow-summary" aria-label="制作流程状态"><span className={scriptReviewed ? 'done' : ''}>1 讲稿确认</span><ChevronRight size={14} /><span className={approved ? 'done' : ''}>2 分镜确认</span><ChevronRight size={14} /><span className={preparedTimelineTask && !dirty ? 'done' : ''}>3 配音与时间轴</span><ChevronRight size={14} /><span className={currentJobs.some(job => job.status === 'completed') ? 'done' : ''}>4 成片验收</span>{project.workflow?.previousStoryboardRevision && <button className="video-link-button" disabled={!!busy} onClick={() => void run('读取原分镜', () => viewRevision(project.workflow!.previousStoryboardRevision!))}>查看上次分镜</button>}</section>
      {tasksWarning && <p className="video-message" role="status">{tasksWarning}</p>}
      <VideoTaskPanel key={project.id} project={project} tasks={tasks} disabled={!!busy} onRefresh={() => setTaskRefresh(value => value + 1)} onApply={applyTask} onSelectShot={id => { setSelectedId(id); setTab('storyboard') }} />
      {generation.state !== 'idle'  && <section className={`video-generation-panel ${generation.state}`} aria-label="分镜生成状态">
  <div className="video-generation-title"><strong>{generation.state === 'running' ? generation.kind === 'problem' ? '正在生成解析讲稿' : '正在生成分镜' : generation.state === 'failed' ? generation.kind === 'problem' ? '解析讲稿生成未完成' : '分镜生成未完成' : generation.state === 'cancelled' ? generation.kind === 'problem' ? '解析讲稿生成已暂停' : '分镜生成已暂停' : generation.kind === 'problem' ? '解析讲稿待审核' : '分镜草稿已就绪'}</strong>{generation.state === 'running' && <span>{generationSeconds} 秒</span>}</div>
  <p role="status">{generation.message}</p>
  {generation.state === 'running' && <><progress aria-label="分镜生成进度" /><button className="video-button" onClick={() => generationController.current?.abort()}><Square size={12} />停止当前生成</button></>}
  {(generation.state === 'failed' || generation.state === 'cancelled') && <><p className="video-field-hint">{generation.kind === 'problem' ? '题目、题图与已有讲稿已保留，重试将重新生成解析。' : '原稿与已有分镜保持原样。继续时会复用已完成且仍适用的部分。'}</p><button className="video-button" disabled={!!busy} onClick={() => void (generation.kind === 'problem' ? generateProblemScript() : generateStoryboard())}><RefreshCw size={14} />{generation.kind === 'problem' ? '重试解析讲稿' : generation.state === 'failed' ? '重试分镜生成' : '继续生成分镜'}</button></>}
</section>}
      {tab === 'script' && <main className="video-script-page">{project.problem && <section className="video-panel video-problem-panel"><div className="video-section-title"><h2>题目解析与审核</h2><span>{project.problem.reviewed ? '老师已审核' : '待老师审核'}</span></div><fieldset disabled={!!busy}><div className="video-problem-source"><label className="video-field">题干<textarea aria-label="题目题干" rows={4} value={project.problem.text} onChange={event => { setScriptChanged(true); edit(current => ({ ...current, problem: { ...current.problem!, text: event.target.value, reviewed: false, storyboardReady: false } })) }} /></label>{project.problem.imageDataUrl && <img src={project.problem.imageDataUrl} alt="原始题图" />}</div><div className="video-problem-review-fields"><label className="video-field">解题分析<textarea aria-label="题目解析" rows={5} value={project.problem.analysis || ''} placeholder="生成后逐步核对，也可以直接填写解析。" onChange={event => { setScriptChanged(true); edit(current => ({ ...current, problem: { ...current.problem!, analysis: event.target.value, reviewed: false, storyboardReady: false } })) }} /></label><label className="video-field">答案<textarea aria-label="题目答案" rows={3} value={project.problem.answer || ''} onChange={event => { setScriptChanged(true); edit(current => ({ ...current, problem: { ...current.problem!, answer: event.target.value, reviewed: false, storyboardReady: false } })) }} /></label></div><div className="video-problem-actions"><button className="video-button primary" disabled={activeTaskKinds.has("problem_script") || (!project.problem.text.trim() && !project.problem.imageDataUrl)} onClick={() => void generateProblemScript()}><Sparkles size={16} />生成解析讲稿</button><span className="video-field-hint">{scriptReviewed ? "题目解析与讲稿已确认" : "核对后，请在下方点击保存并确认讲稿"}</span></div><p className="video-field-hint">先生成或编辑解析讲稿，老师审核后再生成分镜。题图保存在本机工程中，生成解析时作为参考提交给已配置的 AI。</p></fieldset></section>}<section className="video-panel"><div className="video-section-title"><h2>原始讲稿</h2><span>{project.workflow?.scriptDraft !== undefined ? "草稿待确认" : scriptReviewed ? "讲稿已确认" : "请审核讲稿"}</span></div><textarea aria-label="原始讲稿" className="video-full-script" value={project.workflow?.scriptDraft ?? project.sourceScript} disabled={!!busy} onChange={event => { const draft = event.target.value; setScriptChanged(true); edit(current => ({ ...current, workflow: { ...current.workflow, scriptDraft: draft } })) }} /><p className="video-field-hint">修改后可立即保存草稿。确认讲稿后再生成新分镜，已有画面可继续查看。</p><div className="video-workflow-checkpoint"><p>{scriptReviewed ? "讲稿已确认。分镜生成将使用这份讲稿。" : project.problem ? "请核对题干、题图、解题分析、答案和双人讲稿。" : "请核对台词顺序、物理结论和双人角色。"}</p><button className="video-button primary" disabled={!!busy || scriptReviewed || !(project.workflow?.scriptDraft ?? project.sourceScript).trim() || (!!project.problem && (!project.problem.analysis?.trim() || !project.problem.answer?.trim()))} onClick={() => void run("保存并确认讲稿", confirmScript)}><CheckCircle2 size={16} />{scriptReviewed ? "讲稿已确认" : "保存并确认讲稿"}</button></div></section><section className="video-panel"><div className="video-section-title"><h2>格式清理结果</h2><span>保留台词与角色</span></div><pre className="video-clean-script">{project.workflow?.scriptDraft !== undefined ? cleanVideoScript(project.workflow.scriptDraft) : project.cleanedScript}</pre></section><section className="video-panel video-appearance-panel">
  <div className="video-section-title"><h2>画面底纹与标题条</h2><span>草图与成片共用</span></div>
  <div className="video-appearance-content">
    <div className="video-background-swatch" style={{ backgroundColor: project.settings.background, backgroundImage: backgroundImage ? `url("${backgroundImage}")` : undefined }}><strong>{project.title}</strong><span>知识点总标题</span></div>
    <div className="video-appearance-options">
      <p>知识点总标题使用蓝色自适应标题条与图钉。标题按 1080p 画面高 66 px、字 36 px、左右留白 32 px 的比例显示。</p><div className="video-background-actions"><button className="video-button" disabled={!!busy} onClick={() => pinInput.current?.click()}>上传标题图钉</button><button className="video-button" disabled={!!busy} onClick={() => edit(current => ({ ...current, settings: { ...current.settings, titlePinImage: undefined } }))}>恢复默认图钉</button></div><input ref={pinInput} type="file" accept="image/png,image/jpeg,image/webp" aria-label="上传标题图钉图片" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void run('读取图钉', async () => { const data = await readLocalImage(file, '标题图钉', 2); edit(current => ({ ...current, settings: { ...current.settings, titlePinImage: data } })) }) }} /><label className="video-check-label"><input type="checkbox" aria-label="投屏公式说明" checked={project.settings.showFormulaCaptions === true} disabled={!!busy} onChange={event => edit(current => ({ ...current, settings: { ...current.settings, showFormulaCaptions: event.target.checked } }))} />在画面中显示公式说明</label>
      <div className="video-background-actions"><button className="video-button" disabled={!!busy} aria-pressed={backgroundImage === VIDEO_PAGE_BACKGROUND} onClick={() => edit(current => ({ ...current, settings: { ...current.settings, backgroundImage: VIDEO_PAGE_BACKGROUND } }))}>使用指定底纹</button><button className="video-button" disabled={!!busy} aria-pressed={!backgroundImage} onClick={() => edit(current => ({ ...current, settings: { ...current.settings, backgroundImage: '' } }))}>纯色背景</button><button className="video-button" disabled={!!busy} onClick={() => backgroundInput.current?.click()}><FolderOpen size={14} />上传底纹</button></div>
      <input ref={backgroundInput} type="file" accept="image/png,image/jpeg,image/webp" aria-label="上传视频底纹" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void run('读取底纹', async () => importBackground(file)) }} />
      <p className="video-field-hint">内置正文：方正兰亭圆简体 / STIX Two Text，42 号，固定行距 56；标题 36 号。字体包缺少中粗原文件，当前标题使用合成加粗。底纹随工程保存，按 16:9 画面铺满。修改显示选项后，请保存并重新确认分镜。</p>
    </div>
  </div>
</section><section className="video-panel video-speech-panel">
  <div className="video-section-title"><h2>配音服务与角色</h2><span>{speechName}</span></div>
  <fieldset disabled={!!busy} className="video-speech-settings">
    <div className="video-speech-controls">
      <label>配音服务<select aria-label="配音服务" value={speechProvider} onChange={event => setSpeechProvider(event.target.value as SpeechProvider)}><option value="fish">Fish.audio · 专用角色音色</option><option value="edge">Edge TTS · 验证配音</option><option value="azure">Azure Speech</option></select></label>
      {speechProvider === 'fish' && <label>语音模型<select aria-label="Fish 语音模型" value={project.speech?.model || 's1'} onChange={event => editSpeech({ model: event.target.value })}><option value="s1">s1</option><option value="s2-pro">s2-pro</option></select></label>}
      {speechProvider === 'fish' && <label>配音分段长度<input aria-label="配音分段长度" type="number" min="100" max="300" step="10" value={project.speech?.chunkLength ?? 200} onChange={event => editSpeech({ chunkLength: Number(event.target.value) })} onBlur={event => editSpeech({ chunkLength: Math.min(300, Math.max(100, Number(event.target.value) || 200)) })} /></label>}
      <label>段间气口 / 秒<input aria-label="段间气口" type="number" min="0" max="3" step="0.1" value={project.speech?.pauseSeconds ?? 0.5} onChange={event => editSpeech({ pauseSeconds: Math.min(3, Math.max(0, Number(event.target.value) || 0)) })} /></label>
    </div>
    <p className="video-field-hint">{speechProvider === 'fish' ? '使用专用角色音色，按配音片段同步；依据关键词和标点拆段，用实际音频时长安排动画。' : speechProvider === 'edge' ? '用于先验证画面与讲解节奏，按配音片段同步。后续可切换专用角色音色重新制作。' : '使用固定中文声线，按语音时间事件同步动画。'}旁白保留原稿，字母和单位由发音配置处理。</p>
    <div className="video-speaker-grid">{project.speakers.map(speaker => <div className="video-speaker-config" key={speaker.id}>
      <strong><span className="video-speaker-dot" style={{ backgroundColor: speaker.color }} />{speaker.name} · {speaker.id === 'teacher' ? '主讲者 / 知识引导者' : '提问者 / 踩坑者'}</strong>
      <p className="video-field-hint">{speaker.id === 'teacher' ? '沉稳冷静、学识渊博、自信。负责解释概念、纠正错误、引导思考。' : '小迷糊、冒冒失失、行动派。主动试错、提出简短问题、表达畏难情绪；知识讲解占比不超过 20%。'}</p>
      <label>固定音色<input aria-label={`${speaker.name}配音音色`} value={speaker.voice} readOnly spellCheck={false} /></label>
    </div>)}</div>
    <p className="video-field-hint">所有项目统一使用方大招、金天练，互相称呼使用全名。导入旧稿中的角色与台词问题会列入审核提示。</p>
  </fieldset>
</section><div className="video-script-actions"><p>AI 根据已确认讲稿组织分镜。画面会逐张展示，全部完成后核对并采用；生成期间的新编辑会保留。</p><button className="video-button primary" disabled={!!busy || !scriptReviewed || activeTaskKinds.has("storyboard")} onClick={() => void generateStoryboard()}><Sparkles size={17} />生成分镜</button></div></main>}
      {tab === 'timeline' && <main className="video-script-page"><section className="video-panel"><h2>配音与时间轴</h2><label className="video-field">选择镜头<select aria-label="时间轴镜头" value={selectedId} onChange={e => setSelectedId(e.target.value)}>{project.shots.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>{shot && <VideoTimelinePlayer project={project} shot={shot} task={latestTimelineTask} dirty={dirty} disabled={!!busy || !approved || !runtimeReady || activeTaskKinds.has("preflight")} onPrepare={() => void startTask("preflight", { scope: [shot.id] })} />}</section></main>}
      {tab === 'storyboard' && storyboardUnplanned && <main className="video-planning-page" aria-label="分镜待生成"><div className="video-planning-icon"><Clapperboard size={32} /></div><span className="video-eyebrow">文稿 → 画面与动画</span><h1>{generation.state === 'running' ? '正在把讲稿组织成教学画面' : project.problem ? '先完成解析讲稿审核' : '讲稿已导入，画面尚未生成'}</h1><p>{project.problem ? '请在文稿页生成并核对题目解析、答案和讲稿，再生成分镜。' : `已保留 ${project.utterances.length} 段旁白。生成分镜会安排板书、公式推导、电路与同步动作，每张画面完成后会立即展示在上方，可边生成边查看。`}</p>{generation.state !== 'running' && generation.state !== 'failed' && generation.state !== 'cancelled' && <button className="video-button primary" disabled={!!busy || activeTaskKinds.has("storyboard")} onClick={() => !scriptReviewed ? setTab('script') : void generateStoryboard()}><Sparkles size={17} />{!scriptReviewed ? '前往讲稿审核与确认' : '生成分镜与画面'}</button>}<button className="video-link-button" onClick={() => setTab('script')}>查看导入讲稿</button></main>}
      {tab === 'storyboard' && !storyboardUnplanned && <div className="video-storyboard-layout"><aside className="video-shot-nav"><div className="video-nav-heading">镜头目录<span>{project.shots.length}</span></div>{chapterGroups.map(group => <section key={group.shots[0].id}><h3>第 {group.chapter} 章</h3>{group.shots.map(item => <button key={item.id} aria-current={shot?.id === item.id ? 'step' : undefined} onClick={() => setSelectedId(item.id)}><span className="video-shot-number">{String(project.shots.indexOf(item) + 1).padStart(2, '0')}</span><span><strong>{item.title}</strong><small>{item.utteranceIds.length} 段旁白{item.reviewNotes.length ? ' · 有审核提示' : ''}</small></span><ChevronRight size={13} /></button>)}</section>)}</aside>
        {shot ? <main className="video-shot-main"><div className="video-shot-heading"><div><span className="video-eyebrow">SHOT {String(project.shots.indexOf(shot) + 1).padStart(2, '0')} / {String(project.shots.length).padStart(2, '0')}</span><h1>{shot.title}</h1><p>{shot.summary}</p></div><div className="video-shot-heading-actions"><button className="video-button" disabled={!!busy || geometryBusy} onClick={() => { shotEditor.current?.scrollIntoView({ block: 'start' }); shotEditor.current?.querySelector<HTMLButtonElement>('button[aria-selected="true"]')?.focus({ preventScroll: true }) }}><FileText size={16} />编辑分镜内容</button><button className="video-button" disabled={!!busy || !approved || !runtimeReady} title={!approved ? '保存并确认分镜后可预览' : !runtimeReady ? '请先完成制作环境配置' : '制作当前镜头'} onClick={() => void run('提交镜头预览', async () => render('shot', [shot.id]))}><Play size={16} />预览此镜头</button></div></div>
          {<VideoShotAssistant project={project} shot={shot} disabled={!!busy || geometryBusy || activeTaskKinds.has("storyboard_patch")} onGenerate={(scope, instruction) => void startTask("storyboard_patch", { scope, instruction })} onEdit={editShot} onUndo={undoAdoption} canUndo={!!lastAdoption && lastAdoption.after.id === project.id} />}<div className="video-shot-content"><section className="video-shot-stage">{hasTeachingVisual(shot) ? <VideoSceneEditor project={project} shot={shot} disabled={!!busy || geometryBusy} onChangeLayout={layout => editShot({ layout })} onEditElement={(element, text) => { try { const updated = editCanvasElement(project, shot.id, element, text); edit(() => updated); setNotice([videoEditDependencyNotice(project, updated), '画面文字已更新。'].filter(Boolean).join('；')) } catch (reason) { setError(message(reason)) } }} onDeleteElement={element => { try { const updated = deleteCanvasElement(project, shot.id, element); edit(() => updated); setNotice([videoEditDependencyNotice(project, updated), '已从本镜头移除该元素，原始文稿保留。'].filter(Boolean).join('；')) } catch (reason) { setError(message(reason)) } }} onCreateHighlight={(element, selection) => { try { const updated = highlightCanvasElement(project, shot.id, element, selection); edit(() => updated); setNotice('关键词强调已添加，可在画面阶段中查看。') } catch (reason) { setError(message(reason)) } }} /> : <div className="video-empty-shots"><Clapperboard size={28} /><h2>本镜头还没有教学画面</h2><p>请在下方添加板书、公式或电路素材，再查看画面。</p></div>}
            {geometryError && <div className="video-geometry-error" role="alert"><strong>电路草图准备失败</strong><p>{geometryError}</p><button className="video-button" disabled={!!busy || geometryBusy} onClick={() => void prepareMissingGeometry(project)}><RefreshCw size={14} />重试电路草图</button></div>}{shot.reviewNotes.length > 0 && <div className="video-review-note"><strong><CircleAlert size={15} />审核提示</strong>{shot.reviewNotes.map((note, index) => <p key={index}>{note}</p>)}</div>}{latestVideo && <div className="video-rendered-preview"><h3>已制作的镜头</h3><video controls preload="metadata" src={latestVideo.videoUrl} /></div>}
          </section><section ref={shotEditor} className="video-shot-editor"><nav aria-label="镜头编辑内容">{([['narration', '旁白'], ['board', '板书与高亮'], ['formulas', '公式'], ['actions', '动画'], ['circuit', '电路与数据']] as const).map(([key, title]) => <button key={key} aria-selected={editorTab === key} onClick={() => setEditorTab(key)}>{title}</button>)}</nav><fieldset disabled={!!busy || geometryBusy} className="video-editor-fields" onFocusCapture={event => {
              const target = event.target as Element
              const element = target.closest('.formula-editor, [data-video-text-edit]')
              const current = projectRef.current
              if (element && current && textEditSession.current?.element !== element) textEditSession.current = { element, baseline: current, raw: current }
            }} onBlurCapture={event => {
              const session = textEditSession.current
              if (session && !session.element.contains(event.relatedTarget as Node | null)) textEditSession.current = null
            }}>
            {editorTab === 'narration' && <><label className="video-field">镜头标题<input aria-label="镜头标题" value={shot.title} onChange={event => editShot({ title: event.target.value })} /></label><label className="video-field">知识点总标题（可选覆盖）<input aria-label="知识点总标题" value={shot.sectionTitle || ''} placeholder="例如：串联电路的功率比" onChange={event => editShot({ sectionTitle: event.target.value || undefined })} /></label><label className="video-field">画面说明（仅制作参考）<textarea aria-label="画面说明" value={shot.summary} onChange={event => editShot({ summary: event.target.value })} rows={2} /></label>{shot.utteranceIds.map((id, index) => { const line = project.utterances.find(item => item.id === id); const speaker = project.speakers.find(item => item.id === line?.speakerId); return line && <div className="video-utterance" key={id}><div><span style={{ color: speaker?.color }}>{speaker?.name || line.speakerId}</span><small>旁白 {index + 1}</small></div><textarea data-video-text-edit aria-label={`旁白 ${index + 1}`} value={line.text} rows={Math.max(3, Math.ceil(line.text.length / 28))} onChange={event => edit(current => ({ ...current, problem: current.problem ? { ...current.problem, reviewed: false } : undefined, utterances: current.utterances.map(item => item.id === id ? { ...item, text: event.target.value } : item) }))} /></div>})}<label className="video-field video-hold-field">镜头结束停顿 / 秒<input aria-label="镜头结束停顿" type="number" min="0" max="15" step="0.1" value={shot.holdSeconds} onChange={event => editShot({ holdSeconds: Math.min(15, Math.max(0, Number(event.target.value) || 0)) })} /></label><label className="video-field">审核备注（仅制作参考，每行一条）<textarea aria-label="审核备注" rows={3} value={shot.reviewNotes.join('\n')} onChange={event => editShot({ reviewNotes: event.target.value.split('\n') })} /></label></>}
            {editorTab === 'board' && <><p className="video-field-hint">板书只放关键词、定律、题干、已知条件与推导。画面说明、审核备注和默认公式说明仅供制作时参考。每项板书与关键词高亮可分别绑定台词。</p>{(shot.boardTexts || []).map((item, index) => <section className="video-formula-card" key={item.id}><div className="video-card-heading"><strong>板书 {index + 1}</strong><button className="video-icon-button" aria-label={`删除板书 ${index + 1}`} onClick={() => editShot({ boardTexts: shot.boardTexts?.filter(value => value.id !== item.id), highlights: shot.highlights?.filter(value => value.targetType !== 'board' || value.targetId !== item.id) })}><Trash2 size={14} /></button></div><label className="video-field">显示样式<select aria-label={`板书 ${index + 1}样式`} value={item.card ? 'card' : 'plain'} onChange={event => editBoard(item.id, { card: event.target.value === 'card' ? { title: item.card?.title || '知识要点' } : undefined, text: event.target.value === 'plain' && !item.text.trim() ? item.card?.title || '' : item.text })}><option value="plain">普通板书</option><option value="card">蓝色知识卡</option></select></label>{item.card && <><label className="video-field">卡片标题<input data-video-text-edit aria-label={`板书 ${index + 1}卡片标题`} value={item.card.title} onChange={event => editBoard(item.id, { card: { title: event.target.value } })} /></label><p className="video-field-hint">正文和公式放在卡片内。可在“公式”中选择所属知识卡；每张卡独立累计或替换公式。</p>{!item.text.trim() && !shot.formulas.some(formula => formula.cardId === item.id) && <p className="video-inline-warning">请填写卡片正文，或在“公式”中添加并绑定一条公式。</p>}</>}<label className="video-field">内容类型<select aria-label={`板书 ${index + 1}类型`} value={item.kind} onChange={event => editBoard(item.id, { kind: event.target.value as BoardText['kind'] })}>{Object.entries(boardKinds).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label><label className="video-field">{item.card ? '卡片正文（有卡内公式时可留空）' : '板书文字'}<textarea data-video-text-edit aria-label={`板书 ${index + 1}文字`} rows={3} value={item.text} onChange={event => editBoard(item.id, { text: event.target.value })} /></label><label className="video-field">入场方式<select aria-label={`板书 ${index + 1}入场`} value={item.entrance || 'appear'} onChange={event => editBoard(item.id, { entrance: event.target.value as BoardText['entrance'] })}><option value="appear">直接出现</option><option value="fade">淡入</option><option value="write">逐字书写</option><option value="slide">滑入</option><option value="settle">轻摆落定</option></select></label>{item.entrance && item.entrance !== 'appear' && <VideoTransitionDuration label={`板书 ${index + 1}`} value={item.durationSeconds} onChange={durationSeconds => editBoard(item.id, { durationSeconds })} />}<label className="video-check-label"><input type="checkbox" aria-label={`板书 ${index + 1}随台词出现`} checked={!!item.cue} onChange={event => editBoard(item.id, { cue: event.target.checked ? { utteranceId: shot.utteranceIds[0] || '' } : undefined })} />随台词出现（关闭时从镜头开始显示）</label>{item.cue && <CueEditor cue={item.cue} shot={shot} project={project} label={`板书 ${index + 1}`} onChange={cue => editBoard(item.id, { cue })} />}</section>)}<button className="video-button" onClick={() => editShot({ boardTexts: [...(shot.boardTexts || []), { id: `${shot.id}-board-${crypto.randomUUID().slice(0, 8)}`, text: '', kind: 'keyword' }] })}><Plus size={15} />添加板书</button><button className="video-button" onClick={() => editShot({ boardTexts: [...(shot.boardTexts || []), { id: `${shot.id}-board-${crypto.randomUUID().slice(0, 8)}`, text: '填写知识要点', kind: 'law', card: { title: '知识卡' }, entrance: 'slide', cue: { utteranceId: shot.utteranceIds[0] || '' } }] })}><Plus size={15} />添加知识卡</button><div className="video-editor-section-title"><h3>关键词高亮</h3><p>选择板书、最新公式或已保留的公式，再填写该对象中的关键词；出现时机由同步台词决定。公式关键词使用对应公式片段。</p></div>{(shot.highlights || []).map((item, index) => {
              const target = item.targetType === 'board' ? shot.boardTexts?.find(value => value.id === item.targetId)?.text : shot.formulas.find(value => value.id === item.targetId)?.latex
              const line = project.utterances.find(value => value.id === item.cue.utteranceId)?.text || ''
              const missingTarget = !target || !item.phrase || !target.includes(item.phrase)
              return <section className="video-formula-card" key={item.id}><div className="video-card-heading"><strong>高亮 {index + 1}</strong><button className="video-icon-button" aria-label={`删除高亮 ${index + 1}`} onClick={() => editShot({ highlights: shot.highlights?.filter(value => value.id !== item.id) })}><Trash2 size={14} /></button></div><label className="video-field">高亮对象<select aria-label={`高亮 ${index + 1}对象`} value={`${item.targetType}:${item.targetId}`} onChange={event => { const split = event.target.value.indexOf(':'); editHighlight(item.id, { targetType: event.target.value.slice(0, split) as KeywordHighlight['targetType'], targetId: event.target.value.slice(split + 1), phrase: (event.target.value.slice(0, split) === 'board' ? shot.boardTexts?.find(board => board.id === event.target.value.slice(split + 1))?.text : shot.formulas.find(formula => formula.id === event.target.value.slice(split + 1))?.latex) || '', occurrence: 1 }) }}>{(shot.boardTexts || []).map((board, i) => <option key={board.id} value={`board:${board.id}`}>板书 {i + 1} · {board.text.slice(0, 20) || '空白板书'}</option>)}{shot.formulas.map((formula, i) => <option key={formula.id} value={`formula:${formula.id}`}>公式 {i + 1} · {formula.latex.slice(0, 28)}</option>)}</select></label><div className="video-field-pair"><label>对象内关键词<input aria-label={`高亮 ${index + 1}文字`} value={item.phrase} onChange={event => editHighlight(item.id, { phrase: event.target.value })} /></label><label>第几次出现<input aria-label={`高亮 ${index + 1}出现次数`} type="number" min="1" max="20" value={item.occurrence || 1} onChange={event => editHighlight(item.id, { occurrence: Math.min(20, Math.max(1, Number(event.target.value) || 1)) })} /></label></div>{missingTarget && <p className="video-inline-warning">请填写所选板书或公式中存在的关键词。</p>}<div className="video-field-pair"><label>强调方式<select aria-label={`高亮 ${index + 1}效果`} value={item.effect} onChange={event => editHighlight(item.id, { effect: event.target.value as KeywordHighlight['effect'] })}><option value="box">圆角框选</option><option value="marker">圆角底色</option><option value="underline">下划线</option><option value="pointer">指示箭头</option><option value="pulse">脉冲强调</option><option value="check">打勾确认</option><option value="cross">打叉纠错</option></select></label><label>高亮颜色<select aria-label={`高亮 ${index + 1}颜色`} value={item.color || '#4F80FF'} onChange={event => editHighlight(item.id, { color: event.target.value })}>{highlightColors.map(color => <option key={color.value} value={color.value}>{color.name} · {color.value}</option>)}</select></label></div><label className="video-field">强调持续 / 秒<input aria-label={`高亮 ${index + 1}持续秒数`} type="number" min="0.5" max="15" step="0.5" value={item.durationSeconds ?? 3} onChange={event => editHighlight(item.id, { durationSeconds: Math.min(15, Math.max(0.5, Number(event.target.value) || 3)) })} /></label><CueEditor cue={item.cue} shot={shot} project={project} label={`高亮 ${index + 1}`} onChange={cue => editHighlight(item.id, { cue })} />{item.cue.phrase && !line.includes(item.cue.phrase) && <p className="video-inline-warning">同步关键词不在所选台词中，请重新选择。</p>}</section>
            })}<button className="video-button" disabled={!shot.boardTexts?.some(item => item.text.trim()) && !shot.formulas.some(item => item.latex.trim())} onClick={addHighlight}><Plus size={15} />添加关键词高亮</button></>}
            {editorTab === 'formulas' && <><p className="video-field-hint">使用可视化公式编辑器输入，绑定旁白关键词后安排出现与变换。选择“另起一行”可保留前式，继续累计推导；选择“替换最新一行”只更新当前行。公式说明默认仅供制作参考。</p>{shot.formulas.map((formula, index) => <section className="video-formula-card" key={formula.id}><div className="video-card-heading"><strong>步骤 {index + 1}</strong><code>{formula.id}</code><button className="video-icon-button" aria-label={`删除公式 ${index + 1}`} disabled={project.shots.some(item => item.formulas.some(value => value.correctionStepId === formula.id))} title="删除公式及其关联高亮；被猜想引用的纠正步骤需先解除引用" onClick={() => editShot({ formulas: shot.formulas.filter(item => item.id !== formula.id) })}><Trash2 size={14} /></button></div><FormulaEditor label={`公式 ${index + 1}`} value={formula.latex} onChange={latex => editFormula(formula.id, { latex })} /><div className="video-field-pair"><label>动画动作<select aria-label={`公式 ${index + 1}动作`} value={formula.action} onChange={event => editFormula(formula.id, { action: event.target.value as FormulaStep['action'] })}>{Object.entries(actionNames).map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select></label><label>教学性质<select aria-label={`公式 ${index + 1}教学性质`} value={formula.role || 'normal'} onChange={event => editFormula(formula.id, { role: event.target.value as FormulaStep['role'] })}><option value="normal">正式推导</option><option value="misconception">学生猜想</option></select></label></div>{formula.role === 'misconception' && <label className="video-field">对应纠正步骤<input aria-label={`公式 ${index + 1}纠正步骤`} value={formula.correctionStepId || ''} onChange={event => editFormula(formula.id, { correctionStepId: event.target.value })} /></label>}<label className="video-field">所属知识卡<select aria-label={`公式 ${index + 1}知识卡`} value={formula.cardId || ''} onChange={event => editFormula(formula.id, { cardId: event.target.value || undefined })}><option value="">独立公式</option>{(shot.boardTexts || []).filter(board => board.card).map(board => <option key={board.id} value={board.id}>{board.card!.title || '未命名知识卡'}</option>)}</select></label><label className="video-field">公式排布<select aria-label={`公式 ${index + 1}排布`} value={formula.display || 'replace'} onChange={event => editFormula(formula.id, { display: event.target.value as FormulaStep['display'] })}><option value="replace">替换最新一行</option><option value="append">另起一行，保留前式</option></select></label><VideoTransitionDuration label={`公式 ${index + 1}`} value={formula.durationSeconds} onChange={durationSeconds => editFormula(formula.id, { durationSeconds })} /><label className="video-field">公式说明（默认不投屏）<input aria-label={`公式 ${index + 1}画面提示`} value={formula.caption || ''} onChange={event => editFormula(formula.id, { caption: event.target.value })} /></label><CueEditor cue={formula.cue} shot={shot} project={project} label={`公式 ${index + 1}`} onChange={cue => editFormula(formula.id, { cue })} />{formula.parts && <details className="video-formula-parts"><summary>独立公式项（{formula.parts.length}）</summary>{formula.parts.map(part => <label key={part.id}>{part.id}<input aria-label={`公式项 ${part.id}`} value={part.latex} onChange={event => editFormula(formula.id, { parts: formula.parts?.map(item => item.id === part.id ? { ...item, latex: event.target.value } : item) })} /></label>)}</details>}</section>)}<button className="video-button" onClick={() => editShot({ formulas: [...shot.formulas, { id: `${shot.id}-formula-${crypto.randomUUID().slice(0, 8)}`, latex: 'P=UI', action: 'write', cue: { utteranceId: shot.utteranceIds[0] || '' }, role: 'normal' }] })}><Plus size={15} />添加公式步骤</button></>}
            {editorTab === 'actions' && <><p className="video-field-hint">可绘制与强调电路，添加电压 / 电流箭头，或随台词改变开关、阻值和滑片。多个标注目标以逗号分隔。</p>{shot.actions.map((action, index) => <section className="video-formula-card" key={action.id}><div className="video-card-heading"><strong>动作 {index + 1}</strong><code>{action.id}</code><button className="video-icon-button" aria-label={`删除动画 ${index + 1}`} onClick={() => editShot({ actions: shot.actions.filter(item => item.id !== action.id) })}><Trash2 size={14} /></button></div><VideoCircuitActionEditor action={action} index={index} asset={asset} onChange={updated => editShot({ actions: shot.actions.map(item => item.id === action.id ? updated : item) })} /><CueEditor cue={action.cue} shot={shot} project={project} label={`动画 ${index + 1}`} onChange={cue => editShot({ actions: shot.actions.map(item => item.id === action.id ? { ...item, cue } : item) })} /></section>)}<button className="video-button" disabled={!asset} onClick={() => editShot({ actions: [...shot.actions, { id: `${shot.id}-action-${crypto.randomUUID().slice(0, 8)}`, type: 'highlight', targetIds: asset ? ['circuit'] : [], cue: { utteranceId: shot.utteranceIds[0] || '' } }] })}><Plus size={15} />添加电路动作</button></>}
            {editorTab === 'circuit' && <><label className="video-field">电路素材<select aria-label="电路素材" value={shot.circuitAssetId || ''} onChange={event => editShot({ circuitAssetId: event.target.value || undefined })}><option value="">无电路 · 公式讲解</option>{project.circuits.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{asset ? <><div className="video-circuit-display-controls"><label>画面中的电路<select aria-label="电路画面样式" value={asset.viewMode || 'schematic'} onChange={event => void updateCircuitDisplay({ viewMode: event.target.value as 'schematic' | 'real' })}><option value="schematic">标准电路图</option><option value="real">实物图</option></select></label><label className="video-current-toggle"><input type="checkbox" aria-label="显示电流流动" disabled={asset.mode === 'symbolic'} checked={asset.mode !== 'symbolic' && (asset.currentFlow ?? asset.viewMode === 'real')} onChange={event => void updateCircuitDisplay({ currentFlow: event.target.checked })} />显示电流流动</label><p className="video-field-hint">{geometryBusy ? '正在准备对应素材与导线路径…' : asset.mode === 'symbolic' ? '符号推导没有数值电流，不播放电流动画。' : '电流动画沿当前导线路径显示；只对可确定的电流方向播放。'}同一电路素材的修改会应用到引用它的所有镜头。</p></div><div className="video-circuit-meta"><strong>{asset.name}</strong><span>{asset.mode === 'symbolic' ? '符号推导' : '数值电路'} · 教材理想模型</span>{onEditCircuit && <button className="video-button" onClick={() => void run('打开电路编辑', async () => { const value = await persist(); const currentAsset = value.circuits.find(item => item.id === asset.id); if (currentAsset) onEditCircuit(currentAsset.id, currentAsset.graph, value) })}><ChevronRight size={15} />在物理实验室编辑</button>}</div><div className="video-quantity-table"><table><caption>题设与推导数据</caption><thead><tr><th>物理量</th><th>数值 / 表达式</th><th>来源</th><th>显示时机</th></tr></thead><tbody>{asset.quantities.map(quantity => <tr key={quantity.id}><td>{quantity.symbol}</td><td>{quantity.value ?? quantity.expression ?? '—'} {quantity.unit}</td><td><span className={`video-provenance ${quantity.provenance}`}>{({ given: '题设', derived: '推导值', symbolic: '符号量' })[quantity.provenance]}</span></td><td>{quantity.revealStepId || (quantity.provenance === 'derived' ? '仅内部校验' : '题面')}</td></tr>)}</tbody></table></div><details className="video-ids"><summary>元件、导线与端口 ID</summary>{asset.geometry?.components.map(item => <p key={item.id}><strong>{item.id}</strong> · {item.label}<small>{Object.keys(item.terminals).join(' · ')}</small></p>)}{asset.geometry?.wires.map(item => <p key={item.id}>{item.id}<small>{item.from} → {item.to}</small></p>)}</details></> : <p className="video-field-hint">本镜头使用公式与文字画面，可选择已有电路素材。</p>}</>}
          </fieldset></section></div>
        </main> : <main className="video-empty-shots"><FileText size={32} /><h2>先把讲稿组织成镜头</h2><p>在文稿页生成分镜后，即可逐镜核对旁白、电路与公式。</p><button className="video-button primary" onClick={() => setTab('script')}>前往文稿</button></main>}
      </div>}
      {tab === 'output' && <main className="video-output-page"><section className="video-output-intro"><div><span className="video-eyebrow">READY FOR THE CLASSROOM</span><h1>把这一课，制作成视频。</h1><p>镜头独立制作，修改后复用未变化的片段。成片包含双人旁白与字幕。</p></div><div className="video-output-settings"><span>1920 × 1080</span><span>{project.settings.fps} fps</span><span>中文双声线</span><span>无背景音乐</span></div></section>
        <section className="video-approval-panel"><div><h2>{approved ? <><CheckCircle2 size={19} />分镜已确认</> : '确认本次制作内容'}</h2><p>{approved ? '本次制作将使用已确认的旁白、公式和电路快照。' : !scriptReviewed ? '请先在文稿页保存并确认讲稿，再完成分镜审核。' : project.problem && (!project.problem.reviewed || !project.problem.storyboardReady) ? '请先在文稿页审核题目解析与讲稿，再生成分镜。' : scriptChanged ? '原稿有更新，请返回文稿页生成分镜，避免用旧分镜制作新文稿。' : !storyboardReady ? '分镜画面尚未生成，请先规划板书、公式或电路后再确认制作。' : '请核对旁白、公式、电路接法和审核提示。确认时会先保存当前修改。'}</p></div><button className={`video-button ${approved ? '' : 'primary'}`} disabled={!!busy || approved || !scriptReviewed || scriptChanged || !storyboardReady || (!!project.problem && (!project.problem.reviewed || !project.problem.storyboardReady))} onClick={() => void run('保存并确认分镜', confirmProject)}><CheckCircle2 size={17} />{approved ? '已确认分镜' : '保存并确认分镜'}</button></section>
        {report.length > 0 && <details className="video-review-report" open><summary>教学复核 · {report.length} 条</summary>{report.map((item, index) => <p key={index}>{item}</p>)}</details>}
        {!runtimeReady && <div className="video-environment-note"><CircleAlert size={18} /><div><strong>制作环境尚未就绪</strong><p>{speechMissing.length ? `请配置 ${speechMissing.join('、')}。` : `请检查 Python、Manim、FFmpeg、LaTeX 与 ${speechName} 配置。`}可以继续保存和审核分镜。</p></div><button className="video-button" onClick={() => setShowSystem(true)}>查看环境</button></div>}
        <section className="video-workflow-checkpoint"><div><h2>全镜头配音与时间轴预检</h2><p>{preparedTimelineTask && !dirty ? '当前版本已准备真实配音与时间轴，可逐镜检查出现和强调时机。' : '先检查所有镜头的公式、引用与同步顺序，再合成正式双人配音。通过后可播放真实时间轴。'}</p></div><button className="video-button" disabled={!!busy || !approved || !runtimeReady || activeTaskKinds.has('preflight')} onClick={() => void startTask('preflight', { force: true })}><Play size={16} />{activeTaskKinds.has('preflight') ? '正在准备时间轴' : preparedTimelineTask && !dirty ? '重新检查时间轴' : '准备配音与时间轴'}</button></section>
        <div className="video-export-options"><section><span className="video-option-number">01</span><h2>快速预览</h2><p>720p 整课预览，用于核对画面和讲解节奏。</p><button className="video-button" disabled={!!busy || !approved || !runtimeReady} onClick={() => void run('提交整片预览', async () => render('preview'))}><Play size={16} />制作 720p 预览</button></section><section><span className="video-option-number">02</span><h2>高清成片</h2><p>1080p MP4 与独立 SRT 字幕，适合正式交付。</p><button className="video-button primary" disabled={!!busy || !approved || !runtimeReady} onClick={() => void run('提交高清制作', async () => render('final'))}><Video size={16} />输出 1080p 成片</button></section><section><span className="video-option-number">03</span><h2>可复用工程</h2><p>下载分镜、电路快照及已生成的 Manim 场景和音频。</p><a className={`video-button ${!saved || dirty ? 'disabled' : ''}`} aria-disabled={!saved || dirty} href={saved && !dirty ? videoClient.archiveUrl(project.id) : undefined} download><Download size={16} />下载工程 ZIP</a></section></div>
        <section className="video-jobs">{jobsWarning && <p className="video-job-error" role="status">{jobsWarning}</p>}<div className="video-section-title"><h2>制作任务</h2><span>本机持久保存</span></div>{jobs.length === 0 && <div className="video-no-jobs"><Film size={26} /><p>还没有制作任务。确认分镜后，从一个镜头或整片预览开始。</p></div>}{[...jobs].reverse().map(job => <article className={`video-job ${job.status}`} key={job.id}><div className="video-job-heading"><div><strong>{job.kind === 'shot' ? `镜头预览 · ${project.shots.find(item => item.id === job.shotIds[0])?.title || job.shotIds[0]}` : job.kind === 'preview' ? '720p 整片预览' : '1080p 高清成片'}</strong><span>{new Date(job.createdAt).toLocaleString('zh-CN')}{job.cachedShots ? ` · 复用 ${job.cachedShots} 个镜头` : ''}{job.duration ? ` · ${Math.round(job.duration)} 秒` : ''}</span></div><span className="video-job-status">{jobNames[job.status]}</span></div><progress aria-label="制作进度" max="100" value={job.progress} /><div className="video-job-detail"><span>{job.stage} · {Math.round(job.progress)}%</span>{(job.status === 'queued' || job.status === 'running') && <button className="video-link-button" disabled={!!busy} onClick={() => void run('取消制作', async () => { const value = await videoClient.cancel(job.id); setJobs(current => current.map(item => item.id === job.id ? value : item)) })}><Square size={12} />取消</button>}{(job.status === 'failed' || job.status === 'cancelled') && <button className="video-link-button" disabled={!!busy} onClick={() => void run('继续原版本制作', async () => { const value = await videoClient.resumeRender(job.id); setJobs(current => current.map(item => item.id === job.id ? value : item)) })}>继续此制作版本</button>}{(job.status === 'failed' || job.status === 'cancelled') && <button className="video-link-button" disabled={!!busy || !approved || !runtimeReady} onClick={() => void run('重试制作', async () => render(job.kind, job.kind === 'shot' ? job.shotIds : undefined))}><RefreshCw size={13} />使用当前版本重试</button>}</div><VideoProductionNodes job={job} project={project} onSelect={id => { if (project.shots.some(s => s.id === id)) { setSelectedId(id); setTab('storyboard') } else void run('查看制作版本', () => viewRevision(job.projectRevision)) }} />{job.error && <p className="video-job-error">{job.error}{job.shotId && <button className="video-link-button" onClick={() => { setSelectedId(job.shotId!); setTab("storyboard") }}>定位问题镜头</button>}</p>}{job.projectRevision !== project.revision && <p className="video-field-hint">此任务使用第 {job.projectRevision} 版分镜。<button className="video-link-button" disabled={!!busy} onClick={() => void run("读取制作版本", () => viewRevision(job.projectRevision))}>只读查看制作版本</button></p>}{job.status === 'completed' && <><div className="video-job-downloads">{job.videoUrl && <a className="video-button" href={job.videoUrl} download><Download size={14} />MP4 视频</a>}{job.subtitleUrl && <a className="video-button" href={job.subtitleUrl} download><FileText size={14} />SRT 字幕</a>}{job.archiveUrl && <a className="video-button" href={job.archiveUrl} download><Download size={14} />工程 ZIP</a>}{job.validationReportUrl && <a className="video-button" href={job.validationReportUrl} target="_blank" rel="noreferrer"><CheckCircle2 size={14} />成片验收报告</a>}</div>{job.keyframeUrls && job.keyframeUrls.length > 0 && <details className="video-keyframe-review"><summary>查看镜头关键帧（{job.keyframeUrls.length}）</summary><div>{job.keyframeUrls.map((url, index) => <a href={url} target="_blank" rel="noreferrer" key={url}><img loading="lazy" src={url} alt={`镜头关键帧 ${index + 1}`} /></a>)}</div></details>}{job.videoUrl && <video controls preload="metadata" src={job.videoUrl} aria-label="制作视频预览" />}</>}</article>)}</section>
      </main>}
      {tab === 'storyboard' && !storyboardUnplanned && <footer className="video-bottom-bar"><span><strong>{approved ? '分镜已确认 · 可继续编辑' : '下一步：确认分镜'}</strong><small>{approved ? '双击画面文字或使用内容编辑区，修改后重新保存并确认' : '核对台词、公式、电路与同步点'}</small></span><button className="video-button primary" onClick={() => setTab('output')}><span>{approved ? '前往制作与输出' : '审核并确认分镜'}</span><ChevronRight size={16} /></button></footer>}
    </>}
    {historyPreview && <div className="video-modal-backdrop"><section className="video-task-review" role="dialog" aria-modal="true" aria-label="历史分镜只读预览"><div className="video-section-title"><h2>第 {historyPreview.project.revision} 版分镜 · 只读</h2><button className="video-button" onClick={() => setHistoryPreview(null)}>关闭历史预览</button></div><p>查看此前保存的台词和画面，当前草稿保留。</p><label className="video-field">历史镜头<select aria-label="历史镜头" value={historyPreview.shotId} onChange={event => setHistoryPreview({ ...historyPreview, shotId: event.target.value })}>{historyPreview.project.shots.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>{historyPreview.project.shots.find(item => item.id === historyPreview.shotId) && <VideoSceneEditor project={historyPreview.project} shot={historyPreview.project.shots.find(item => item.id === historyPreview.shotId)!} disabled onChangeLayout={() => {}} />}<details><summary>查看当时的讲稿</summary><pre className="video-clean-script">{historyPreview.project.sourceScript}</pre></details></section></div>}
    {pendingNavigation && <div className="video-modal-backdrop"><section className="video-import-dialog" role="dialog" aria-modal="true" aria-label="切换前保存草稿"><h2>当前项目有未保存修改</h2><p>可以保存到项目，或把修改保留在此浏览器中，下次打开时继续。</p><div className="video-dialog-actions"><button className="video-button" disabled={!!busy} onClick={() => setPendingNavigation(undefined)}>取消</button><button className="video-button" disabled={!!busy} onClick={() => void finishNavigation(false)}>保留草稿并切换</button><button className="video-button primary" disabled={!!busy} onClick={() => void finishNavigation(true)}>保存并切换</button></div></section></div>}
    {importOpen && <div className="video-modal-backdrop"><section className="video-import-dialog" role="dialog" aria-modal="true" aria-labelledby="video-import-heading"><div className="video-section-title"><h2 id="video-import-heading">开始一份新课程</h2><button aria-label="关闭导入" disabled={!!busy} onClick={() => setImportOpen(false)}>×</button></div><nav className="video-import-modes" aria-label="课程来源"><button className="video-button" aria-pressed={importMode === 'script'} disabled={!!busy} onClick={() => setImportMode('script')}>导入讲稿</button><button className="video-button" aria-pressed={importMode === 'problem'} disabled={!!busy} onClick={() => setImportMode('problem')}>导入题目</button></nav><button className="video-sample-import" disabled={!!busy} onClick={() => void run('建立示范课程', async () => { await create(createPowerLessonProject()) })}><Clapperboard size={20} /><span><strong>使用《电功率公式与比例》示范课程</strong><small>完整原稿 · 12 个分镜 · 已校验的电路例题</small></span><ChevronRight size={16} /></button><button className="video-sample-import" disabled={!!busy} onClick={() => void run('建立目标效果示范', async () => { await create(createReferenceEffectsProject()) })}><Play size={20} /><span><strong>使用目标效果示范课程</strong><small>逐字板书 · 累计推导 · 电压电流箭头 · 电路状态变化</small></span><ChevronRight size={16} /></button><button className="video-sample-import" disabled={!!busy} onClick={() => void run('建立知识卡片复用示范', async () => { await create(createKnowledgeCardsProject()) })}><Clapperboard size={20} /><span><strong>使用知识卡片复用示范</strong><small>电功 · 电功率 · 欧姆定律 · 卡片与公式混排</small></span><ChevronRight size={16} /></button><label className="video-field">课程名称<input aria-label="新课程名称" value={importTitle} onChange={event => setImportTitle(event.target.value)} placeholder="例如：串并联电路中的电功率" /></label><label className="video-field">{importMode === 'problem' ? '题目文字' : '粘贴讲稿'}<textarea aria-label={importMode === 'problem' ? '导入题目内容' : '导入讲稿内容'} rows={8} value={importText} onChange={event => setImportText(event.target.value)} placeholder="方大招：我们先来看这个电路……\n金天练：可以用比例来计算吗？" /></label>{importMode === 'problem' ? <div className="video-problem-upload"><button className="video-button" disabled={!!busy} onClick={() => problemImageInput.current?.click()}><FolderOpen size={14} />添加本地题图</button><input ref={problemImageInput} type="file" accept="image/png,image/jpeg,image/webp" aria-label="上传题目图片" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void run('读取题图', async () => setImportImage(await readLocalImage(file, '题目图片'))) }} />{importImage && <><img src={importImage} alt="待导入题图" /><button className="video-link-button" onClick={() => setImportImage('')}>移除题图</button></>}<p className="video-field-hint">支持题目文字与可选题图，也可只上传题图。创建后生成解析讲稿，老师审核后再生成分镜。</p></div> : <p className="video-field-hint">支持“角色：台词”和 Markdown 格式。创建后先审核并确认讲稿，再生成分镜；后台任务可以停止和继续。</p>}<input type="file" ref={fileInput} accept=".txt,.md,text/plain,text/markdown" hidden onChange={async event => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; if (file.size > 1024 * 1024) { setError('讲稿文件不能超过 1 MB。'); return } try { setImportText(await file.text()); if (!importTitle) setImportTitle(file.name.replace(/\.[^.]+$/, '')) } catch (reason) { setError(message(reason)) } }} /><div className="video-dialog-actions"><button className="video-button" onClick={() => fileInput.current?.click()} disabled={!!busy}><FolderOpen size={15} />读取 TXT / Markdown</button><button className="video-button primary" disabled={!!busy || (!importText.trim() && (importMode !== 'problem' || !importImage))} onClick={() => void importCourse()}><Plus size={16} />创建课程</button></div></section></div>}
  </div>
}
