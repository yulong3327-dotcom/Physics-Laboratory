import type { GenerationTask, RenderJob } from '../../server/videoTypes'

export type ProductionEntry = { id: string; projectId: string; revision: number; label: string; status: string;
  progress: number; stage: string; createdAt: string; error?: string; active: boolean; attention: boolean;
  canResume: boolean; target: 'script' | 'storyboard' | 'timeline' | 'output' } & (
    { type: 'generation'; task: GenerationTask; job?: never } | { type: 'render'; job: RenderJob; task?: never })

const generationNames: Record<GenerationTask['kind'], string> = {
  problem_script: '解析讲稿', storyboard: '分镜生成', storyboard_patch: '分镜修改', preflight: '配音与时间轴',
}
export function productionEntries(tasks: GenerationTask[], jobs: RenderJob[]): ProductionEntry[] {
  const generation: ProductionEntry[] = tasks.map(task => ({
    type: 'generation', task, id: task.id, projectId: task.projectId, revision: task.expectedRevision,
    label: generationNames[task.kind], status: task.status, progress: task.progress, stage: task.stage,
    createdAt: task.createdAt, error: task.error, active: ['queued', 'running'].includes(task.status),
    attention: ['failed', 'waiting_retry', 'cancelled'].includes(task.status)
      || task.status === 'completed' && task.kind !== 'preflight' && !task.appliedRevision,
    canResume: task.status === 'cancelled' || task.status === 'waiting_retry' || task.status === 'failed' && task.retryable === true,
    target: task.kind === 'problem_script' ? 'script' : task.kind === 'preflight' ? 'timeline' : 'storyboard',
  }))
  const rendering: ProductionEntry[] = jobs.map(job => ({
    type: 'render', job, id: job.id, projectId: job.projectId, revision: job.projectRevision,
    label: job.kind === 'final' ? '高清成片' : job.kind === 'preview' ? '整片预览' : '镜头预览',
    status: job.status, progress: job.progress, stage: job.stage, createdAt: job.createdAt, error: job.error,
    active: ['queued', 'running'].includes(job.status), attention: job.status === 'failed' || job.status === 'cancelled',
    canResume: job.status === 'cancelled' || job.status === 'failed' && job.retryable !== false
      && !['render_snapshot_invalid', 'teaching_invalid', 'invalid_content', 'preflight_failed'].includes(job.errorCode || ''), target: 'output',
  }))
  return [...generation, ...rendering].sort((a, b) => Number(b.active) - Number(a.active)
    || (a.active && b.active ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt))
    || a.id.localeCompare(b.id))
}

export function productionStatus(entry: ProductionEntry): string {
  if (entry.type === 'generation' && entry.status === 'completed' && entry.attention) return '待查看与采用'
  return ({ queued: '排队中', running: '处理中', waiting_retry: '等待继续', failed: '需要处理', cancelled: '已取消', completed: '已完成' })[entry.status] || entry.status
}
