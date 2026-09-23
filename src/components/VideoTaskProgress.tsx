import { useEffect, useRef, useState } from 'react'
import type { GenerationPartialResult, GenerationTask } from '../../server/videoTypes'
import { videoClient } from '../lib/videoClient'
import { VideoSceneEditor } from './VideoSceneEditor'

const pageSize = 4
const readOnlyLayout = () => {}

/** Display saved candidate frames without adopting them into the editable project. */
export function VideoTaskProgress({ task }: { task: GenerationTask }) {
  const [snapshot, setSnapshot] = useState<GenerationPartialResult | null>(null)
  const [error, setError] = useState(''), [retry, setRetry] = useState(0)
  const [expanded, setExpanded] = useState(true), [page, setPage] = useState<number | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const loadedVersion = useRef(-1)
  const previewDialog = useRef<HTMLDialogElement>(null)
  const advertisedVersion = task.partialResultVersion || 0

  useEffect(() => {
    if (advertisedVersion <= loadedVersion.current) return
    const controller = new AbortController()
    setError('')
    void videoClient.taskPartialResult(task.id, { signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return
      loadedVersion.current = value.version
      setSnapshot(value)
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '实时画面读取失败，请重试。')
    })
    return () => controller.abort()
  }, [task.id, advertisedVersion, retry])

  const project = snapshot?.project
  const readyIds = new Set(snapshot?.completedShotIds || [])
  const shots = project?.shots || []
  // Text-only story plans are useful progress, but must not be called completed images.
  const ready = shots.filter(shot => readyIds.has(shot.id) && (!shot.story || !!shot.story.imageDataUrl))
  const pendingImages = shots.filter(shot => shot.story && !shot.story.imageDataUrl)
  const pages = Math.max(1, Math.ceil(shots.length / pageSize))
  const currentPage = Math.min(page ?? pages - 1, pages - 1)
  const displayed = shots.slice(currentPage * pageSize, (currentPage + 1) * pageSize)
  const selected = shots.find(shot => shot.id === selectedId)
  const running = task.status === 'running' || task.status === 'queued'
  const canResume = task.status === 'waiting_retry' || task.status === 'cancelled' || task.status === 'failed' && task.retryable
  const stage = !running && task.error ? task.error : task.status === 'cancelled' ? '任务已停止'
    : ['starting', 'queued', 'recovered'].includes(task.stage) ? '准备生成画面'
      : task.stage === 'completed' ? '本次分镜已完成' : task.stage || '等待生成画面'
  const completedUtterances = snapshot?.completedUtterances ?? task.completedUtterances
  const totalUtterances = snapshot?.totalUtterances ?? task.totalUtterances
  const completedCount = snapshot ? ready.length : task.completedShots || 0

  useEffect(() => {
    if (selected && previewDialog.current && !previewDialog.current.open) previewDialog.current.showModal()
    else if (!selected) previewDialog.current?.close()
  }, [selectedId, selected?.id])

  return <section className="video-task-progress" aria-label="实时分镜画面">
    <div className="video-task-progress-heading">
      <div aria-live="polite"><strong>已完成 {completedCount} 张画面</strong>{!!pendingImages.length && <span> · {pendingImages.length} 张剧情图片待生成</span>}{totalUtterances !== undefined && <span> · 文稿进度 {completedUtterances || 0}/{totalUtterances} 段</span>}</div>
      <button className="video-link-button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? '收起实时画面' : '展开实时画面'}</button>
    </div>
    {expanded && <>
      <div className="video-task-progress-status"><span>{stage}</span>{!running && task.status !== 'completed' && <span>{canResume ? '已完成画面已保留，可从断点继续。' : '已完成画面已保留，请按错误提示调整后重新生成。'}</span>}</div>
      {error && <p role="alert" className="video-task-progress-error">{error}<button className="video-link-button" onClick={() => setRetry(value => value + 1)}>重新读取实时画面</button></p>}
      {!!displayed.length && project ? <div className="video-task-progress-gallery">
        {displayed.map((shot, index) => {
          const isReady = readyIds.has(shot.id) && (!shot.story || !!shot.story.imageDataUrl)
          return <article className="video-task-progress-card" key={shot.id} data-progress-shot-id={shot.id}>
            {isReady ? <div className="video-task-progress-thumbnail"><VideoSceneEditor project={project} shot={shot} disabled onChangeLayout={readOnlyLayout} /></div> : <div className="video-task-progress-placeholder"><strong>{shot.story && !shot.story.imageDataUrl ? '待生成图片' : '画面准备中'}</strong><span>{shot.story?.description || shot.summary}</span></div>}
            <div className="video-task-progress-caption"><span title={shot.title}>{String(currentPage * pageSize + index + 1).padStart(2, '0')} · {shot.title}</span>{isReady && <button className="video-link-button" aria-label={`查看实时画面：${shot.title}`} onClick={() => setSelectedId(shot.id)}>放大</button>}</div>
          </article>
        })}
      </div> : <p className="video-task-progress-empty">{running ? '第一张画面完成后会自动展示，后续逐张追加。' : '当前还没有可展示的画面。'}</p>}
      {pages > 1 && <nav className="video-task-progress-pagination" aria-label="实时画面翻页"><button className="video-link-button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一组画面</button><span>{currentPage + 1} / {pages}</span><button className="video-link-button" disabled={currentPage === pages - 1} onClick={() => setPage(currentPage + 1)}>下一组画面</button>{page !== null && <button className="video-link-button" onClick={() => setPage(null)}>跟随最新画面</button>}</nav>}
      <p className="video-task-progress-hint">每张完成即保存并展示，刷新页面后仍可查看。全部完成后可查看差异并采用。</p>
    </>}
    <dialog ref={previewDialog} className="video-task-progress-dialog" aria-label="实时分镜放大预览" onCancel={() => setSelectedId('')} onClose={() => setSelectedId('')}>
      <div className="video-section-title"><h2>{selected?.title}</h2><button className="video-button" onClick={() => setSelectedId('')}>关闭放大预览</button></div>
      {selected && project && <VideoSceneEditor project={project} shot={selected} disabled onChangeLayout={readOnlyLayout} />}
    </dialog>
  </section>
}
