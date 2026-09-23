import assert from 'node:assert/strict'
import test from 'node:test'
import { createOpticalComponent as component, createOpticsScene, opticsPresets } from '../src/optics/library'
import { measureImages, simulateOptics } from '../src/optics/simulation'
import type { OpticsScene, Vec2 } from '../src/optics/types'

const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-5, `${actual} != ${expected}`)
const rotate = (p: Vec2, angle: number) => ({ x: p.x * Math.cos(angle) - p.y * Math.sin(angle), y: p.x * Math.sin(angle) + p.y * Math.cos(angle) })

for (const [kind, distance, expectedV, expectedM] of [
  ['convex-lens', 30, 20, -2 / 3], ['convex-lens', 8, -24, 3], ['concave-lens', 30, -60 / 7, 2 / 7],
] as const) {
  test(`${kind} at object distance ${distance} forms an off-axis image with both endpoints displaced`, () => {
    for (const offset of [-6, 4, 8]) {
      const s: OpticsScene = { ...createOpticsScene(), components: [
        { ...component('object', 0, offset), height: 4 }, component(kind, distance, 0),
      ] }
      for (const angle of [0, 35, 90, 180]) {
        const radians = angle * Math.PI / 180
        const rotated = { ...s, components: s.components.map(c => ({ ...c, ...rotate(c, radians), angle })) }
        const [image] = measureImages(rotated)
        assert.ok(image, 'moving the object off the axis must not remove its image')
        near(image.imageDistance!, expectedV); near(image.magnification!, expectedM)
        const expectedBase = rotate({ x: distance + expectedV, y: offset * expectedM }, radians)
        const expectedTip = rotate({ x: distance + expectedV, y: (offset - 4) * expectedM }, radians)
        near(image.imageBase!.x, expectedBase.x); near(image.imageBase!.y, expectedBase.y)
        near(image.imagePoint!.x, expectedTip.x); near(image.imagePoint!.y, expectedTip.y)
        const lens = rotated.components[1]
        const outgoing = simulateOptics(rotated).segments.filter(ray => !ray.virtual && Math.abs((ray.from.x - lens.x) * Math.cos(radians) + (ray.from.y - lens.y) * Math.sin(radians)) < 1e-5)
        assert.equal(outgoing.length, 3)
        // At the image plane every actual emergent ray (or its reverse) meets the predicted tip.
        for (const ray of outgoing) {
          const d = { x: ray.to.x - ray.from.x, y: ray.to.y - ray.from.y }
          near(((expectedTip.x - ray.from.x) * d.y - (expectedTip.y - ray.from.y) * d.x) / Math.hypot(d.x, d.y), 0)
        }
        if (expectedV < 0) {
          const virtual = simulateOptics(rotated).segments.filter(ray => ray.virtual)
          assert.equal(virtual.length, 3)
          for (const ray of virtual) { near(ray.to.x, expectedTip.x); near(ray.to.y, expectedTip.y) }
        }
      }
    }
  })
}

test('an off-axis object retains intermediate and final images in a coaxial microscope', () => {
  const original = opticsPresets.find(p => p.id === 'microscope')!.create()
  const old = measureImages(original)
  original.components[0].y += .5
  const images = measureImages(original)
  assert.equal(images.length, 2)
  images.forEach((image, i) => {
    near(image.imageBase!.y, old[i].imageBase!.y + .5 * image.magnification!)
    near(image.imagePoint!.y, old[i].imagePoint!.y + .5 * image.magnification!)
  })
})

test('a tip on the optical axis still emits three distinct imaging rays', () => {
  const s = createOpticsScene()
  s.components[0].y += s.components[0].height
  const segments = simulateOptics(s).segments.filter(ray => !ray.virtual && Math.abs(ray.to.x - 50) < 1e-5)
  assert.equal(segments.length, 3)
  assert.equal(new Set(segments.map(ray => ray.to.y.toFixed(5))).size, 3)
  assert.equal(simulateOptics(s).screenHits.length, 3)
  for (const hit of simulateOptics(s).screenHits) near(hit.point.y, 34)
})
