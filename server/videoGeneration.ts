import { renderPrompt } from './promptCatalog.js'
import { createHash } from 'node:crypto'
import type { AIEnvironment } from './aiProxy.js'
import { upstreamErrorMessage } from './aiProxy.js'
import type { GenerationTaskContext } from './videoTasks.js'
import type { VideoShared } from './videoShared.js'
import type { CircuitAsset, Shot, VideoProject, ValidationIssue } from './videoTypes.js'
import { canonicalVideoValue, scriptReviewContent } from './videoWorkflow.js'
import { equalProjectValue } from './videoProjectMerge.js'
import { getVideoStoryboardReadiness } from './videoStoryboardReadiness.js'
import { createStoryboardPreviewPublisher, publishStoryboardPreview } from './videoGenerationPreview.js'

type Outline = { sections: { id: string; title: string; chapter: number; utteranceIds: string[]; circuitIds: string[] }[];
  circuits: { id: string; description: string }[] }
type Checkpoint = { version: 1; inputHash: string; outline?: Outline; batches?: unknown; patch?: unknown; project?: VideoProject; failedCandidate?: VideoProject;
  diagnostics?: { stage: string; at: string; content?: string; error?: string; code?: string; status?: number }[];
  metrics: { requests: number; retries: number; stages: Record<string, number>; calls?: (AIRequestMetric & { stage: string })[]; contentCorrections?: number } }
type AIRequest = { messages: { role: string; content: unknown }[]; json?: boolean; purpose?: string; maxOutputTokens?: number }
export interface AIRequestMetric {
  attempt: number; startedAt: string; durationMs: number; requestBytes: number; responseCharacters?: number;
  inputTokens?: number; outputTokens?: number; cachedInputTokens?: number; status?: number; code?: string;
}
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value)
const positive = (value: string | undefined, fallback: number, max: number) => value && /^\d+$/.test(value) && Number(value) > 0 ? Math.min(Number(value), max) : fallback
const failure = (message: string, code: string, retryable = false, extra: object = {}) => Object.assign(new Error(message), { code, retryable, ...extra })
export function retryAfterMilliseconds(value: string | null, now = Date.now()) {
  if (!value?.trim()) return undefined
  const ms = /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) * 1000 : Date.parse(value) - now
  return Number.isFinite(ms) ? Math.max(0, ms) : undefined
}
function delay(milliseconds: number, signal: AbortSignal) {
  signal.throwIfAborted()
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, milliseconds)
    signal.addEventListener('abort', abort, { once: true })
  })
}

/** The same endpoint/model/credentials as aiProxy; only this transport owns network retries. */
export function createVideoAITransport(env: AIEnvironment, fetcher: typeof fetch = fetch, sleep = delay) {
  const apiKey = env.AI_API_KEY?.trim(), model = env.AI_MODEL?.trim()
  let endpoint: URL | undefined
  try {
    const url = new URL(env.AI_BASE_URL || '')
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('invalid')
    url.pathname = url.pathname.replace(/\/$/, '').replace(/\/v1$/, '') + '/v1/chat/completions'
    url.search = ''; url.hash = ''; endpoint = url
  } catch { /* Configuration errors are content/action-required failures, never transient. */ }
  const timeout = positive(env.VIDEO_AI_REQUEST_TIMEOUT_MS || env.AI_REQUEST_TIMEOUT_MS, 95_000, 300_000)
  const requestTimes: number[] = [], rateLimit = positive(env.AI_RATE_LIMIT_PER_MINUTE, 30, 600)
  return async (input: AIRequest, signal: AbortSignal, onAttempt?: (attempt: number, retryMs?: number) => Promise<void>, onMetric?: (metric: AIRequestMetric) => void): Promise<Response> => {
    if (!apiKey || !model || !endpoint) throw failure('请在本机服务配置 AI_BASE_URL、AI_API_KEY 和 AI_MODEL', 'ai_configuration')
    for (let attempt = 1; attempt <= 3; attempt++) {
      signal.throwIfAborted()
      while (true) {
        while (requestTimes.length && Date.now() - requestTimes[0] >= 60_000) requestTimes.shift()
        if (requestTimes.length < rateLimit) break
        await sleep(Math.max(1, 60_000 - (Date.now() - requestTimes[0])), signal)
        signal.throwIfAborted()
      }
      requestTimes.push(Date.now())
      await onAttempt?.(attempt)
      signal.throwIfAborted()
      const body = JSON.stringify({ model, messages: input.messages, reasoning_effort: 'low',
        max_completion_tokens: Number.isInteger(input.maxOutputTokens) ? Math.max(1000, Math.min(16000, input.maxOutputTokens!)) : input.purpose === 'video_problem' ? 16000 : 7000,
        ...(input.json ? { response_format: { type: 'json_object' } } : {}) })
      const began = Date.now(), requestDeadline = AbortSignal.timeout(timeout)
      const requestSignal = AbortSignal.any([signal, requestDeadline])
      const metric: AIRequestMetric = { attempt, startedAt: new Date(began).toISOString(), durationMs: 0, requestBytes: Buffer.byteLength(body) }
      try {
        const response = await fetcher(endpoint, { method: 'POST', redirect: 'error', signal: requestSignal,
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
          body })
        metric.status = response.status
        if (!response.ok) {
          const detail = await response.json().catch(() => null)
          const retryable = response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500
          throw failure(upstreamErrorMessage(response.status, detail, apiKey), retryable ? 'ai_upstream_temporary' : 'ai_upstream_rejected', retryable,
            { status: response.status, retryAfterMs: retryAfterMilliseconds(response.headers.get('retry-after')) })
        }
        let output: any
        try { output = await response.json() } catch (error) { requestSignal.throwIfAborted(); if (!(error instanceof SyntaxError)) throw error; throw failure('AI 服务返回的响应不是有效 JSON，请修改后重新生成', 'invalid_ai_response') }
        const choice = output?.choices?.[0], content = choice?.message?.content
        if (typeof content === 'string') metric.responseCharacters = content.length
        for (const [key, value] of Object.entries({ inputTokens: output?.usage?.prompt_tokens, outputTokens: output?.usage?.completion_tokens,
          cachedInputTokens: output?.usage?.prompt_tokens_details?.cached_tokens })) {
          if (Number.isInteger(value) && Number(value) >= 0) (metric as unknown as Record<string, unknown>)[key] = value
        }
        if (choice?.finish_reason === 'length') throw failure('当前内容超出 AI 输出上限，请缩小范围后重新生成', 'ai_output_limit')
        if (typeof content !== 'string' || !content.trim()) throw failure('AI 没有返回有效内容', 'invalid_ai_response')
        return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      } catch (error) {
        metric.durationMs = Date.now() - began
        signal.throwIfAborted()
        let e = error as Error & { retryable?: boolean; retryAfterMs?: number; code?: string }
        // A smaller storyboard batch is more useful than repeating the same slow
        // generation three times. Other network failures keep transport retries.
        if (requestDeadline.aborted || e.name === 'TimeoutError') e = failure('AI 请求超时，已完成批次会保留', 'ai_request_timeout', true)
        if (e.retryable === undefined && (['TypeError', 'TimeoutError', 'AbortError'].includes(e.name)
          || ['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET'].includes(e.code || ''))) e = failure(e.name === 'TimeoutError' || e.name === 'AbortError' ? 'AI 请求超时，已完成批次会保留' : 'AI 服务连接中断，已完成批次会保留', 'ai_connection', true)
        metric.code = e.code
        if (e.code === 'ai_request_timeout' && input.purpose === 'video_storyboard') throw e
        if (!e.retryable || attempt === 3) throw e
        const wait = e.retryAfterMs ?? Math.min(10_000, 1000 * 2 ** (attempt - 1))
        await onAttempt?.(attempt, wait)
        await sleep(wait, signal) // Never retry before a provider's Retry-After deadline.
      } finally {
        metric.durationMs ||= Date.now() - began
        onMetric?.(metric)
      }
    }
    throw failure('AI 请求未完成', 'ai_connection', true)
  }
}

export function validateLessonOutline(value: unknown, project: VideoProject): Outline {
  if (!record(value) || !Array.isArray(value.sections) || !value.sections.length || value.sections.length > 200 || !Array.isArray(value.circuits)) throw failure('全课结构缺少章节或电路清单', 'outline_invalid')
  const sections = value.sections.map((section: any) => {
    if (!record(section) || !ID.test(section.id) || typeof section.title !== 'string' || !section.title.trim() || section.title.length > 200
      || !Number.isInteger(section.chapter) || section.chapter < 1 || !Array.isArray(section.utteranceIds) || !section.utteranceIds.length
      || !section.utteranceIds.every((id: unknown) => typeof id === 'string') || !Array.isArray(section.circuitIds) || !section.circuitIds.every((id: unknown) => typeof id === 'string' && ID.test(id))) throw failure('全课结构的章节或台词归属无效', 'outline_invalid')
    return { id: section.id, title: section.title, chapter: section.chapter, utteranceIds: [...section.utteranceIds], circuitIds: [...section.circuitIds] }
  })
  const circuits = value.circuits.map((circuit: any) => {
    if (!record(circuit) || !ID.test(circuit.id) || typeof circuit.description !== 'string' || !circuit.description.trim() || circuit.description.length > 3000) throw failure('全课共享电路 ID 或说明无效', 'outline_invalid')
    return { id: circuit.id, description: circuit.description }
  })
  if (new Set(sections.map(section => section.id)).size !== sections.length || new Set(circuits.map(circuit => circuit.id)).size !== circuits.length
    || JSON.stringify(sections.flatMap(section => section.utteranceIds)) !== JSON.stringify(project.utterances.map(line => line.id))) throw failure('全课结构必须按原顺序覆盖每段台词一次', 'outline_utterance_coverage')
  const known = new Set([...project.circuits.map(circuit => circuit.id), ...circuits.map(circuit => circuit.id)])
  if (sections.some(section => section.circuitIds.some((id: string) => !known.has(id)))) throw failure('章节引用了未声明的共享电路', 'outline_circuit_reference')
  return { sections, circuits }
}

export interface VideoGenerationOptions {
  cwd: string; env: AIEnvironment; shared: () => Promise<VideoShared>;
  resolveImage: (source: string) => Promise<string>; validate: (value: unknown, options?: { pendingFormulaReferences?: boolean }) => VideoProject;
  fetcher?: typeof fetch; sleep?: typeof delay;
}
export function createVideoGenerationExecutor(options: VideoGenerationOptions) {
  const transport = createVideoAITransport(options.env, options.fetcher, options.sleep)
  return async (context: GenerationTaskContext): Promise<unknown> => {
    const original = structuredClone(options.validate(context.input)), shared = await options.shared()
    const inputHash = createHash('sha256').update(canonicalVideoValue(original)).digest('hex')
    let state: Checkpoint = record(context.checkpoint) && context.checkpoint.version === 1 && context.checkpoint.inputHash === inputHash
      ? structuredClone(context.checkpoint) as Checkpoint : { version: 1, inputHash, metrics: { requests: 0, retries: 0, stages: {} } }
    const deadline = AbortSignal.timeout(positive(options.env.VIDEO_GENERATION_TIMEOUT_MS, 30 * 60_000, 2 * 60 * 60_000))
    const signal = AbortSignal.any([context.signal, deadline])
    let stage = context.task.kind as string, pendingProgress = Promise.resolve(), responsibleShotId = context.task.scope?.[0]
    const checkpoint = async () => { await pendingProgress; await context.onCheckpoint(structuredClone(state)) }
    const progress = (message: string) => {
      if (message.includes('正在按校验反馈修正')) state.metrics.contentCorrections = (state.metrics.contentCorrections || 0) + 1
      pendingProgress = pendingProgress.then(() => context.onProgress({ stage: message }))
      void pendingProgress.catch(() => undefined) // Checkpoint still propagates a failed progress write.
    }
    const fetcher: typeof fetch = async (_url, init) => {
      if (typeof init?.body !== 'string') throw failure('AI 请求缺少声明式输入', 'ai_input_invalid')
      const body = JSON.parse(init.body) as AIRequest
      const callSignal = init.signal ? AbortSignal.any([signal, init.signal]) : signal
      if (stage === '全课结构') body.purpose = 'video_outline'
      if (context.task.kind === 'problem_script') body.messages[0].content = String(body.messages[0].content)
        + renderPrompt('video/problem-role-budget')
        + (context.task.instruction?.trim() ? renderPrompt('video/problem-teacher-prefix') + context.task.instruction + renderPrompt('video/problem-teacher-suffix') : '')
      const safeDiagnostic = (value: string) => Object.entries(options.env).filter(([key, secret]) => /KEY|TOKEN|SECRET|PASSWORD/i.test(key) && !!secret)
        .reduce((text, [, secret]) => text.replaceAll(secret!, '[redacted]'), value).replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]')
      let response: Response, requestBegan = Date.now(), awaitingProvider = false
      const heartbeat = setInterval(() => { if (awaitingProvider) progress(`${stage}：正在等待 AI 输出（本次请求已用 ${Math.floor((Date.now() - requestBegan) / 1000)} 秒）`) }, 15_000)
      try { response = await transport(body, callSignal, async (attempt, retryMs) => {
        awaitingProvider = retryMs === undefined
        if (retryMs !== undefined) {
          state.metrics.retries++; await context.onProgress({ stage: `${stage}：服务暂时中断，${Math.ceil(retryMs / 1000)} 秒后第 ${attempt + 1}/3 次尝试` })
        } else { requestBegan = Date.now(); state.metrics.requests++; await context.onProgress({ stage: `${stage}：正在请求 AI（${attempt}/3）` }) }
        await checkpoint()
      }, metric => { state.metrics.calls = [...(state.metrics.calls || []).slice(-199), { ...metric, stage }] }) } catch (error) {
        const e = error as Error & { code?: string; status?: number }
        state.diagnostics = [...(state.diagnostics || []).slice(-39), { stage, at: new Date().toISOString(), error: safeDiagnostic(e.message), code: e.code, status: e.status }]
        await checkpoint(); throw error
      } finally { clearInterval(heartbeat) }
      const data = await response.clone().json() as { choices: { message: { content: string } }[] }
      state.diagnostics = [...(state.diagnostics || []).slice(-39), { stage, at: new Date().toISOString(), content: safeDiagnostic(data.choices[0].message.content).slice(0, 160000) }]
      await checkpoint()
      return response
    }
    const runStage = async <T>(name: string, action: () => Promise<T>) => {
      stage = name; const began = Date.now()
      try { return await action() } finally { state.metrics.stages[name] = (state.metrics.stages[name] || 0) + Date.now() - began; await checkpoint() }
    }
    try {
      if (context.task.kind === 'problem_script') {
        const result = state.project || await runStage('解析讲稿', () => shared.generateProblemNarration(structuredClone(original), { fetcher, signal, attempts: 1, onProgress: progress }))
        result.speakers = structuredClone(original.speakers); result.speech = structuredClone(original.speech)
        options.validate(result); state.project = result; await checkpoint()
        return { project: result, metrics: state.metrics }
      }
      if (context.task.kind === 'storyboard_patch') throw failure('局部分镜补丁功能已废弃，请重新生成分镜', 'generation_kind_invalid')
      if (context.task.kind !== 'storyboard') throw failure('该任务类型需要使用配音预检管线', 'generation_kind_invalid')
      // The scheduler checkpoints every validated batch, including batches
      // completed out of order while other requests are still in flight.
      const publishPreview = createStoryboardPreviewPublisher(original, context, shared, { signal, resolveImage: options.resolveImage, validate: options.validate })
      const validateProject = (candidate: VideoProject) => {
        const issues = shared.validateTeachingProject(candidate)
        try { options.validate(candidate) }
        catch (error) {
          const detail = error as Error & { shotId?: string; objectId?: string }
          const shot = candidate.shots.find(item => item.id === detail.shotId)
          issues.push((shot ? `${shot.title}（${shot.id}）：` : '') + (detail.message || String(error)) + (detail.objectId ? `（${detail.objectId}）` : ''))
        }
        return [...new Set(issues)]
      }
      const result = state.project || await runStage('分镜生成', () => shared.generateStoryboardInBatches(structuredClone(original), {
        fetcher, signal, serverManagedRetries: true, checkpoint: state.batches, onProgress: progress,
        batchMaxUtterances: positive(options.env.VIDEO_STORYBOARD_BATCH_UTTERANCES, 2, 8),
        batchConcurrency: positive(options.env.VIDEO_STORYBOARD_CONCURRENCY, 3, 3),
        onCheckpoint: async (value: unknown) => {
          state.batches = structuredClone(value)
          const snapshot = value as { project?: VideoProject; shots?: Shot[]; circuits?: CircuitAsset[] }
          const shots = snapshot.project?.shots || snapshot.shots || []
          const circuits = snapshot.project?.circuits || snapshot.circuits || []
          const sourceIds = new Set(original.utterances.map(line => line.id))
          const covered = new Set(shots.flatMap(shot => shot.utteranceIds).filter(id => sourceIds.has(id)))
          await context.onProgress({ progress: Math.round(85 * covered.size / Math.max(1, original.utterances.length)) })
          await checkpoint()
          await publishPreview(shots, circuits)
        },
      }, shared.requestStoryboardBatch, validateProject))
      if (JSON.stringify(result.utterances) !== JSON.stringify(original.utterances)) throw failure('分镜改变了已确认台词，结果未应用', 'utterance_changed')
      result.speakers = structuredClone(original.speakers); result.speech = structuredClone(original.speech)
      if (result.problem) result.problem = { ...result.problem, storyboardReady: true }
      options.validate(result)
      const readiness = getVideoStoryboardReadiness(result)
      if (!readiness.ready) throw failure(readiness.issues.join('\n'), 'storyboard_incomplete')
      const prepared = await runStage('电路画面准备', () => shared.prepareVideoProject(result, { signal, resolveImage: options.resolveImage }))
      if (!equalProjectValue(scriptReviewContent(original), scriptReviewContent(prepared))) throw failure('分镜生成改变了已确认讲稿，结果未应用', 'script_fingerprint_changed')
      options.validate(prepared); state.project = prepared; await checkpoint()
      await publishStoryboardPreview(context, original, prepared)
      return { project: prepared, metrics: state.metrics }
    } catch (error) {
      context.signal.throwIfAborted()
      const e = error as Error & { code?: string; retryable?: boolean; issues?: ValidationIssue[]; status?: number; responsibleUtteranceId?: string; candidateProject?: VideoProject }
      if (deadline.aborted) throw failure('生成阶段超过时限，已完成部分已保留，可从断点继续', 'generation_timeout', true)
      if (e.candidateProject) { state.failedCandidate = structuredClone(e.candidateProject); await checkpoint() }
      if (e.responsibleUtteranceId) responsibleShotId = original.shots.find(shot => shot.utteranceIds.includes(e.responsibleUtteranceId!))?.id
      if (!e.issues) e.issues = [{ code: e.code || 'generation_content_invalid', stage, message: e.message, severity: 'error', retryable: e.retryable === true,
        ...(responsibleShotId ? { shotId: responsibleShotId } : {}) }]
      throw e
    }
  }
}
