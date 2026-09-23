import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowUpRight, FlaskConical, KeyRound, Loader2, LogOut, X } from 'lucide-react'
import { AIConnectionContext, ConnectionSettingsContext } from './ConnectionSettings'
import './VideoLoginGate.css'

const defaults = { baseUrl: 'https://ccproxy.yukework.com', model: 'gpt-6-astra', imageModel: 'gpt-image-2' }
type Connection = typeof defaults
type Session = Connection & { authenticated: boolean }
type AuthState = 'checking' | 'anonymous' | 'authenticated'
const isPublicWorkspace = () => true

function sessionValue(value: unknown): Session {
  if (!value || typeof value !== 'object' || typeof (value as Session).authenticated !== 'boolean') throw new Error('连接服务返回了无效信息，请重试。')
  const data = value as Partial<Session>
  return { authenticated: data.authenticated!, ...Object.fromEntries(Object.entries(defaults).map(([key, fallback]) =>
    [key, typeof data[key as keyof Connection] === 'string' && data[key as keyof Connection] ? data[key as keyof Connection] : fallback])) } as Session
}

async function authRequest(path: string, options: RequestInit = {}): Promise<Session> {
  const response = await fetch('/api/auth/' + path, { credentials: 'same-origin', cache: 'no-store', ...options })
  if (response.status === 401) return { ...defaults, authenticated: false }
  const value: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    // Do not render upstream response text: it could contain the submitted key.
    throw new Error(response.status === 400 ? '请检查 URL、SK 和模型名称的填写格式。' : '连接服务暂时不可用，请稍后重试。')
  }
  return sessionValue(value)
}

/** Keep an opened workspace mounted while an expired session is renewed. */
export function VideoLoginGate({ children }: { children: ReactNode }) {
  const [localWorkspace, setLocalWorkspace] = useState(isPublicWorkspace)
  const [auth, setAuth] = useState<AuthState>('checking')
  const [hasOpened, setHasOpened] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [connection, setConnection] = useState<Connection>(defaults)
  const [form, setForm] = useState<Connection>(defaults)
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState<'login' | 'logout' | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const keyInput = useRef<HTMLInputElement>(null)
  const mounted = useRef(false)
  const authRef = useRef<AuthState>('checking')
  const operation = useRef(0)
  const mutating = useRef(false)
  const checking = useRef<AbortController | null>(null)
  const pendingAI = useRef<(() => void) | null>(null)
  const dialogOpen = settingsOpen || (!localWorkspace && auth !== 'authenticated')

  const adoptSession = useCallback((session: Session) => {
    const next = session.authenticated ? 'authenticated' : 'anonymous'
    authRef.current = next; setAuth(next)
    if (session.authenticated) {
      const value = { baseUrl: session.baseUrl, model: session.model, imageModel: session.imageModel }
      setConnection(value); setHasOpened(true)
      if (pendingAI.current) {
        const ready = pendingAI.current
        pendingAI.current = null
        setSettingsOpen(false)
        ready()
      }
    }
  }, [])

  const checkSession = useCallback(async (explicit = false) => {
    if ((!explicit && isPublicWorkspace()) || mutating.current || checking.current) return
    const controller = new AbortController(), version = operation.current
    checking.current = controller
    try {
      const session = await authRequest('session', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) })
      if (!mounted.current || controller.signal.aborted || version !== operation.current) return
      const wasAuthenticated = authRef.current === 'authenticated'
      if (authRef.current === 'checking') setForm({ baseUrl: session.baseUrl, model: session.model, imageModel: session.imageModel })
      adoptSession(session)
      if (wasAuthenticated && !session.authenticated) {
        setApiKey(''); setSettingsOpen(true); setError(''); setNotice('连接已过期，请重新填写 SK。当前工作区和草稿已保留。')
      }
    } catch {
      if (!mounted.current || controller.signal.aborted || version !== operation.current) return
      if (authRef.current === 'checking') {
        authRef.current = 'anonymous'; setAuth('anonymous')
        setError('暂时无法检查连接。可以重试检查，或填写连接信息后登录。')
      }
    } finally { if (checking.current === controller) checking.current = null }
  }, [adoptSession])

  useEffect(() => {
    mounted.current = true
    void checkSession()
    const focus = () => { if (document.visibilityState !== 'hidden') void checkSession() }
    const expired = () => {
      // A pending settings/login request may be replacing the expired cookie.
      // Confirm against the session endpoint before acting on a late API 401.
      setSettingsOpen(true)
      void checkSession(true)
    }
    const navigate = () => {
      const local = isPublicWorkspace()
      setLocalWorkspace(local)
      if (local) {
        pendingAI.current = null
        checking.current?.abort(); checking.current = null
        setSettingsOpen(false); setApiKey('')
      } else void checkSession()
    }
    window.addEventListener('focus', focus)
    document.addEventListener('visibilitychange', focus)
    window.addEventListener('api-session-expired', expired)
    window.addEventListener('hashchange', navigate)
    return () => {
      mounted.current = false; operation.current++; checking.current?.abort(); checking.current = null
      window.removeEventListener('focus', focus)
      document.removeEventListener('visibilitychange', focus)
      window.removeEventListener('api-session-expired', expired)
      window.removeEventListener('hashchange', navigate)
    }
  }, [checkSession])

  useEffect(() => {
    const node = dialog.current
    if (!node) return
    if (dialogOpen && !node.open) node.showModal()
    if (!dialogOpen && node.open) node.close()
    if (dialogOpen && auth !== 'checking') keyInput.current?.focus()
  }, [dialogOpen, auth])

  const openSettings = () => {
    setForm(connection); setApiKey(''); setError(''); setNotice(''); setSettingsOpen(true)
    if (localWorkspace) void checkSession(true)
  }
  const closeSettings = () => {
    if ((!localWorkspace && auth !== 'authenticated') || mutating.current) return
    pendingAI.current = null
    setApiKey(''); setError(''); setNotice(''); setSettingsOpen(false)
  }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (mutating.current) return
    let url: URL
    try { url = new URL(form.baseUrl.trim()) } catch { setError('请输入完整的 API URL，例如 https://ccproxy.yukework.com。'); return }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      setError('API URL 必须是 HTTPS 地址，且不包含账号、查询参数或片段。'); return
    }
    if (!apiKey.trim() || !form.model.trim() || !form.imageModel.trim()) { setError('请填写 SK、文本模型和图片模型。'); return }
    if (!/^sk-[A-Za-z0-9_.-]{8,500}$/.test(apiKey.trim())) { setError('请填写有效的 SK，格式应以 sk- 开头。'); return }
    mutating.current = true; operation.current++; checking.current?.abort(); checking.current = null
    const version = operation.current
    setBusy('login'); setError(''); setNotice('')
    try {
      const session = await authRequest('login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: form.baseUrl.trim(), apiKey: apiKey.trim(), model: form.model.trim(), imageModel: form.imageModel.trim() }), signal: AbortSignal.timeout(30_000) })
      if (!mounted.current || version !== operation.current) return
      if (!session.authenticated) throw new Error('连接未保存，请重新填写 SK 后登录。')
      adoptSession(session); setForm({ baseUrl: session.baseUrl, model: session.model, imageModel: session.imageModel }); setApiKey(''); setSettingsOpen(false)
    } catch (reason) {
      if (mounted.current && version === operation.current) setError(reason instanceof Error && reason.name !== 'TimeoutError' ? reason.message : '保存连接超时，请重试。')
    } finally {
      if (mounted.current && version === operation.current) { mutating.current = false; setBusy(null) }
    }
  }
  const logout = async () => {
    if (mutating.current) return
    mutating.current = true; operation.current++; checking.current?.abort(); checking.current = null
    const version = operation.current
    setBusy('logout'); setError(''); setApiKey('')
    try {
      const session = await authRequest('logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(15_000) })
      if (!mounted.current || version !== operation.current) return
      if (session.authenticated) throw new Error('退出未完成，请重试。')
      adoptSession(session); setSettingsOpen(false); setNotice('已退出连接。重新登录后可继续当前工作区。')
    } catch (reason) {
      if (mounted.current && version === operation.current) setError(reason instanceof Error && reason.name !== 'TimeoutError' ? reason.message : '退出连接超时，请重试。')
    } finally {
      if (mounted.current && version === operation.current) { mutating.current = false; setBusy(null) }
    }
  }

  return <>
    {hasOpened || localWorkspace ? <ConnectionSettingsContext.Provider value={openSettings}><AIConnectionContext.Provider value={ready => {
      if (authRef.current === 'authenticated') ready()
      else { pendingAI.current = ready; openSettings() }
    }}>{children}</AIConnectionContext.Provider></ConnectionSettingsContext.Provider> : <main className="video-login-cover" aria-label="实验室登录入口"><div className="video-login-cover-brand"><FlaskConical size={28} /><span>物理实验室</span></div></main>}
    <dialog ref={dialog} className="video-login-dialog" aria-labelledby="video-login-title" aria-describedby="video-login-description" onCancel={event => { event.preventDefault(); closeSettings() }}>
      <div className="video-login-heading"><span className="video-login-icon"><KeyRound size={24} /></span>{(auth === 'authenticated' || localWorkspace) && <button className="video-login-close" aria-label="关闭连接设置" disabled={!!busy} onClick={closeSettings}><X size={20} /></button>}</div>
      <p className="video-login-eyebrow">物理实验室</p>
      <h1 id="video-login-title">{auth === 'checking' ? '正在检查连接' : auth === 'authenticated' ? '连接设置' : '连接 AI'}</h1>
      <p id="video-login-description" className="video-login-description">{auth === 'checking' ? '正在读取连接状态。' : '填写本次 AI 识别使用的 API 地址和 SK。'}</p>
      {auth === 'checking' ? <div className="video-login-checking" role="status"><Loader2 size={20} className="video-login-spinner" />正在读取登录状态…</div> : <form onSubmit={event => void submit(event)}>
        <fieldset disabled={!!busy} className="video-login-fields">
          <label htmlFor="video-login-url">API URL <span>必填</span></label>
          <input id="video-login-url" name="api-url" type="url" required value={form.baseUrl} onChange={event => setForm({ ...form, baseUrl: event.target.value })} autoComplete="url" spellCheck={false} placeholder={defaults.baseUrl} />
          <div className="video-login-key-label"><label htmlFor="video-login-key">SK <span>必填</span></label><a href="https://code.yukework.com/static/zcode-admin/#/coding-plan" target="_blank" rel="noopener noreferrer">查询 SK <ArrowUpRight size={14} /></a></div>
          <input ref={keyInput} id="video-login-key" name="api-key" type="password" required value={apiKey} onChange={event => setApiKey(event.target.value)} autoComplete="off" spellCheck={false} autoCapitalize="none" placeholder={auth === 'authenticated' ? '输入新连接使用的 SK' : '输入你的 SK'} aria-describedby="video-login-key-help" />
          <p id="video-login-key-help" className="video-login-help">SK 不写入浏览器本地存储；登录成功后清空输入框。</p>
          <div className="video-login-models"><div><label htmlFor="video-login-model">文本模型</label><input id="video-login-model" name="model" required value={form.model} onChange={event => setForm({ ...form, model: event.target.value })} autoComplete="off" spellCheck={false} /></div><div><label htmlFor="video-login-image-model">图片模型</label><input id="video-login-image-model" name="image-model" required value={form.imageModel} onChange={event => setForm({ ...form, imageModel: event.target.value })} autoComplete="off" spellCheck={false} /></div></div>
        </fieldset>
        {notice && <p role="status" className="video-login-notice">{notice}</p>}
        {error && <p role="alert" className="video-login-error">{error}</p>}
        <div className="video-login-actions"><button type="submit" className="video-login-submit" disabled={!!busy}>{busy === 'login' ? <><Loader2 size={17} className="video-login-spinner" />正在保存连接…</> : auth === 'authenticated' ? '保存连接' : '登录并进入工作台'}</button>{auth === 'authenticated' ? <button type="button" className="video-login-logout" disabled={!!busy} onClick={() => void logout()}><LogOut size={15} />{busy === 'logout' ? '正在退出…' : '退出登录'}</button> : error && <button type="button" className="video-login-retry" disabled={!!busy} onClick={() => void checkSession()}>重新检查连接</button>}</div>
      </form>}
      {auth !== 'authenticated' && <button type="button" className="video-login-local" onClick={() => { location.hash = 'home' }}>返回实验室首页</button>}
    </dialog>
  </>
}
