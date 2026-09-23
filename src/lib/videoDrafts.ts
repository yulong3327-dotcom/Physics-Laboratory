import type { VideoProject } from '../../server/videoTypes'
import { isVideoProjectShape, migrateVideoEditorProject } from './videoClient'

export type GenerationProgress = { state: 'idle' | 'running' | 'failed' | 'cancelled' | 'complete'; message: string; kind?: 'storyboard' | 'problem' }
export type VideoDraft = { project: VideoProject; dirty: boolean; saved: boolean; scriptChanged?: boolean; generation?: GenerationProgress; loadedCleanSnapshot?: boolean; editorSessionId?: string; draftSavedAt?: string; recoveryKey?: string }
const prefix = 'physics-video-workbench:draft:'
const recoveryPrefix = 'physics-video-workbench:recovery:'
const editorSessionId = globalThis.crypto.randomUUID()
const legacy = prefix + 'v1'
export type VideoStage = 'script' | 'storyboard' | 'timeline' | 'output'
export function videoRoute(hash = location.hash): { id?: string; stage: VideoStage; view?: 'production' } {
  // Reserve the platform route before interpreting the second segment as an ID.
  if (hash === '#video/production') return { stage: 'script', view: 'production' }
  const match = /^#video\/([A-Za-z0-9][A-Za-z0-9_-]{0,95})(?:\/(script|storyboard|timeline|render|output))?$/.exec(hash)
  return { id: match?.[1], stage: match?.[2] === 'render' ? 'output' : match?.[2] as VideoStage || 'script' }
}
export function videoProjectHash(id: string, stage: VideoStage) { return `#video/${id}/${stage === 'output' ? 'render' : stage}` }
export function readVideoDraft(id?: string): VideoDraft | null {
  try {
    // One-time migration copies the legacy draft to its own ID before removing
    // the old key, so opening a different project cannot overwrite it.
    const old = JSON.parse(localStorage.getItem(legacy) || 'null') as VideoDraft | null
    if (isVideoProjectShape(old?.project)) {
      if (!localStorage.getItem(prefix + old!.project.id)) localStorage.setItem(prefix + old!.project.id, JSON.stringify(old))
      localStorage.removeItem(legacy)
    }
  } catch { /* A damaged legacy draft must not hide valid project-specific drafts. */ }
  if (!id) return null
  try {
    const value = JSON.parse(localStorage.getItem(prefix + id) || 'null') as VideoDraft | null
    if (!isVideoProjectShape(value?.project) || value!.project.id !== id) return null
    const migration = migrateVideoEditorProject(value!.project)
    return { ...value!, project: migration.project, dirty: value!.dirty || migration.changed,
      loadedCleanSnapshot: value!.saved && !value!.dirty && !value!.scriptChanged && value!.generation?.state !== 'running' }
  } catch { return null }
}
export function writeVideoDraft(draft: VideoDraft) {
  const key = prefix + draft.project.id
  const raw = localStorage.getItem(key)
  let previous: VideoDraft | null = null
  try { previous = JSON.parse(raw || 'null') as VideoDraft | null }
  catch { if (raw) localStorage.setItem(recoveryPrefix + draft.project.id + ':unreadable', raw) }
  if (previous?.dirty && previous.editorSessionId !== editorSessionId) {
    // Background polling in a clean tab must never erase another tab's edits.
    if (!draft.dirty) return
    if (JSON.stringify(previous.project) !== JSON.stringify(draft.project)) {
      localStorage.setItem(recoveryPrefix + draft.project.id + ':' + (previous.editorSessionId || 'legacy'), JSON.stringify(previous))
    }
  }
  localStorage.setItem(key, JSON.stringify({ ...draft, recoveryKey: undefined, editorSessionId, draftSavedAt: new Date().toISOString() }))
}
export function removeVideoDraft(id: string) {
  localStorage.removeItem(prefix + id)
  const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
  keys.filter(key => key?.startsWith(recoveryPrefix + id + ':')).forEach(key => localStorage.removeItem(key!))
}
export function listVideoDrafts(): VideoDraft[] {
  readVideoDraft()
  const drafts: VideoDraft[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith(recoveryPrefix)) {
      try {
        const draft = JSON.parse(localStorage.getItem(key) || 'null') as VideoDraft | null
        if (draft && isVideoProjectShape(draft.project)) drafts.push({ ...draft, recoveryKey: key })
      } catch { /* A broken backup does not hide the remaining drafts. */ }
      continue
    }
    if (!key?.startsWith(prefix) || key === legacy) continue
    const draft = readVideoDraft(key.slice(prefix.length))
    if (draft && (draft.dirty || !draft.saved)) drafts.push(draft)
  }
  return drafts
}
