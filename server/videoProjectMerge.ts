import type { VideoProject } from './videoTypes.js'

const missing = Symbol('missing')
type Value = unknown | typeof missing
const object = (value: Value): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const keys = (value: Record<string, unknown>) => Object.keys(value).filter(key => value[key] !== undefined)
export function equalProjectValue(a: Value, b: Value): boolean {
  if (a === b || ((a === missing || a === undefined) && (b === missing || b === undefined))) return true
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, index) => equalProjectValue(value, b[index]))
  if (object(a) && object(b)) { const ak = keys(a), bk = keys(b); return ak.length === bk.length && ak.every(key => Object.prototype.hasOwnProperty.call(b, key) && equalProjectValue(a[key], b[key])) }
  return false
}
const metadata = new Set(['revision', 'approvedRevision', 'createdAt', 'updatedAt'])
export function sameProjectContent(a: VideoProject, b: VideoProject): boolean {
  const content = (p: VideoProject) => {
    const { scriptReview: _script, storyboardReview: _storyboard, lastTaskId: _task, lastAppliedTaskId: _applied, ...workflow } = p.workflow || {}
    return Object.fromEntries(Object.entries({ ...p, workflow: Object.keys(workflow).length ? workflow : undefined }).filter(([key]) => !metadata.has(key)))
  }
  return equalProjectValue(content(a), content(b))
}
const idArray = (value: unknown[]): value is Array<Record<string, unknown> & { id: string }> => value.every(item => object(item) && typeof item.id === 'string') && new Set(value.map(item => (item as { id: string }).id)).size === value.length

/** Apply local changes to the remote snapshot. Conflicting values remain local;
 * callers must retain a recovery copy before committing any reported conflict. */
export function mergeProjectChanges(base: VideoProject, local: VideoProject, remote: VideoProject): { project: VideoProject; conflicts: string[] } {
  if (base.id !== local.id || local.id !== remote.id) throw new Error('只能合并同一个视频工程')
  const conflicts: string[] = []
  const merge = (before: Value, mine: Value, theirs: Value, path: string): Value => {
    if (equalProjectValue(mine, before)) return theirs
    if (equalProjectValue(theirs, before) || equalProjectValue(mine, theirs)) return mine
    // A circuit's graph, rendered geometry and teaching values form one snapshot.
    if (/^\/circuits\/[^/]+$/.test(path)) { conflicts.push(path); return mine }
    if (path === '/storyScene' || /^\/shots\/[^/]+\/story$/.test(path)) { conflicts.push(path); return mine }
    if (object(before) && object(mine) && object(theirs)) {
      return Object.fromEntries([...new Set([...keys(before), ...keys(mine), ...keys(theirs)])].flatMap(key => {
        const value = merge(Object.prototype.hasOwnProperty.call(before, key) ? before[key] : missing, Object.prototype.hasOwnProperty.call(mine, key) ? mine[key] : missing, Object.prototype.hasOwnProperty.call(theirs, key) ? theirs[key] : missing, `${path}/${key}`)
        return value === missing || value === undefined ? [] : [[key, value]]
      }))
    }
    if (Array.isArray(before) && Array.isArray(mine) && Array.isArray(theirs) && idArray(before) && idArray(mine) && idArray(theirs)) {
      const bm = new Map(before.map(v => [v.id, v])), lm = new Map(mine.map(v => [v.id, v])), rm = new Map(theirs.map(v => [v.id, v]))
      const merged = new Map<string, Value>()
      for (const id of new Set([...bm.keys(), ...lm.keys(), ...rm.keys()])) {
        const value = merge(bm.get(id) ?? missing, lm.get(id) ?? missing, rm.get(id) ?? missing, `${path}/${id}`)
        if (value !== missing) merged.set(id, value)
      }
      const common = before.map(v => v.id).filter(id => merged.has(id) && lm.has(id) && rm.has(id))
      const order = (items: Array<{ id: string }>) => items.map(v => v.id).filter(id => common.includes(id))
      const mineReordered = !equalProjectValue(order(mine), common), theirsReordered = !equalProjectValue(order(theirs), common)
      if (mineReordered && theirsReordered && !equalProjectValue(order(mine), order(theirs))) conflicts.push(`${path}/@order`)
      const preferred = mineReordered ? mine : theirs, secondary = mineReordered ? theirs : mine
      const ids = preferred.map(v => v.id).filter(id => merged.has(id))
      // Preserve independently inserted items near their original neighbours.
      for (let index = 0; index < secondary.length; index++) {
        const id = secondary[index].id
        if (!merged.has(id) || ids.includes(id)) continue
        const previous = secondary.slice(0, index).reverse().find(item => ids.includes(item.id))
        const next = secondary.slice(index + 1).find(item => ids.includes(item.id))
        ids.splice(previous ? ids.indexOf(previous.id) + 1 : next ? ids.indexOf(next.id) : ids.length, 0, id)
      }
      return ids.map(id => merged.get(id))
    }
    conflicts.push(path || '/'); return mine
  }
  const clean = (p: VideoProject) => Object.fromEntries(Object.entries(p).filter(([key]) => !metadata.has(key)))
  const value = merge(clean(base), clean(local), clean(remote), '') as Omit<VideoProject, 'revision' | 'createdAt' | 'updatedAt'>
  const project = structuredClone({ ...value, revision: remote.revision, createdAt: remote.createdAt, updatedAt: remote.updatedAt }) as VideoProject
  delete project.approvedRevision
  return { project, conflicts: [...new Set(conflicts)] }
}
