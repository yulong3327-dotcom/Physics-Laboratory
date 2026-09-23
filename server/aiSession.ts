import { AsyncLocalStorage } from 'node:async_hooks'
import { randomBytes, randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { isAllowedOrigin, type AIEnvironment } from './aiProxy.js'

export const AI_LOGIN_DEFAULTS = { baseUrl: 'https://ccproxy.yukework.com', model: 'gpt-6-astra', imageModel: 'gpt-image-2', skQueryUrl: 'https://code.yukework.com/static/zcode-admin/#/coding-plan' } as const
const COOKIE = 'circuit_ai_session', TTL = 12 * 60 * 60 * 1000
type Profile = { id: string; token: string; expiresAt: number; baseUrl: string; apiKey: string; model: string; imageModel: string }
const profiles = new Map<string, Profile>(), tokens = new Map<string, string>()
const requestContext = new AsyncLocalStorage<string>()

function activeProfile(id: string | undefined) {
  const p = id ? profiles.get(id) : undefined
  if (p && p.expiresAt <= Date.now()) { profiles.delete(p.id); tokens.delete(p.token); return undefined }
  return p
}
export function requestAIProfileId() { return requestContext.getStore() }
export function profileAIEnvironment(id: string | undefined, fallback: AIEnvironment): AIEnvironment {
  if (!id) return fallback
  const p = activeProfile(id)
  if (!p) throw Object.assign(new Error('AI 登录会话已失效，请重新登录后点击“从断点继续”。'), { code: 'ai_session_required', status: 401, retryable: true })
  return { ...fallback, AI_BASE_URL: p.baseUrl, AI_API_KEY: p.apiKey, AI_MODEL: p.model, AI_IMAGE_MODEL: p.imageModel }
}
export function requestAIEnvironment(fallback: AIEnvironment) { return profileAIEnvironment(requestAIProfileId(), fallback) }
function reply(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value))
}
function publicProfile(p: Profile) { return { authenticated: true, baseUrl: p.baseUrl, model: p.model, imageModel: p.imageModel, skQueryUrl: AI_LOGIN_DEFAULTS.skQueryUrl } }
function fromCookie(req: IncomingMessage) {
  const token = req.headers.cookie?.split(';').map(item => item.trim()).find(item => item.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1)
  return activeProfile(token ? tokens.get(token) : undefined)
}
function cookie(req: IncomingMessage, token: string, env: AIEnvironment, remove = false) {
  const secure = (req.socket as { encrypted?: boolean }).encrypted || env.PUBLIC_ORIGIN?.startsWith('https:') || req.headers.origin?.startsWith('https:')
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${remove ? 0 : TTL / 1000}${secure ? '; Secure' : ''}`
}
function validated(input: unknown) {
  const p = input as Record<string, unknown> | null
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('请填写登录信息。')
  const apiKey = typeof p.apiKey === 'string' ? p.apiKey.trim() : ''
  if (!/^sk-[A-Za-z0-9_.-]{8,500}$/.test(apiKey)) throw new Error('请填写有效的 SK，格式应以 sk- 开头。')
  const url = new URL(typeof p.baseUrl === 'string' ? p.baseUrl.trim() : AI_LOGIN_DEFAULTS.baseUrl)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('服务地址须为 HTTPS 地址，且不包含用户名、密码或查询参数。')
  // User-entered upstreams may be custom domains, but not local network services.
  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.includes(':') || /^\d+(?:\.\d+){3}$/.test(host)) throw new Error('请使用服务商的公网域名地址。')
  const model = typeof p.model === 'string' && p.model.trim() ? p.model.trim() : AI_LOGIN_DEFAULTS.model
  const imageModel = typeof p.imageModel === 'string' && p.imageModel.trim() ? p.imageModel.trim() : AI_LOGIN_DEFAULTS.imageModel
  if (![model, imageModel].every(value => /^[A-Za-z0-9][A-Za-z0-9_./:-]{0,119}$/.test(value))) throw new Error('模型名称格式无效。')
  return { apiKey, baseUrl: url.toString().replace(/\/$/, ''), model, imageModel }
}
async function body(req: IncomingMessage) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw new Error('登录请求须使用 JSON。')
  let size = 0; const chunks: Buffer[] = []
  for await (const chunk of req) { size += chunk.length; if (size > 8192) throw new Error('登录信息过长。'); chunks.push(Buffer.from(chunk)) }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

/** API-key connection login. Secrets stay in process memory and never enter task snapshots. */
export function createAISessionMiddleware(env: AIEnvironment = {}) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void | Promise<void>) => {
    const path = (req.url || '').split('?')[0]
    if (!path.startsWith('/api/') || path === '/api/health') { await next(); return }
    if (!isAllowedOrigin(req, env.PUBLIC_ORIGIN)) { reply(res, 403, { error: '不允许跨站请求' }); return }
    const profile = fromCookie(req)
    if (path === '/api/auth/session' && req.method === 'GET') { reply(res, 200, profile ? publicProfile(profile) : { authenticated: false, ...AI_LOGIN_DEFAULTS }); return }
    if (path === '/api/auth/login' && req.method === 'POST') {
      try {
        const input = validated(await body(req))
        for (const id of profiles.keys()) activeProfile(id)
        if (profiles.size >= 1000 && !profile) { reply(res, 429, { error: '登录会话过多，请稍后重试。' }); return }
        if (profile) { profiles.delete(profile.id); tokens.delete(profile.token) }
        const p: Profile = { ...input, id: randomUUID(), token: randomBytes(32).toString('hex'), expiresAt: Date.now() + TTL }
        profiles.set(p.id, p); tokens.set(p.token, p.id)
        res.setHeader('Set-Cookie', cookie(req, p.token, env)); reply(res, 200, publicProfile(p))
      } catch { reply(res, 400, { error: '请检查 HTTPS 服务地址、SK 格式和模型名称。SK 应以 sk- 开头。' }) }
      return
    }
    if (path === '/api/auth/logout' && req.method === 'POST') {
      if (profile) { profiles.delete(profile.id); tokens.delete(profile.token) }
      res.setHeader('Set-Cookie', cookie(req, '', env, true)); reply(res, 200, { authenticated: false, ...AI_LOGIN_DEFAULTS }); return
    }
    if (path.startsWith('/api/auth/')) { reply(res, 404, { error: '登录接口不存在' }); return }
    if (!profile) { reply(res, 401, { error: '请先填写 SK 登录工作台。', code: 'ai_session_required' }); return }
    await requestContext.run(profile.id, next)
  }
}
export function createAISessionPlugin(env: AIEnvironment): Plugin {
  const session = createAISessionMiddleware(env)
  const mount = (server: { middlewares: { use: (handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void } }) => { server.middlewares.use((req, res, next) => { void session(req, res, next).catch(() => { if (!res.headersSent) reply(res, 500, { error: '登录服务暂时不可用' }); else res.destroy() }) }) }
  return { name: 'local-ai-session', configureServer: mount, configurePreviewServer: mount }
}
