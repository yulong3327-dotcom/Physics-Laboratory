import type { ImageMeasurement, OpticalComponent, OpticsScene, OpticsSimulation, Vec2 } from './types'
import { OPTICS_LIMITS, parseOpticsScene } from './library'

const EPSILON = 1e-7
const OFFSET = 1e-5
const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y })
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y })
const scale = (v: Vec2, k: number): Vec2 => ({ x: v.x * k, y: v.y * k })
const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y
const cross = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x
const unit = (v: Vec2): Vec2 => scale(v, 1 / (Math.hypot(v.x, v.y) || 1))
const isLens = (c: OpticalComponent) => c.kind === 'convex-lens' || c.kind === 'concave-lens'
const isGlass = (c: OpticalComponent) => c.kind === 'glass-slab' || c.kind === 'prism'
const focalLength = (c: OpticalComponent) => (c.kind === 'concave-lens' ? -1 : 1) * Math.abs(c.focalLength)

function axes(c: OpticalComponent) {
  const angle = c.angle * Math.PI / 180
  return { x: { x: Math.cos(angle), y: Math.sin(angle) }, y: { x: -Math.sin(angle), y: Math.cos(angle) } }
}
function local(c: OpticalComponent, point: Vec2): Vec2 {
  const a = axes(c), v = sub(point, c)
  return { x: dot(v, a.x), y: dot(v, a.y) }
}
function world(c: OpticalComponent, x: number, y: number): Vec2 {
  const a = axes(c)
  return add({ x: c.x, y: c.y }, add(scale(a.x, x), scale(a.y, y)))
}

function vertices(c: OpticalComponent): Vec2[] {
  const w = c.width / 2, h = c.height / 2
  return (c.kind === 'prism' ? [[-w, h], [w, h], [0, -h]] : [[-w, -h], [w, -h], [w, h], [-w, h]])
    .map(([x, y]) => world(c, x, y))
}

interface SurfaceHit { component: OpticalComponent; point: Vec2; distance: number; normal: Vec2; transverse: number }
interface GlassShape { component: OpticalComponent; vertices: Vec2[] }
interface Seed { source: OpticalComponent; origin: Vec2; direction: Vec2 }

function planeHit(origin: Vec2, direction: Vec2, c: OpticalComponent): SurfaceHit | null {
  const a = axes(c), denominator = dot(direction, a.x)
  if (Math.abs(denominator) < EPSILON) return null
  const distance = dot(sub(c, origin), a.x) / denominator
  if (distance <= EPSILON) return null
  const point = add(origin, scale(direction, distance)), transverse = dot(sub(point, c), a.y)
  if (Math.abs(transverse) > c.height / 2 + EPSILON) return null
  return { component: c, point, distance, normal: a.x, transverse }
}

function polygonHit(origin: Vec2, direction: Vec2, shape: GlassShape): SurfaceHit | null {
  let closest: SurfaceHit | null = null
  for (let i = 0; i < shape.vertices.length; i++) {
    const start = shape.vertices[i], edge = sub(shape.vertices[(i + 1) % shape.vertices.length], start)
    const denominator = cross(direction, edge)
    if (Math.abs(denominator) < EPSILON) continue
    const delta = sub(start, origin), distance = cross(delta, edge) / denominator, fraction = cross(delta, direction) / denominator
    if (distance <= EPSILON || fraction < -EPSILON || fraction > 1 + EPSILON || (closest && distance >= closest.distance)) continue
    closest = { component: shape.component, point: add(origin, scale(direction, distance)), distance, normal: unit({ x: edge.y, y: -edge.x }), transverse: 0 }
  }
  return closest
}

function inside(point: Vec2, polygon: Vec2[]): boolean {
  let sign = 0
  for (let i = 0; i < polygon.length; i++) {
    const value = cross(sub(polygon[(i + 1) % polygon.length], polygon[i]), sub(point, polygon[i]))
    if (Math.abs(value) <= EPSILON) continue
    if (sign && Math.sign(value) !== sign) return false
    sign = Math.sign(value)
  }
  return true
}
function mediumAt(point: Vec2, shapes: GlassShape[]): number {
  // Last added medium occupies overlap regions; disjoint and nested glass are deterministic.
  for (let i = shapes.length - 1; i >= 0; i--) if (inside(point, shapes[i].vertices)) return shapes[i].component.refractiveIndex
  return 1
}
function reflected(direction: Vec2, normal: Vec2): Vec2 {
  return unit(sub(direction, scale(normal, 2 * dot(direction, normal))))
}
function refracted(direction: Vec2, normal: Vec2, n1: number, n2: number): Vec2 | null {
  const facing = dot(direction, normal) > 0 ? scale(normal, -1) : normal
  const cosine = Math.max(0, Math.min(1, -dot(direction, facing))), ratio = n1 / n2
  const discriminant = 1 - ratio * ratio * (1 - cosine * cosine)
  if (discriminant < -EPSILON) return null
  return unit(add(scale(direction, ratio), scale(facing, ratio * cosine - Math.sqrt(Math.max(0, discriminant)))))
}

function alignedLens(object: OpticalComponent, components: OpticalComponent[]): OpticalComponent | undefined {
  const objectAxis = axes(object).x
  return components.filter(c => {
    if (!isLens(c)) return false
    const l = local(c, object)
    return Math.abs(l.y) < 0.05 && Math.abs(dot(objectAxis, axes(c).x)) > 0.99999 && dot(sub(c, object), objectAxis) > EPSILON
  }).sort((a, b) => Math.hypot(a.x - object.x, a.y - object.y) - Math.hypot(b.x - object.x, b.y - object.y))[0]
}

function sourceSeeds(components: OpticalComponent[]): Seed[] {
  const seeds: Seed[] = []
  const push = (source: OpticalComponent, origin: Vec2, direction: Vec2) => seeds.push({ source, origin, direction: unit(direction) })
  for (const source of components) {
    const axis = axes(source)
    if (source.kind === 'laser') {
      push(source, { x: source.x, y: source.y }, axis.x)
    } else if (source.kind === 'parallel-source') {
      for (let i = 0; i < source.rayCount; i++) push(source, world(source, 0, source.rayCount === 1 ? 0 : source.height * (i / (source.rayCount - 1) - 0.5)), axis.x)
    } else if (source.kind === 'point-source' || source.kind === 'object') {
      const origin = source.kind === 'object' ? world(source, 0, -source.height) : { x: source.x, y: source.y }
      const lens = source.kind === 'object' ? alignedLens(source, components) : undefined
      if (lens) {
        const l = local(lens, origin), distance = Math.abs(l.x), f = focalLength(lens), radius = lens.height / 2
        // Parallel, central and front-focus rays. Replace a clipped principal ray with an aperture ray.
        const focusTarget = Math.abs(f - distance) > EPSILON ? f * l.y / (f - distance) : NaN
        const targets = [l.y, 0, focusTarget]
        for (let i = 0; i < Math.min(3, source.rayCount); i++) {
          const target = Number.isFinite(targets[i]) && Math.abs(targets[i]) <= radius ? targets[i] : (i === 0 ? -1 : 1) * radius * 0.9
          push(source, origin, sub(world(lens, 0, target), origin))
        }
        for (let i = 3; i < source.rayCount; i++) push(source, origin, sub(world(lens, 0, radius * 1.8 * ((i - 2) / (source.rayCount - 1) - 0.5)), origin))
      } else {
        for (let i = 0; i < source.rayCount; i++) {
          const angle = (source.rayCount === 1 ? 0 : source.spread * (i / (source.rayCount - 1) - 0.5)) * Math.PI / 180
          push(source, origin, add(scale(axis.x, Math.cos(angle)), scale(axis.y, Math.sin(angle))))
        }
      }
    }
  }
  return seeds
}

function drawingBounds(components: OpticalComponent[]) {
  const xs = components.flatMap(c => [c.x - Math.max(c.height, c.width), c.x + Math.max(c.height, c.width)])
  const ys = components.flatMap(c => [c.y - Math.max(c.height, c.width), c.y + Math.max(c.height, c.width)])
  return { minX: Math.min(0, ...xs) - 160, maxX: Math.max(100, ...xs) + 160, minY: Math.min(0, ...ys) - 160, maxY: Math.max(70, ...ys) + 160 }
}
function endAtBounds(origin: Vec2, direction: Vec2, bounds: ReturnType<typeof drawingBounds>): Vec2 {
  const candidates = [
    direction.x > EPSILON ? (bounds.maxX - origin.x) / direction.x : direction.x < -EPSILON ? (bounds.minX - origin.x) / direction.x : Infinity,
    direction.y > EPSILON ? (bounds.maxY - origin.y) / direction.y : direction.y < -EPSILON ? (bounds.minY - origin.y) / direction.y : Infinity,
  ].filter(distance => distance > EPSILON && Number.isFinite(distance))
  return add(origin, scale(direction, candidates.length ? Math.min(...candidates) : 300))
}

/** Sequential geometric tracing: paraxial thin lenses, exact plane reflection and Snell refraction. */
export function simulateOptics(input: OpticsScene): OpticsSimulation {
  const scene = parseOpticsScene(input), components = scene.components.filter(c => c.enabled)
  const result: OpticsSimulation = { segments: [], screenHits: [], warnings: [], emittedRays: 0 }
  const warnings = new Set<string>(), bounds = drawingBounds(components)
  const planes = components.filter(c => isLens(c) || c.kind === 'plane-mirror' || c.kind === 'screen' || c.kind === 'aperture')
  const glass = components.filter(isGlass).map(component => ({ component, vertices: vertices(component) }))
  const images = measureLensChains(components)
  const imageByLens = new Map(images.map(image => [JSON.stringify([image.objectId, image.lensId]), image]))
  const seeds = sourceSeeds(components)
  if (seeds.length > OPTICS_LIMITS.maxTotalRays) warnings.add('光线较多，当前最多追踪 512 条光线。')
  const segment = (source: OpticalComponent, from: Vec2, to: Vec2, virtual = false) => {
    if (Math.hypot(to.x - from.x, to.y - from.y) > EPSILON) result.segments.push({ from, to, sourceId: source.id, wavelength: source.wavelength, intensity: virtual ? 0.4 : 1, ...(virtual ? { virtual: true } : {}) })
  }
  for (const seed of seeds.slice(0, OPTICS_LIMITS.maxTotalRays)) {
    result.emittedRays++
    let origin = seed.origin, displayOrigin = seed.origin, direction = seed.direction, previousOpticalInteractions = 0
    const traversed: string[] = []
    for (let bounce = 0; bounce < OPTICS_LIMITS.maxInteractions; bounce++) {
      let closest: SurfaceHit | null = null
      const planeHits = planes.flatMap(plane => { const hit = planeHit(origin, direction, plane); return hit ? [hit] : [] })
      // A stop can share a plane with a lens. Check the stop and apply the lens
      // before advancing the ray, independently of component array order.
      const priority = (hit: SurfaceHit) => hit.component.kind === 'screen' ? 0 : hit.component.kind === 'aperture' ? 2 : 1
      for (const hit of planeHits) if (!closest || hit.distance < closest.distance - EPSILON || (Math.abs(hit.distance - closest.distance) < EPSILON && priority(hit) < priority(closest))) closest = hit
      for (const shape of glass) { const hit = polygonHit(origin, direction, shape); if (hit && (!closest || hit.distance < closest.distance)) closest = hit }
      if (!closest) { segment(seed.source, displayOrigin, endAtBounds(origin, direction, bounds)); break }
      const { component, point, normal, transverse } = closest
      segment(seed.source, displayOrigin, point)
      if (planeHits.some(hit => hit.component.kind === 'aperture' && Math.abs(hit.distance - closest!.distance) < EPSILON && (hit.component.opening <= EPSILON || Math.abs(hit.transverse) > hit.component.opening / 2 + EPSILON))) break
      if (component.kind === 'screen') {
        result.screenHits.push({ componentId: component.id, point, wavelength: seed.source.wavelength, intensity: 1 })
        break
      }
      if (component.kind === 'aperture') {
        if (component.opening <= EPSILON || Math.abs(transverse) > component.opening / 2 + EPSILON) break
      } else if (component.kind === 'plane-mirror') {
        traversed.push(component.id)
        direction = reflected(direction, normal)
        if (scene.settings.showVirtual) segment(seed.source, point, endAtBounds(point, scale(direction, -1), bounds), true)
        previousOpticalInteractions++
      } else if (isLens(component)) {
        traversed.push(component.id)
        const axis = axes(component), incomingX = dot(direction, axis.x)
        // Transverse slope is measured against distance travelled, valid from either side.
        const slope = dot(direction, axis.y) / Math.abs(incomingX) - transverse / focalLength(component)
        direction = unit(add(scale(axis.x, Math.sign(incomingX)), scale(axis.y, slope)))
        const objectDistance = Math.abs(local(component, seed.origin).x)
        const virtual = component.kind === 'concave-lens' || (previousOpticalInteractions === 0 && seed.source.kind !== 'parallel-source' && seed.source.kind !== 'laser' && objectDistance < focalLength(component) - EPSILON)
        const image = imageByLens.get(JSON.stringify([seed.source.id, component.id]))
        if (scene.settings.showVirtual && image?.nature === 'virtual' && image.imagePoint && image.lensIds?.length === traversed.length && image.lensIds.every((id, index) => id === traversed[index])) {
          const extension = sub(image.imagePoint, point)
          // Only actual reverse continuations may meet an analytic virtual image.
          if (dot(extension, direction) < 0 && Math.abs(cross(unit(extension), direction)) < 1e-5) segment(seed.source, point, image.imagePoint, true)
        } else if (scene.settings.showVirtual && !image && virtual) segment(seed.source, point, endAtBounds(point, scale(direction, -1), bounds), true)
        previousOpticalInteractions++
      } else if (isGlass(component)) {
        traversed.push(component.id)
        const before = mediumAt(add(point, scale(direction, -OFFSET)), glass), after = mediumAt(add(point, scale(direction, OFFSET)), glass)
        const transmitted = refracted(direction, normal, before, after)
        if (transmitted) direction = transmitted
        else { direction = reflected(direction, normal); warnings.add('发生全反射：光线在介质内部继续传播。') }
        previousOpticalInteractions++
      }
      displayOrigin = point
      origin = add(point, scale(direction, OFFSET))
      if (bounce === OPTICS_LIMITS.maxInteractions - 1) warnings.add('部分光线达到 32 次交互上限，已停止追踪。')
    }
  }
  result.warnings = [...warnings]
  return result
}

/** Successive images for coaxial lenses, including virtual objects and afocal stages. */
export function measureImages(input: OpticsScene): ImageMeasurement[] {
  return measureLensChains(parseOpticsScene(input).components.filter(c => c.enabled))
}

function measureLensChains(components: OpticalComponent[]): ImageMeasurement[] {
  // Reflected and refracted paths still trace geometrically; this analytic
  // readout is reserved for a straight, common-axis train of thin lenses.
  if (components.some(c => isGlass(c) || c.kind === 'plane-mirror')) return []
  const measurements: ImageMeasurement[] = []
  for (const source of components.filter(c => ['object', 'point-source', 'parallel-source'].includes(c.kind))) {
    const axis = axes(source)
    const forward = components.filter(c => isLens(c) && local(source, c).x > EPSILON)
    if (forward.some(c => Math.abs(local(source, c).y) > .05 || Math.abs(dot(axis.x, axes(c).x)) < .99999)) continue
    const lenses = forward.sort((a, b) => local(source, a).x - local(source, b).x)
    if (!lenses.length) continue
    const stopDistances = components.filter(c => c.kind === 'screen' || (c.kind === 'aperture' && c.opening <= EPSILON))
      .flatMap(c => { const hit = planeHit(source, axis.x, c); return hit ? [hit.distance] : [] })
    const stop = Math.min(Infinity, ...stopDistances)
    const reachable = lenses.filter(c => local(source, c).x < stop - EPSILON)
    // Coincident powered surfaces require a combined surface model.
    if (reachable.some((lens, index) => index > 0 && Math.abs(local(source, lens).x - local(source, reachable[index - 1]).x) < EPSILON)) continue
    const parallel = source.kind === 'parallel-source'
    const objectHeight = source.kind === 'object' ? -source.height : 0
    let a = 1, b = 0, c = 0, d = 1, position = 0
    for (const [index, lens] of reachable.entries()) {
      const lensPosition = local(source, lens).x, travel = lensPosition - position
      // Ray-transfer propagation stays well defined for an intermediate image
      // at infinity or exactly on a subsequent lens.
      a += travel * c; b += travel * d
      const incomingHeight = parallel ? a : b, incomingSlope = parallel ? c : d
      const objectDistance = Math.abs(incomingSlope) < EPSILON ? Infinity : incomingHeight / incomingSlope
      c -= a / focalLength(lens); d -= b / focalLength(lens)
      const heightCoefficient = parallel ? a : b, slopeCoefficient = parallel ? c : d
      const infinite = Math.abs(slopeCoefficient) < 1e-10
      const imageDistance = infinite ? null : -heightCoefficient / slopeCoefficient
      const magnification = infinite || parallel ? null : a + imageDistance! * c
      const nature: ImageMeasurement['nature'] = infinite ? 'infinity' : imageDistance! >= 0 ? 'real' : 'virtual'
      const nextDistance = index + 1 < reachable.length ? local(source, reachable[index + 1]).x - lensPosition : Infinity
      const intercepted = nature === 'real' && imageDistance! > nextDistance + EPSILON
      const imageBase = infinite || intercepted ? null : add(lens, scale(axis.x, imageDistance!))
      const imagePoint = imageBase ? add(imageBase, scale(axis.y, parallel ? 0 : magnification! * objectHeight)) : null
      const prefix = index === reachable.length - 1 ? '最终' : reachable.length > 2 ? `第 ${index + 1} 级` : '中间'
      const caption = reachable.length > 1 || parallel
        ? `${prefix}${nature === 'infinity' ? '像在无穷远' : nature === 'real' ? '实像' : '虚像'}${intercepted ? '（被后续透镜截取）' : ''}`
        : undefined
      measurements.push({
        lensId: lens.id, lensIds: reachable.slice(0, index + 1).map(c => c.id), objectId: source.id,
        objectDistance, imageDistance, magnification, imageBase, imagePoint, nature, caption,
      })
      position = lensPosition
    }
  }
  return measurements
}

/** Visible wavelength color only; the ideal material model does not include dispersion. */
export function wavelengthColor(wavelength: number): string {
  const w = Math.max(380, Math.min(780, wavelength))
  let red = 0, green = 0, blue = 0
  if (w < 440) { red = -(w - 440) / 60; blue = 1 }
  else if (w < 490) { green = (w - 440) / 50; blue = 1 }
  else if (w < 510) { green = 1; blue = -(w - 510) / 20 }
  else if (w < 580) { red = (w - 510) / 70; green = 1 }
  else if (w < 645) { red = 1; green = -(w - 645) / 65 }
  else red = 1
  return `rgb(${[red, green, blue].map(channel => Math.round(255 * Math.pow(channel, 0.8))).join(', ')})`
}
