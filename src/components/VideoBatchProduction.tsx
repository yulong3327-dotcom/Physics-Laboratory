import { useEffect, useMemo, useRef, useState } from 'react'
import type { VideoProjectSummary } from '../../server/videoProjectCatalog'
import type { GenerationTask, RenderJob } from '../../server/videoTypes'
import { videoProjectHash } from '../lib/videoDrafts'
import { forgetVideoBatch, readPendingVideoBatch, rememberVideoBatch, videoBatchClient, type VideoBatchReceipt, type VideoBatchRequest } from '../lib/videoBatchClient'
import './VideoBatchProduction.css'

export function VideoBatchProduction({ projects, jobs, tasks, disabled = false, onSubmitted }: {
  projects: VideoProjectSummary[]; jobs: RenderJob[]; tasks: GenerationTask[]; disabled?: boolean; onSubmitted(): void
}) {
  const [kind, setKind] = useState<'final' | 'preview'>('final')
  const [selected, setSelected] = useState<Record<string, number>>({})
  const [query, setQuery] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [pending, setPending] = useState(readPendingVideoBatch)
  const [receipt, setReceipt] = useState<VideoBatchReceipt>()
  const action = useRef(false), mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (!pending) return
    let cancelled = false
    void videoBatchClient.read(pending.id).then(value => {
      if (!cancelled) { setReceipt(value); setPending(undefined); forgetVideoBatch(value.id) }
    }).catch(() => { /* Keep the original request so explicit retry remains idempotent. */ })
    return () => { cancelled = true }
  }, [pending?.id])
  const active = useMemo(() => new Set([
    ...jobs.filter(job => ['queued', 'running'].includes(job.status)).map(job => job.projectId),
    ...tasks.filter(task => ['queued', 'running', 'waiting_retry'].includes(task.status)).map(task => task.projectId),
  ]), [jobs, tasks])
  const available = projects.filter(project => project.lifecycle === 'active')
  const eligible = (project: VideoProjectSummary) => project.stage === 'render' && !project.activeTaskCount && !active.has(project.id)
  const produced = (project: VideoProjectSummary) => jobs.some(job => job.projectId === project.id && job.projectRevision === project.revision && job.kind === kind && job.status === 'completed')
  const chosen = available.filter(project => selected[project.id] === project.revision && eligible(project))
  const stale = Object.keys(selected).length !== chosen.length
  const shown = available.filter(project => project.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a, b) => Number(eligible(b)) - Number(eligible(a)) || a.title.localeCompare(b.title, 'zh-CN'))
  const submit = async (existing?: VideoBatchRequest) => {
    if (action.current || disabled) return
    const request = existing || { id: crypto.randomUUID(), kind, projects: chosen.map(project => ({ projectId: project.id, expectedRevision: project.revision })) }
    if (!request.projects.length || request.projects.length > 50 || !existing && stale) return
    action.current = true; setBusy(true); setError('')
    try {
      // Persist the identity before sending: a lost response can retry the same
      // submission after navigation/reload without creating duplicate videos.
      rememberVideoBatch(request); setPending(request)
      const result = await videoBatchClient.submit(request)
      forgetVideoBatch(result.id)
      if (mounted.current) { setReceipt(result); setPending(undefined); setSelected({}); onSubmitted() }
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : '提交状态尚未确认，请重试原提交。')
    } finally { action.current = false; if (mounted.current) setBusy(false) }
  }
  return <section className="video-batch-production" aria-label="批量制作">
    <h3>审核通过后，统一加入制作队列</h3>
    <p>选择已确认分镜的项目。提交后由后台依次制作，关闭页面也会继续；中途修改项目不会改变已提交的版本。</p>
    <div className="video-batch-toolbar">
      <label>输出规格<select aria-label="批量输出规格" value={kind} disabled={busy || !!pending} onChange={event => setKind(event.target.value as 'final' | 'preview')}><option value="final">高清成片 · 1080p</option><option value="preview">整片预览 · 720p</option></select></label>
      <input aria-label="搜索待制作项目" placeholder="搜索项目名称" value={query} onChange={event => setQuery(event.target.value)} />
      <button className="video-button" disabled={disabled || busy || !!pending} onClick={() => setSelected(Object.fromEntries(shown.filter(project => eligible(project) && !produced(project)).slice(0, 50).map(project => [project.id, project.revision])))}>选择可制作项目</button>
      <button className="video-button" disabled={busy || !!pending || !Object.keys(selected).length} onClick={() => setSelected({})}>清空选择</button>
    </div>
    {pending && <div className="video-batch-pending" role="status"><p>{busy ? `正在提交 ${pending.projects.length} 个项目…` : `上一批 ${pending.projects.length} 个项目的提交结果尚未确认，重试会使用原提交记录，避免重复制作。`}</p><button className="video-button" disabled={busy || disabled} onClick={() => void submit(pending)}>重试原提交</button></div>}
    {error && <p className="video-message error" role="alert">{error}</p>}
    {receipt && <div className="video-batch-receipt" role="status"><strong>已加入 {receipt.items.filter(item => item.jobId).length} 个项目，{receipt.items.filter(item => item.error).length} 个项目需处理</strong><p>制作进度见“进行中”，完成后到“成片库”下载。</p>
      <ul>{receipt.items.map(item => <li key={item.projectId}><span>{projects.find(project => project.id === item.projectId)?.title || item.projectId} · 第 {item.expectedRevision} 版</span><span>{item.error || '已加入队列'}</span>{item.error && <a href={videoProjectHash(item.projectId, 'storyboard')}>查看项目</a>}</li>)}</ul>
    </div>}
    <div className="video-batch-projects">{shown.map(project => <label key={project.id} className={`video-batch-project ${eligible(project) ? '' : 'unavailable'}`}>
      <input type="checkbox" aria-label={`选择 ${project.title}`} checked={selected[project.id] === project.revision} disabled={disabled || busy || !!pending || !eligible(project) || !selected[project.id] && chosen.length >= 50}
        onChange={event => setSelected(current => { const next = { ...current }; if (event.target.checked) next[project.id] = project.revision; else delete next[project.id]; return next })} />
      <span><strong>{project.title}</strong><small>第 {project.revision} 版 · {project.shotCount} 个镜头</small></span>
      <span className="video-batch-project-state">{active.has(project.id) || project.activeTaskCount ? '已有任务，完成或取消后可选择' : project.stage !== 'render' ? '请先确认讲稿与分镜' : produced(project) ? '本版已有成片，可选择重新制作' : '审核已通过，可制作'}</span>
    </label>)}</div>
    {!shown.length && <p className="video-production-empty">没有符合条件的项目，请先在项目中心创建并审核内容。</p>}
    {stale && <p className="video-message" role="status">所选项目的版本或状态已变化，请清空选择后重新选择，确保制作的是已审核版本。</p>}
    <div className="video-batch-submit"><span>已选择 {chosen.length} / 50 个项目</span><button className="video-button primary" disabled={disabled || busy || !!pending || stale || !chosen.length} onClick={() => void submit()}>加入制作队列（{chosen.length}）</button></div>
  </section>
}
