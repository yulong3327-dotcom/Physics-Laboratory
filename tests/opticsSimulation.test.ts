import assert from 'node:assert/strict'
import test from 'node:test'
import { createOpticalComponent as component, createOpticsScene, opticalOrder, opticsPresets, parseOpticsScene, OPTICS_LIMITS } from '../src/optics/library'
import { measureImages, simulateOptics } from '../src/optics/simulation'
import type { OpticalComponent, OpticsScene, RaySegment } from '../src/optics/types'

const near = (actual: number, expected: number, tolerance = 1e-5) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≠ ${expected}`)
const scene = (...components: OpticalComponent[]): OpticsScene => ({ ...createOpticsScene(), components })
const real = (s: OpticsScene) => simulateOptics(s).segments.filter(segment => !segment.virtual)
const slope = (segment: RaySegment) => (segment.to.y - segment.from.y) / (segment.to.x - segment.from.x)

test('laser emits exactly one ray at its tip along the rotated direction', () => {
  const laser = { ...component('laser', 12, 18), angle: 35, rayCount: 41, spread: 160 }
  const simulation = simulateOptics(scene(laser)), [ray] = simulation.segments
  assert.equal(simulation.emittedRays, 1)
  assert.equal(simulation.segments.length, 1)
  assert.deepEqual(ray.from, { x: 12, y: 18 })
  assert.equal(ray.sourceId, laser.id)
  assert.equal(ray.wavelength, 650)
  near(slope(ray), Math.tan(35 * Math.PI / 180))
  assert.ok(ray.to.x > ray.from.x)
  laser.enabled = false
  assert.equal(simulateOptics(scene(laser)).emittedRays, 0)
})

test('laser reflection preset directs one ray from mirror to screen', () => {
  const preset = opticsPresets.find(preset => preset.id === 'laser')!
  const s = preset.create(), simulation = simulateOptics(s), rays = real(s)
  assert.equal(simulation.emittedRays, 1)
  assert.equal(simulation.screenHits.length, 1)
  assert.equal(rays.length, 2)
  assert.deepEqual(rays[0].to, { x: 55, y: 34 })
  near(slope(rays[1]), -Math.sqrt(3))
  const hit = simulation.screenHits[0]
  assert.equal(hit.componentId, s.components[2].id)
  near(hit.point.x, 43)
  near(hit.point.y, 34 + 12 * Math.sqrt(3))
})

test('laser refracts through either lens type without a false convex virtual image', () => {
  for (const kind of ['convex-lens', 'concave-lens'] as const) {
    const s = scene(component('laser', 15, 4), { ...component(kind, 20, 0), focalLength: kind === 'convex-lens' ? 10 : -10 }, component('screen', 30, 0))
    const simulation = simulateOptics(s)
    assert.equal(simulation.screenHits.length, 1)
    near(simulation.screenHits[0].point.y, kind === 'convex-lens' ? 0 : 8)
    assert.equal(simulation.segments.filter(segment => segment.virtual).length, kind === 'concave-lens' ? 1 : 0)
  }
})

test('laser follows Snell refraction through a slab and a prism', () => {
  const slabScene = scene({ ...component('laser', 0, 0), angle: 30 }, { ...component('glass-slab', 15, 10), width: 10, height: 60 })
  const slabRays = real(slabScene)
  assert.equal(slabRays.length, 3)
  near(slope(slabRays[1]), Math.tan(Math.asin(0.5 / 1.5)))
  near(slope(slabRays[2]), Math.tan(Math.PI / 6))
  const prismRays = real(scene(component('laser', 0, 0), { ...component('prism', 20, 0), height: 20, width: 20 }))
  assert.ok(prismRays.length >= 3)
  near(prismRays[0].to.x, 15)
  assert.ok(Math.abs(slope(prismRays.at(-1)!)) > 0.1)
})

test('laser passes an open aperture and is stopped by its closed opening', () => {
  const laser = component('laser', 0, 0), aperture = { ...component('aperture', 10, 0), opening: 2 }, screen = component('screen', 20, 0)
  assert.equal(simulateOptics(scene(laser, aperture, screen)).screenHits.length, 1)
  aperture.opening = 0
  assert.equal(simulateOptics(scene(laser, aperture, screen)).screenHits.length, 0)
})

test('laser imports normalize beam controls while rejecting invalid persisted values', () => {
  const s = scene({ ...component('laser'), rayCount: 9, spread: 50 })
  const parsed = parseOpticsScene(s)
  assert.equal(parsed.components[0].rayCount, 1)
  assert.equal(parsed.components[0].spread, 0)
  assert.equal(s.components[0].rayCount, 9)
  for (const patch of [{ rayCount: 1.5 }, { rayCount: 0 }, { spread: Infinity }, { angle: 361 }, { wavelength: 900 }]) {
    assert.throws(() => parseOpticsScene(scene({ ...component('laser'), ...patch })))
  }
})

test('default object forms three converging rays at the real inverted image on screen', () => {
  const s = createOpticsScene(), simulation = simulateOptics(s), [image] = measureImages(s)
  assert.equal(s.components.length, 3)
  assert.equal(simulation.emittedRays, 3)
  assert.equal(simulation.screenHits.length, 3)
  near(image.objectDistance, 30); near(image.imageDistance!, 20); near(image.magnification!, -2 / 3)
  near(image.imagePoint!.x, 70); near(image.imagePoint!.y, 34 + 16 / 3)
  for (const hit of simulation.screenHits) { near(hit.point.x, image.imagePoint!.x); near(hit.point.y, image.imagePoint!.y) }
  assert.equal(image.nature, 'real')
})

test('parallel rays converge one focal length behind convex lenses from either side', () => {
  for (const reverse of [false, true]) {
    const source = { ...component('parallel-source', reverse ? 40 : 0, 0), height: 8, rayCount: 3, angle: reverse ? 180 : 0 }
    const lens = { ...component('convex-lens', 20, 0), focalLength: 10 }
    const screen = component('screen', reverse ? 10 : 30, 0)
    const simulation = simulateOptics(scene(source, lens, screen))
    assert.equal(simulation.screenHits.length, 3)
    for (const hit of simulation.screenHits) near(hit.point.y, 0)
  }
})

test('concave lens produces divergent rays whose virtual extensions meet at the front focus', () => {
  const s = scene({ ...component('parallel-source', 0, 0), height: 8, rayCount: 3 }, { ...component('concave-lens', 20, 0), focalLength: -10 })
  const extensions = simulateOptics(s).segments.filter(segment => segment.virtual)
  assert.equal(extensions.length, 3)
  for (const segment of extensions) near(segment.from.y + slope(segment) * (10 - segment.from.x), 0)
  s.settings.showVirtual = false
  assert.equal(simulateOptics(s).segments.filter(segment => segment.virtual).length, 0)
})

test('object inside focal length produces an upright enlarged virtual image', () => {
  const s = scene({ ...component('object', 12, 0), height: 3 }, { ...component('convex-lens', 20, 0), focalLength: 12 })
  const [image] = measureImages(s)
  assert.equal(image.nature, 'virtual'); near(image.imageDistance!, -24); near(image.magnification!, 3); near(image.imagePoint!.y, -9)
  for (const segment of simulateOptics(s).segments.filter(segment => segment.virtual)) near(segment.from.y + slope(segment) * (image.imagePoint!.x - segment.from.x), image.imagePoint!.y)
})

test('focal-plane object yields parallel output and an image at infinity', () => {
  const s = scene({ ...component('object', 8, 0), height: 3 }, { ...component('convex-lens', 20, 0), focalLength: 12 })
  assert.equal(measureImages(s)[0].nature, 'infinity')
  const outgoing = real(s).filter(segment => Math.abs(segment.from.x - 20) < 1e-5)
  assert.equal(outgoing.length, 3)
  for (const segment of outgoing) near(slope(segment), 0.25)
})

test('rotated scene preserves lens image geometry', () => {
  const s = scene({ ...component('object', 0, 0), height: 4, angle: 90 }, { ...component('convex-lens', 0, 30), focalLength: 12, angle: 90 }, { ...component('screen', 0, 50), angle: 90 })
  const [image] = measureImages(s); near(image.imagePoint!.x, -8 / 3); near(image.imagePoint!.y, 50)
  for (const hit of simulateOptics(s).screenHits) { near(hit.point.x, -8 / 3); near(hit.point.y, 50) }
})

test('finite lens aperture allows outer rays to pass unchanged', () => {
  const s = scene({ ...component('parallel-source', 0, 0), height: 20, rayCount: 3 }, { ...component('convex-lens', 20, 0), height: 4 }, component('screen', 40, 0))
  const ys = simulateOptics(s).screenHits.map(hit => Math.round(hit.point.y)).sort((a, b) => a - b)
  assert.deepEqual(ys, [-10, 0, 10])
})

test('opaque aperture blocks its material, transmits the opening and closes completely at zero', () => {
  const source = { ...component('parallel-source', 0, 0), height: 8, rayCount: 5 }
  const aperture = { ...component('aperture', 10, 0), opening: 3 }, screen = component('screen', 20, 0)
  assert.equal(simulateOptics(scene(source, aperture, screen)).screenHits.length, 1)
  aperture.opening = 0
  assert.equal(simulateOptics(scene(source, aperture, screen)).screenHits.length, 0)
})

test('nearest screen blocks further tracing regardless of component array order', () => {
  const source = { ...component('parallel-source', 0, 0), rayCount: 1 }, nearScreen = component('screen', 10, 0), farScreen = component('screen', 30, 0)
  const simulation = simulateOptics(scene(farScreen, source, nearScreen))
  assert.equal(simulation.screenHits.length, 1); assert.equal(simulation.screenHits[0].componentId, nearScreen.id)
})

test('plane mirror obeys reflection law at an oblique angle', () => {
  const s = scene({ ...component('point-source', 0, 0), rayCount: 1, angle: 30 }, { ...component('plane-mirror', 10, 0), height: 40 })
  const segments = real(s), reflected = segments[1]
  assert.ok(reflected.to.x < reflected.from.x)
  near(slope(reflected), -Math.tan(Math.PI / 6))
})

test('parallel slab obeys Snell law at entry and returns the initial angle at exit', () => {
  const source = { ...component('point-source', 0, 0), rayCount: 1, angle: 30 }, slab = { ...component('glass-slab', 15, 10), width: 10, height: 60, refractiveIndex: 1.5 }
  const segments = real(scene(source, slab))
  assert.equal(segments.length, 3)
  near(segments[0].to.x, 10); near(segments[1].to.x, 20)
  near(slope(segments[1]), Math.tan(Math.asin(Math.sin(Math.PI / 6) / 1.5)))
  near(slope(segments[2]), Math.tan(Math.PI / 6))
})

test('triangular prism ray meets actual triangle edges and exits into air', () => {
  const source = { ...component('parallel-source', 0, 0), rayCount: 1 }, prism = { ...component('prism', 20, 0), height: 20, width: 20 }
  const segments = real(scene(source, prism))
  assert.ok(segments.length >= 3)
  near(segments[0].to.x, 15)
  assert.ok(Math.abs(slope(segments.at(-1)!)) > 0.1)
  for (const segment of segments) assert.ok(Number.isFinite(segment.to.x) && Number.isFinite(segment.to.y))
})

test('grazing air-to-prism incidence still refracts across the base', () => {
  const source = { ...component('laser', 0, 10.0003), angle: -0.001 }
  const prism = { ...component('prism', 20, 0), height: 20, width: 20 }
  const simulation = simulateOptics(scene(source, prism)), segments = simulation.segments
  assert.equal(segments.length, 3)
  near(segments[0].to.y, 10)
  near(slope(segments[1]), -Math.sqrt(1.5 ** 2 - 1), 1e-4)
  assert.equal(simulation.warnings.length, 0)
})

test('prism reflects only above the glass-to-air critical angle', () => {
  const source = { ...component('laser', 20, 0), angle: 35 }
  const prism = { ...component('prism', 20, 0), height: 20, width: 20 }
  const simulation = simulateOptics(scene(source, prism)), segments = simulation.segments
  assert.ok(simulation.warnings.some(warning => warning.includes('临界角 41.8°')))
  assert.ok(segments[1].to.x < segments[1].from.x)
  near(segments[1].to.y, 10)
})

test('glass-to-air incidence above critical angle totally reflects internally', () => {
  const source = { ...component('point-source', 0, 0), rayCount: 1, angle: 60 }, slab = { ...component('glass-slab', 0, 0), width: 10, height: 100 }
  const simulation = simulateOptics(scene(source, slab)), segments = simulation.segments.filter(segment => !segment.virtual)
  assert.ok(simulation.warnings.some(warning => warning.includes('全反射')))
  near(segments[0].to.x, 5)
  assert.ok(segments[1].to.x < segments[1].from.x)
})

test('multiple lenses report successive images and use a signed virtual object distance', () => {
  const s = createOpticsScene(); s.components.splice(2, 0, component('concave-lens', 60, 34))
  const [first, final] = measureImages(s)
  near(first.imageDistance!, 20)
  assert.equal(first.imagePoint, null) // The second lens intercepts the converging rays.
  near(final.objectDistance, -10)
  near(final.imageDistance!, 60)
  near(final.magnification!, -4)
  assert.equal(final.nature, 'real')
  assert.ok(real(s).some(segment => Math.abs(segment.from.x - 60) < 1e-5))
  s.components[2].enabled = false
  assert.equal(measureImages(s).length, 1)
})

test('telescope preset traces both lenses and returns incident parallel rays to parallel output', () => {
  const preset = opticsPresets.find(candidate => candidate.id === 'telescope')!
  const s = preset.create(), [objective, eyepiece] = s.components.filter(candidate => candidate.kind === 'convex-lens')
  const simulation = simulateOptics(s), rays = simulation.segments.filter(segment => !segment.virtual)
  assert.equal(simulation.emittedRays, 7)
  const objectiveX = objective.x, eyepieceX = eyepiece.x
  assert.equal(rays.filter(segment => Math.abs(segment.to.x - objectiveX) < 1e-5).length, 7)
  assert.equal(rays.filter(segment => Math.abs(segment.to.x - eyepieceX) < 1e-5).length, 7)
  const outgoing = rays.filter(segment => Math.abs(segment.from.x - eyepieceX) < 1e-5)
  assert.equal(outgoing.length, 7)
  for (const ray of outgoing) near(slope(ray), 0)
  const [intermediate, final] = measureImages(s)
  near(intermediate.imageDistance!, objective.focalLength)
  near(intermediate.imagePoint!.x, 63)
  assert.equal(final.nature, 'infinity')
  assert.equal(final.imagePoint, null)
  assert.equal(final.caption, '最终像在无穷远')
})

test('microscope preset uses two real lens components with rays meeting at the intermediate image', () => {
  const preset = opticsPresets.find(candidate => candidate.id === 'microscope')!
  const s = preset.create(), [objective, eyepiece] = s.components.filter(candidate => candidate.kind === 'convex-lens')
  const simulation = simulateOptics(s), rays = simulation.segments.filter(segment => !segment.virtual)
  assert.equal(simulation.emittedRays, 3)
  assert.equal(rays.filter(segment => Math.abs(segment.to.x - objective.x) < 1e-5).length, 3)
  const between = rays.filter(segment => Math.abs(segment.to.x - eyepiece.x) < 1e-5)
  assert.equal(between.length, 3)
  for (const ray of between) near(ray.from.y + slope(ray) * (40 + 1 / 6 - ray.from.x), 34 + 8 / 3)
  assert.equal(rays.filter(segment => Math.abs(segment.from.x - eyepiece.x) < 1e-5).length, 3)
})

test('microscope preset measures an intermediate real image and a finite final virtual image', () => {
  const preset = opticsPresets.find(candidate => candidate.id === 'microscope')!
  const s = preset.create(), measurements = measureImages(s)
  assert.equal(measurements.length, 2)
  const intermediate = measurements.find(measurement => measurement.caption === '中间实像')!
  const final = measurements.find(measurement => measurement.caption === '最终虚像')!
  assert.ok(intermediate)
  assert.ok(final)
  assert.equal(intermediate.nature, 'real')
  assert.equal(final.nature, 'virtual')
  near(final.imageDistance!, -48)
  near(final.magnification!, -24)
  assert.ok(final.imagePoint && final.imageBase)
  for (const point of [final.imagePoint!, final.imageBase!]) {
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y))
  }
  const virtualSegments = simulateOptics(s).segments.filter(segment => segment.virtual)
  assert.equal(virtualSegments.length, 3)
  const eyepiece = s.components[2]
  const outgoing = real(s).filter(ray => Math.abs(ray.from.x - eyepiece.x) < 1e-5)
  for (const ray of outgoing) near(ray.from.y + slope(ray) * (final.imagePoint!.x - ray.from.x), final.imagePoint!.y)
  for (const ray of virtualSegments) { near(ray.to.x, final.imagePoint!.x); near(ray.to.y, final.imagePoint!.y) }
  s.settings.showVirtual = false
  assert.equal(simulateOptics(s).segments.filter(ray => ray.virtual).length, 0)
})

test('a colocated aperture stops outer rays while the transmitted rays still refract', () => {
  const source = { ...component('parallel-source', 0, 0), height: 10, rayCount: 3 }
  const lens = { ...component('convex-lens', 20, 0), focalLength: 10 }
  const aperture = { ...component('aperture', 20, 0), opening: 12 }
  const screen = component('screen', 30, 0)
  for (const pair of [[aperture, lens], [lens, aperture]]) {
    const simulation = simulateOptics(scene(source, ...pair, screen))
    assert.equal(simulation.screenHits.length, 3)
    for (const hit of simulation.screenHits) near(hit.point.y, 0)
  }
  aperture.opening = 4
  assert.equal(simulateOptics(scene(source, aperture, lens, screen)).screenHits.length, 1)
  aperture.opening = 0
  assert.equal(simulateOptics(scene(source, lens, aperture, screen)).screenHits.length, 0)
})

test('three ordinary lenses form sequential images independent of component array order', () => {
  const source = { ...component('object', 0, 0), height: 1 }
  const lenses = [
    { ...component('convex-lens', 10, 0), focalLength: 5 },
    { ...component('convex-lens', 30, 0), focalLength: 8 },
    { ...component('convex-lens', 80, 0), focalLength: 20 },
  ]
  const s = scene(...lenses.toReversed(), source)
  const images = measureImages(s)
  assert.equal(images.length, 3)
  assert.deepEqual(images.map(image => image.lensId), lenses.map(lens => lens.id))
  for (const [i, x] of [20, 70, 60].entries()) near(images[i].imageBase!.x, x)
  near(images[2].magnification!, 8)
  near(images[2].imagePoint!.y, -8)
  assert.equal(images[2].nature, 'virtual')
  const outgoing = real(s).filter(ray => Math.abs(ray.from.x - 80) < 1e-5)
  assert.equal(outgoing.length, 3)
  for (const ray of outgoing) near(ray.from.y + slope(ray) * (60 - ray.from.x), -8)
})

test('multilens images and actual reverse extensions rotate with the complete setup', () => {
  const original = opticsPresets.find(preset => preset.id === 'microscope')!.create()
  const initial = measureImages(original)
  for (const angle of [90, -90, 180, 30]) {
    const radians = angle * Math.PI / 180
    const rotate = (point: { x: number; y: number }) => ({ x: point.x * Math.cos(radians) - point.y * Math.sin(radians), y: point.x * Math.sin(radians) + point.y * Math.cos(radians) })
    const s = scene(...original.components.map(c => ({ ...c, ...rotate(c), angle: c.angle + angle })))
    const images = measureImages(s)
    assert.equal(images.length, 2)
    for (const [i, image] of images.entries()) {
      const expected = rotate(initial[i].imagePoint!)
      near(image.imagePoint!.x, expected.x); near(image.imagePoint!.y, expected.y)
      near(image.magnification!, initial[i].magnification!)
    }
    const simulation = simulateOptics(s), virtual = simulation.segments.filter(ray => ray.virtual)
    assert.equal(virtual.length, 3)
    for (const ray of virtual) {
      near(ray.to.x, images[1].imagePoint!.x); near(ray.to.y, images[1].imagePoint!.y)
      const outgoing = simulation.segments.find(segment => !segment.virtual && Math.hypot(segment.from.x - ray.from.x, segment.from.y - ray.from.y) < 1e-5)!
      const dx = outgoing.to.x - outgoing.from.x, dy = outgoing.to.y - outgoing.from.y
      near((ray.to.x - ray.from.x) * dy - (ray.to.y - ray.from.y) * dx, 0, 1e-3)
      assert.ok((ray.to.x - ray.from.x) * dx + (ray.to.y - ray.from.y) * dy < 0)
    }
  }
})

test('an intermediate image at infinity or on the next lens remains numerically stable', () => {
  const source = { ...component('object', 0, 0), height: 1 }
  const first = { ...component('convex-lens', 10, 0), focalLength: 10 }
  const second = { ...component('convex-lens', 30, 0), focalLength: 5 }
  const s = scene(source, first, second)
  let images = measureImages(s)
  assert.equal(images[0].nature, 'infinity')
  near(images[1].imageDistance!, 5); near(images[1].imagePoint!.y, .5)
  for (const ray of real(s).filter(ray => Math.abs(ray.from.x - second.x) < 1e-5)) near(ray.from.y + slope(ray) * (35 - ray.from.x), .5)
  first.focalLength = 5; second.x = 20
  images = measureImages(s)
  near(images[1].objectDistance, 0); near(images[1].imageDistance!, 0)
  near(images[1].magnification!, -1); near(images[1].imagePoint!.y, 1)
})

test('disabled, misaligned or blocked lens chains do not show a stale final image', () => {
  const s = opticsPresets.find(preset => preset.id === 'microscope')!.create()
  s.components[2].enabled = false
  assert.equal(measureImages(s).length, 1)
  s.components[2].enabled = true; s.components[2].angle = 90
  assert.equal(measureImages(s).length, 0)
  s.components[2].angle = 0
  s.components.push(component('screen', 30, 34))
  assert.equal(measureImages(s).length, 1)
  assert.equal(simulateOptics(s).segments.filter(ray => ray.virtual).length, 0)
})

test('disabled sources and optical components do not participate', () => {
  const s = createOpticsScene(); s.components[0].enabled = false
  assert.equal(simulateOptics(s).emittedRays, 0); assert.equal(measureImages(s).length, 0)
})

test('cavity tracing is bounded and high source count is capped', () => {
  const cavity = scene({ ...component('point-source', 5, 0), rayCount: 1 }, { ...component('plane-mirror', 0, 0), angle: 180 }, component('plane-mirror', 10, 0))
  const simulation = simulateOptics(cavity)
  assert.ok(simulation.segments.length <= OPTICS_LIMITS.maxInteractions * 2)
  assert.ok(simulation.warnings.some(warning => warning.includes('32')))
  const many = scene(...Array.from({ length: 20 }, (_, i) => ({ ...component('parallel-source', i, 0), rayCount: 41 })))
  assert.equal(simulateOptics(many).emittedRays, 512)
})

test('every library component and preset validates and yields finite bounded output', () => {
  for (const kind of opticalOrder) parseOpticsScene(scene(component(kind)))
  for (const preset of opticsPresets) {
    const s = parseOpticsScene(preset.create()), simulation = simulateOptics(s)
    for (const segment of simulation.segments) for (const coordinate of [segment.from.x, segment.from.y, segment.to.x, segment.to.y]) assert.ok(Number.isFinite(coordinate))
    assert.ok(simulation.emittedRays > 0)
  }
})

test('scene parsing rejects invalid numeric, structural and resource input', () => {
  const badValues: [string, unknown][] = [['x', Infinity], ['y', 1001], ['angle', 361], ['height', 0], ['width', 201], ['focalLength', 0], ['focalLength', 501], ['rayCount', 42], ['rayCount', 1.5], ['spread', 161], ['wavelength', 379], ['refractiveIndex', 0.9], ['enabled', 'true'], ['label', 'x'.repeat(61)], ['kind', '__proto__']]
  for (const [field, value] of badValues) { const s = createOpticsScene(); (s.components[0] as unknown as Record<string, unknown>)[field] = value; assert.throws(() => parseOpticsScene(s), `${field}=${value}`) }
  const duplicate = createOpticsScene(); duplicate.components.push(duplicate.components[0]); assert.throws(() => parseOpticsScene(duplicate))
  assert.throws(() => parseOpticsScene(scene(...Array.from({ length: 101 }, () => component('screen')))))
  assert.throws(() => parseOpticsScene({ ...createOpticsScene(), settings: { showGrid: true } }))
  assert.throws(() => parseOpticsScene('{oops'))
  assert.throws(() => parseOpticsScene(scene({ ...component('aperture'), opening: 100 })))
})

test('parse and JSON round-trip return isolated whitelisted data', () => {
  const original = createOpticsScene(), parsed = parseOpticsScene(JSON.stringify(original))
  assert.deepEqual(parsed, original)
  parsed.components[0].x = 99
  assert.equal(original.components[0].x, 20)
  assert.deepEqual(parseOpticsScene({ ...original, unknown: 'ignored' }), original)
})
