import { useEffect, useRef, useState } from 'react'
import type { GenerationTask, GenerationTaskKind, VideoProject } from '../../server/videoTypes'
import { videoClient } from '../lib/videoClient'
import { VideoSceneEditor } from './VideoSceneEditor'
import { VideoTaskProgress } from './VideoTaskProgress'
import { formatVideoTaskDuration, newestVideoTasks, videoTaskElapsedSeconds, videoTaskSpotlight } from '../lib/videoTaskPresentation'
import './VideoWorkflow.css'

const names: Record<GenerationTaskKind, string> = { problem_script: '题目解析讲稿', storyboard: '全课分镜', storyboard_patch: '局部分镜修改', preflight: '配音与时间轴预检' }
const states: Record<GenerationTask['status'], string> = { queued: '等待中', running: '进行中', waiting_retry: '等待继续', failed: '需要修改', cancelled: '已停止', completed: '已完成' }
export function VideoTaskPanel({ project, tasks, disabled, onRefresh, onApply, onSelectShot }: {
  project: VideoProject; tasks: GenerationTask[]; disabled: boolean; onRefresh: () => void;
  onApply: (task: GenerationTask, acceptConflicts: boolean) => Promise<void>; onSelectShot: (id: string) => void;
}) {
  const [review, setReview] = useState<{ task: GenerationTask; project: VideoProject; descriptions: string[]; readOnly: boolean } | null>(null)
  const [error, setError] = useState(''), [pending, setPending] = useState(false)
  const [selected, setSelected] = useState(''), [overwrite, setOverwrite] = useState(false)
  const [now, setNow] = useState(Date.now)
  const [tasksOpen, setTasksOpen] = useState(false)
  const taskDialog = useRef<HTMLDialogElement>(null)
  const visibleTasks = newestVideoTasks(tasks.filter(task => task.projectId === project.id))
  const spotlight = videoTaskSpotlight(visibleTasks, project.revision)
  const progressiveTask = visibleTasks.find(task => (task.kind === 'storyboard' || task.kind === 'storyboard_patch') && !task.appliedRevision
    && (['running', 'queued', 'waiting_retry', 'failed', 'cancelled'].includes(task.status) || !!task.partialResultVersion))
  const activeCount = visibleTasks.filter(task => task.status === 'running' || task.status === 'queued').length
  const hasActiveTasks = visibleTasks.some(task => task.status === 'running' || task.status === 'queued')
  useEffect(() => {
    if (!hasActiveTasks) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [hasActiveTasks])
  useEffect(() => { setReview(null); setError(''); setTasksOpen(false) }, [project.id])
  useEffect(() => {
    const dialog = taskDialog.current
    if (tasksOpen) dialog?.showModal()
    else dialog?.close()
  }, [tasksOpen])
  const act = async (action: () => Promise<unknown>) => {
    setPending(true); setError('')
    try { await action(); onRefresh() } catch (error) { setError(error instanceof Error ? error.message : '操作失败') }
    finally { setPending(false) }
  }
  const inspect = async (task: GenerationTask, shotId?: string) => {
    const result = await videoClient.taskResult(task.id)
    if (!result.project) throw new Error('任务尚未生成可采用的分镜。')
    const patch = result.patch as { changes?: { description: string }[] } | undefined
    const changed = result.project.shots.filter(shot => task.kind !== 'storyboard_patch' || !project.shots.some(previous => JSON.stringify(previous) === JSON.stringify(shot)))
    setTasksOpen(false)
    setSelected(shotId && result.project.shots.some(shot => shot.id === shotId) ? shotId : changed[0]?.id || result.project.shots[0].id); setOverwrite(false)
    setReview({ task, project: result.project, descriptions: patch?.changes?.map(item => item.description) || [], readOnly: result.readOnly === true || task.status !== 'completed' })
  }
  if (!visibleTasks.length) return null
  const after = review?.project.shots.find(shot => shot.id === selected)
  const before = project.shots.find(shot => shot.id === selected) || project.shots.find(shot => after?.utteranceIds.some(id => shot.utteranceIds.includes(id)))
  const actions = (task: GenerationTask) => <div className="video-task-actions">
        {['running','queued','waiting_retry'].includes(task.status) && <button className="video-button" disabled={pending} onClick={() => void act(() => videoClient.cancelTask(task.id))}>停止任务</button>}
        {(task.status === 'waiting_retry' || task.status === 'cancelled' || task.status === 'failed' && task.retryable) && <button className="video-button" disabled={pending} onClick={() => void act(() => videoClient.resumeTask(task.id))}>从断点继续</button>}
        {task.status === 'completed' && task.kind !== 'preflight' && !task.appliedRevision && <button className="video-button primary" disabled={pending} onClick={() => void act(() => inspect(task))}>查看结果与差异</button>}
        {task.status === 'failed' && task.resultAvailable && <button className="video-button" disabled={pending} onClick={() => void act(() => inspect(task, task.issues?.find(issue => issue.shotId)?.shotId))}>查看失败候选</button>}
        {task.appliedRevision && <span>已采用</span>}
      </div>
  return <section className="video-task-panel" aria-label="后台制作流程">
    <div className="video-task-summary">
      <div className="video-task-summary-status"><strong>后台任务{activeCount > 0 ? ` · ${activeCount} 项进行中` : ''}</strong><span title={spotlight ? `${names[spotlight.kind]} · ${states[spotlight.status]}` : undefined}>{spotlight ? `${names[spotlight.kind]} · ${states[spotlight.status]}${['running', 'queued'].includes(spotlight.status) && spotlight.completedShots === undefined ? ` ${Math.round(spotlight.progress)}%` : ''}` : '历史记录已保留'}</span></div>
      {spotlight && !tasksOpen && actions(spotlight)}
      <button className="video-button" aria-label="查看后台任务" onClick={() => setTasksOpen(true)}>查看后台任务（{visibleTasks.length}）</button>
    </div>
    {progressiveTask && <VideoTaskProgress key={progressiveTask.id} task={progressiveTask} />}
    {error && !tasksOpen && !review && <p role="alert" className="video-job-error">{error}</p>}
    <dialog ref={taskDialog} className="video-task-dialog" aria-label="后台任务记录" onCancel={() => setTasksOpen(false)} onClose={() => setTasksOpen(false)}>
      <div className="video-section-title"><h2>后台任务记录</h2><button className="video-button" onClick={() => setTasksOpen(false)}>关闭任务记录</button></div>
      <p className="video-task-history-hint">当前分镜为第 {project.revision} 版。历史任务的失败记录不影响当前分镜编辑；任务进度保存在本机。</p>
      {visibleTasks.map(task => <article className="video-task-row" key={task.id}>
      <div><strong>{names[task.kind]}</strong><span>{states[task.status]}{task.stage && task.stage !== task.status ? ` · ${task.stage}` : ''}</span><span>第 {task.expectedRevision} 版{task.expectedRevision !== project.revision ? ' · 历史版本' : ''} · 已执行 {task.attempt} 次</span><span>{Math.round(task.progress)}% · 已用时 {formatVideoTaskDuration(videoTaskElapsedSeconds(task, now))}（含等待）</span></div>
      <progress aria-label={`${names[task.kind]}进度`} max={100} value={task.progress} />
      {actions(task)}
      {task.error && !task.issues?.some(issue => issue.message === task.error) && <p className="video-job-error">{task.error}</p>}
      {task.status === 'waiting_retry' && <p className="video-task-issue">任务已暂停，已完成进度保留；点击“从断点继续”恢复执行。</p>}
      {task.issues?.map((issue, index) => <p className="video-task-issue" key={index}>{issue.message}{issue.shotId && <button className="video-link-button" onClick={() => { if (task.status === 'failed' && task.resultAvailable) void act(() => inspect(task, issue.shotId)); else { setTasksOpen(false); onSelectShot(issue.shotId!) } }}>定位镜头</button>}</p>)}
    </article>)}
      {error && <p role="alert" className="video-job-error">{error}</p>}
    </dialog>
    {review && <div className="video-modal-backdrop"><section className="video-task-review" role="dialog" aria-modal="true" aria-label="生成结果与修改差异">
      <div className="video-section-title"><h2>{names[review.task.kind]} · 修改前后</h2><button className="video-button" onClick={() => setReview(null)}>关闭</button></div>
      {review.readOnly && <div className="video-review-note"><p>失败候选 · 只读。请依据校验问题调整内容后重新生成。</p>{review.task.issues?.map((issue, index) => <p key={index}>{issue.message}</p>)}<details><summary>查看候选镜头内容</summary><pre className="video-clean-script">{JSON.stringify(after, null, 2)}</pre></details></div>}
      {review.descriptions.length > 0 && <ul>{review.descriptions.map((text, i) => <li key={i}>{text}</li>)}</ul>}
      {review.task.kind === 'problem_script' ? <div className="video-task-comparison"><section><h3>当前讲稿</h3><pre>{project.workflow?.scriptDraft ?? project.sourceScript}</pre></section><section><h3>建议讲稿</h3><pre>{review.project.sourceScript}</pre><p>{review.project.problem?.analysis}</p><p>{review.project.problem?.answer}</p></section></div> : <>
        <label className="video-field">查看镜头<select value={selected} onChange={event => setSelected(event.target.value)}>{review.project.shots.map(shot => <option key={shot.id} value={shot.id}>{shot.title}</option>)}</select></label>
        <div className="video-task-comparison"><section><h3>当前画面</h3>{before ? <VideoSceneEditor project={project} shot={before} disabled onChangeLayout={() => {}} /> : <p>新增镜头</p>}</section><section><h3>建议画面</h3>{after?.story ? <><p>{after.story.description}</p><p className="video-field-hint">采用后导入镜头插画，审核背景与有限动效。</p></> : after && <VideoSceneEditor project={review.project} shot={after} disabled onChangeLayout={() => {}} />}</section></div>
      </>}
      {!review.readOnly && review.task.expectedRevision !== project.revision && <div className="video-review-note"><p>生成期间工程有新修改。独立修改将自动合并；同一字段有冲突时需要明确选择。</p><label><input type="checkbox" checked={overwrite} onChange={event => setOverwrite(event.target.checked)} />我已对比，同一字段冲突时采用这份建议</label></div>}
      {error && <p role="alert" className="video-job-error">{error}</p>}
      {!review.readOnly && <div className="video-dialog-actions"><button className="video-button primary" disabled={disabled || pending} onClick={() => void act(async () => { await onApply(review.task, overwrite); setReview(null) })}>采用这份结果</button></div>}
    </section></div>}
  </section>
}
