import assert from 'node:assert/strict'
import test from 'node:test'
import { createOpticalComponent, createOpticsScene, opticalLibrary, opticalOrder, opticsPresets, parseOpticsScene } from '../src/optics/library'
import { createOpticsStore } from '../src/optics/store'

function legacy(kind: 'microscope' | 'telescope', overrides: Record<string, unknown> = {}) {
  return {
    ...createOpticalComponent('convex-lens', 50, 40), id: `legacy-${kind}`, kind,
    label: kind === 'microscope' ? '显微镜' : '望远镜',
    width: kind === 'microscope' ? 20 : 32, height: kind === 'microscope' ? 42 : 22,
    focalLength: kind === 'microscope' ? 4 : 24, opening: 10,
    secondaryFocalLength: kind === 'microscope' ? 6 : 8, ...overrides,
  }
}
function sceneWith(components: unknown[]) { return { ...createOpticsScene(), components } }
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`)

test('instrument presets consist of independently editable ordinary lenses', () => {
  assert.equal(opticalOrder.length, 13)
  assert.equal('microscope' in opticalLibrary, false)
  assert.equal('telescope' in opticalLibrary, false)
  for (const id of ['microscope', 'telescope']) {
    const scene = opticsPresets.find(preset => preset.id === id)!.create()
    assert.equal(scene.components.length, 3)
    const lenses = scene.components.filter(component => component.kind === 'convex-lens')
    assert.equal(lenses.length, 2)
    assert.deepEqual(lenses.map(component => component.label), ['物镜', '目镜'])
    assert.deepEqual(lenses.map(component => component.focalLength), id === 'microscope' ? [4, 6] : [24, 8])
    assert.deepEqual(parseOpticsScene(scene), scene)
    assert.ok(scene.components.every(component => !('secondaryFocalLength' in component)))
  }
})

test('legacy instruments expand at the original internal lens planes with aperture stops', () => {
  for (const kind of ['microscope', 'telescope'] as const) {
    for (const angle of [0, 37, 90, -90, -360, 360]) {
      const source = legacy(kind, { angle, focalLength: -5, secondaryFocalLength: -7, enabled: false })
      const components = parseOpticsScene(sceneWith([source])).components
      const lenses = components.filter(component => component.kind === 'convex-lens')
      const stops = components.filter(component => component.kind === 'aperture')
      assert.equal(lenses.length, 2)
      assert.equal(stops.length, 2)
      const radians = (angle + (kind === 'microscope' ? -90 : 0)) * Math.PI / 180
      for (let index = 0; index < 2; index++) {
        const lens = lenses[index], stop = stops[index], side = index === 0 ? -1 : 1
        close(lens.x, source.x + Math.cos(radians) * side * source.width / 2)
        close(lens.y, source.y + Math.sin(radians) * side * source.width / 2)
        close(Math.cos(lens.angle * Math.PI / 180), Math.cos(radians))
        close(Math.sin(lens.angle * Math.PI / 180), Math.sin(radians))
        assert.equal(lens.focalLength, index === 0 ? 5 : 7)
        assert.equal(lens.enabled, false)
        assert.equal(stop.enabled, false)
        assert.equal(stop.x, lens.x)
        assert.equal(stop.y, lens.y)
        assert.equal(stop.angle, lens.angle)
        assert.equal(stop.height, source.height)
        assert.equal(stop.opening, source.opening)
        assert.equal('secondaryFocalLength' in lens, false)
      }
    }
  }
})

test('migration preserves completely closed pupils and restores missing historical defaults', () => {
  for (const kind of ['microscope', 'telescope'] as const) {
    const source = legacy(kind, { opening: 0, secondaryFocalLength: undefined })
    const components = parseOpticsScene(sceneWith([source])).components
    assert.deepEqual(components.filter(component => component.kind === 'aperture').map(component => component.opening), [0, 0])
    assert.equal(components.filter(component => component.kind === 'convex-lens')[1].focalLength, kind === 'microscope' ? 6 : 8)
  }
})

test('migration IDs are deterministic, collision safe and valid after JSON round trips', () => {
  const source = legacy('microscope', { id: 'old' })
  const longId = 'x'.repeat(80)
  const input = sceneWith([
    source,
    { ...createOpticalComponent('screen'), id: 'old:objective' },
    { ...createOpticalComponent('screen'), id: 'old:objective-1' },
    { ...createOpticalComponent('screen'), id: 'old:eyepiece-aperture' },
    legacy('telescope', { id: longId, label: '镜'.repeat(60) }),
    { ...createOpticalComponent('screen'), id: `${longId.slice(0, 70)}:objective` },
  ])
  const first = parseOpticsScene(JSON.stringify(input)), second = parseOpticsScene(input)
  assert.deepEqual(first, second)
  assert.deepEqual(parseOpticsScene(JSON.stringify(first)), first)
  assert.equal(new Set(first.components.map(component => component.id)).size, first.components.length)
  assert.ok(first.components.every(component => component.id.length <= 80 && component.label.length <= 60))
  assert.ok(first.components.some(component => component.id === 'old:objective-2'))
  assert.ok(first.components.some(component => component.id === 'old:eyepiece-aperture-1'))
})

test('legacy validation rejects invalid instrument data and expanded coordinate overflow', () => {
  const invalid = [
    { secondaryFocalLength: 0 }, { secondaryFocalLength: 0.49 }, { secondaryFocalLength: 501 },
    { secondaryFocalLength: NaN }, { secondaryFocalLength: Infinity }, { secondaryFocalLength: '6' },
    { secondaryFocalLength: null }, { opening: -1 }, { opening: 43 }, { width: 0 }, { angle: 361 },
    { height: 0 }, { enabled: 'false' }, { focalLength: 0 }, { x: 1000, angle: 90 },
  ]
  for (const patch of invalid) {
    assert.throws(() => parseOpticsScene(sceneWith([legacy('microscope', patch)])), JSON.stringify(patch))
  }
  assert.throws(() => parseOpticsScene(sceneWith([legacy('microscope'), legacy('microscope')])), /重复/)
  assert.throws(() => parseOpticsScene(sceneWith([legacy('telescope', { kind: 'unknown-instrument' })])), /不支持/)
})

test('the component limit applies after expanding legacy instruments', () => {
  const instruments = Array.from({ length: 25 }, (_, index) => legacy('microscope', { id: `legacy-${index}` }))
  assert.equal(parseOpticsScene(sceneWith(instruments)).components.length, 100)
  assert.throws(() => parseOpticsScene(sceneWith([...instruments, createOpticalComponent('screen')])), /100/)
  assert.throws(() => parseOpticsScene(sceneWith([...instruments, legacy('telescope')])), /100/)
})

test('retired secondary focal fields on ordinary components are ignored and removed', () => {
  const component = createOpticalComponent('convex-lens')
  for (const secondaryFocalLength of [0, null, 'retired', Infinity]) {
    const scene = parseOpticsScene(sceneWith([{ ...component, secondaryFocalLength }]))
    assert.deepEqual(scene.components, [component])
  }
})

test('legacy drafts and JSON import migrate without changing invalid stored data', () => {
  const input = JSON.stringify(sceneWith([legacy('microscope')]))
  const expected = parseOpticsScene(input)
  const values = new Map([['optics-lab.draft.v1', input]])
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
  const store = createOpticsStore({ storage })
  store.getState().hydrate()
  assert.deepEqual(store.getState().scene, expected)
  assert.deepEqual(JSON.parse(store.getState().exportJson()), expected)
  store.getState().clear()
  assert.equal(store.getState().importJson(input), true)
  assert.deepEqual(store.getState().scene, expected)
  const saved = values.get('optics-lab.draft.v1')
  assert.equal(store.getState().importJson(JSON.stringify(sceneWith([legacy('microscope', { opening: 99 })]))), false)
  assert.deepEqual(store.getState().scene, expected)
  assert.equal(values.get('optics-lab.draft.v1'), saved)
})
