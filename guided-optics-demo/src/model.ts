import { simulateOptics, measureImages } from './optics/simulation'
import type { OpticalComponent, OpticsScene } from './optics/types'

export const FOCAL = 10
export const LENS_X = 46
export const AXIS_Y = 25
export const FLAME_HALF_HEIGHT = 1.4

function component(id: string, kind: OpticalComponent['kind'], x: number, y: number, overrides: Partial<OpticalComponent> = {}): OpticalComponent {
  return { id, kind, label: '', x, y, angle: 0, height: 26, focalLength: FOCAL, rayCount: 3, spread: 0, wavelength: 650, refractiveIndex: 1.5, width: 2, opening: 25, enabled: true, ...overrides }
}

// The same optical engine as the existing free-form laboratory drives this guided scene.
export function optics(u: number, screen: number, parallel: boolean, throughLens: boolean) {
  const object = component('candle', 'object', LENS_X - u, AXIS_Y, { height: FLAME_HALF_HEIGHT })
  const lens = component('lens', 'convex-lens', LENS_X, AXIS_Y)
  const screenComponent = component('screen', 'screen', LENS_X + screen, AXIS_Y, { height: 26 })
  const source = parallel ? component('source', 'parallel-source', 7, AXIS_Y, { height: 7, rayCount: 5 }) : object
  const scene: OpticsScene = {
    schemaVersion: 1, kind: 'optics-lab', title: '凸透镜成像规律',
    settings: { showGrid: true, showAxis: true, showFoci: true, showVirtual: throughLens, showLabels: true, animate: true, snap: false },
    components: [source, lens, ...throughLens ? [] : [screenComponent]],
  }
  const image = measureImages({ ...scene, components: [object, lens] })[0]
  const simulation = simulateOptics(scene)
  const v = image?.imageDistance ?? Infinity
  const slopeSpread = Math.abs(1 - screen / FOCAL + screen / u)
  const blur = parallel ? Math.min(18, Math.abs(screen - FOCAL) * 2) : Math.min(22, slopeSpread * 18)
  return { ...simulation, v, magnification: image?.magnification ?? 0, blur, focused: parallel ? Math.abs(screen - FOCAL) <= 0.2 : v > 0 && Number.isFinite(v) && Math.abs(screen - v) <= 0.25 }
}
