import { nanoid } from 'nanoid'
import type { OpticalComponent, OpticalDefinition, OpticsKind, OpticsScene, OpticsSettings } from './types'

export type OpticalOrientation = 'horizontal' | 'vertical'

/** Map a user-facing optical-axis direction to the component rotation angle. */
export function opticalOrientationAngle(_component: Pick<OpticalComponent, 'kind'>, orientation: OpticalOrientation): number {
  return orientation === 'horizontal' ? 0 : 90
}

/** Infer the nearest cardinal optical-axis direction from a component angle. */
export function opticalOrientation(component: Pick<OpticalComponent, 'kind' | 'angle'>): OpticalOrientation {
  const angle = ((component.angle % 180) + 180) % 180
  return angle < 45 || angle >= 135 ? 'horizontal' : 'vertical'
}

export const OPTICS_LIMITS = {
  maxComponents: 100, maxRaysPerSource: 41, maxTotalRays: 512, maxInteractions: 32,
  coordinate: 1000, maxLength: 200, minLength: 0.2, maxFocalLength: 500, minFocalLength: 0.5,
} as const

function definition(kind: OpticsKind, name: string, nameEn: string, category: OpticalDefinition['category'], description: string, defaults: Partial<OpticalComponent>): OpticalDefinition {
  return { kind, name, nameEn, category, description, defaults }
}

export const opticalLibrary: Record<OpticsKind, OpticalDefinition> = {
  'parallel-source': definition('parallel-source', '平行光源', 'Parallel source', 'sources', '发射一束平行光，可调光束宽度、条数和颜色。', { height: 16, rayCount: 9, spread: 0 }),
  'point-source': definition('point-source', '点光源', 'Point source', 'sources', '从一点发出扇形光束，可调发散角和光线条数。', { height: 4, rayCount: 11, spread: 50 }),
  laser: definition('laser', '激光笔', 'Laser pointer', 'sources', '从笔尖发射一条直线光束，可调方向和颜色，用于反射与折射实验。', { height: 3, width: 12, rayCount: 1, spread: 0, wavelength: 650 }),
  object: definition('object', '物体箭头', 'Object', 'sources', '箭头顶端发出成像光线，用于观察实像和虚像。', { height: 8, rayCount: 3 }),
  'convex-lens': definition('convex-lens', '凸透镜', 'Convex lens', 'lenses', '会聚光线的理想薄透镜，可调焦距和口径。', { height: 26, focalLength: 12, width: 2 }),
  'concave-lens': definition('concave-lens', '凹透镜', 'Concave lens', 'lenses', '发散光线的理想薄透镜，焦距按负值计算。', { height: 26, focalLength: -12, width: 2 }),
  'plane-mirror': definition('plane-mirror', '平面镜', 'Plane mirror', 'reflectors', '无斜线侧为反射面，遵循反射定律并形成等大虚像；背面不透光。', { height: 26, width: 1 }),
  'concave-mirror': definition('concave-mirror', '凹面镜', 'Concave mirror', 'reflectors', '按球面实际法线反射，近轴焦距为正；无斜线侧反射，背面不透光。', { height: 18, focalLength: 12, width: 2 }),
  'convex-mirror': definition('convex-mirror', '凸面镜', 'Convex mirror', 'reflectors', '按球面实际法线反射，近轴焦距为负；无斜线侧反射，背面不透光。', { height: 18, focalLength: -12, width: 2 }),
  screen: definition('screen', '光屏', 'Screen', 'tools', '接收并阻挡光线，显示光线落点。', { height: 30, width: 1 }),
  aperture: definition('aperture', '光阑', 'Aperture', 'tools', '只允许穿过中央开口的光线通过。', { height: 26, opening: 10, width: 1 }),
  'glass-slab': definition('glass-slab', '平行玻璃板', 'Glass slab', 'lenses', '在平行界面按折射定律传播，可调厚度和折射率。', { height: 28, width: 10, refractiveIndex: 1.5 }),
  prism: definition('prism', '三棱镜', 'Prism', 'lenses', '光线在三角形玻璃内折射，也可产生全反射。', { height: 26, width: 24, refractiveIndex: 1.5 }),
}

export const opticalOrder: OpticsKind[] = ['parallel-source', 'point-source', 'laser', 'object', 'convex-lens', 'concave-lens', 'plane-mirror', 'concave-mirror', 'convex-mirror', 'glass-slab', 'prism', 'screen', 'aperture']
export const categoryNames = { sources: '光源与物体', lenses: '透镜与介质', reflectors: '反射组件', tools: '实验工具' } as const

export function createOpticalComponent(kind: OpticsKind, x = 0, y = 0): OpticalComponent {
  if (!Object.prototype.hasOwnProperty.call(opticalLibrary, kind)) throw new Error('不支持的光学组件类型。')
  return {
    id: `opt-${nanoid(10)}`, kind, label: opticalLibrary[kind].name, x, y, angle: 0,
    height: 12, focalLength: 12, rayCount: 9, spread: 50, wavelength: 590,
    refractiveIndex: 1.5, width: 2, opening: 10, enabled: true,
    ...opticalLibrary[kind].defaults,
  }
}

const defaultSettings: OpticsSettings = { showGrid: true, showAxis: true, showFoci: true, showVirtual: true, showLabels: true, animate: true, snap: true }
function sceneWith(title: string, components: OpticalComponent[]): OpticsScene {
  return { schemaVersion: 1, kind: 'optics-lab', title, components, settings: { ...defaultSettings } }
}
export function createOpticsScene(): OpticsScene {
  return sceneWith('凸透镜成像实验', [createOpticalComponent('object', 20, 34), createOpticalComponent('convex-lens', 50, 34), createOpticalComponent('screen', 70, 34)])
}

export const opticsPresets: { id: string; name: string; description: string; create(): OpticsScene }[] = [
  { id: 'convex', name: '凸透镜成像', description: '物距 30 cm，焦距 12 cm，观察倒立、缩小的实像。', create: createOpticsScene },
  { id: 'concave', name: '凹透镜发散', description: '平行光通过凹透镜后发散，延长线交于虚焦点。', create: () => sceneWith('凹透镜发散实验', [createOpticalComponent('parallel-source', 15, 34), createOpticalComponent('concave-lens', 50, 34)]) },
  { id: 'virtual', name: '放大镜与虚像', description: '物体放在焦点以内，形成正立、放大的虚像。', create: () => sceneWith('凸透镜虚像实验', [{ ...createOpticalComponent('object', 42, 34), height: 5 }, createOpticalComponent('convex-lens', 50, 34)]) },
  { id: 'concave-image', name: '凹透镜成像', description: '观察凹透镜形成的正立、缩小虚像。', create: () => sceneWith('凹透镜成像实验', [createOpticalComponent('object', 20, 34), createOpticalComponent('concave-lens', 50, 34)]) },
  { id: 'mirror', name: '平面镜反射', description: '旋转镜面，观察入射角与反射角的变化。', create: () => sceneWith('平面镜反射实验', [{ ...createOpticalComponent('parallel-source', 18, 24), height: 10, rayCount: 5, angle: 15 }, { ...createOpticalComponent('plane-mirror', 55, 34), angle: -25, height: 34 }]) },
  { id: 'plane-image', name: '平面镜成像', description: '物体与虚像关于镜面对称，观察等大的正立虚像。', create: () => sceneWith('平面镜成像实验', [{ ...createOpticalComponent('object', 30, 35), height: 6 }, createOpticalComponent('plane-mirror', 55, 34)]) },
  { id: 'concave-mirror', name: '凹面镜成像', description: '观察凹面镜的倒立实像；移近焦点以内可得到放大的虚像。成像箭头为近轴估计。', create: () => sceneWith('凹面镜成像实验', [{ ...createOpticalComponent('object', 24, 34), height: 3 }, { ...createOpticalComponent('concave-mirror', 60, 34), height: 12 }]) },
  { id: 'convex-mirror', name: '凸面镜成像', description: '凸面镜使光线发散，反向延长线在镜后形成缩小的虚像。成像箭头为近轴估计。', create: () => sceneWith('凸面镜成像实验', [{ ...createOpticalComponent('object', 24, 34), height: 3 }, { ...createOpticalComponent('convex-mirror', 60, 34), height: 12 }]) },
  { id: 'laser', name: '激光笔反射', description: '激光照向平面镜，反射光落在光屏上；旋转激光笔或镜面观察光路。', create: () => sceneWith('激光笔反射实验', [createOpticalComponent('laser', 18, 34), { ...createOpticalComponent('plane-mirror', 55, 34), angle: -30 }, { ...createOpticalComponent('screen', 43, 34 + 12 * Math.sqrt(3)), angle: -60, height: 20 }]) },
  { id: 'slab', name: '玻璃板折射', description: '斜入射光通过平行玻璃板后产生侧向位移。', create: () => sceneWith('平行玻璃板折射实验', [{ ...createOpticalComponent('parallel-source', 16, 18), height: 7, rayCount: 5, angle: 25 }, { ...createOpticalComponent('glass-slab', 50, 34), height: 34 }]) },
  { id: 'prism', name: '三棱镜折射', description: '观察光线在三棱镜两侧折射；可调折射率和入射方向。', create: () => sceneWith('三棱镜折射实验', [{ ...createOpticalComponent('parallel-source', 15, 33), height: 5, rayCount: 5 }, createOpticalComponent('prism', 50, 34)]) },
  { id: 'microscope', name: '显微镜原理', description: '两枚凸透镜分别作为物镜和目镜，观察中间实像和最终放大的虚像。', create: () => sceneWith('显微镜原理实验', [
    { ...createOpticalComponent('object', 20, 34), height: 1, rayCount: 3 },
    { ...createOpticalComponent('convex-lens', 25.5, 34), label: '物镜', focalLength: 4, height: 10 },
    { ...createOpticalComponent('convex-lens', 45.5, 34), label: '目镜', focalLength: 6, height: 12 },
  ]) },
  { id: 'telescope', name: '望远镜原理', description: '两枚凸透镜组成开普勒望远镜，可分别移动、旋转并调整物镜和目镜的焦距。', create: () => sceneWith('望远镜原理实验', [
    { ...createOpticalComponent('parallel-source', 12, 34), height: 10, rayCount: 7 },
    { ...createOpticalComponent('convex-lens', 39, 34), label: '物镜', focalLength: 24, height: 20 },
    { ...createOpticalComponent('convex-lens', 71, 34), label: '目镜', focalLength: 8, height: 12 },
  ]) },
]

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
function boundedNumber(record: Record<string, unknown>, key: string, min: number, max: number): number {
  const value = record[key]
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`组件参数 ${key} 必须在 ${min} 到 ${max} 之间。`)
  return value
}
function boundedText(value: unknown, field: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) throw new Error(`${field}必须是${max}字以内的文本。`)
  return value
}

/** Validate every persisted field and return a fresh, whitelisted scene. */
export function parseOpticsScene(input: unknown): OpticsScene {
  let value = input
  if (typeof value === 'string') {
    if (value.length > 250_000) throw new Error('光学实验文件过大。')
    try { value = JSON.parse(value) } catch { throw new Error('无法读取 JSON 光学实验文件。') }
  }
  if (!isRecord(value) || value.kind !== 'optics-lab' || value.schemaVersion !== 1) throw new Error('这不是受支持的光学实验文件。')
  if (!Array.isArray(value.components) || value.components.length > OPTICS_LIMITS.maxComponents) throw new Error('光学实验最多支持 100 个组件。')
  const title = boundedText(value.title, '实验名称', 120)
  if (!isRecord(value.settings)) throw new Error('光学实验显示设置无效。')
  const settings = {} as OpticsSettings
  for (const key of Object.keys(defaultSettings) as (keyof OpticsSettings)[]) {
    if (typeof value.settings[key] !== 'boolean') throw new Error('光学实验显示设置必须为开关值。')
    settings[key] = value.settings[key]
  }
  const seen = new Set<string>()
  const validated = value.components.map(raw => {
    if (!isRecord(raw) || typeof raw.kind !== 'string') throw new Error('实验中包含不支持的光学组件。')
    const legacyKind = raw.kind === 'microscope' || raw.kind === 'telescope' ? raw.kind : null
    if (!legacyKind && !Object.prototype.hasOwnProperty.call(opticalLibrary, raw.kind)) throw new Error('实验中包含不支持的光学组件。')
    const kind = legacyKind ? 'convex-lens' : raw.kind as OpticsKind
    const id = boundedText(raw.id, '组件标识', 80)
    if (seen.has(id)) throw new Error('组件标识重复。')
    seen.add(id)
    const label = boundedText(raw.label, '组件名称', 60, true)
    if (typeof raw.enabled !== 'boolean') throw new Error('组件启用状态无效。')
    const rawFocalLength = boundedNumber(raw, 'focalLength', -500, 500)
    if (Math.abs(rawFocalLength) < 0.5) throw new Error('焦距绝对值必须至少为 0.5 cm。')
    const focalLength = kind === 'convex-lens' || kind === 'concave-mirror' ? Math.abs(rawFocalLength)
      : kind === 'concave-lens' || kind === 'convex-mirror' ? -Math.abs(rawFocalLength) : rawFocalLength
    // Earlier schema 1 drafts stored a compound instrument as one component.
    // Only those legacy entries use a second focal length; ordinary entries
    // discard this retired field while returning the current whitelist.
    let secondaryFocalLength: number | undefined
    if (legacyKind) {
      secondaryFocalLength = raw.secondaryFocalLength === undefined
        ? legacyKind === 'microscope' ? 6 : 8
        : Math.abs(boundedNumber(raw, 'secondaryFocalLength', -500, 500))
      if (secondaryFocalLength < 0.5) throw new Error('第二焦距绝对值必须至少为 0.5 cm。')
    }
    const rayCount = boundedNumber(raw, 'rayCount', 1, 41)
    if (!Number.isInteger(rayCount)) throw new Error('光线条数必须为整数。')
    const spread = boundedNumber(raw, 'spread', 0, 160)
    const height = boundedNumber(raw, 'height', 0.2, 200)
    if ((kind === 'concave-mirror' || kind === 'convex-mirror') && height > 4 * Math.abs(focalLength)) throw new Error('球面镜口径不能超过球面直径 4|f|。')
    const opening = boundedNumber(raw, 'opening', 0, 200)
    if ((kind === 'aperture' || legacyKind) && opening > height) throw new Error('光阑开口不能大于组件高度。')
    const component: OpticalComponent = {
      id, kind, label, enabled: raw.enabled,
      x: boundedNumber(raw, 'x', -1000, 1000), y: boundedNumber(raw, 'y', -1000, 1000),
      angle: boundedNumber(raw, 'angle', -360, 360), height, focalLength, rayCount: kind === 'laser' ? 1 : rayCount,
      spread: kind === 'laser' ? 0 : spread, wavelength: boundedNumber(raw, 'wavelength', 380, 780),
      refractiveIndex: boundedNumber(raw, 'refractiveIndex', 1, 3), width: boundedNumber(raw, 'width', 0.2, 200), opening,
    }
    return { component, legacyKind, secondaryFocalLength }
  })
  const expandedCount = validated.reduce((count, item) => count + (item.legacyKind ? 4 : 1), 0)
  if (expandedCount > OPTICS_LIMITS.maxComponents) throw new Error('光学实验最多支持 100 个组件，旧仪器展开后的数量超出上限。')
  // Reserve every original ID before assigning deterministic migration IDs,
  // including IDs from entries that occur later in the file.
  const childId = (parent: string, part: string): string => {
    let attempt = 0
    while (true) {
      const suffix = `:${part}${attempt ? `-${attempt}` : ''}`
      const id = `${parent.slice(0, 80 - suffix.length)}${suffix}`
      if (!seen.has(id)) { seen.add(id); return id }
      attempt++
    }
  }
  const components = validated.flatMap(({ component, legacyKind, secondaryFocalLength }): OpticalComponent[] => {
    if (!legacyKind) return [component]
    const angle = ((component.angle + (legacyKind === 'microscope' ? -90 : 0) + 540) % 360) - 180
    const radians = angle * Math.PI / 180
    return [-1, 1].flatMap((side, index) => {
      const part = index === 0 ? 'objective' : 'eyepiece'
      const partLabel = index === 0 ? '物镜' : '目镜'
      const x = component.x + Math.cos(radians) * side * component.width / 2
      const y = component.y + Math.sin(radians) * side * component.width / 2
      if (Math.abs(x) > OPTICS_LIMITS.coordinate || Math.abs(y) > OPTICS_LIMITS.coordinate) throw new Error('旧仪器展开后的透镜位置超出允许范围。')
      const plane = { ...component, x, y, angle, width: OPTICS_LIMITS.minLength }
      const lens: OpticalComponent = {
        ...plane, id: childId(component.id, part), kind: 'convex-lens',
        label: `${component.label.slice(0, 57)}·${partLabel}`,
        focalLength: index === 0 ? component.focalLength : secondaryFocalLength!,
      }
      const aperture: OpticalComponent = {
        ...plane, id: childId(component.id, `${part}-aperture`), kind: 'aperture',
        label: `${component.label.slice(0, 55)}·${partLabel}光阑`,
      }
      // The colocated stop preserves a partially or fully closed legacy pupil.
      return [aperture, lens]
    })
  })
  return { schemaVersion: 1, kind: 'optics-lab', title, components, settings }
}
