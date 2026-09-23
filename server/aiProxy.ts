import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { requestAIEnvironment } from './aiSession.js'
import { traceHeaders } from './logging.js'

export type AIEnvironment = Record<string, string | undefined>
const MAX_BODY_BYTES = 8 * 1024 * 1024

function positiveInteger(value: string | undefined, fallback: number, maximum: number) {
  if (!value || !/^\d+$/.test(value)) return fallback
  const parsed = Number(value)
  return parsed > 0 && parsed <= maximum ? parsed : fallback
}

function retryAfterSeconds(value: string | null): number | undefined {
  if (!value?.trim()) return undefined
  const raw = value.trim()
  const seconds = /^\d+$/.test(raw) ? Number(raw) : Math.ceil((Date.parse(raw) - Date.now()) / 1000)
  return Number.isFinite(seconds) ? Math.max(1, seconds) : undefined
}

export function isAllowedOrigin(req: IncomingMessage, publicOrigin?: string): boolean {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  if (!origin) return true
  try {
    const parsed = new URL(origin)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) return false
    if (publicOrigin) {
      const expected = new URL(publicOrigin)
      return ['http:', 'https:'].includes(expected.protocol) && expected.origin === publicOrigin && origin === publicOrigin
    }
    // TLS may terminate at the platform proxy. Never use forwarded headers to authorize a host.
    const host = req.headers.host
    if (!host) return false
    const requested = new URL(`${parsed.protocol}//${host}`)
    return requested.host === host && requested.origin === origin
  } catch { return false }
}

export function upstreamErrorMessage(status: number, input: unknown, apiKey: string): string {
  const error = input && typeof input === 'object' && 'error' in input ? input.error : undefined
  const detail = error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message : ''
  const safe = detail.replaceAll(apiKey, '[redacted]').replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/data:image\/[^\s"]+/g, '[image]').slice(0, 300)
  return `AI 服务返回错误 (${status})${safe ? `：${safe}` : ''}`
}

function respond(res: ServerResponse, status: number, data: unknown, headers?: Record<string, string>) {
  if (res.destroyed || res.writableEnded) return
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  for (const [name, value] of Object.entries(headers || {})) res.setHeader(name, value)
  res.end(JSON.stringify(data))
}

async function readBody(req: IncomingMessage, timeoutMs = 30_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (req.aborted || req.destroyed) { reject(new Error('请求中断')); return }
    let size = 0
    const chunks: Buffer[] = []
    let timer: ReturnType<typeof setTimeout>
    const cleanup = () => {
      clearTimeout(timer)
      req.off('data', onData)
      req.off('end', onEnd)
      req.off('error', onError)
      req.off('aborted', onAborted)
    }
    const onError = (error: Error) => { cleanup(); reject(error) }
    const onAborted = () => onError(new Error('请求中断'))
    const onData = (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        onError(new Error('请求过大'))
        req.resume()
        return
      }
      chunks.push(Buffer.from(chunk))
    }
    const onEnd = () => {
      cleanup()
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
      catch (error) { reject(error) }
    }
    req.on('data', onData)
    req.once('end', onEnd)
    req.once('error', onError)
    req.once('aborted', onAborted)
    timer = setTimeout(() => { onError(new DOMException('请求读取超时', 'TimeoutError')); req.resume() }, timeoutMs)
  })
}

function validMessages(value: unknown): value is unknown[] {
  if (!Array.isArray(value) || !value.length || value.length > 20) return false
  return value.every(message => {
    if (!message || !['user', 'assistant', 'system'].includes(message.role)) return false
    if (typeof message.content === 'string') return message.content.length > 0 && message.content.length <= 60000
    if (!Array.isArray(message.content) || message.content.length > 4 || !message.content.length) return false
    return message.content.every((part: { type?: string; text?: unknown; image_url?: { url?: unknown } } | null) => {
      if (!part || typeof part !== 'object') return false
      if (part.type === 'text') return typeof part.text === 'string' && part.text.length <= 60000
      if (part.type !== 'image_url' || typeof part.image_url?.url !== 'string') return false
      return /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(part.image_url.url)
    })
  })
}

export function createAIProxyMiddleware(env: AIEnvironment) {
  const publicOrigin = env.PUBLIC_ORIGIN?.trim()
  const maxRequests = positiveInteger(env.AI_RATE_LIMIT_PER_MINUTE, 30, 600)
  const maxConcurrent = positiveInteger(env.AI_MAX_CONCURRENT_REQUESTS, 4, 32)
  const requestTimeout = positiveInteger(env.AI_REQUEST_TIMEOUT_MS, 150000, 300000)
  let activeRequests = 0
  let requestTimes: number[] = []

  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const pathname = (req.url || '').split('?')[0]
    if (!pathname.startsWith('/api/ai/')) { next(); return }
    const effective = requestAIEnvironment(env)
  const apiKey = effective.AI_API_KEY?.trim()
  const model = effective.AI_MODEL?.trim()
  const baseUrl = effective.AI_BASE_URL?.trim()
  let endpoint: URL | undefined
  try {
    if (baseUrl) {
      const base = new URL(baseUrl)
      if (base.protocol !== 'https:' || base.username || base.password) throw new Error('Invalid URL')
      base.pathname = `${base.pathname.replace(/\/$/, '').replace(/\/v1$/, '')}/v1/chat/completions`
      base.search = ''; base.hash = ''; endpoint = base
    }
  } catch { endpoint = undefined }
  const configured = !!(apiKey && model && endpoint)

    if (!isAllowedOrigin(req, publicOrigin)) {
      respond(res, 403, { error: '不允许跨站请求' }); return
    }
    if (pathname === '/api/ai/status' && req.method === 'GET') {
      respond(res, 200, { configured, model: model || null, imageModel: effective.AI_IMAGE_MODEL || 'gpt-image-2' }); return
    }
    if (pathname !== '/api/ai/chat') { respond(res, 404, { error: '接口不存在' }); return }
    if (req.method !== 'POST') { respond(res, 405, { error: '请求方法不支持' }); return }
    if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      respond(res, 415, { error: '请求必须使用 JSON' }); return
    }
    if (!configured) { respond(res, 503, { error: '请在服务端环境变量中配置 AI_BASE_URL、AI_API_KEY 和 AI_MODEL' }); return }

    const now = Date.now()
    requestTimes = requestTimes.filter(time => now - time < 60000)
    if (requestTimes.length >= maxRequests || activeRequests >= maxConcurrent) {
      res.setHeader('Retry-After', activeRequests >= maxConcurrent ? '5' : '60')
      respond(res, 429, { error: 'AI 请求繁忙，请稍后重试' }); return
    }
    requestTimes.push(now)
    activeRequests += 1
    try {
      let body: { messages?: unknown; json?: unknown; purpose?: unknown }
      try {
        const input = await readBody(req, Math.min(requestTimeout, 30_000))
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('无效请求')
        body = input
        if (!validMessages(body.messages)) throw new Error('消息格式无效')
      } catch (error) {
        if (error instanceof Error && error.name === 'TimeoutError') respond(res, 408, { error: '请求上传超时，请重试', code: 'request_timeout' })
        else respond(res, 400, { error: '请求格式无效或超过 8 MB' })
        return
      }

      const storyboard = body.purpose === 'video_storyboard' || body.purpose === 'video_problem'
      // Echo assistance is an explicit, isolated choice; it never changes other workspaces' model.
      const echo = body.purpose === 'echo_parse'
      const selectedModel = echo ? 'deepseek-v4-pro-zy' : model
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), storyboard ? Math.min(requestTimeout, 95000) : requestTimeout)
      const onClose = () => { if (!res.writableEnded) controller.abort() }
      res.once('close', onClose)
      try {
        if (res.destroyed) return
        const upstream = await fetch(endpoint!, {
          method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { ...traceHeaders(), 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model: selectedModel, messages: body.messages, ...(echo ? { max_tokens: 5000, temperature: 0 } : { reasoning_effort: storyboard ? 'low' : 'medium', max_completion_tokens: storyboard ? 7000 : 12000 }),
            ...(body.json === true ? { response_format: { type: 'json_object' } } : {}) }),
        })
        if (!upstream.ok) {
          const detail: unknown = await upstream.json().catch(() => null)
          // Keep rate limiting visible to the client. Storyboard batching uses this to
          // back off instead of interpreting a quota response as malformed JSON.
          const retryable = [408, 425, 429, 500, 502, 503, 504].includes(upstream.status)
          const retryAfter = retryAfterSeconds(upstream.headers.get('retry-after')) ?? (upstream.status === 429 ? 5 : undefined)
          const headers: Record<string, string> = {}
          if (retryAfter) headers['Retry-After'] = String(retryAfter)
          const status = upstream.status === 429 ? 429 : 502
          respond(res, status, { error: upstreamErrorMessage(upstream.status, detail, apiKey!), code: retryable ? 'upstream_temporary' : 'upstream_error', retryable, upstreamStatus: upstream.status }, headers); return
        }
        const data = await upstream.json() as { choices?: { message?: { content?: unknown }; finish_reason?: string }[] } | null
        if (data?.choices?.[0]?.finish_reason === 'length') {
          respond(res, 502, { error: storyboard ? '本批分镜超出输出限制，将缩小批次后重试' : '识别结果超出输出限制，请缩小到一个完整电路后重试', code: 'output_limit' }); return
        }
        const content = data?.choices?.[0]?.message?.content
        if (typeof content !== 'string' || !content.trim()) {
          respond(res, 502, { error: 'AI 服务未返回有效内容' }); return
        }
        respond(res, 200, { ...(echo ? { model: selectedModel } : {}), choices: [{ message: { role: 'assistant', content } }] })
      } catch {
        if (!res.destroyed) respond(res, controller.signal.aborted ? 504 : 502, { error: controller.signal.aborted ? (storyboard ? '本批分镜请求超时，已完成批次可以继续复用' : 'AI 请求超时，请重试') : 'AI 服务连接失败，请检查服务端配置', code: controller.signal.aborted ? 'timeout' : 'connection_failed' })
      } finally { clearTimeout(timer); res.off('close', onClose) }
    } finally { activeRequests -= 1 }
  }
}

export function createAIProxyPlugin(env: AIEnvironment): Plugin {
  const middleware = createAIProxyMiddleware(env)
  return {
    name: 'local-circuit-ai-proxy',
    configureServer(server) { server.middlewares.use((req, res, next) => { void middleware(req, res, next) }) },
    configurePreviewServer(server) { server.middlewares.use((req, res, next) => { void middleware(req, res, next) }) },
  }
}
