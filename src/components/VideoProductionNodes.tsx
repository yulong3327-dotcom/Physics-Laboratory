import { useEffect, useState } from 'react'
import type { RenderJob, VideoProject } from '../../server/videoTypes'
import { videoClient } from '../lib/videoClient'

export function VideoProductionNodes({ job, project, onSelect }: { job: RenderJob; project: VideoProject; onSelect(id: string): void }) {
  const [open, setOpen] = useState(false)
  const [nodes, setNodes] = useState<Awaited<ReturnType<typeof videoClient.productionNodes>>['nodes']>([])
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open) return
    let active = true, timer: ReturnType<typeof setTimeout>
    const refresh = async () => {
      try { const value = await videoClient.productionNodes(job.id); if (active) { setNodes(value.nodes); setError('') } }
      catch (reason) { if (active) setError(reason instanceof Error ? reason.message : '镜头状态读取失败') }
      finally { if (active && ['queued', 'running'].includes(job.status)) timer = setTimeout(refresh, 2500) }
    }
    void refresh()
    return () => { active = false; clearTimeout(timer) }
  }, [open, job.id, job.status])
  const names: Record<string, string> = { queued: '等待中', running: '制作中', succeeded: '已完成', failed: '失败' }
  return <details className="video-production-nodes" open={open} onToggle={e => setOpen(e.currentTarget.open)}>
    <summary>逐镜头制作状态 · 第 {job.projectRevision} 版</summary>
    {error && <p role="alert">{error}</p>}
    {!nodes.length && <p>尚无镜头记录。旧任务可继续制作以生成记录。</p>}
    {nodes.map(node => <div key={node.shotId} className="video-production-node"><div><button className="video-link-button" onClick={() => onSelect(node.shotId)}>{project.shots.find(s => s.id === node.shotId)?.title || node.shotId}</button><span>{names[node.status] || node.status}{node.cached ? ' · 复用缓存' : ''} · 尝试 {node.attempts} 次</span></div>{node.error && <p className="video-job-error">{node.error.message}</p>}</div>)}
  </details>
}
