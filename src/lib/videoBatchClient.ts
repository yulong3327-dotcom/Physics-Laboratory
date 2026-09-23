import { checkExpiredSession } from './apiSession'

export interface VideoBatchRequest {
  id: string
  kind: 'final' | 'preview'
  projects: { projectId: string; expectedRevision: number }[]
}
export interface VideoBatchReceipt {
  id: string
  kind: 'final' | 'preview'
  createdAt: string
  status: 'completed'
  items: { projectId: string; expectedRevision: number; jobId?: string; error?: string }[]
}
const storageKey = 'physics-video-workbench:render-batch:v1'
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(value)
export function readPendingVideoBatch(): VideoBatchRequest | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || 'null')
    if (value && validId(value.id) && ['final', 'preview'].includes(value.kind)
      && Array.isArray(value.projects) && value.projects.length > 0 && value.projects.length <= 50
      && value.projects.every((item: any) => validId(item?.projectId) && Number.isSafeInteger(item.expectedRevision) && item.expectedRevision > 0)) return value
  } catch { /* The server's durable receipts remain authoritative. */ }
}
export function rememberVideoBatch(request: VideoBatchRequest) { localStorage.setItem(storageKey, JSON.stringify(request)) }
export function forgetVideoBatch(id: string) {
  if (readPendingVideoBatch()?.id === id) localStorage.removeItem(storageKey)
}
async function batchRequest(path: string, request?: VideoBatchRequest): Promise<VideoBatchReceipt> {
  const response = await fetch('/api/video/render-batches' + path, {
    method: request ? 'POST' : 'GET', signal: AbortSignal.timeout(60_000),
    ...(request ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) } : {}),
  })
  checkExpiredSession(response)
  const value = await response.json().catch(() => undefined)
  if (!response.ok) throw new Error(value?.error || `批量提交状态暂时无法确认（${response.status}），可重试原提交。`)
  if (!value || !validId(value.id) || value.status !== 'completed' || !['final', 'preview'].includes(value.kind)
    || !Array.isArray(value.items) || !value.items.every((item: any) => validId(item?.projectId) && Number.isSafeInteger(item.expectedRevision)
      && (validId(item.jobId) || typeof item.error === 'string'))) throw new Error('批量提交回执尚未完整，请重试原提交。')
  return value as VideoBatchReceipt
}
export const videoBatchClient = {
  submit: (request: VideoBatchRequest) => batchRequest('', request),
  read: (id: string) => batchRequest('/' + encodeURIComponent(id)),
}
