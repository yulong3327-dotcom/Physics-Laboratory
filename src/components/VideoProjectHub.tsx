import { useEffect, useMemo, useState } from 'react'
import { Archive, Copy, FolderOpen, Plus, RefreshCw, Search, Trash2 } from 'lucide-react'
import type { VideoProjectSummary } from '../../server/videoProjectCatalog'
import { videoClient } from '../lib/videoClient'
import { listVideoDrafts, removeVideoDraft, type VideoDraft } from '../lib/videoDrafts'
import { VideoProductionCenter } from './VideoProductionCenter'

type Action = 'rename' | 'archive' | 'trash' | 'restore' | 'delete' | 'duplicate'
export function VideoProjectHub({ onOpen, onCreate, onSample, disabled, view = 'projects', onView }: {
  onOpen(id: string, draft?: VideoDraft): void; onCreate(mode: 'script' | 'problem'): void; onSample(): void; disabled: boolean;
  view?: 'projects' | 'production'; onView(view: 'projects' | 'production'): void;
}) {
  const [items, setItems] = useState<VideoProjectSummary[]>([])
  const production = view === 'production'
  const [lifecycle, setLifecycle] = useState('active')
  const [query, setQuery] = useState(''), [sort, setSort] = useState('updated'), [status, setStatus] = useState('all')
  const [error, setError] = useState(''), [loading, setLoading] = useState(true), [refresh, setRefresh] = useState(0)
  const [busy, setBusy] = useState(false), [dialog, setDialog] = useState<{ item: VideoProjectSummary; action: Action }>()
  const [name, setName] = useState(''), [confirmation, setConfirmation] = useState('')
  const [drafts, setDrafts] = useState(() => { try { return listVideoDrafts() } catch { return [] } })
  useEffect(() => {
    if (production) return
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>
    setLoading(true)
    const load = async () => {
      try {
        const value = await videoClient.projectSummaries('all', { signal: controller.signal })
        if (!controller.signal.aborted) { setItems(value); setError(''); setLoading(false); try { setDrafts(listVideoDrafts()) } catch { /* Server projects remain usable without browser storage. */ } }
      } catch (reason) { if (!controller.signal.aborted) { setError(reason instanceof Error ? reason.message : '读取项目失败'); setLoading(false) } }
      finally { if (!controller.signal.aborted) timer = setTimeout(load, 5000) }
    }
    void load()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [refresh, production])
  const stateOf = (p: VideoProjectSummary) => p.activeTaskCount ? 'running' : p.latestJobStatus === 'completed' ? 'completed' : p.latestJobStatus === 'failed' ? 'failed' : 'draft'
  const shown = useMemo(() => items.filter(p => p.lifecycle === lifecycle && p.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) && (status === 'all' || stateOf(p) === status))
    .sort(sort === 'title' ? (a, b) => a.title.localeCompare(b.title, 'zh-CN') : (a, b) => b.updatedAt.localeCompare(a.updatedAt)), [items, lifecycle, query, sort, status])
  const ask = (item: VideoProjectSummary, action: Action) => { setDialog({ item, action }); setName(item.title); setConfirmation(''); setError('') }
  const perform = async () => {
    if (!dialog || busy) return
    const { item, action } = dialog
    setBusy(true); setError('')
    try {
      if (action === 'rename') await videoClient.renameProject(item.id, name, item.revision)
      if (action === 'archive') await videoClient.archiveProject(item.id)
      if (action === 'trash') await videoClient.trashProject(item.id)
      if (action === 'restore') await videoClient.restoreProject(item.id)
      if (action === 'duplicate') await videoClient.duplicateProject(item.id)
      if (action === 'delete') { await videoClient.deleteProject(item.id); removeVideoDraft(item.id); setDrafts(listVideoDrafts()) }
      setDialog(undefined); setRefresh(v => v + 1)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败') }
    finally { setBusy(false) }
  }
  const labels: Record<Action, string> = { rename: '重命名', archive: '归档', trash: '移入回收站', restore: '恢复到项目中心', delete: '永久删除', duplicate: '复制项目' }
  if (production) return <main className="video-project-hub"><div className="video-hub-heading"><div><span className="video-eyebrow">教学视频 · 生产平台</span><h1>视频生产平台</h1></div><button className="video-button" onClick={() => onView('projects')}><FolderOpen size={16} />返回项目中心</button></div><VideoProductionCenter /></main>
  return <main className="video-project-hub">
    <div className="video-hub-mode-switch"><button className="video-button" onClick={() => onView('production')}>生产中心 · 任务与成片</button></div>
    <div className="video-hub-heading"><div><span className="video-eyebrow">教学视频 · 项目中心</span><h1>我的视频项目</h1><p>管理课程、继续制作，或查看已完成的作品。</p></div><div className="video-hub-create"><button className="video-button primary" disabled={disabled} onClick={() => onCreate('script')}><Plus size={16} />新建课程</button><button className="video-button" disabled={disabled} onClick={() => onCreate('problem')}>导入题目</button></div></div>
    <nav className="video-hub-views" aria-label="项目分类">{[['active', '项目中心'], ['archived', '已归档'], ['trashed', '回收站']].map(([key, label]) => <button key={key} aria-pressed={lifecycle === key} onClick={() => setLifecycle(key)}>{label}<span>{items.filter(i => i.lifecycle === key).length}</span></button>)}</nav>
    <div className="video-hub-filters"><label><Search size={16} /><input aria-label="搜索视频项目" placeholder="搜索项目名称" value={query} onChange={e => setQuery(e.target.value)} /></label><select aria-label="项目状态筛选" value={status} onChange={e => setStatus(e.target.value)}><option value="all">全部状态</option><option value="draft">待制作</option><option value="running">制作中</option><option value="completed">已完成</option><option value="failed">制作失败</option></select><select aria-label="项目排序" value={sort} onChange={e => setSort(e.target.value)}><option value="updated">最近更新</option><option value="title">按名称</option></select><button className="video-button" aria-label="刷新项目" onClick={() => setRefresh(v => v + 1)}><RefreshCw size={15} /></button></div>
    {error && <p className="video-message error" role="alert">{error}</p>}
    {loading && !items.length && <p role="status">正在读取项目…</p>}
    {lifecycle === 'trashed' && <p className="video-field-hint">移入回收站的项目可以恢复。永久删除会移除该项目的版本、任务和输出文件。</p>}
    <div className="video-hub-grid">{shown.map(item => <article className="video-hub-card" key={item.id} aria-label={`项目 ${item.title}`}>
      <div className="video-hub-card-top"><FolderOpen size={22} /><span>{({ running: '制作中', completed: '已完成', failed: '制作失败', draft: '待制作' })[stateOf(item)]}</span></div>
      <h2>{item.title}</h2><p>{item.type === 'problem' ? '题目讲解' : '教学课程'} · {item.shotCount} 个镜头 · {item.utteranceCount} 段旁白</p>
      <small>版本 {item.revision} · {new Date(item.updatedAt).toLocaleString('zh-CN')}</small>
      {item.recovery && <p className="video-hub-recovery">恢复副本{item.sourceProjectId ? ` · 来源 ${item.sourceProjectId}` : ''}</p>}
      {drafts.some(d => d.project.id === item.id) && <p className="video-hub-recovery">此浏览器有未保存草稿</p>}
      {!!item.activeTaskCount && <p>有任务正在处理，请进入项目查看或取消。</p>}
      <div className="video-hub-card-actions">
        {item.lifecycle === 'active' && <><button className="video-button primary" disabled={disabled || busy} onClick={() => onOpen(item.id)}>打开项目</button><button className="video-button" disabled={busy || !!item.activeTaskCount} onClick={() => ask(item, 'rename')}>重命名</button><button className="video-button" disabled={busy} onClick={() => ask(item, 'duplicate')}><Copy size={14} />复制</button><button className="video-button" disabled={busy || !!item.activeTaskCount} onClick={() => ask(item, 'archive')}><Archive size={14} />归档</button></>}
        {item.lifecycle !== 'active' && <button className="video-button primary" disabled={busy} onClick={() => ask(item, 'restore')}>恢复</button>}
        {item.lifecycle !== 'trashed' ? <button className="video-button danger" disabled={busy || !!item.activeTaskCount} onClick={() => ask(item, 'trash')}><Trash2 size={14} />删除</button> : <button className="video-button danger" disabled={busy || !!item.activeTaskCount} onClick={() => ask(item, 'delete')}>永久删除</button>}
      </div>
    </article>)}</div>
    {!loading && !shown.length && <div className="video-hub-empty"><FolderOpen size={32} /><h2>{query || status !== 'all' ? '没有符合条件的项目' : lifecycle === 'active' ? '创建第一份课程' : '这里还没有项目'}</h2>{lifecycle === 'active' && <button className="video-button" disabled={disabled} onClick={onSample}>使用电功率示范课程</button>}</div>}
    {lifecycle === 'active' && drafts.filter(d => !items.some(p => p.id === d.project.id)).length > 0 && <section className="video-panel"><h2>浏览器中的待保存草稿</h2>{drafts.filter(d => !items.some(p => p.id === d.project.id)).map(d => <p key={d.project.id}>{d.project.title} <button className="video-button" onClick={() => onOpen(d.project.id)}>恢复本地草稿</button></p>)}</section>}
    {lifecycle === 'active' && drafts.some(d => d.recoveryKey && items.some(p => p.id === d.project.id && p.lifecycle === 'active')) && <section className="video-panel"><h2>其他编辑窗口的草稿</h2><p>多窗口编辑产生的不同版本已单独保留，打开后核对并保存。</p>{drafts.filter(d => d.recoveryKey && items.some(p => p.id === d.project.id && p.lifecycle === 'active')).map(d => <p key={d.recoveryKey}>{d.project.title} · {d.draftSavedAt ? new Date(d.draftSavedAt).toLocaleString('zh-CN') : '旧草稿'} <button className="video-button" onClick={() => onOpen(d.project.id, d)}>打开这份草稿</button></p>)}</section>}
    {dialog && <div className="video-modal-backdrop"><section role="dialog" aria-modal="true" aria-label={labels[dialog.action]} className="video-import-dialog"><h2>{labels[dialog.action]}</h2><p>{dialog.item.title}</p>
      {dialog.action === 'rename' && <label className="video-field">项目名称<input autoFocus aria-label="重命名项目名称" value={name} maxLength={240} onChange={e => setName(e.target.value)} /></label>}
      {dialog.action === 'trash' && <p>项目会移入回收站，已有版本与输出保留，可随时恢复。</p>}
      {dialog.action === 'archive' && <p>归档后停止编辑，恢复到项目中心后可以继续制作。</p>}
      {dialog.action === 'delete' && <label className="video-field">此操作无法撤销。请输入项目名称以确认：<input autoFocus aria-label="确认永久删除项目名称" value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label>}
      {error && <p role="alert" className="video-message error">{error}</p>}
      <div className="video-dialog-actions"><button className="video-button" disabled={busy} onClick={() => setDialog(undefined)}>取消</button><button className="video-button primary" disabled={busy || (dialog.action === 'rename' && !name.trim()) || (dialog.action === 'delete' && confirmation !== dialog.item.title)} onClick={() => void perform()}>{busy ? '正在处理…' : `确认${labels[dialog.action]}`}</button></div>
    </section></div>}
  </main>
}
