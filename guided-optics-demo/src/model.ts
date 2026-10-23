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
export type SceneOptions = { focal?: number; height?: number; glasses?: 'none'|'near'|'far'; cover?: number; swapped?: boolean }
export function optics(u: number, screen: number, parallel: boolean, throughLens: boolean, options?: SceneOptions) {
  const focal = options?.focal ?? FOCAL, sign = options?.swapped ? -1 : 1
  const object = component('candle', 'object', LENS_X - sign*u, options ? AXIS_Y+(options.height??0)+sign*FLAME_HALF_HEIGHT : AXIS_Y, { height: FLAME_HALF_HEIGHT, angle: sign===1?0:180, rayCount: options?.cover?11:options?.glasses&&options.glasses!=='none'?9:3 })
  const lens = component('lens', 'convex-lens', LENS_X, AXIS_Y, {focalLength:focal})
  const screenComponent = component('screen', 'screen', LENS_X + sign*screen, AXIS_Y, { height: 26 })
  const source = parallel ? component('source', 'parallel-source', 7, AXIS_Y, { height: 7, rayCount: 5 }) : object
  const lenses = options?.glasses && options.glasses!=='none' ? [component('spectacle',options.glasses==='near'?'concave-lens':'convex-lens',LENS_X-3,AXIS_Y,{focalLength:options.glasses==='near'?-40:40}),lens] : [lens]
  const stop = options?.cover ? [component('cover','aperture',LENS_X,AXIS_Y,{opening:26*(1-options.cover/100)})] : []
  const scene: OpticsScene = {
    schemaVersion: 1, kind: 'optics-lab', title: '凸透镜成像规律',
    settings: { showGrid: true, showAxis: true, showFoci: true, showVirtual: throughLens, showLabels: true, animate: true, snap: false },
    components: [source, ...lenses, ...stop, ...throughLens ? [] : [screenComponent]],
  }
  const images = measureImages({ ...scene, components: [parallel?source:object, ...lenses] })
  const image = images[images.length-1]
  const simulation = simulateOptics(scene)
  const v = image?.imageDistance ?? Infinity
  const slopeSpread = Math.abs(1 - screen/v)
  const blur = parallel ? Math.min(18, Math.abs(screen - focal) * 2) : Math.min(22, slopeSpread * 18)
  const imageY = image?.imagePoint?.y ?? AXIS_Y
  return { ...simulation, v, magnification: image?.magnification ?? 0, imageY, brightness:1-(options?.cover??0)/100, blur, focused: parallel ? Math.abs(screen - focal) <= 0.2 : v > 0 && Number.isFinite(v) && Math.abs(screen - v) <= 0.25 }
}
