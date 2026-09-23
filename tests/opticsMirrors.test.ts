import assert from 'node:assert/strict'
import test from 'node:test'
import { createOpticalComponent as component, createOpticsScene, parseOpticsScene } from '../src/optics/library'
import { mirrorSurface } from '../src/optics/mirrorGeometry'
import { measureImages, simulateOptics } from '../src/optics/simulation'
import type { OpticalComponent, OpticsScene, RaySegment, Vec2 } from '../src/optics/types'

const scene = (...components: OpticalComponent[]): OpticsScene => ({ ...createOpticsScene(), components })
const near = (actual: number, expected: number, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`)
const rotate = (p: Vec2, angle: number): Vec2 => ({ x: p.x * Math.cos(angle) - p.y * Math.sin(angle), y: p.x * Math.sin(angle) + p.y * Math.cos(angle) })
const unit = (ray: RaySegment): Vec2 => { const dx = ray.to.x - ray.from.x, dy = ray.to.y - ray.from.y, length = Math.hypot(dx, dy); return { x: dx / length, y: dy / length } }
const real = (s: OpticsScene) => simulateOptics(s).segments.filter(ray => !ray.virtual)

test('plane mirror images reflect both endpoints of an off-axis object and actual virtual rays', () => {
  for (const angle of [0, 35, 90, 180]) {
    const radians = angle * Math.PI / 180
    const source = { ...component('object', 0, 6), height: 4 }
    const mirror = component('plane-mirror', 30, 0)
    const s = scene(...[source, mirror].map(c => ({ ...c, ...rotate(c, radians), angle })))
    const [image] = measureImages(s)
    near(image.objectDistance, 30); near(image.imageDistance!, -30); near(image.magnification!, 1)
    const base = rotate({ x: 60, y: 6 }, radians), tip = rotate({ x: 60, y: 2 }, radians)
    near(image.imageBase!.x, base.x); near(image.imageBase!.y, base.y)
    near(image.imagePoint!.x, tip.x); near(image.imagePoint!.y, tip.y)
    const simulation = simulateOptics(s), virtual = simulation.segments.filter(ray => ray.virtual)
    assert.equal(virtual.length, 3)
    for (const ray of virtual) {
      near(ray.to.x, tip.x); near(ray.to.y, tip.y)
      const reflected = simulation.segments.find(r => !r.virtual && Math.hypot(r.from.x - ray.from.x, r.from.y - ray.from.y) < 1e-6)!
      const d = unit(reflected), v = unit(ray)
      near(d.x, -v.x); near(d.y, -v.y)
    }
  }
})

test('spherical reflection contacts the displayed circular surface and obeys its actual normal', () => {
  for (const kind of ['concave-mirror', 'convex-mirror'] as const) {
    for (const height of [-8, -3, .01, 3, 8]) {
      const mirror = component(kind, 30, 0), s = scene(component('laser', 0, height), mirror)
      const segments = real(s)
      assert.equal(segments.length, 2)
      const hit = segments[0].to, signedRadius = kind === 'concave-mirror' ? 24 : -24
      near((hit.x - 30 + signedRadius) ** 2 + hit.y ** 2, signedRadius ** 2)
      const geometry = mirrorSurface(mirror, height)
      near(hit.x - 30, geometry.point.x)
      const n = geometry.frontNormal, output = unit(segments[1])
      near(output.x, 1 - 2 * n.x * n.x); near(output.y, -2 * n.x * n.y)
      const crossing = hit.x - hit.y * output.x / output.y
      assert.ok(kind === 'concave-mirror' ? crossing < 30 : crossing > 30)
      if (Math.abs(height) < .02) near(crossing, 30 - signedRadius / 2, 1e-5)
    }
  }
})

test('mirror backs absorb light and rotating 180 degrees exposes the reflective face', () => {
  for (const kind of ['plane-mirror', 'concave-mirror', 'convex-mirror'] as const) {
    const source = { ...component('laser', 40, 0), angle: 180 }, mirror = component(kind, 20, 0)
    const s = scene(source, mirror)
    assert.equal(real(s).length, 1)
    assert.ok(simulateOptics(s).warnings.some(warning => warning.includes('背面')))
    mirror.angle = 180
    assert.equal(real(s).length, 2)
    assert.ok(real(s)[1].to.x > real(s)[1].from.x)
    assert.equal(simulateOptics(s).warnings.length, 0)
  }
})

test('finite mirror aperture passes rays that miss the actual mirror', () => {
  for (const kind of ['plane-mirror', 'concave-mirror', 'convex-mirror'] as const) {
    const s = scene(component('laser', 0, 15), { ...component(kind, 20, 0), height: 10 })
    const rays = real(s)
    assert.equal(rays.length, 1)
    assert.ok(rays[0].to.x > 20)
    near(rays[0].to.y, 15)
  }
})

test('concave and convex Gaussian images are explicitly marked as estimates with correct signed distances', () => {
  for (const [kind, u, expectedV, expectedM] of [
    ['concave-mirror', 36, 18, -.5], ['concave-mirror', 8, -24, 3], ['convex-mirror', 36, -9, .25],
  ] as const) {
    const source = { ...component('object', 60 - u, 4), height: 3 }, mirror = component(kind, 60, 0)
    const s = scene(source, mirror), [image] = measureImages(s)
    assert.equal(image.approximate, true); assert.ok(image.caption?.includes('近轴估计'))
    near(image.imageDistance!, expectedV); near(image.magnification!, expectedM)
    near(image.imageBase!.x, 60 - expectedV); near(image.imageBase!.y, 4 * expectedM)
    near(image.imagePoint!.y, expectedM)
    const simulation = simulateOptics(s)
    for (const ray of simulation.segments.filter(r => r.virtual)) {
      const reflected = simulation.segments.find(r => !r.virtual && Math.hypot(r.from.x - ray.from.x, r.from.y - ray.from.y) < 1e-6)!
      const d = unit(reflected), v = unit(ray)
      near(d.x, -v.x); near(d.y, -v.y)
    }
    assert.equal(image.nature, expectedV > 0 ? 'real' : 'virtual')
  }
  const focus = scene({ ...component('object', 48, 0), height: 1 }, component('concave-mirror', 60, 0))
  assert.equal(measureImages(focus)[0].nature, 'infinity')
  assert.equal(measureImages(focus)[0].imagePoint, null)
})

test('blocked or mixed optical paths do not fabricate mirror images', () => {
  const source = component('object', 0, 0), mirror = component('concave-mirror', 40, 0)
  assert.equal(measureImages(scene(source, mirror, component('screen', 20, 0))).length, 0)
  assert.equal(measureImages(scene(source, mirror, component('convex-lens', 20, 0))).length, 0)
  assert.equal(measureImages(scene(source, { ...mirror, angle: 180 })).length, 0)
})

test('mirror schema normalizes focal signs and rejects a cap larger than the sphere', () => {
  for (const kind of ['concave-mirror', 'convex-mirror'] as const) {
    const s = scene({ ...component(kind), focalLength: kind === 'concave-mirror' ? -12 : 12 })
    const [mirror] = parseOpticsScene(s).components
    assert.equal(mirror.focalLength, kind === 'concave-mirror' ? 12 : -12)
    assert.throws(() => parseOpticsScene(scene({ ...mirror, height: 48.01 })), /球面直径/)
    assert.doesNotThrow(() => parseOpticsScene(scene({ ...mirror, height: 48 })))
  }
})
