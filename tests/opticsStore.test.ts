import assert from 'node:assert/strict'
import test from 'node:test'
import { createOpticsStore } from '../src/optics/store'
import { createOpticalComponent, createOpticsScene } from '../src/optics/library'
import type { OpticalComponent, OpticsSettings } from '../src/optics/types'

const KEY = 'optics-lab.draft.v1'
function memoryStorage(initial?: string) {
  const values = new Map<string, string>(initial === undefined ? [] : [[KEY, initial]])
  let writes = 0
  let reads = 0
  return { values, get writes() { return writes }, get reads() { return reads }, getItem(key: string) { reads++; return values.get(key) ?? null }, setItem(key: string, value: string) { writes++; values.set(key, value) } }
}
function blankScene() { const scene = createOpticsScene(); scene.components = []; return scene }

test('optical draft persistence is independent and selection follows add, duplicate and removal', () => {
  const storage = memoryStorage()
  storage.values.set('circuit-lab.draft.v1', 'electrical state')
  const store = createOpticsStore({ initialScene: blankScene(), storage })
  const a = store.getState()
  a.add('concave-lens', 30, 20)
  const first = store.getState().scene.components[0]
  assert.equal(store.getState().selectedId, first.id)
  a.update(first.id, { focalLength: -18 })
  a.duplicate(first.id)
  const second = store.getState().scene.components[1]
  assert.notEqual(second.id, first.id)
  assert.equal(second.focalLength, -18)
  assert.equal(second.x, 34)
  assert.equal(store.getState().selectedId, second.id)
  a.remove(second.id)
  assert.equal(store.getState().selectedId, null)
  assert.deepEqual(JSON.parse(storage.values.get(KEY)!), store.getState().scene)
  assert.equal(storage.values.get('circuit-lab.draft.v1'), 'electrical state')
  a.undo()
  assert.equal(store.getState().selectedId, second.id)
  assert.equal(store.getState().scene.components.length, 2)
})

test('laser add, edit, duplicate and import persist through undo and hydration', () => {
  const storage = memoryStorage(), store = createOpticsStore({ initialScene: blankScene(), storage }), a = store.getState()
  a.add('laser', 18, 34)
  const laser = store.getState().scene.components[0]
  assert.equal(laser.kind, 'laser')
  assert.equal(laser.width, 12)
  assert.equal(laser.height, 3)
  assert.equal(laser.wavelength, 650)
  a.update(laser.id, { angle: 30, wavelength: 532, rayCount: 11, spread: 60 })
  const edited = store.getState().scene.components[0]
  assert.equal(edited.angle, 30)
  assert.equal(edited.wavelength, 532)
  assert.equal(edited.rayCount, 1)
  assert.equal(edited.spread, 0)
  a.duplicate(laser.id)
  assert.equal(store.getState().scene.components.length, 2)
  a.undo()
  assert.deepEqual(store.getState().scene.components, [edited])
  const exported = a.exportJson()
  a.clear()
  assert.equal(a.importJson(exported), true)
  assert.deepEqual(store.getState().scene.components, [edited])
  const restored = createOpticsStore({ storage })
  restored.getState().hydrate()
  assert.deepEqual(restored.getState().scene, store.getState().scene)
  const invalid = JSON.parse(exported)
  invalid.components[0].kind = 'unknown-laser'
  const saved = storage.values.get(KEY)
  assert.equal(a.importJson(JSON.stringify(invalid)), false)
  assert.equal(a.exportJson(), exported)
  assert.equal(storage.values.get(KEY), saved)
  a.undo()
  assert.equal(store.getState().scene.components.length, 0)
  a.redo()
  assert.deepEqual(store.getState().scene.components, [edited])
})

test('drag transaction is one undo and cancellation restores scene, selection and redo', () => {
  const store = createOpticsStore({ storage: null })
  const a = store.getState()
  const lens = a.scene.components.find(c => c.kind === 'convex-lens')!
  a.select(lens.id)
  a.beginTransaction()
  for (let i = 1; i <= 20; i++) a.update(lens.id, { x: lens.x + i })
  a.endTransaction()
  assert.equal(store.getState().scene.components.find(c => c.id === lens.id)!.x, lens.x + 20)
  a.undo()
  assert.equal(store.getState().scene.components.find(c => c.id === lens.id)!.x, lens.x)
  assert.equal(store.getState().canUndo, false)
  assert.equal(store.getState().canRedo, true)
  a.beginTransaction()
  a.update(lens.id, { x: lens.x + 3 })
  a.select(null)
  a.cancelTransaction()
  assert.equal(store.getState().selectedId, lens.id)
  assert.equal(store.getState().scene.components.find(c => c.id === lens.id)!.x, lens.x)
  assert.equal(store.getState().canUndo, false)
  assert.equal(store.getState().canRedo, true)
  a.redo()
  assert.equal(store.getState().scene.components.find(c => c.id === lens.id)!.x, lens.x + 20)
})

test('empty and round-trip transactions do not consume history or clear redo', () => {
  const store = createOpticsStore({ storage: null })
  const a = store.getState(), lens = a.scene.components[1]
  a.update(lens.id, { x: lens.x + 5 }); a.undo()
  a.beginTransaction(); a.endTransaction()
  assert.equal(store.getState().canUndo, false)
  assert.equal(store.getState().canRedo, true)
  a.beginTransaction()
  a.update(lens.id, { x: lens.x + 2 }); a.update(lens.id, { x: lens.x })
  a.endTransaction()
  assert.equal(store.getState().canUndo, false)
  assert.equal(store.getState().canRedo, true)
})

test('invalid parameters and settings are rejected atomically without consuming history', () => {
  const store = createOpticsStore({ storage: null })
  const a = store.getState(), lens = a.scene.components[1]
  const before = a.exportJson()
  const invalid: Partial<OpticalComponent>[] = [{ x: NaN }, { y: Infinity }, { height: -1 }, { width: 0 }, { rayCount: 1.5 }, { rayCount: 10000 }, { refractiveIndex: 0 }, { wavelength: 900 }, { focalLength: 0 }]
  for (const patch of invalid) a.update(lens.id, patch)
  a.updateSettings({ showGrid: 'yes' } as unknown as Partial<OpticsSettings>)
  a.updateSettings({ unknown: true } as unknown as Partial<OpticsSettings>)
  assert.equal(a.exportJson(), before)
  assert.equal(store.getState().canUndo, false)
  a.update(lens.id, { id: 'new-id', kind: 'screen' })
  assert.equal(a.exportJson(), before)
})

test('rotation wraps and clear is undoable with settings preserved', () => {
  const store = createOpticsStore({ storage: null })
  const a = store.getState(), lens = a.scene.components[1]
  a.update(lens.id, { angle: 375 })
  assert.equal(store.getState().scene.components[1].angle, 15)
  a.updateSettings({ showGrid: false })
  a.clear()
  assert.equal(store.getState().scene.components.length, 0)
  assert.equal(store.getState().scene.settings.showGrid, false)
  a.undo()
  assert.equal(store.getState().scene.components.length, 3)
  assert.equal(store.getState().scene.settings.showGrid, false)
})

test('history retains only the latest 80 changes', () => {
  const store = createOpticsStore({ initialScene: blankScene(), storage: null })
  const a = store.getState()
  a.add('plane-mirror', 0, 0)
  const id = store.getState().selectedId!
  for (let x = 1; x <= 100; x++) a.update(id, { x })
  for (let i = 0; i < 100; i++) a.undo()
  assert.equal(store.getState().scene.components[0].x, 20)
  assert.equal(store.getState().canUndo, false)
  for (let i = 0; i < 100; i++) a.redo()
  assert.equal(store.getState().scene.components[0].x, 100)
  assert.equal(store.getState().canRedo, false)
})

test('JSON import roundtrip is undoable and malformed imports preserve scene and draft', () => {
  const storage = memoryStorage()
  const store = createOpticsStore({ storage })
  const a = store.getState(), initial = a.exportJson()
  const scene = blankScene(); scene.components.push(createOpticalComponent('prism', 20, 25)); scene.settings.snap = false
  assert.equal(a.importJson(JSON.stringify(scene)), true)
  assert.deepEqual(store.getState().scene, scene)
  const before = a.exportJson(), saved = storage.values.get(KEY), writes = storage.writes
  for (const bad of ['{', '{}', JSON.stringify({ ...scene, kind: 'circuit-lab' }), JSON.stringify({ ...scene, settings: null })]) assert.equal(a.importJson(bad), false)
  assert.equal(a.exportJson(), before)
  assert.equal(storage.values.get(KEY), saved)
  assert.equal(storage.writes, writes)
  assert.ok(store.getState().importError)
  a.undo()
  assert.equal(a.exportJson(), initial)
})

test('hydration restores a validated draft once and leaves malformed drafts intact', () => {
  const scene = blankScene(); scene.title = 'saved experiment'; scene.components.push(createOpticalComponent('aperture', 12, 20))
  const storage = memoryStorage(JSON.stringify(scene))
  const store = createOpticsStore({ storage })
  store.getState().hydrate()
  assert.deepEqual(store.getState().scene, scene)
  assert.equal(store.getState().canUndo, false)
  store.getState().clear()
  store.getState().hydrate()
  assert.equal(storage.reads, 1)
  assert.equal(store.getState().scene.components.length, 0)
  const badStorage = memoryStorage('{broken draft')
  const badStore = createOpticsStore({ storage: badStorage })
  const before = badStore.getState().exportJson()
  badStore.getState().hydrate(); badStore.getState().hydrate()
  assert.equal(badStore.getState().exportJson(), before)
  assert.equal(badStore.getState().saveStatus, 'invalid-draft')
  assert.equal(badStorage.writes, 0)
  assert.equal(badStorage.values.get(KEY), '{broken draft')
})

test('import normalizes lens focal signs so saved values and simulated component types agree', () => {
  const storage = memoryStorage()
  const store = createOpticsStore({ initialScene: blankScene(), storage })
  const scene = blankScene()
  scene.components = [
    { ...createOpticalComponent('convex-lens', 30, 30), focalLength: -18 },
    { ...createOpticalComponent('concave-lens', 60, 30), focalLength: 24 },
  ]
  assert.equal(store.getState().importJson(JSON.stringify(scene)), true)
  assert.deepEqual(store.getState().scene.components.map(c => c.focalLength), [18, -24])
  assert.deepEqual(JSON.parse(storage.values.get(KEY)!).components.map((c: OpticalComponent) => c.focalLength), [18, -24])
  const restored = createOpticsStore({ storage })
  restored.getState().hydrate()
  assert.deepEqual(restored.getState().scene.components.map(c => c.focalLength), [18, -24])
  store.getState().undo()
  assert.equal(store.getState().scene.components.length, 0)
})

test('storage denial keeps editing, undo and JSON export available', () => {
  const denied = { getItem() { throw new Error('denied') }, setItem() { throw new Error('quota') } }
  const store = createOpticsStore({ initialScene: blankScene(), storage: denied })
  const a = store.getState()
  assert.doesNotThrow(() => a.hydrate())
  a.add('convex-lens', 20, 30)
  assert.equal(store.getState().scene.components.length, 1)
  assert.equal(store.getState().saveStatus, 'storage-unavailable')
  assert.equal(JSON.parse(a.exportJson()).kind, 'optics-lab')
  a.undo()
  assert.equal(store.getState().scene.components.length, 0)
})
