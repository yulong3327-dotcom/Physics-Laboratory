/** World coordinates and all lengths are centimetres; angles are degrees clockwise in SVG space. */
export type OpticsKind = 'parallel-source' | 'point-source' | 'laser' | 'object' | 'convex-lens' | 'concave-lens' | 'plane-mirror' | 'concave-mirror' | 'convex-mirror' | 'screen' | 'aperture' | 'glass-slab' | 'prism'

export interface Vec2 { x: number; y: number }
export interface OpticalComponent {
  id: string
  kind: OpticsKind
  label: string
  x: number
  y: number
  /** Local positive x is the optical axis / emitting direction; a laser emits at (x, y). */
  angle: number
  /** Full height of the component, or the emitted parallel beam width. */
  height: number
  focalLength: number
  rayCount: number
  spread: number
  wavelength: number
  refractiveIndex: number
  width: number
  /** Opening height of an aperture. */
  opening: number
  enabled: boolean
}

export interface OpticsSettings {
  showGrid: boolean
  showAxis: boolean
  showFoci: boolean
  showVirtual: boolean
  showLabels: boolean
  animate: boolean
  snap: boolean
}
export interface OpticsScene {
  schemaVersion: 1
  kind: 'optics-lab'
  title: string
  components: OpticalComponent[]
  settings: OpticsSettings
}
export interface OpticalDefinition {
  kind: OpticsKind
  name: string
  nameEn: string
  category: 'sources' | 'lenses' | 'reflectors' | 'tools'
  description: string
  defaults: Partial<OpticalComponent>
}
export interface RaySegment {
  from: Vec2
  to: Vec2
  sourceId: string
  wavelength: number
  intensity: number
  virtual?: boolean
}
export interface ScreenHit { componentId: string; point: Vec2; wavelength: number; intensity: number }
export interface OpticsSimulation {
  segments: RaySegment[]
  screenHits: ScreenHit[]
  warnings: string[]
  emittedRays: number
}
export interface ImageMeasurement {
  lensId: string
  /** Lens sequence traversed from the original source to this image stage. */
  lensIds?: string[]
  objectId: string
  objectDistance: number
  imageDistance: number | null
  magnification: number | null
  imagePoint: Vec2 | null
  imageBase: Vec2 | null
  nature: 'real' | 'virtual' | 'infinity'
  caption?: string
  /** Spherical-mirror Gaussian estimate; exact traced rays may show aberration. */
  approximate?: boolean
}
