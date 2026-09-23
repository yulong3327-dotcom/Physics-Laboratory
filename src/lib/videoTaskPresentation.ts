import type { GenerationTask } from '../../server/videoTypes'

/** Task storage order can change after a server restart. Never infer recency from it. */
export function newestVideoTasks(tasks: GenerationTask[]): GenerationTask[] {
  return [...tasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt)
    || b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))
}

/** Keep live work and unadopted results accessible without resurfacing obsolete failures. */
export function videoTaskSpotlight(tasks: GenerationTask[], revision: number): GenerationTask | undefined {
  const sorted = newestVideoTasks(tasks)
  return sorted.find(task => task.status === 'running' || task.status === 'queued')
    || sorted.find(task => task.status === 'completed' && task.kind !== 'preflight' && !task.appliedRevision)
    || sorted.find(task => task.expectedRevision === revision)
}

export function videoTaskSubmissionNotice(task: GenerationTask): string {
  switch (task.status) {
    case 'queued': return '任务已排队，轮到后会自动执行。可以关闭页面，稍后返回查看进度。'
    case 'running': return '后台任务正在执行。可以关闭页面，稍后返回查看进度和结果。'
    case 'waiting_retry': return '任务已暂停，已完成进度保留。请在后台任务中点击“从断点继续”。'
    case 'completed': return task.kind === 'preflight' ? '已复用完成的配音与时间轴，可以直接预览。'
      : task.appliedRevision ? '这份生成结果已采用，可以继续审核当前内容。'
        : task.kind === 'storyboard_patch' ? '局部修改已完成，请在后台任务中查看差异并采用结果。'
          : '生成结果已完成，请在后台任务中查看画面与差异，然后采用这份结果。'
    case 'cancelled': return '任务已停止，已完成进度保留。可在后台任务中从断点继续。'
    case 'failed': return '任务未完成，请查看后台任务中的具体原因和修复建议。'
  }
}

/** Wall time includes waiting; paused/finished tasks stop at the recorded state update. */
export function videoTaskElapsedSeconds(task: GenerationTask, now: number): number {
  const started = Date.parse(task.createdAt)
  const ended = task.status === 'queued' || task.status === 'running' ? now : Date.parse(task.updatedAt)
  return Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, Math.floor((ended - started) / 1000)) : 0
}

export function formatVideoTaskDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60), rest = seconds % 60
  return minutes ? `${minutes} 分 ${rest.toString().padStart(2, '0')} 秒` : `${rest} 秒`
}
