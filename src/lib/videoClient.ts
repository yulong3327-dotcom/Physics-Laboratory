import { checkExpiredSession } from './apiSession'
import type { RenderJob, VideoProject, VideoSystemStatus, GenerationTask, GenerationPartialResult, GenerationTaskKind, VideoTimelinePreview, Shot } from '../../server/videoTypes'
import { normalizeVideoProjectRoles } from './videoRoles'
import { normalizeVideoStoryboardActions, VIDEO_CIRCUIT_ACTION_TYPES, validVideoAnimationDuration, validVideoStateParameters } from '../../server/videoActionTargets'
import { sameProjectContent } from '../../server/videoProjectMerge'
import { VIDEO_BOARD_ENTRANCES, VIDEO_HIGHLIGHT_EFFECTS, validateVideoShotPresentation } from '../../server/videoPresentation'
import type { VideoProjectSummary } from '../../server/videoProjectCatalog'

const migratedProjects = new WeakSet<VideoProject>()
/** Recover only deterministic legacy encodings; keep all user edits and IDs. */
export function migrateVideoEditorProject(input: VideoProject): { project: VideoProject; changed: boolean } {
  const project = normalizeVideoStoryboardActions(normalizeVideoProjectRoles(input))
  const changed = !sameProjectContent(input, project) || input.approvedRevision !== project.approvedRevision
  if (changed) { delete project.approvedRevision; migratedProjects.add(project) }
  return { project, changed }
}
export function needsVideoMigrationSave(project: VideoProject): boolean { return migratedProjects.has(project) }

const base = '/api/video'
const invalidResponse = '视频服务返回了无效数据，请检查本机服务后重试。当前草稿会保留。'
const requestTimeoutMs = 30_000
function requestSignal(signal?: AbortSignal | null): AbortSignal {
  const timeout = AbortSignal.timeout(requestTimeoutMs)
  if (!signal) return timeout
  // A caller supplied signal must not disable the client's safety timeout.
  return AbortSignal.any([signal, timeout])
}
function record(value: unknown): value is Record<string, any> { return !!value && typeof value === 'object' && !Array.isArray(value) }
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every(item => typeof item === 'string') }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
function cue(value: unknown) { return record(value) && typeof value.utteranceId === 'string' && (value.phrase === undefined || typeof value.phrase === 'string') && (value.offset === undefined || finite(value.offset)) && (value.occurrence === undefined || Number.isInteger(value.occurrence) && value.occurrence > 0) }
function geometryShape(g: unknown): boolean {
  return record(g) && record(g.bounds) && [g.bounds.x, g.bounds.y, g.bounds.width, g.bounds.height].every(finite)
    && Array.isArray(g.components) && g.components.every((component: unknown) => record(component)
      && [component.id, component.svg, component.label].every(text => typeof text === 'string')
      && [component.x, component.y, component.width, component.height].every(finite) && record(component.terminals)
      && Object.values(component.terminals).every(point => record(point) && finite(point.x) && finite(point.y))
      && (component.image === undefined || (record(component.image) && typeof component.image.dataUrl === 'string' && [component.image.width, component.image.height, component.image.rotation].every(finite))))
    && Array.isArray(g.wires) && g.wires.every((wire: unknown) => record(wire) && [wire.id, wire.path, wire.from, wire.to].every(text => typeof text === 'string') && (wire.current === undefined || finite(wire.current)))
}

/** Validate the editor's required structure before adopting an API or browser draft value. Physics and references are checked separately. */
export function isVideoProjectShape(value: unknown): value is VideoProject {
  return isVideoProjectStructure(value, false)
}
function isVideoProjectStructure(value: unknown, allowEmptyShots: boolean): value is VideoProject {
  if (!record(value) || value.schemaVersion !== 1 || typeof value.id !== 'string' || !Number.isInteger(value.revision) || value.revision < 1) return false
  if (![value.title, value.sourceScript, value.cleanedScript, value.createdAt, value.updatedAt].every(item => typeof item === 'string')) return false
  if (!Array.isArray(value.speakers) || !value.speakers.length || !value.speakers.every(item => record(item) && [item.id, item.name, item.voice, item.color].every(text => typeof text === 'string'))) return false
  if (!Array.isArray(value.utterances) || !allowEmptyShots && !value.utterances.length || !value.utterances.every(item => record(item) && [item.id, item.speakerId, item.text].every(text => typeof text === 'string'))) return false
  if (!Array.isArray(value.shots) || !allowEmptyShots && !value.shots.length || !value.shots.every(shot => record(shot)
    && [shot.id, shot.title, shot.summary].every(text => typeof text === 'string') && Number.isInteger(shot.chapter) && shot.chapter >= 1
    && (shot.sectionTitle === undefined || typeof shot.sectionTitle === 'string') && strings(shot.utteranceIds) && shot.utteranceIds.length > 0 && strings(shot.reviewNotes) && finite(shot.holdSeconds)
    && (shot.boardTexts === undefined || (Array.isArray(shot.boardTexts) && shot.boardTexts.every((b: any) => record(b) && typeof b.id === 'string' && typeof b.text === 'string' && ['keyword', 'law', 'problem', 'given', 'derivation'].includes(b.kind) && (b.cue === undefined || cue(b.cue)) && (b.entrance === undefined || (VIDEO_BOARD_ENTRANCES as readonly string[]).includes(b.entrance)) && validVideoAnimationDuration(b.durationSeconds))))
    && (shot.highlights === undefined || (Array.isArray(shot.highlights) && shot.highlights.every((h: any) => record(h) && [h.id, h.targetId, h.phrase].every(v => typeof v === 'string') && ['board','formula'].includes(h.targetType) && (VIDEO_HIGHLIGHT_EFFECTS as readonly string[]).includes(h.effect) && cue(h.cue))))
    && Array.isArray(shot.formulas) && shot.formulas.every((formula: unknown) => record(formula) && typeof formula.id === 'string' && typeof formula.latex === 'string'
      && ['write', 'substitute', 'transform', 'cancel', 'reciprocal', 'ratio', 'result'].includes(formula.action) && cue(formula.cue)
      && (formula.display === undefined || ['replace', 'append'].includes(formula.display)) && validVideoAnimationDuration(formula.durationSeconds)
      && (formula.parts === undefined || (Array.isArray(formula.parts) && formula.parts.every((part: unknown) => record(part) && typeof part.id === 'string' && typeof part.latex === 'string'))))
    && Array.isArray(shot.actions) && shot.actions.every((action: unknown) => record(action) && typeof action.id === 'string'
      && (VIDEO_CIRCUIT_ACTION_TYPES as readonly string[]).includes(action.type) && strings(action.targetIds) && cue(action.cue) && validVideoAnimationDuration(action.durationSeconds)
      && (action.type !== 'annotation' || record(action.annotation) && ['voltage', 'current'].includes(action.annotation.kind) && typeof action.annotation.label === 'string'
        && (action.annotation.color === undefined || typeof action.annotation.color === 'string') && (action.annotation.side === undefined || ['above', 'below'].includes(action.annotation.side))
        && (action.annotation.direction === undefined || ['forward', 'reverse'].includes(action.annotation.direction)) && (action.annotation.offset === undefined || finite(action.annotation.offset)))
      && (action.type !== 'state' || record(action.state) && typeof action.state.componentId === 'string' && validVideoStateParameters(action.state.parameters))
      && (action.geometry === undefined || geometryShape(action.geometry))))) return false
  if (value.shots.some((shot: Shot) => validateVideoShotPresentation(shot).length)) return false
  if (value.contentKinds !== undefined && (!record(value.contentKinds) || Object.values(value.contentKinds).some(kind => kind !== 'story' && kind !== 'knowledge'))) return false
  for (const shot of value.shots) if (shot.story !== undefined) {
    const story = shot.story
    if (!record(story) || typeof story.description !== 'string' || !['still', 'zoom-in', 'pan-left', 'pan-right', 'fade-in'].includes(story.motion)
      || story.imageDataUrl !== undefined && (typeof story.imageDataUrl !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(story.imageDataUrl))
      || story.imageApproved !== undefined && typeof story.imageApproved !== 'boolean'
      || story.sceneRevision !== undefined && (!Number.isSafeInteger(story.sceneRevision) || story.sceneRevision < 1)
      || story.imageReviewedAt !== undefined && typeof story.imageReviewedAt !== 'string') return false
  }
  if (value.storyScene !== undefined) {
    const scene = value.storyScene, spec = scene?.spec
    if (!record(scene) || !record(spec) || typeof scene.id !== 'string' || !Number.isSafeInteger(scene.version) || scene.version < 1
      || !['draft', 'confirmed'].includes(scene.status) || typeof scene.contentHash !== 'string' || typeof scene.confirmedAt !== 'string'
      || spec.schemaVersion !== 1 || spec.mode !== 'single_background'
      || !['summary', 'location', 'timeOfDay', 'basePrompt'].every(key => typeof spec[key] === 'string')
      || !['environment', 'fixedAssets', 'allowedTransientAssets', 'physicsConstraints', 'forbiddenAdditions', 'styleConstraints'].every(key => strings(spec[key]))
      || scene.backgroundImage !== undefined && (typeof scene.backgroundImage !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(scene.backgroundImage))) return false
  }
  if (!Array.isArray(value.circuits) || !value.circuits.every(asset => {
    if (!record(asset) || !record(asset.graph) || typeof asset.id !== 'string' || typeof asset.name !== 'string' || !Array.isArray(asset.quantities)) return false
    if (asset.viewMode !== undefined && !['schematic', 'real'].includes(asset.viewMode)) return false
    if (asset.currentFlow !== undefined && typeof asset.currentFlow !== 'boolean') return false
    if (!asset.quantities.every((quantity: unknown) => record(quantity) && [quantity.id, quantity.symbol, quantity.unit].every(text => typeof text === 'string')
      && ['given', 'derived', 'symbolic'].includes(quantity.provenance) && (quantity.value === undefined || finite(quantity.value)))) return false
    if (!asset.geometry) return true
    return geometryShape(asset.geometry)
  })) return false
  if (value.scriptNotes !== undefined && (!Array.isArray(value.scriptNotes) || !value.scriptNotes.every((note: unknown) => record(note)
    && typeof note.id === 'string' && typeof note.text === 'string' && ['chapter', 'summary', 'problem', 'visual', 'review'].includes(note.kind)
    && Number.isInteger(note.sourceLine) && note.sourceLine > 0 && (note.placement === undefined || ['before', 'after'].includes(note.placement))
    && (note.utteranceId === undefined || typeof note.utteranceId === 'string') && (note.chapter === undefined || Number.isInteger(note.chapter) && note.chapter > 0)
    && (note.symbolicValues === undefined || strings(note.symbolicValues))))) return false
  if (value.problem !== undefined && (!record(value.problem) || typeof value.problem.text !== 'string' || (value.problem.imageDataUrl !== undefined && typeof value.problem.imageDataUrl !== 'string') || (value.problem.reviewed !== undefined && typeof value.problem.reviewed !== 'boolean'))) return false
  return record(value.settings) && [value.settings.width, value.settings.height, value.settings.fps].every(finite)
    && typeof value.settings.font === 'string' && typeof value.settings.background === 'string'
    && (value.settings.backgroundImage === undefined || typeof value.settings.backgroundImage === 'string')
    && (value.settings.titlePinImage === undefined || typeof value.settings.titlePinImage === 'string')
    && (value.settings.defaultCircuitView === undefined || ['schematic','real'].includes(value.settings.defaultCircuitView))
    && (value.settings.switchPolicy === undefined || ['contextual','preserve','include'].includes(value.settings.switchPolicy))
}

class VideoRequestError extends Error { constructor(public status: number, message: string) { super(message) } }
async function request(path: string, init?: RequestInit): Promise<unknown> {
  const signal = requestSignal(init?.signal)
  try {
    const response = await fetch(`${base}${path}`, { ...init, signal, headers: { 'Content-Type': 'application/json', ...init?.headers } })
    checkExpiredSession(response)
    let body: unknown
    try { body = await response.json() } catch (error) {
      if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) throw error
      throw new Error(response.ok ? invalidResponse : `视频服务请求失败（${response.status}），当前草稿会保留。`)
    }
    signal.throwIfAborted()
    if (!response.ok || (record(body) && body.error)) {
      const detail = record(body) ? typeof body.error === 'string' ? body.error : typeof body.message === 'string' ? body.message : '' : ''
      throw new VideoRequestError(response.status, detail || `视频服务请求失败（${response.status}）`)
    }
    return body
  } catch (error) {
    if (signal.aborted && signal.reason?.name === 'TimeoutError' || error instanceof Error && error.name === 'TimeoutError') throw new Error('视频服务响应超时，当前草稿会保留，请重试。')
    if (init?.signal?.aborted) init.signal.throwIfAborted()
    throw error
  }
}
function unwrap(value: unknown, key: string): unknown { return record(value) && key in value ? value[key] : value }
const projectBases = new Map<string, VideoProject>()
const latestProjects = new Map<string, VideoProject>()
const saveQueues = new Map<string, Promise<void>>()
const saveNotices = new Map<string, { message: string }>()
function rememberProject(project: VideoProject): VideoProject {
  const snapshot = structuredClone(project), key = `${project.id}:${project.revision}`
  projectBases.set(key, snapshot)
  if (projectBases.size > 40) projectBases.delete(projectBases.keys().next().value!)
  const latest = latestProjects.get(project.id)
  if (!latest || latest.revision <= snapshot.revision) latestProjects.set(project.id, snapshot)
  return project
}
function serializeSave<T>(id: string, action: () => Promise<T>): Promise<T> {
  const task = (saveQueues.get(id) || Promise.resolve()).then(action)
  const settled = task.then(() => {}, () => {})
  saveQueues.set(id, settled)
  void settled.then(() => { if (saveQueues.get(id) === settled) saveQueues.delete(id) })
  return task
}
async function persistProject(value: VideoProject, creating: boolean): Promise<VideoProject> {
  // Capture before awaiting a preceding save; callers may continue editing.
  const project = structuredClone(migrateVideoEditorProject(value).project)
  const baseline = projectBases.get(`${project.id}:${project.revision}`)
  return serializeSave(project.id, async () => {
    const value = await request(creating ? '/projects' : `/projects/${encodeURIComponent(project.id)}`, { method: creating ? 'POST' : 'PUT', body: JSON.stringify({ saveMode: 'merge', project, ...(baseline ? { baseProject: baseline } : {}) }) })
    const result = checkedProject(value)
    const meta = record(value) && record(value.save) ? value.save : undefined
    if (result.id !== project.id && meta?.forkedFrom !== project.id) throw new Error(invalidResponse)
    if (meta?.notice !== undefined) {
      if (typeof meta.notice !== 'string' || meta.notice.length > 2000) throw new Error(invalidResponse)
      const notice = { message: meta.notice }
      saveNotices.set(result.id, notice)
      if (result.id !== project.id) saveNotices.set(project.id, notice)
    }
    return rememberProject(result)
  })
}
function checkedProject(value: unknown, expectedId?: string): VideoProject {
  const project = unwrap(value, 'project')
  if (!isVideoProjectShape(project) || (expectedId && project.id !== expectedId)) throw new Error(invalidResponse)
  return migrateVideoEditorProject(project).project
}
function checkedJob(value: unknown): RenderJob {
  const job = unwrap(value, 'job')
  if (!record(job) || ![job.id, job.projectId, job.createdAt, job.updatedAt, job.stage].every(text => typeof text === 'string')
    || !Number.isInteger(job.projectRevision) || !['shot', 'preview', 'final'].includes(job.kind)
    || !['queued', 'running', 'completed', 'failed', 'cancelled'].includes(job.status) || !strings(job.shotIds)
    || !finite(job.progress) || job.progress < 0 || job.progress > 100
    || (job.status === 'completed' && (typeof job.videoUrl !== 'string' || typeof job.subtitleUrl !== 'string'))) throw new Error(invalidResponse)
  return job as unknown as RenderJob
}
function checkedTask(value: unknown): GenerationTask {
  if (!record(value) || ![value.id, value.projectId, value.kind, value.stage, value.inputHash].every(v => typeof v === 'string')
    || !['queued','running','waiting_retry','failed','cancelled','completed'].includes(value.status)
    || !Number.isInteger(value.expectedRevision) || !finite(value.progress)
    || ['partialResultVersion', 'completedShots', 'completedUtterances', 'totalUtterances'].some(key => value[key] !== undefined && (!Number.isSafeInteger(value[key]) || value[key] < 0))) throw new Error(invalidResponse)
  return value as GenerationTask
}

export const videoClient = {
  projectSummaries: async (lifecycle = 'active', options?: Pick<RequestInit, 'signal'>): Promise<VideoProjectSummary[]> => {
    const value = await request(`/projects?view=summary&lifecycle=${encodeURIComponent(lifecycle)}`, options)
    if (!Array.isArray(value) || !value.every(p => record(p) && typeof p.id === 'string' && typeof p.title === 'string'
      && typeof p.updatedAt === 'string' && Number.isInteger(p.revision) && Number.isInteger(p.shotCount)
      && ['active', 'archived', 'trashed'].includes(p.lifecycle))) throw new Error(invalidResponse)
    return value as VideoProjectSummary[]
  },
  renameProject: async (id: string, title: string, expectedRevision: number) => rememberProject(checkedProject(await request(`/projects/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify({ title, expectedRevision }) }), id)),
  archiveProject: (id: string) => request(`/projects/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ lifecycle: 'archived' }) }),
  trashProject: (id: string) => request(`/projects/${encodeURIComponent(id)}/trash`, { method: 'POST', body: '{}' }),
  restoreProject: (id: string) => request(`/projects/${encodeURIComponent(id)}/restore`, { method: 'POST', body: '{}' }),
  duplicateProject: async (id: string) => rememberProject(checkedProject(await request(`/projects/${encodeURIComponent(id)}/duplicate`, { method: 'POST', body: '{}' }))),
  deleteProject: (id: string) => request(`/projects/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({ confirmId: id }) }),
  resumeRender: async (id: string) => checkedJob(await request(`/jobs/${encodeURIComponent(id)}/resume`, { method: 'POST', body: '{}' })),
  productionNodes: async (id: string) => {
    const result = await request(`/jobs/${encodeURIComponent(id)}/nodes`)
    if (!record(result) || !Array.isArray(result.nodes) || !result.nodes.every(n => record(n) && typeof n.shotId === 'string' && typeof n.status === 'string')) throw new Error(invalidResponse)
    return result as { nodes: { shotId: string; status: string; phase: string; attempts: number; cached: boolean; duration?: number; error?: { code: string; message: string; retryable: boolean } }[] }
  },
  status: async (options?: Pick<RequestInit, 'signal'>): Promise<VideoSystemStatus> => {
    const value = await request('/status', options)
    if (!record(value) || typeof value.azureConfigured !== 'boolean' || !strings(value.missingConfiguration) || !strings(value.messages)
      || !record(value.runtime) || !['python', 'manim', 'ffmpeg', 'latex'].every(key => typeof value.runtime[key] === 'boolean')) throw new Error(invalidResponse)
    return value as unknown as VideoSystemStatus
  },
  projects: async (options?: Pick<RequestInit, 'signal'>): Promise<VideoProject[]> => {
    const value = unwrap(await request('/projects', options), 'projects')
    if (!Array.isArray(value) || !value.every(isVideoProjectShape)) throw new Error(invalidResponse)
    return value.map(item => rememberProject(migrateVideoEditorProject(item).project))
  },
  project: async (id: string, options?: Pick<RequestInit, 'signal'>) => rememberProject(checkedProject(await request(`/projects/${encodeURIComponent(id)}`, options), id)),
  create: (project: VideoProject) => persistProject(project, true),
  save: (project: VideoProject) => persistProject(project, false),
  approveScript: async (project: VideoProject) => rememberProject(checkedProject(await request(`/projects/${encodeURIComponent(project.id)}/approve-script`,
    { method: 'POST', body: JSON.stringify({ expectedRevision: project.revision }) }), project.id)),
  revision: async (id: string, revision: number) => checkedProject(await request(`/projects/${encodeURIComponent(id)}/revisions/${revision}`), id),
  tasks: async (projectId?: string, options?: Pick<RequestInit, 'signal'>) => {
    const value = await request(projectId ? `/tasks?projectId=${encodeURIComponent(projectId)}` : '/tasks', options)
    if (!Array.isArray(value)) throw new Error(invalidResponse)
    return value.map(checkedTask)
  },
  createTask: async (project: VideoProject, kind: GenerationTaskKind, options: { scope?: string[]; instruction?: string; force?: boolean } = {}) =>
    checkedTask(await request(`/projects/${encodeURIComponent(project.id)}/tasks`, { method: 'POST', body: JSON.stringify({ kind, expectedRevision: project.revision, ...options }) })),
  task: async (id: string) => checkedTask(await request(`/tasks/${encodeURIComponent(id)}`)),
  taskResult: async (id: string): Promise<{ project?: VideoProject; patch?: unknown; [key: string]: unknown }> => {
    const value = await request(`/tasks/${encodeURIComponent(id)}/result`)
    if (!record(value) || (value.project !== undefined && !isVideoProjectShape(value.project))) throw new Error(invalidResponse)
    return value
  },
  taskPartialResult: async (id: string, options?: Pick<RequestInit, 'signal'>): Promise<GenerationPartialResult> => {
    const value = await request(`/tasks/${encodeURIComponent(id)}/partial-result`, options)
    if (!record(value) || value.readOnly !== true || !Number.isSafeInteger(value.version) || value.version < 0
      || !strings(value.completedShotIds) || new Set(value.completedShotIds).size !== value.completedShotIds.length
      || !Number.isSafeInteger(value.completedUtterances) || value.completedUtterances < 0
      || !Number.isSafeInteger(value.totalUtterances) || value.totalUtterances < value.completedUtterances
      || value.project !== null && !isVideoProjectStructure(value.project, true)
      || value.project === null && value.completedShotIds.length > 0
      || value.project && value.completedShotIds.some(id => !value.project.shots.some((shot: Shot) => shot.id === id))) throw new Error(invalidResponse)
    return value as GenerationPartialResult
  },
  resumeTask: async (id: string) => checkedTask(await request(`/tasks/${encodeURIComponent(id)}/resume`, { method: 'POST' })),
  cancelTask: async (id: string) => checkedTask(await request(`/tasks/${encodeURIComponent(id)}/cancel`, { method: 'POST' })),
  applyTask: async (id: string, project: VideoProject, acceptConflicts = false) => rememberProject(checkedProject(await request(`/tasks/${encodeURIComponent(id)}/apply`,
    { method: 'POST', body: JSON.stringify({ expectedRevision: project.revision, acceptConflicts }) }), project.id)),
  timeline: async (taskId: string, shotId: string): Promise<VideoTimelinePreview> => {
    const value = await request(`/tasks/${encodeURIComponent(taskId)}/timeline/${encodeURIComponent(shotId)}`)
    if (!record(value) || !finite(value.duration) || !Array.isArray(value.events) || typeof value.audioUrl !== 'string') throw new Error(invalidResponse)
    return value as VideoTimelinePreview
  },
  consumeSaveNotice: (projectId?: string): string | undefined => {
    const key = projectId || [...saveNotices.keys()].at(-1)
    if (!key) return undefined
    const notice = saveNotices.get(key)
    if (notice) for (const [id, value] of saveNotices) if (value === notice) saveNotices.delete(id)
    return notice?.message
  },
  approve: (project: VideoProject) => {
    const requested = structuredClone(project)
    return serializeSave(project.id, async () => {
      const latest = latestProjects.get(project.id)
      let target = latest && latest.revision > requested.revision && sameProjectContent(latest, requested) ? latest : requested
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const result = checkedProject(await request(`/projects/${encodeURIComponent(target.id)}/approve`, { method: 'POST', body: JSON.stringify({ revision: target.revision }) }), target.id)
          if (result.approvedRevision !== result.revision || result.revision < target.revision || !sameProjectContent(result, target)) throw new Error('分镜内容已经更新，请核对当前版本后再确认。当前修改已保留。')
          return rememberProject(result)
        } catch (error) {
          if (!(error instanceof VideoRequestError) || error.status !== 409 || attempt) throw error
          const current = rememberProject(checkedProject(await request(`/projects/${encodeURIComponent(target.id)}`), target.id))
          if (current.revision <= target.revision) throw error
          if (!sameProjectContent(current, target)) throw new Error('其他页面更新了分镜内容，请打开最新工程核对后再确认。当前修改已保留。')
          target = current
        }
      }
      throw new Error('服务未确认当前分镜，请重试。')
    })
  },
  render: async (projectId: string, kind: RenderJob['kind'], shotIds?: string[], expectedRevision?: number) => checkedJob(await request(`/projects/${encodeURIComponent(projectId)}/render`, { method: 'POST', body: JSON.stringify({ kind, shotIds, expectedRevision: expectedRevision ?? latestProjects.get(projectId)?.revision }) })),
  jobs: async (projectId?: string, options?: Pick<RequestInit, 'signal'>) => {
    const value = unwrap(await request(projectId ? `/jobs?projectId=${encodeURIComponent(projectId)}` : '/jobs', options), 'jobs')
    if (!Array.isArray(value)) throw new Error(invalidResponse)
    return value.map(checkedJob).sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
  },
  cancel: async (jobId: string) => checkedJob(await request(`/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' })),
  archiveUrl: (projectId: string) => `${base}/projects/${encodeURIComponent(projectId)}/archive`,
}


