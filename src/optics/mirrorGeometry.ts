import type { OpticalComponent, Vec2 } from './types'

export const isCurvedMirror = (c: OpticalComponent) => c.kind === 'concave-mirror' || c.kind === 'convex-mirror'
export const isMirror = (c: OpticalComponent) => c.kind === 'plane-mirror' || isCurvedMirror(c)
export const mirrorFocalLength = (c: OpticalComponent) => (c.kind === 'convex-mirror' ? -1 : 1) * Math.abs(c.focalLength)

/** A circular cross-section with its vertex at (0, 0), reflective side toward -x. */
export function mirrorSurface(c: OpticalComponent, y: number): { point: Vec2; frontNormal: Vec2 } {
  if (!isCurvedMirror(c)) return { point: { x: 0, y }, frontNormal: { x: -1, y: 0 } }
  const radius = 2 * mirrorFocalLength(c), r = Math.abs(radius)
  const root = Math.sqrt(Math.max(0, r * r - y * y))
  // This form avoids subtracting nearly equal radii near the vertex.
  const x = -Math.sign(radius) * y * y / (r + root)
  return { point: { x, y }, frontNormal: { x: -root / r, y: -y / radius } }
}

export function mirrorPath(c: OpticalComponent): string {
  const h = c.height / 2
  if (!isCurvedMirror(c)) return `M0 ${-h}V${h}`
  const radius = 2 * Math.abs(c.focalLength), x = mirrorSurface(c, h).point.x
  return `M${x} ${-h}A${radius} ${radius} 0 0 ${c.kind === 'concave-mirror' ? 1 : 0} ${x} ${h}`
}
