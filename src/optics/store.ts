import { create, type StoreApi, type UseBoundStore } from 'zustand'
import type { OpticalComponent, OpticsScene, OpticsSettings, OpticsKind } from './types'
import { createOpticalComponent, createOpticsScene, parseOpticsScene } from './library'

const KEY = 'optics-lab.draft.v1'
const SETTING_KEYS = ['showGrid', 'showAxis', 'showFoci', 'showVirtual', 'showLabels', 'animate', 'snap']
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>
type Snapshot = { scene: OpticsScene; selectedId: string | null }

export interface OpticsStore {
  scene: OpticsScene
  selectedId: string | null
  running: boolean
  tool: 'select' | 'pan'
  canUndo: boolean
  canRedo: boolean
  saveStatus: string
  importError: string | null
  select: (id: string | null) => void
  setTool: (tool: 'select' | 'pan') => void
  setRunning: (running: boolean) => void
  add: (kind: OpticsKind, x?: number, y?: number) => void
  update: (id: string, patch: Partial<OpticalComponent>) => void
  remove: (id: string) => void
  duplicate: (id: string) => void
  updateSettings: (patch: Partial<OpticsSettings>) => void
  load: (scene: unknown) => boolean
  clear: () => void
  undo: () => void
  redo: () => void
  beginTransaction: () => void
  endTransaction: () => void
  cancelTransaction: () => void
  importJson: (text: string) => boolean
  exportJson: () => string
  hydrate: () => void
}

const clone = <T,>(v: T): T => structuredClone(v)
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
function validSettings(settings: unknown): settings is OpticsSettings {
  if (!settings || typeof settings !== 'object') return false
  const v = settings as Record<string, unknown>
  return SETTING_KEYS.every(k => typeof v[k] === 'boolean')
}
function validate(scene: unknown): OpticsScene | null {
  try {
    const parsed = parseOpticsScene(scene)
    return validSettings(parsed.settings) ? parsed : null
  } catch { return null }
}

export interface CreateOpticsStoreOptions { initialScene?: OpticsScene; storage?: StorageLike | null }
export function createOpticsStore(options: CreateOpticsStoreOptions = {}): UseBoundStore<StoreApi<OpticsStore>> {
  const storage = options.storage === undefined
    ? (() => { try { return typeof localStorage !== 'undefined' ? localStorage : null } catch { return null } })()
    : options.storage
  let past: Snapshot[] = []
  let future: Snapshot[] = []
  let transaction: Snapshot | null = null
  let transactionDirty = false
  let hydrated = false
  const initial = validate(options.initialScene ?? createOpticsScene()) ?? createOpticsScene()
  const draft = (scene: OpticsScene, selectedId: string | null): Snapshot => ({ scene: clone(scene), selectedId })
  const historyState = () => ({ canUndo: past.length > 0 || transactionDirty, canRedo: future.length > 0 && !transactionDirty })
  const persist = (scene: OpticsScene, set: (v: Partial<OpticsStore>) => void) => {
    if (!storage) { set({ saveStatus: 'storage-unavailable' }); return }
    try { storage.setItem(KEY, JSON.stringify(scene)); set({ saveStatus: 'saved' }) }
    catch { set({ saveStatus: 'storage-unavailable' }) }
  }
  const store = create<OpticsStore>((set, get) => {
    const commit = (scene: OpticsScene, selectedId: string | null = get().selectedId) => {
      const current = get()
      if (equal(current.scene, scene)) { set({ selectedId, importError: null }); return }
      if (!transaction) {
        past.push(draft(current.scene, current.selectedId))
        if (past.length > 80) past.shift()
        future = []
      }
      if (transaction) transactionDirty = !equal(transaction.scene, scene)
      set({ scene: clone(scene), selectedId, ...historyState(), importError: null })
      persist(scene, set)
    }
    return {
      scene: initial, selectedId: null, running: true, tool: 'select', ...historyState(), saveStatus: 'idle', importError: null,
      select: (id) => set({ selectedId: id && get().scene.components.some(c => c.id === id) ? id : null }),
      setTool: (tool) => set({ tool }), setRunning: (running) => set({ running }),
      add: (kind, x = 50, y = 30) => {
        try {
          const c = createOpticalComponent(kind, x, y)
          const scene = clone(get().scene)
          scene.components.push(c)
          const parsed = validate(scene)
          if (parsed) commit(parsed, c.id)
        } catch { /* Unknown kinds and invalid positions leave the current experiment intact. */ }
      },
      update: (id, patch) => {
        const current = get().scene
        const index = current.components.findIndex(c => c.id === id)
        if (index < 0) return
        const next = clone(current), old = next.components[index]
        const safe = { ...patch } as Record<string, unknown>
        delete safe.id
        delete safe.kind
        if (Object.keys(safe).some(k => !Object.prototype.hasOwnProperty.call(old, k))) return
        if (typeof safe.angle === 'number' && Number.isFinite(safe.angle)) safe.angle = ((safe.angle + 180) % 360 + 360) % 360 - 180
        next.components[index] = { ...old, ...safe, id: old.id, kind: old.kind }
        const parsed = validate(next)
        if (parsed) commit(parsed)
      },
      remove: (id) => {
        const next = clone(get().scene)
        next.components = next.components.filter(c => c.id !== id)
        if (next.components.length === get().scene.components.length) return
        const parsed = validate(next)
        if (parsed) commit(parsed, get().selectedId === id ? null : get().selectedId)
      },
      duplicate: (id) => {
        const c = get().scene.components.find(x => x.id === id)
        if (!c) return
        const copy = { ...clone(c), id: createOpticalComponent(c.kind).id, x: c.x + 4, y: c.y + 4 }
        const next = clone(get().scene)
        next.components.push(copy)
        const parsed = validate(next)
        if (parsed) commit(parsed, copy.id)
      },
      updateSettings: (patch) => {
        const keys = Object.keys(patch)
        if (keys.some(k => !SETTING_KEYS.includes(k) || typeof (patch as Record<string, unknown>)[k] !== 'boolean')) return
        const next = clone(get().scene)
        next.settings = { ...next.settings, ...patch }
        const parsed = validate(next)
        if (parsed) commit(parsed)
      },
      load: (input) => {
        const parsed = validate(input)
        if (!parsed) return false
        commit(parsed, null)
        return true
      },
      clear: () => {
        const next = clone(get().scene)
        next.title = '未命名光学实验'
        next.components = []
        commit(next, null)
      },
      undo: () => {
        if (transaction) get().endTransaction()
        const item = past.pop()
        if (!item) return
        future.push(draft(get().scene, get().selectedId))
        set({ scene: clone(item.scene), selectedId: item.selectedId, importError: null, ...historyState() })
        persist(item.scene, set)
      },
      redo: () => {
        if (transaction) get().endTransaction()
        const item = future.pop()
        if (!item) return
        past.push(draft(get().scene, get().selectedId))
        set({ scene: clone(item.scene), selectedId: item.selectedId, importError: null, ...historyState() })
        persist(item.scene, set)
      },
      beginTransaction: () => { if (!transaction) { transaction = draft(get().scene, get().selectedId); transactionDirty = false } },
      endTransaction: () => {
        if (!transaction) return
        const base = transaction
        transaction = null
        transactionDirty = false
        if (!equal(base.scene, get().scene)) {
          past.push(base)
          if (past.length > 80) past.shift()
          future = []
        }
        set(historyState())
      },
      cancelTransaction: () => {
        if (!transaction) return
        const base = transaction
        transaction = null
        transactionDirty = false
        const changed = !equal(base.scene, get().scene)
        set({ scene: clone(base.scene), selectedId: base.selectedId, ...historyState() })
        if (changed) persist(base.scene, set)
      },
      importJson: (text) => {
        const parsed = validate(text)
        if (!parsed) { set({ importError: '无法导入：光学场景数据无效' }); return false }
        commit(parsed, null)
        return true
      },
      exportJson: () => JSON.stringify(get().scene, null, 2),
      hydrate: () => {
        if (hydrated) return
        hydrated = true
        if (!storage) { set({ saveStatus: 'storage-unavailable' }); return }
        let text: string | null
        try { text = storage.getItem(KEY) }
        catch { set({ saveStatus: 'storage-unavailable' }); return }
        if (!text) return
        const parsed = validate(text)
        if (!parsed) { set({ saveStatus: 'invalid-draft' }); return }
        past = []
        future = []
        transaction = null
        transactionDirty = false
        set({ scene: parsed, selectedId: null, ...historyState(), saveStatus: 'loaded' })
      },
    }
  })
  return store
}
export const useOpticsStore = createOpticsStore()
