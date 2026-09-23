import type { CircuitAsset, Shot, VideoProject } from '../../server/videoTypes'
import { getVideoStoryboardReadiness } from '../../server/videoStoryboardReadiness'
import { isVideoProjectShape } from './videoClient'
import { normalizeGeneratedShotLayout } from './videoStoryboardLayout'

export interface StoryboardGenerationOptions {
  signal?: AbortSignal
  onProgress?: (message: string) => void
  /** Optional request implementation for isolated integrations. */
  fetcher?: typeof fetch
  /** Optional storage for isolated tests or alternate local persistence. */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  /** Durable server task checkpoint. When supplied, browser storage is not authoritative. */
  checkpoint?: unknown
  onCheckpoint?: (value: unknown) => Promise<void>
  /** Server owns transport retries; invalid AI content gets one feedback correction. */
  serverManagedRetries?: boolean
  /** Small independent requests, with a hard concurrency cap of three. */
  batchMaxUtterances?: number
  batchMaxCharacters?: number
  batchAcrossSections?: boolean
  batchConcurrency?: number
  compactOutput?: boolean
  teachingReview?: { noteId: string; utteranceId?: string; message: string }[]
  outline?: { sections: { id: string; title: string; chapter: number; utteranceIds: string[]; circuitIds?: string[] }[]; circuits?: { id: string; description: string }[] }
  attempts?: number
}

type BatchRequest = (project: VideoProject, options: StoryboardGenerationOptions, context: string) => Promise<VideoProject>

// Persist the work plan as well as completed batches, including timeout splits.
interface Batch { id: string; utteranceIds: string[]; project?: VideoProject }
interface Checkpoint { version: 4; fingerprint: string; batches: Batch[]; shots: Shot[]; circuits: CircuitAsset[]; project?: VideoProject; savedAt?: number }

const memory = new Map<string, Checkpoint>()
const generationInFlight = new Set<string>()
const stripGeometry = (circuits: CircuitAsset[]) => circuits.map(({ geometry: _geometry, ...circuit }) => circuit)
const keyFor = (project: VideoProject) => 'video-storyboard-checkpoint-v4:' + project.id

function getStorage(options: StoryboardGenerationOptions) {
  if (options.storage) return options.storage
  try { return typeof localStorage === 'undefined' ? undefined : localStorage } catch { return undefined }
}

async function fingerprint(project: VideoProject, strategy = 'storyboard-incremental-v1') {
  const values: unknown[] = [strategy, project.sourceScript, project.scriptNotes, project.problem, project.settings.defaultCircuitView, project.settings.switchPolicy, project.utterances, project.speakers.map(s => [s.id, s.name]), stripGeometry(project.circuits)]
  const payload = JSON.stringify(values)
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload))), b => b.toString(16).padStart(2, '0')).join('')
}

function selectedStoryboardCircuits(project: VideoProject, shots: Shot[], circuits: CircuitAsset[]): CircuitAsset[] {
  const used = new Set(shots.map(shot => shot.circuitAssetId).filter(Boolean))
  const allSteps = new Set(shots.flatMap(shot => shot.formulas.map(formula => formula.id)))
  const originals = new Map(project.circuits.map(circuit => [circuit.id, circuit]))
  return circuits.filter(circuit => used.has(circuit.id)).map(circuit => ({ ...circuit, quantities: circuit.quantities.map(quantity => {
    const prior = originals.get(circuit.id)?.quantities.find(old => old.id === quantity.id)
    return quantity.revealStepId && !allSteps.has(quantity.revealStepId) && prior?.revealStepId === quantity.revealStepId ? { ...quantity, revealStepId: undefined } : quantity
  }) }))
}

function isVideoProject(value: unknown): value is VideoProject {
  return !!value && typeof value === 'object' && !Array.isArray(value) && isVideoProjectShape(value as VideoProject)
}

const contentFailure = (messages: string[]) => Object.assign(new Error(messages.join('\n')), {
  code: 'storyboard_content_invalid', retryable: false,
  issues: messages.map(message => ({ code: 'storyboard_content_invalid', stage: 'storyboard', message, severity: 'error', retryable: false })),
})

function batchProject(project: VideoProject, ids: string[]): VideoProject {
  const selected = new Set(ids)
  return { ...structuredClone(project), utterances: structuredClone(project.utterances.filter(line => selected.has(line.id))),
    scriptNotes: structuredClone(project.scriptNotes?.filter(note => !note.utteranceId || selected.has(note.utteranceId))),
    contentKinds: project.contentKinds && Object.fromEntries(Object.entries(project.contentKinds).filter(([id]) => selected.has(id))),
    shots: [], approvedRevision: undefined }
}

function checked(candidate: VideoProject, source: VideoProject, validate: (p: VideoProject) => string[]) {
  if (!isVideoProject(candidate)) throw contentFailure(['AI 分镜结构不完整'])
  const result = { ...structuredClone(source), shots: structuredClone(candidate.shots),
    circuits: selectedStoryboardCircuits(source, candidate.shots, structuredClone(candidate.circuits)), approvedRevision: undefined }
  const errors = [...validate(result), ...getVideoStoryboardReadiness(result).issues]
  if (JSON.stringify(result.shots.flatMap(shot => shot.utteranceIds)) !== JSON.stringify(source.utterances.map(line => line.id))) errors.push('分镜必须按顺序覆盖每段旁白一次，避免漏句或重复。')
  if (errors.length) throw contentFailure([...new Set(errors)])
  return result
}

/** Each batch owns its generated IDs and assets; concurrent responses cannot overwrite another page. */
function namespaceBatch(candidate: VideoProject, batchId: string): VideoProject {
  const result = structuredClone(candidate)
  const formulas = new Map(result.shots.flatMap(shot => shot.formulas).map((f, index) => [f.id, `${batchId}-f${index + 1}`]))
  const assets = new Map(result.circuits.map((c, index) => [c.id, `${batchId}-c${index + 1}`]))
  const elementId = (id: string) => id.replace(/^(formula(?:-caption)?):(.+)$/, (_match, kind, source) => `${kind}:${formulas.get(source) || source}`)
  for (const circuit of result.circuits) {
    circuit.id = assets.get(circuit.id)!
    for (const quantity of circuit.quantities) if (quantity.revealStepId) quantity.revealStepId = formulas.get(quantity.revealStepId) || quantity.revealStepId
  }
  result.shots.forEach((shot, index) => {
    shot.id = `${batchId}-s${index + 1}`
    if (shot.circuitAssetId) shot.circuitAssetId = assets.get(shot.circuitAssetId) || shot.circuitAssetId
    for (const formula of shot.formulas) {
      formula.id = formulas.get(formula.id)!
      if (formula.correctionStepId) formula.correctionStepId = formulas.get(formula.correctionStepId) || formula.correctionStepId
    }
    for (const highlight of shot.highlights || []) if (highlight.targetType === 'formula') highlight.targetId = formulas.get(highlight.targetId) || highlight.targetId
    if (shot.layout) shot.layout.elements = Object.fromEntries(Object.entries(shot.layout.elements).map(([id, value]) => [elementId(id), value]))
    if (shot.lockedElementIds) shot.lockedElementIds = shot.lockedElementIds.map(elementId)
  })
  return result
}

function planBatches(project: VideoProject, options: StoryboardGenerationOptions): Batch[] {
  const boundaries = new Set<number>([0, project.utterances.length])
  if (!options.batchAcrossSections) for (const note of project.scriptNotes || []) {
    if (!['chapter', 'summary', 'problem'].includes(note.kind)) continue
    const index = project.utterances.findIndex(line => line.id === note.utteranceId)
    if (index >= 0) boundaries.add(index + (note.placement === 'after' ? 1 : 0))
  }
  const points = [...boundaries].sort((a, b) => a - b)
  const groups: string[][] = []
  for (let i = 0; i < points.length - 1; i++) groups.push(...splitStoryboardUtterances(project.utterances.slice(points[i], points[i + 1]), options))
  if (groups[0]?.length > 2) groups.splice(0, 1, groups[0].slice(0, 2), groups[0].slice(2))
  return groups.map((utteranceIds, index) => ({ id: `b${index + 1}`, utteranceIds }))
}

/** Bounded independent requests with durable per-batch recovery and ordered assembly. */
export async function generateStoryboardInBatches(project: VideoProject, options: StoryboardGenerationOptions, request: BatchRequest, validate: (p: VideoProject) => string[]): Promise<VideoProject> {
  options.signal?.throwIfAborted()
  const id = project.id
  if (generationInFlight.has(id)) throw new Error('本工程的分镜正在生成，请等待完成或取消后再试。')
  generationInFlight.add(id)
  try {
    options.signal?.throwIfAborted()
    const digest = await fingerprint(project)
    const key = keyFor(project)
    const storage = options.onCheckpoint ? undefined : getStorage(options)

    let loaded: unknown = options.onCheckpoint ? options.checkpoint : memory.get(key)
    if (!loaded && storage) {
      try { const stored = storage.getItem(key); if (stored) loaded = JSON.parse(stored) } catch { /* corrupt checkpoints are ignored */ }
    }
    const saved = loaded as Partial<Checkpoint> | undefined
    let batches = planBatches(project, options)
    if (saved?.version === 4 && saved.fingerprint === digest && Array.isArray(saved.batches)
      && saved.batches.every(batch => typeof batch?.id === 'string' && /^b\d+(?:-[12])*$/.test(batch.id) && Array.isArray(batch.utteranceIds) && batch.utteranceIds.length)
      && new Set(saved.batches.map(batch => batch.id)).size === saved.batches.length
      && JSON.stringify(saved.batches.flatMap(batch => batch.utteranceIds)) === JSON.stringify(project.utterances.map(line => line.id))) {
      batches = structuredClone(saved.batches)
      for (const batch of batches) if (batch.project) {
        try {
          const result = checked(batch.project, batchProject(project, batch.utteranceIds), validate)
          if (batches.length > 1 && JSON.stringify(namespaceBatch(result, batch.id)) !== JSON.stringify(result)) throw new Error('checkpoint namespace mismatch')
          batch.project = result
        } catch { delete batch.project }
      }
    } else if ((loaded as { version?: number })?.version === 3 && (loaded as { fingerprint?: string }).fingerprint === await fingerprint(project, 'storyboard-single-shot-v1')) {
      const previous = (loaded as { project?: VideoProject }).project
      if (previous) { try { return checked(previous, project, validate) } catch { /* invalid legacy results are regenerated */ } }
    }
    // A deployment with a smaller request budget keeps completed work and
    // subdivides only pending requests from an older checkpoint.
    const resize = (batch: Batch): Batch[] => {
      if (batch.project || splitStoryboardUtterances(batchProject(project, batch.utteranceIds).utterances, options).length <= 1) return [batch]
      const middle = Math.ceil(batch.utteranceIds.length / 2)
      return [...resize({ id: batch.id + '-1', utteranceIds: batch.utteranceIds.slice(0, middle) }), ...resize({ id: batch.id + '-2', utteranceIds: batch.utteranceIds.slice(middle) })]
    }
    batches = batches.flatMap(resize)
    const assembled = () => ({ ...structuredClone(project), shots: batches.flatMap(batch => batch.project?.shots || []),
      circuits: batches.flatMap(batch => batch.project?.circuits || []), approvedRevision: undefined })
    let persistence = Promise.resolve()
    const persist = (complete?: VideoProject) => {
      persistence = persistence.then(async () => {
        const result = assembled()
        const next: Checkpoint = { version: 4, fingerprint: digest, batches: structuredClone(batches), shots: result.shots, circuits: result.circuits,
          ...(complete ? { project: structuredClone(complete) } : {}), savedAt: Math.max(Date.now(), (memory.get(key)?.savedAt || 0) + 1) }
        memory.set(key, structuredClone(next))
        try { storage?.setItem(key, JSON.stringify(next)) } catch { /* in-memory recovery remains available */ }
        await options.onCheckpoint?.(structuredClone(next))
      })
      return persistence
    }
    const signal = options.signal || new AbortController().signal
    const running = new Set<string>()
    let failure: unknown
    const lesson = JSON.stringify({ title: project.title, lessonContext: project.utterances.map(line => [line.id, line.text]), lessonNotes: project.scriptNotes })
    await persist()
    const worker = async () => {
      while (!failure) {
        signal.throwIfAborted()
        const batch = batches.find(item => !item.project && !running.has(item.id))
        if (!batch) return
        running.add(batch.id)
        const source = batchProject(project, batch.utteranceIds)
        const context = lesson + '\n' + JSON.stringify({ batchId: batch.id, generateOnly: batch.utteranceIds })
          + '\n仅生成 generateOnly 内的台词，整课上下文只用于理解，不得提前展示后文答案。每批使用独立素材和本批公式引用；需要后文纠正的错误先用题干、问题板书与 reviewNotes 表达，不编造尚未生成的 correctionStepId。精简输出，省略可选默认字段，不重复定义输入中已有的电路。'
        try {
          let candidate: VideoProject
          try {
            const response = await request(structuredClone(source), { ...options, compactOutput: options.compactOutput ?? options.serverManagedRetries === true, signal }, context)
            signal.throwIfAborted()
            candidate = checked(response, source, validate)
          } catch (error) {
            signal.throwIfAborted()
            const e = error as Error & { code?: string }
            if (e.code !== 'storyboard_content_invalid') throw error
            if (failure) throw failure
            // A single bounded correction preserves validation without discarding successful batches.
            options.onProgress?.('正在按校验反馈修正当前分镜批次')
            const repaired = await request(structuredClone(source), { ...options, compactOutput: options.compactOutput ?? options.serverManagedRetries === true, signal }, context + '\n上次本批输出未通过校验，请修正以下问题后返回完整本批 JSON：\n' + e.message.slice(0, 4000))
            candidate = checked(repaired, source, validate)
          }
          signal.throwIfAborted()
          batch.project = batches.length === 1 ? candidate : namespaceBatch(candidate, batch.id)
          await persist()
          options.onProgress?.(`已生成 ${batches.filter(item => item.project).reduce((count, item) => count + item.utteranceIds.length, 0)}/${project.utterances.length} 段分镜`)
        } catch (error) {
          const e = error as Error & { code?: string }
          if (!signal.aborted && (e.name === 'TimeoutError' || ['ai_request_timeout', 'ai_output_limit'].includes(e.code || '')) && batch.utteranceIds.length > 1) {
            const middle = Math.ceil(batch.utteranceIds.length / 2)
            batches.splice(batches.indexOf(batch), 1, { id: batch.id + '-1', utteranceIds: batch.utteranceIds.slice(0, middle) }, { id: batch.id + '-2', utteranceIds: batch.utteranceIds.slice(middle) })
            options.onProgress?.('当前分镜请求较慢，已缩小本批范围，已完成画面保留')
            await persist()
          } else { failure ||= !signal.aborted && e.name === 'TimeoutError'
            ? Object.assign(new Error('AI 请求超时，已完成批次会保留'), { code: 'ai_request_timeout', retryable: true }) : error }
        } finally { running.delete(batch.id) }
      }
    }
    const concurrency = Number.isFinite(options.batchConcurrency) ? Math.max(1, Math.min(3, Math.floor(options.batchConcurrency!))) : 3
    const workers = await Promise.allSettled(Array.from({ length: concurrency }, worker))
    for (const result of workers) if (result.status === 'rejected') failure ||= result.reason
    await persistence
    signal.throwIfAborted()
    if (failure) throw failure
    const candidate = checked(assembled(), project, validate)
    await persist(candidate)
    signal.throwIfAborted()
    memory.delete(key)
    try { storage?.removeItem(key) } catch { /* optional storage */ }
    options.onProgress?.('分镜已生成')
    return candidate
  } finally {
    generationInFlight.delete(id)
  }
}

export function splitStoryboardUtterances(utterances: VideoProject['utterances'], options: Pick<StoryboardGenerationOptions, 'batchMaxUtterances' | 'batchMaxCharacters'> = {}): string[][] {
  const limit = Number.isFinite(options.batchMaxUtterances) ? Math.max(1, Math.min(8, Math.floor(options.batchMaxUtterances!))) : 2
  const characters = Number.isFinite(options.batchMaxCharacters) ? Math.max(100, options.batchMaxCharacters!) : 800
  const groups: string[][] = []; let group: string[] = [], size = 0
  for (const line of utterances) {
    if (group.length && (group.length >= limit || size + line.text.length > characters)) { groups.push(group); group = []; size = 0 }
    group.push(line.id); size += line.text.length
  }
  if (group.length) groups.push(group)
  return groups
}

// Re-exported so legacy imports from tests that referenced the internal helper
// for layout normalization continue to resolve.
export { normalizeGeneratedShotLayout }
