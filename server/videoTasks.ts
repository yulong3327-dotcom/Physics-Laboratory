import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, readdir, unlink, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { GenerationPartialResult, GenerationTask, GenerationTaskKind, ValidationIssue, VideoProject } from './videoTypes.js'
import { createVideoFileLock } from './videoFileLock.js'
import { replaceVideoFile } from './videoAtomicFile.js'

export interface GenerationTaskRequest {
  projectId: string; expectedRevision: number; kind: GenerationTaskKind;
  scope?: string[]; instruction?: string; input: unknown; force?: boolean;
  credentialProfileId?: string;
}
export interface GenerationTaskContext {
  task: GenerationTask; input: unknown; checkpoint: unknown; signal: AbortSignal;
  onCheckpoint(value: unknown): Promise<void>;
  onPartialResult?(value: { project: VideoProject; completedShotIds: string[]; completedUtterances: number; totalUtterances: number }): Promise<void>;
  onProgress(value: { progress?: number; stage?: string; issues?: ValidationIssue[] }): Promise<void>;
}
export interface GenerationTaskServiceOptions {
  dataDir: string; executor(context: GenerationTaskContext): Promise<unknown>;
  recoverPartialResult?: (task: GenerationTask, input: unknown, checkpoint: unknown) => Promise<Parameters<NonNullable<GenerationTaskContext['onPartialResult']>>[0] | undefined>;
  isProjectPurged?: (id: string) => boolean;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/
const KINDS = new Set<GenerationTaskKind>(['problem_script', 'storyboard', 'storyboard_patch', 'preflight'])
const STATUSES = new Set(['queued', 'running', 'waiting_retry', 'failed', 'cancelled', 'completed'])
const fault = (status: number, message: string) => Object.assign(new Error(message), { status })
const clone = <T>(value: T): T => structuredClone(value)
function jsonValue(value: unknown): unknown {
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw fault(400, '任务输入、结果与断点必须可保存为 JSON')
  return JSON.parse(encoded)
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}'
  return JSON.stringify(value)
}
const PROJECT_FIELDS = ['schemaVersion', 'id', 'title', 'revision', 'createdAt', 'updatedAt', 'sourceScript', 'cleanedScript',
  'speakers', 'utterances', 'shots', 'circuits', 'scriptNotes', 'contentKinds', 'storyScene', 'physicsModel', 'approvedRevision',
  'problem', 'workflow', 'pronunciations', 'speech', 'settings'] as const
function partialResult(value: unknown, task: GenerationTask, version: number): GenerationPartialResult {
  const snapshot = jsonValue(value) as Record<string, any> | null
  const project = snapshot?.project as VideoProject | undefined
  const validCount = (count: unknown): count is number => Number.isSafeInteger(count) && Number(count) >= 0 && Number(count) <= 600
  if (!project || project.schemaVersion !== 1 || project.id !== task.projectId || project.revision !== task.expectedRevision
    || !Array.isArray(project.shots) || project.shots.length > 200 || !Array.isArray(project.circuits) || project.circuits.length > 200
    || !Array.isArray(project.utterances) || project.utterances.length > 600 || !Array.isArray(project.speakers) || project.speakers.length > 12
    || typeof project.title !== 'string' || typeof project.sourceScript !== 'string' || typeof project.cleanedScript !== 'string'
    || !project.settings || typeof project.settings !== 'object'
    || !Array.isArray(snapshot?.completedShotIds) || snapshot.completedShotIds.length > 200
    || !validCount(snapshot.completedUtterances) || !validCount(snapshot.totalUtterances)
    || snapshot.completedUtterances > snapshot.totalUtterances) throw fault(400, '分镜预览快照或进度数量无效')
  const validIds = (items: { id: string }[]) => items.every(item => item && typeof item.id === 'string' && ID.test(item.id)) && new Set(items.map(item => item.id)).size === items.length
  if (!validIds(project.utterances) || !validIds(project.speakers) || !validIds(project.circuits)) throw fault(400, '分镜预览素材标识无效')
  const shotIds = new Set<string>(), utteranceIds = new Set(project.utterances.map(item => item.id))
  for (const shot of project.shots) {
    if (!shot || typeof shot.id !== 'string' || !ID.test(shot.id) || shotIds.has(shot.id) || !Array.isArray(shot.utteranceIds)
      || !shot.utteranceIds.every(id => utteranceIds.has(id)) || !Array.isArray(shot.formulas) || !Array.isArray(shot.actions)
      || !Array.isArray(shot.reviewNotes)) throw fault(400, '分镜预览镜头结构无效')
    shotIds.add(shot.id)
  }
  if (new Set(snapshot.completedShotIds).size !== snapshot.completedShotIds.length
    || !snapshot.completedShotIds.every((id: unknown) => typeof id === 'string' && shotIds.has(id))) throw fault(400, '分镜预览完成范围无效')
  // The public snapshot is separate from executor checkpoints and model responses.
  const publicProject = Object.fromEntries(PROJECT_FIELDS.filter(key => project[key] !== undefined).map(key => [key, project[key]])) as unknown as VideoProject
  return { project: publicProject, version, readOnly: true, completedShotIds: snapshot.completedShotIds,
    completedUtterances: snapshot.completedUtterances, totalUtterances: snapshot.totalUtterances }
}
async function atomicJson(path: string, value: unknown) {
  const temporary = path + '.' + randomUUID() + '.tmp'
  try {
    const file = await open(temporary, 'wx')
    try { await file.writeFile(JSON.stringify(value, null, 2), 'utf8'); await file.sync() } finally { await file.close() }
    await replaceVideoFile(temporary, path)
  } finally { await unlink(temporary).catch(() => undefined) }
}
function asIssues(error: unknown, stage: string): ValidationIssue[] {
  const data = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  if (Array.isArray(data.issues) && data.issues.length && data.issues.every(issue => issue && typeof issue === 'object')) return data.issues.map(issue => ({
    code: typeof issue.code === 'string' ? issue.code : 'generation_failed',
    stage: typeof issue.stage === 'string' ? issue.stage : stage,
    message: typeof issue.message === 'string' ? issue.message : String(error),
    severity: issue.severity === 'warning' ? 'warning' : 'error',
    retryable: issue.retryable === true,
    ...(typeof issue.shotId === 'string' ? { shotId: issue.shotId } : {}),
    ...(typeof issue.objectId === 'string' ? { objectId: issue.objectId } : {}),
  }))
  return [{ code: typeof data.code === 'string' ? data.code : 'generation_failed', stage,
    message: error instanceof Error ? error.message : String(error), severity: 'error', retryable: data.retryable === true,
    ...(typeof data.shotId === 'string' ? { shotId: data.shotId } : {}),
    ...(typeof data.objectId === 'string' ? { objectId: data.objectId } : {}) }]
}

/** One durable queue per storage directory. Executors own provider retry policy. */
export function createGenerationTaskService(options: GenerationTaskServiceOptions) {
  const root = join(options.dataDir, 'tasks'), lockPath = join(root, '.owner.lock'), owner = randomUUID()
  const tasks = new Map<string, GenerationTask>()
  const executors = new Map<string, string>()
  let stateTail = Promise.resolve(), initialization: Promise<void> | undefined
  let closed = false, ownsLock = false, pumping = false, queueError: unknown
  let active: { id: string; controller: AbortController; token: string } | undefined
  const idleWaiters = new Set<() => void>()
  const folder = (id: string) => { if (!ID.test(id)) throw fault(400, '任务 ID 无效'); return join(root, id) }
  const file = (id: string, name: string) => join(folder(id), name + '.json')
  function exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const promise = stateTail.then(operation)
    stateTail = promise.then(() => undefined, () => undefined)
    return promise
  }
  async function persist(task: GenerationTask) {
    task.updatedAt = new Date().toISOString()
    await atomicJson(file(task.id, 'task'), task)
  }
  function applyPartialMetadata(task: GenerationTask, snapshot: GenerationPartialResult) {
    task.partialResultVersion = snapshot.version
    task.completedShots = snapshot.completedShotIds.length
    task.completedUtterances = snapshot.completedUtterances
    task.totalUtterances = snapshot.totalUtterances
  }
  async function readPartial(task: GenerationTask): Promise<GenerationPartialResult | undefined> {
    try {
      const value = JSON.parse(await readFile(file(task.id, 'partial-result'), 'utf8'))
      if (!value || typeof value !== 'object' || !Number.isSafeInteger(value.version) || value.version < 1) return undefined
      return partialResult(value, task, value.version)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError || (error as { status?: number }).status === 400) return undefined
      throw error
    }
  }
  function find(id: string) {
    folder(id)
    const task = tasks.get(id)
    if (!task) throw fault(404, '制作任务不存在')
    return task
  }
  async function lock() {
    await mkdir(root, { recursive: true })
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await createVideoFileLock(lockPath, { pid: process.pid, owner })
        ownsLock = true
        return
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        const content = await readFile(lockPath, 'utf8').catch(() => '')
        let pid: number
        try { pid = JSON.parse(content).pid } catch { throw fault(409, '制作任务锁无效，请确认没有服务运行后移除 tasks/.owner.lock') }
        if (!Number.isInteger(pid) || pid <= 0) throw fault(409, '制作任务锁无效')
        let alive = true
        try { process.kill(pid, 0) } catch (e) { alive = (e as NodeJS.ErrnoException).code !== 'ESRCH' }
        if (alive) throw fault(409, '同一视频目录已有任务服务运行')
        if (await readFile(lockPath, 'utf8').catch(() => '') === content) await unlink(lockPath).catch(() => undefined)
      }
    }
    throw fault(409, '无法取得制作任务服务锁')
  }
  async function releaseLock() {
    if (!ownsLock) return
    const content = await readFile(lockPath, 'utf8').catch(() => '')
    if (content && JSON.parse(content).owner === owner) await unlink(lockPath).catch(() => undefined)
    ownsLock = false
  }
  async function loadTasks() {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !ID.test(entry.name)) continue
      let task: GenerationTask
      try {
        task = JSON.parse(await readFile(file(entry.name, 'task'), 'utf8'))
        if (task.id !== entry.name || !ID.test(task.projectId) || !KINDS.has(task.kind) || !STATUSES.has(task.status)) continue
      } catch { continue } // An interrupted/corrupt record must not block other projects.
      if (options.isProjectPurged?.(task.projectId)) { await rm(folder(task.id), { recursive: true, force: true }); continue }
      tasks.set(task.id, task)
      // A crash after the snapshot rename but before task.json must not hide frames.
      const partial = await readPartial(task)
      if (partial) {
        applyPartialMetadata(task, partial)
        await persist(task)
      }
      if (task.status !== 'queued' && task.status !== 'running') continue
      try {
        JSON.parse(await readFile(file(task.id, 'input'), 'utf8'))
        let resultExists = false
        try { JSON.parse(await readFile(file(task.id, 'result'), 'utf8')); resultExists = true } catch { /* no committed result */ }
        task.status = resultExists ? 'completed' : 'queued'
        task.stage = resultExists ? 'completed' : 'recovered'
        if (resultExists) { task.resultAvailable = true; task.progress = 100 }
      } catch {
        task.status = 'failed'; task.stage = 'recovery'; task.retryable = false; task.error = '任务输入快照损坏，需重新创建任务'
        task.issues = [{ code: 'input_snapshot_corrupt', stage: 'recovery', message: task.error, severity: 'error', retryable: false }]
      }
      await persist(task)
    }
  }
  async function ensureReady() {
    if (closed) throw fault(503, '制作任务服务已关闭')
    initialization ??= exclusive(async () => {
      await lock()
      try { await loadTasks() } catch (error) { await releaseLock(); throw error }
    }).catch(error => { initialization = undefined; throw error })
    await initialization
    if (closed) throw fault(503, '制作任务服务已关闭')
    if (queueError) throw queueError
    kick()
  }
  function settleIdle() {
    if (queueError || !pumping && !active && ![...tasks.values()].some(task => task.status === 'queued')) {
      for (const resolve of idleWaiters) resolve()
      idleWaiters.clear()
    }
  }
  function kick() {
    if (closed || pumping || !ownsLock || queueError) return
    pumping = true
    void pump().catch(error => { queueError = error }).finally(() => {
      pumping = false
      if (!closed && !queueError && [...tasks.values()].some(task => task.status === 'queued')) kick()
      else settleIdle()
    })
  }
  async function pump() {
    while (!closed) {
      const task = await exclusive(async () => {
        if (closed) return undefined
        const next = [...tasks.values()].find(item => item.status === 'queued')
        if (!next) return undefined
        next.status = 'running'; next.stage = 'starting'; next.attempt += 1; next.lastHeartbeat = new Date().toISOString()
        await persist(next)
        active = { id: next.id, controller: new AbortController(), token: randomUUID() }
        return clone(next)
      })
      if (!task || !active) return
      const running = active
      const current = () => !closed && active?.token === running.token && !running.controller.signal.aborted && find(task.id).status === 'running'
      let abortListener: (() => void) | undefined
      try {
        const input = JSON.parse(await readFile(file(task.id, 'input'), 'utf8'))
        let checkpoint: unknown
        try { checkpoint = JSON.parse(await readFile(file(task.id, 'checkpoint'), 'utf8')) } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw Object.assign(new Error('任务断点损坏，请重新创建任务'), { code: 'checkpoint_corrupt', retryable: false })
        }
        const context: GenerationTaskContext = {
          task, input, checkpoint, signal: running.controller.signal,
          onCheckpoint: value => exclusive(async () => {
            if (!current()) throw fault(409, '任务已停止，不能再写入断点')
            await atomicJson(file(task.id, 'checkpoint'), jsonValue(value))
            const live = find(task.id); live.lastHeartbeat = new Date().toISOString(); await persist(live)
          }),
          onPartialResult: value => exclusive(async () => {
            if (!current()) throw fault(409, '任务已停止，不能再更新分镜预览')
            const live = find(task.id)
            const snapshot = partialResult(value, live, (live.partialResultVersion || 0) + 1)
            // Publish the durable data first; metadata versions only advertise committed frames.
            await atomicJson(file(task.id, 'partial-result'), snapshot)
            applyPartialMetadata(live, snapshot)
            live.lastHeartbeat = new Date().toISOString(); await persist(live)
          }),
          onProgress: value => exclusive(async () => {
            if (!current()) throw fault(409, '任务已停止，不能再更新进度')
            const live = find(task.id)
            if (value.progress !== undefined && Number.isFinite(value.progress)) live.progress = Math.max(0, Math.min(99, value.progress))
            if (value.stage !== undefined) live.stage = value.stage
            if (value.issues !== undefined) live.issues = clone(value.issues)
            live.lastHeartbeat = new Date().toISOString(); await persist(live)
          }),
        }
        const aborted = new Promise<never>((_resolve, reject) => {
          abortListener = () => reject(Object.assign(new Error('任务已停止'), { code: 'cancelled' }))
          running.controller.signal.addEventListener('abort', abortListener, { once: true })
          if (running.controller.signal.aborted) abortListener()
        })
        const execution = Promise.resolve().then(() => {
          if (!current()) throw fault(409, '任务已停止')
          executors.set(running.token, task.projectId)
          return options.executor(context)
        }).finally(() => { executors.delete(running.token) })
        const output = await Promise.race([execution, aborted])
        await exclusive(async () => {
          if (!current()) return
          // Commit the immutable result before advertising completion. Recovery repairs an interrupted metadata write.
          await atomicJson(file(task.id, 'result'), jsonValue(output))
          const live = find(task.id)
          live.status = 'completed'; live.stage = 'completed'; live.progress = 100; live.resultAvailable = true
          delete live.error; delete live.retryable
          live.issues = live.issues?.filter(issue => issue.severity === 'warning')
          await persist(live)
        })
      } catch (error) {
        await exclusive(async () => {
          if (!current()) return
          const live = find(task.id), issues = asIssues(error, live.stage)
          live.issues = issues; live.retryable = issues.some(issue => issue.retryable) && !issues.some(issue => issue.severity === 'error' && !issue.retryable)
          live.status = live.retryable ? 'waiting_retry' : 'failed'
          live.error = error instanceof Error ? error.message : String(error)
          await persist(live)
        })
      } finally {
        if (abortListener) running.controller.signal.removeEventListener('abort', abortListener)
        if (active?.token === running.token) active = undefined
      }
    }
  }
  return {
    async create(request: GenerationTaskRequest): Promise<GenerationTask> {
      await ensureReady()
      const created = await exclusive(async () => {
        if (closed) throw fault(503, '制作任务服务已关闭')
        if (!ID.test(request.projectId) || !Number.isInteger(request.expectedRevision) || request.expectedRevision < 1 || !KINDS.has(request.kind)) throw fault(400, '制作任务项目、版本或类型无效')
        if (request.scope && (!Array.isArray(request.scope) || request.scope.some(id => typeof id !== 'string' || !ID.test(id)))) throw fault(400, '分镜范围无效')
        if (request.instruction !== undefined && (typeof request.instruction !== 'string' || request.instruction.length > 16000)) throw fault(400, '修改指令无效或过长')
        const input = jsonValue(request.input)
        const inputHash = createHash('sha256').update(canonical(jsonValue({ projectId: request.projectId, expectedRevision: request.expectedRevision,
          kind: request.kind, scope: request.scope, instruction: request.instruction, credentialProfileId: request.credentialProfileId, input }))).digest('hex')
        if (!request.force) {
          const previous = [...tasks.values()].reverse().find(task => task.inputHash === inputHash && !['failed', 'cancelled'].includes(task.status))
          if (previous) return clone(previous)
        }
        const now = new Date().toISOString()
        const task: GenerationTask = { id: 'task-' + randomUUID(), projectId: request.projectId, expectedRevision: request.expectedRevision,
          inputHash, kind: request.kind, ...(request.credentialProfileId ? { credentialProfileId: request.credentialProfileId } : {}), ...(request.scope ? { scope: [...request.scope] } : {}),
          ...(request.instruction !== undefined ? { instruction: request.instruction } : {}), status: 'queued', progress: 0, stage: 'queued', createdAt: now, updatedAt: now, attempt: 0 }
        const inputUtterances = (input as { utterances?: unknown } | null)?.utterances
        if (Array.isArray(inputUtterances) && inputUtterances.length <= 600) task.totalUtterances = inputUtterances.length
        await mkdir(folder(task.id), { recursive: true })
        await atomicJson(file(task.id, 'input'), input)
        if (!request.force && request.kind === 'storyboard') {
          // Explicitly creating a replacement for failed content preserves completed
          // batches. The executor still validates its checkpoint hash and fingerprint.
          // Sort by creation time because recovery loads UUID folders in filesystem order.
          const previous = [...tasks.values()].filter(item => item.inputHash === inputHash)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.updatedAt.localeCompare(a.updatedAt))[0]
          if (previous?.status === 'failed') {
            let checkpoint: unknown
            try { checkpoint = JSON.parse(await readFile(file(previous.id, 'checkpoint'), 'utf8')) } catch { /* A missing or damaged checkpoint starts fresh. */ }
            if (checkpoint !== undefined) {
              await atomicJson(file(task.id, 'checkpoint'), checkpoint)
              const partial = await readPartial(previous)
              if (partial) {
                const inherited = { ...partial, version: 1 }
                await atomicJson(file(task.id, 'partial-result'), inherited)
                applyPartialMetadata(task, inherited)
              }
            }
          }
        }
        await persist(task)
        tasks.set(task.id, task)
        return clone(task)
      })
      kick()
      return created
    },
    async read(id: string): Promise<GenerationTask> { await ensureReady(); return exclusive(async () => clone(find(id))) },
    async list(projectId?: string): Promise<GenerationTask[]> {
      await ensureReady()
      return exclusive(async () => [...tasks.values()].filter(task => !projectId || task.projectId === projectId).map(clone))
    },
    isProjectActive(projectId: string) { return (!!active && tasks.get(active.id)?.projectId === projectId) || [...executors.values()].includes(projectId) },
    async purgeProject(projectId: string): Promise<void> {
      await ensureReady()
      await exclusive(async () => {
        const selected = [...tasks.values()].filter(task => task.projectId === projectId)
        if ([...executors.values()].includes(projectId) || active && selected.some(task => task.id === active!.id) || selected.some(task => ['queued', 'running', 'waiting_retry'].includes(task.status))) throw fault(409, '任务尚未结束，暂不能删除项目')
        for (const task of selected) {
          await rm(folder(task.id), { recursive: true, force: true })
          tasks.delete(task.id)
        }
      })
    },
    async result(id: string): Promise<unknown> {
      await ensureReady()
      return exclusive(async () => {
        if (!find(id).resultAvailable) throw fault(409, '任务结果尚未就绪')
        return JSON.parse(await readFile(file(id, 'result'), 'utf8'))
      })
    },
    async partialResult(id: string): Promise<GenerationPartialResult> {
      await ensureReady()
      const existing = await exclusive(async () => {
        const task = find(id)
        const snapshot = await readPartial(task)
        if (snapshot) return { snapshot }
        if (!options.recoverPartialResult || task.kind !== 'storyboard' || ['queued', 'running'].includes(task.status)) return { task: clone(task) }
        const checkpoint = await readFile(file(id, 'checkpoint'), 'utf8').then(JSON.parse).catch(() => undefined)
        const input = await readFile(file(id, 'input'), 'utf8').then(JSON.parse).catch(() => undefined)
        return { task: clone(task), checkpoint, input }
      })
      if (existing.snapshot) return existing.snapshot
      // Geometry preparation runs outside the queue lock; a concurrent resume,
      // cancellation or newer publication wins over this legacy reconstruction.
      const recovered = existing.checkpoint && existing.input
        ? await options.recoverPartialResult?.(existing.task!, existing.input, existing.checkpoint) : undefined
      return exclusive(async () => {
        const live = find(id), current = await readPartial(live)
        if (current) return current
        if (recovered && live.updatedAt === existing.task!.updatedAt && !closed) {
          const snapshot = partialResult(recovered, live, 1)
          await atomicJson(file(id, 'partial-result'), snapshot)
          applyPartialMetadata(live, snapshot); await persist(live)
          return snapshot
        }
        return { project: null, version: 0, readOnly: true, completedShotIds: [], completedUtterances: 0, totalUtterances: live.totalUtterances || 0 }
      })
    },
    async input(id: string): Promise<unknown> {
      await ensureReady()
      return exclusive(async () => { find(id); return JSON.parse(await readFile(file(id, 'input'), 'utf8')) })
    },
    async resume(id: string, credentialProfileId?: string): Promise<GenerationTask> {
      await ensureReady()
      const task = await exclusive(async () => {
        const live = find(id)
        if (['queued', 'running', 'completed'].includes(live.status)) return clone(live)
        if (!live.retryable && live.status !== 'cancelled') throw fault(409, '该任务需要修改内容后重新创建，不能自动重试')
        if (credentialProfileId) live.credentialProfileId = credentialProfileId
        live.status = 'queued'; live.stage = 'queued'; delete live.error; delete live.retryable
        await persist(live); return clone(live)
      })
      kick(); return task
    },
    async cancel(id: string): Promise<GenerationTask> {
      await ensureReady()
      return exclusive(async () => {
        const task = find(id)
        if (['completed', 'cancelled'].includes(task.status)) return clone(task)
        task.status = 'cancelled'; task.stage = 'cancelled'; task.retryable = false
        await persist(task)
        if (active?.id === id) active.controller.abort()
        return clone(task)
      })
    },
    async markApplied(id: string, revision: number): Promise<GenerationTask> {
      await ensureReady()
      return exclusive(async () => {
        const task = find(id)
        if (task.status !== 'completed' || !task.resultAvailable) throw fault(409, '任务尚未完成，不能应用结果')
        if (!Number.isInteger(revision) || revision < 1) throw fault(400, '应用版本无效')
        if (task.appliedRevision !== undefined && task.appliedRevision !== revision) throw fault(409, '该结果已应用到其他版本')
        if (task.appliedRevision === undefined) { task.appliedRevision = revision; task.appliedAt = new Date().toISOString(); await persist(task) }
        return clone(task)
      })
    },
    async recover(): Promise<void> { await ensureReady() },
    async close(): Promise<void> {
      if (closed) return
      closed = true
      active?.controller.abort()
      await initialization?.catch(() => undefined)
      await exclusive(async () => {
        try {
          for (const task of tasks.values()) if (task.status === 'running') { task.status = 'queued'; task.stage = 'paused_restart'; await persist(task) }
        } finally { await releaseLock() }
      })
      for (const resolve of idleWaiters) resolve()
      idleWaiters.clear()
    },
    async waitForIdle(): Promise<void> {
      await ensureReady()
      await stateTail
      if (!pumping && !active && ![...tasks.values()].some(task => task.status === 'queued')) return
      await new Promise<void>(resolve => { idleWaiters.add(resolve); settleIdle() })
      if (queueError) throw queueError
    },
  }
}
