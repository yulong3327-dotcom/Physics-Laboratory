import { useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { GenerationTask, RenderJob } from '../../server/videoTypes'
import type { VideoProjectSummary } from '../../server/videoProjectCatalog'
import { videoClient } from '../lib/videoClient'
import { productionEntries, productionStatus, type ProductionEntry } from '../lib/videoProduction'
import { videoProjectHash } from '../lib/videoDrafts'
import { VideoBatchProduction } from './VideoBatchProduction'
import './VideoProductionCenter.css'

export function VideoProductionCenter() {
  const [projects, setProjects] = useState<VideoProjectSummary[]>([])
  const [jobs, setJobs] = useState<RenderJob[]>([]), [tasks, setTasks] = useState<GenerationTask[]>([])
  const [filter, setFilter] = useState('active'), [query, setQuery] = useState(''), [page, setPage] = useState(1)
  const [projectFilter, setProjectFilter] = useState('')
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [loadError, setLoadError] = useState(''), [updatedAt, setUpdatedAt] = useState('')
  const [busy, setBusy] = useState(''), [refresh, setRefresh] = useState(0)
  useEffect(() => {
    if (busy) return
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>
    const load = async () => {
      const [p, j, t] = await Promise.allSettled([videoClient.projectSummaries('all', { signal: controller.signal }),
        videoClient.jobs(undefined, { signal: controller.signal }), videoClient.tasks(undefined, { signal: controller.signal })])
      if (controller.signal.aborted) return
      const problems: string[] = []
      if (p.status === 'fulfilled') setProjects(p.value)
      else problems.push('项目目录暂时不可用')
      if (j.status === 'fulfilled') setJobs(j.value)
      else problems.push('视频任务更新失败：' + (j.reason instanceof Error ? j.reason.message : '请重试'))
      if (t.status === 'fulfilled') setTasks(t.value)
      else problems.push('生成任务更新失败：' + (t.reason instanceof Error ? t.reason.message : '请重试'))
      setLoadError(problems.join('；')); setLoading(false)
      if (!problems.length) setUpdatedAt(new Date().toLocaleTimeString('zh-CN'))
      timer = setTimeout(load, 4000)
    }
    void load()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [refresh, busy])
  const projectMap = useMemo(() => new Map(projects.map(project => [project.id, project])), [projects])
  const entries = useMemo(() => productionEntries(tasks, jobs), [tasks, jobs])
  const matches = entries.filter(entry => (filter === 'all' || filter === 'active' && entry.active
    || filter === 'attention' && entry.attention || filter === 'outputs' && entry.type === 'render' && entry.status === 'completed')
    && (!projectFilter || entry.projectId === projectFilter)
    && `${projectMap.get(entry.projectId)?.title || entry.projectId} ${entry.label} ${entry.stage}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const pages = Math.max(1, Math.ceil(matches.length / 20)), currentPage = Math.min(page, pages)
  const act = async (entry: ProductionEntry, action: 'resume' | 'cancel') => {
    if (busy) return
    setBusy(`${entry.type}:${entry.id}`); setError(''); setNotice('')
    try {
      if (entry.type === 'render') {
        const job = await (action === 'resume' ? videoClient.resumeRender(entry.id) : videoClient.cancel(entry.id))
        setJobs(items => items.map(item => item.id === job.id ? job : item))
      } else {
        const task = await (action === 'resume' ? videoClient.resumeTask(entry.id) : videoClient.cancelTask(entry.id))
        setTasks(items => items.map(item => item.id === task.id ? task : item))
      }
      setNotice(action === 'resume' ? `已继续第 ${entry.revision} 版任务；已完成且仍适用的步骤会自动复用。` : '任务已取消，已完成内容保留。')
      setRefresh(value => value + 1)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败') }
    finally { setBusy('') }
  }
  return <section className="video-production-center" aria-label="生产中心">
    <div className="video-production-heading"><div><h2>生产中心</h2><p>跨项目查看讲稿、分镜、配音和成片任务。继续任务沿用原版本；新修改请进入项目重新制作。</p></div>
      <button className="video-button" disabled={!!busy} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={15} />刷新生产状态</button></div>
    <nav className="video-production-filters" aria-label="生产任务筛选">
      <button aria-pressed={filter === 'batch'} onClick={() => { setFilter('batch'); setPage(1) }}>批量制作</button>
      {([['active', '进行中', entries.filter(entry => entry.active).length], ['attention', '待处理', entries.filter(entry => entry.attention).length],
        ['outputs', '成片库', entries.filter(entry => entry.type === 'render' && entry.status === 'completed').length], ['all', '全部任务', entries.length]] as const)
        .map(([key, label, count]) => <button key={key} aria-pressed={filter === key} onClick={() => { setFilter(key); setPage(1) }}>{label}<span>{count}</span></button>)}
      {filter !== 'batch' && <><select aria-label="生产项目筛选" value={projectFilter} onChange={event => { setProjectFilter(event.target.value); setPage(1) }}><option value="">全部项目</option>{projects.map(project => <option key={project.id} value={project.id}>{project.title}{project.lifecycle !== 'active' ? '（已归档或删除）' : ''}</option>)}</select>
      <input aria-label="搜索生产任务" placeholder="搜索项目、类型或阶段" value={query} onChange={event => { setQuery(event.target.value); setPage(1) }} /></>}
    </nav>
    <p className="video-production-update">每 4 秒自动更新{updatedAt && ` · 最近同步 ${updatedAt}`}{loadError && ' · 部分记录可能尚未更新'}</p>
    {loadError && <p className="video-message error" role="alert">{loadError}</p>}
    {error && <p className="video-message error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {loading && <p role="status">正在读取生产任务…</p>}
    {filter === 'batch' ? <VideoBatchProduction projects={projects} jobs={jobs} tasks={tasks} disabled={loading || !!loadError} onSubmitted={() => setRefresh(value => value + 1)} /> : <>
    {!loading && !matches.length && <p className="video-production-empty">{filter === 'active' ? '目前没有正在处理的任务，可打开项目继续准备内容。' : '没有符合条件的任务。'}</p>}
    <div className="video-production-list">{matches.slice((currentPage - 1) * 20, currentPage * 20).map(entry => {
      const project = projectMap.get(entry.projectId), unavailable = project?.lifecycle !== 'active'
      return <article key={`${entry.type}:${entry.id}`} className={`video-production-item ${entry.status}`} aria-label={`${project?.title || entry.projectId} · ${entry.label}`}>
        <div className="video-production-item-heading"><div><h3>{project?.title || entry.projectId}</h3><p>{entry.label} · 第 {entry.revision} 版
          {entry.revision !== project?.revision && project && `（当前第 ${project.revision} 版）`}</p></div><strong>{productionStatus(entry)}</strong></div>
        <p className="video-production-stage">{entry.stage}{entry.active ? ` · ${Math.round(entry.progress)}%` : ''}</p>
        {entry.active && <progress aria-label={`${project?.title || entry.projectId}制作进度`} max="100" value={entry.progress} />}
        {entry.error && <p className="video-job-error">{entry.error}</p>}
        {entry.type === 'render' && entry.status === 'failed' && !entry.canResume && <p className="video-field-hint">此制作版本需要修正。请打开项目处理问题，确认后重新制作。</p>}
        <small>{new Date(entry.createdAt).toLocaleString('zh-CN')}{entry.job?.cachedShots ? ` · 复用 ${entry.job.cachedShots} 个镜头` : ''}{entry.job?.duration ? ` · 时长 ${Math.round(entry.job.duration)} 秒` : ''}</small>
        <div className="video-production-actions">
          {!unavailable && <a className="video-button" href={videoProjectHash(entry.projectId, entry.target)}>{entry.type === 'generation' && entry.status === 'completed' && entry.attention ? '查看结果与采用' : '打开项目'}</a>}
          {entry.active && <button className="video-button" disabled={!!busy} onClick={() => void act(entry, 'cancel')}>取消任务</button>}
          {entry.canResume && !unavailable && <button className="video-button" disabled={!!busy || entries.some(other => other.projectId === entry.projectId && other.active)} onClick={() => void act(entry, 'resume')}>从断点继续</button>}
          {entry.type === 'render' && entry.status === 'completed' && <>
            {entry.job.videoUrl && <a className="video-button primary" href={entry.job.videoUrl} download>下载视频</a>}
            {entry.job.subtitleUrl && <a className="video-button" href={entry.job.subtitleUrl} download>字幕</a>}
            {entry.job.archiveUrl && <a className="video-button" href={entry.job.archiveUrl} download>工程包</a>}
            {entry.job.validationReportUrl && <a className="video-button" href={entry.job.validationReportUrl} target="_blank" rel="noreferrer">验收报告</a>}
          </>}
          {unavailable && <span className="video-field-hint">请先在项目中心恢复此项目。</span>}
        </div>
      </article>
    })}</div>
    {pages > 1 && <div className="video-production-pagination"><button className="video-button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>上一页</button><span>{currentPage} / {pages}</span><button className="video-button" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>下一页</button></div>}
    </>}
  </section>
}
