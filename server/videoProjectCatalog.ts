import { mkdir, readFile, readdir, open, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { replaceVideoFile } from './videoAtomicFile.js'
import type { VideoProject } from './videoTypes.js'

export type ProjectLifecycle = 'active' | 'archived' | 'trashed' | 'purged'
export interface VideoProjectSummary {
  id: string; title: string; revision: number; createdAt: string; updatedAt: string;
  lifecycle: ProjectLifecycle; stage: 'script' | 'storyboard' | 'render';
  type: 'lesson' | 'problem'; shotCount: number; utteranceCount: number;
  archivedAt?: string; deletedAt?: string; purgedAt?: string;
  sourceProjectId?: string; recovery?: boolean;
  activeTaskCount?: number; latestJobStatus?: string;
}
const validId = (id: string) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(id)
async function json<T>(path: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
async function atomic(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    const handle = await open(temporary, 'wx')
    try { await handle.writeFile(JSON.stringify(value), 'utf8'); await handle.sync() } finally { await handle.close() }
    await replaceVideoFile(temporary, path)
  } finally { await unlink(temporary).catch(() => {}) }
}
/** Single-writer catalog under the video service's existing process lock.
 * Sidecars are authoritative for lifecycle; the lightweight index is rebuilt at
 * startup to recover a content commit interrupted before its index write. */
export function createVideoProjectCatalog(directory: string) {
  const projectsDirectory = join(directory, 'projects')
  const tombstonesDirectory = join(directory, 'deleted-projects')
  const entries = new Map<string, VideoProjectSummary>()
  const indexPath = join(directory, 'project-index.json')
  const flush = () => atomic(indexPath, { schemaVersion: 1, projects: [...entries.values()] })
  const summarize = (p: VideoProject, previous?: VideoProjectSummary): VideoProjectSummary => ({
    ...previous, id: p.id, title: p.title, revision: p.revision, createdAt: p.createdAt, updatedAt: p.updatedAt,
    lifecycle: previous?.lifecycle || 'active', type: p.problem ? 'problem' : 'lesson',
    stage: p.approvedRevision === p.revision ? 'render' : p.workflow?.scriptReview ? 'storyboard' : 'script',
    shotCount: p.shots.length, utteranceCount: p.utterances.length,
    recovery: previous?.recovery || p.id.startsWith('video-recovery-'),
  })
  return {
    async initialize() {
      await mkdir(tombstonesDirectory, { recursive: true })
      for (const name of await readdir(tombstonesDirectory)) {
        if (!name.endsWith('.json') || !validId(name.slice(0, -5))) continue
        const value = await json<VideoProjectSummary>(join(tombstonesDirectory, name))
        if (value?.lifecycle === 'purged') entries.set(value.id, value)
      }
      for (const id of await readdir(projectsDirectory)) {
        if (!validId(id) || entries.get(id)?.lifecycle === 'purged') continue
        // A corrupt project is retained on disk and does not break the library.
        try {
          const p = await json<VideoProject>(join(projectsDirectory, id, 'project.json'))
          if (!p || p.id !== id || !Array.isArray(p.shots) || !Array.isArray(p.utterances)) continue
          const previous = await json<VideoProjectSummary>(join(projectsDirectory, id, 'metadata.json'))
          entries.set(id, summarize(p, previous))
        } catch { /* Files remain available for manual recovery. */ }
      }
      await flush()
    },
    get(id: string) { return entries.get(id) },
    list() { return [...entries.values()].filter(p => p.lifecycle !== 'purged').map(p => ({ ...p })) },
    purgedIds() { return [...entries.values()].filter(p => p.lifecycle === 'purged').map(p => p.id) },
    async update(project: VideoProject, patch: Partial<VideoProjectSummary> = {}) {
      const previous = entries.get(project.id)
      if (previous?.lifecycle === 'purged') throw Object.assign(new Error('项目已永久删除，请另存为新项目。'), { status: 410 })
      const value = { ...summarize(project, previous), ...patch }
      await atomic(join(projectsDirectory, project.id, 'metadata.json'), value)
      entries.set(project.id, value); await flush(); return value
    },
    async purge(id: string) {
      const previous = entries.get(id)
      if (!previous) throw Object.assign(new Error('项目不存在'), { status: 404 })
      // Keep only a small tombstone. Old browser tabs can never resurrect an ID.
      const value: VideoProjectSummary = { id, title: '', revision: previous.revision, createdAt: previous.createdAt,
        updatedAt: new Date().toISOString(), purgedAt: new Date().toISOString(), lifecycle: 'purged',
        type: previous.type, stage: 'script', shotCount: 0, utteranceCount: 0 }
      await atomic(join(tombstonesDirectory, `${id}.json`), value)
      entries.set(id, value); await flush()
    },
  }
}
