import { componentLibrary } from './componentLibrary'
import type { CircuitComponent, ComponentType, Orientation, Terminal, ViewMode } from '../types/circuit'

export interface ComponentPlacement { type: ComponentType; assetId?: string }
export interface PhysicalTerminal extends Terminal { virtual?: boolean; contact?: 'binding-post' | 'socket' | 'pin' }
export interface MeterDial {
  baseSrc: string
  pivot: { x: number; y: number }
  radius: number
  startAngle: number
  endAngle: number
  ranges: number[]
  unit: 'A' | 'V'
  centerZero?: boolean
}
export interface SliderVisual {
  baseSrc: string
  sliderSrc: string
  left: number
  right: number
  top: number
  width: number
  height: number
}
export interface SwitchVisual {
  baseSrc: string
  bladeSrc: string
  pivot: { x: number; y: number }
  openAngle: number
  closedAngle: number
  boundsTop: number
}
export interface LampVisual {
  baseSrc: string
  glowSrc: string
  defaultBrightness: number
  fixedRegionTop: number
}
export interface PhysicalAsset {
  id: string
  type: ComponentType
  name: string
  src: string
  width: number
  height: number
  sourceWidth: number
  sourceHeight: number
  terminals: PhysicalTerminal[]
  switchClosed?: boolean
  connectionNote?: string
  meterDial?: MeterDial
  sliderVisual?: SliderVisual
  switchVisual?: SwitchVisual
  lampVisual?: LampVisual
  stateImages?: { onSrc: string; offSrc: string }
}

type Anchor = { id: string; x: number; y: number; dir: Terminal['dir']; label?: string; virtual?: boolean; contact?: PhysicalTerminal['contact'] }
const baseUrl = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'
const publicAsset = (path: string) => `${baseUrl}${path.replace(/^\//, '')}`

// Coordinates are measured in the cropped PNG, before display scaling or rotation.
function defineAsset(id: string, type: ComponentType, name: string, sourceWidth: number, sourceHeight: number, width: number, anchors: Anchor[], options: Pick<PhysicalAsset, 'switchClosed' | 'connectionNote' | 'meterDial' | 'sliderVisual' | 'switchVisual' | 'lampVisual' | 'stateImages'> = {}): PhysicalAsset {
  const scale = width / sourceWidth
  return {
    id, type, name, src: publicAsset(`/assets/components/${id}.png`), sourceWidth, sourceHeight,
    width, height: sourceHeight * scale, ...options,
    terminals: anchors.map(anchor => ({
      id: anchor.id, label: anchor.label || componentLibrary[type].terminals.find(term => term.id === anchor.id)?.label,
      dx: (anchor.x - sourceWidth / 2) * scale, dy: (anchor.y - sourceHeight / 2) * scale,
      dir: anchor.dir, virtual: anchor.virtual, contact: anchor.contact,
    })),
  }
}

export const physicalAssetList: PhysicalAsset[] = [
  defineAsset('battery-pack', 'battery', '双节电池组', 174, 47, 170, [
    { id: 'positive', x: 9, y: 24, dir: 'left', label: '+' },
    { id: 'negative', x: 166, y: 24, dir: 'right', label: '-' },
  ]),
  defineAsset('battery-single', 'battery', '单节电池座', 118, 47, 150, [
    { id: 'positive', x: 6, y: 25, dir: 'left', label: '+', contact: 'binding-post' },
    { id: 'negative', x: 111, y: 25, dir: 'right', label: '-', contact: 'binding-post' },
  ]),
  defineAsset('power-supply', 'battery', '直流电源', 141, 107, 145, [
    { id: 'negative', x: 20, y: 20, dir: 'top', label: '-', contact: 'binding-post' },
    { id: 'positive', x: 120, y: 20, dir: 'top', label: '+', contact: 'binding-post' },
  ], { connectionNote: '电压由实验参数设置，图片未标注额定输出电压。' }),
  defineAsset('switch-open', 'switch', '开关（断开）', 127, 73, 140, [
    { id: 'left', x: 14, y: 43, dir: 'left' }, { id: 'right', x: 96, y: 43, dir: 'right' },
  ], { switchClosed: false, switchVisual: {
    baseSrc: publicAsset('/assets/components/dynamic/switch-open-base.png'), bladeSrc: publicAsset('/assets/components/dynamic/switch-open-blade.png'),
    pivot: { x: 26, y: 27 }, openAngle: 0, closedAngle: 12, boundsTop: 0,
  } }),
  defineAsset('switch-closed', 'switch', '开关（闭合）', 147, 63, 140, [
    { id: 'left', x: 13, y: 29, dir: 'left' }, { id: 'right', x: 107, y: 29, dir: 'right' },
  ], { switchClosed: true, switchVisual: {
    baseSrc: publicAsset('/assets/components/dynamic/switch-closed-base.png'), bladeSrc: publicAsset('/assets/components/dynamic/switch-closed-blade.png'),
    pivot: { x: 29, y: 12 }, openAngle: -12, closedAngle: 0, boundsTop: -24,
  } }),
  defineAsset('switch-spdt', 'switch_spdt', '单刀双掷开关', 136, 110, 140, [
    { id: 'left', x: 22, y: 84, dir: 'left', label: '左支路' },
    { id: 'common', x: 68, y: 84, dir: 'bottom', label: '公共端' },
    { id: 'right', x: 113, y: 84, dir: 'right', label: '右支路' },
  ]),
  defineAsset('lamp-bulb', 'lamp', '小灯泡（关闭）', 336, 311, 140, [
    { id: 'left', x: 45, y: 182, dir: 'left', label: '左接线柱' },
    { id: 'right', x: 289, y: 184, dir: 'right', label: '右接线柱' },
  ], { lampVisual: {
    baseSrc: publicAsset('/assets/components/lamp-bulb.png'), glowSrc: publicAsset('/assets/components/dynamic/lamp-bulb-glow.png'),
    defaultBrightness: 0, fixedRegionTop: 164,
  } }),
  defineAsset('lamp-on', 'lamp', '小灯泡（点亮）', 306, 306, 140, [
    { id: 'left', x: 43, y: 183, dir: 'left', label: '左接线柱' },
    { id: 'right', x: 262, y: 183, dir: 'right', label: '右接线柱' },
  ], { lampVisual: {
    baseSrc: publicAsset('/assets/components/dynamic/lamp-on-base.png'), glowSrc: publicAsset('/assets/components/dynamic/lamp-on-glow.png'),
    defaultBrightness: 1, fixedRegionTop: 164,
  } }),
  defineAsset('resistor', 'resistor', '定值电阻', 178, 73, 155, [
    { id: 'left', x: 30, y: 11, dir: 'left' }, { id: 'right', x: 149, y: 11, dir: 'right' },
  ]),
  defineAsset('rheostat', 'rheostat', '滑动变阻器', 206, 119, 190, [
    { id: 'a', x: 39, y: 59, dir: 'left', label: 'A 电阻丝端' },
    { id: 'b', x: 166, y: 59, dir: 'right', label: 'B 电阻丝端' },
    { id: 'c', x: 8, y: 15, dir: 'left', label: 'C 滑杆端' },
    { id: 'd', x: 196, y: 15, dir: 'right', label: 'D 滑杆端' },
  ], { connectionNote: 'C、D 为同一滑杆的两端。', sliderVisual: {
    baseSrc: publicAsset('/assets/components/dynamic/rheostat-base.png'),
    sliderSrc: publicAsset('/assets/components/dynamic/rheostat-slider.png'),
    left: 59, right: 147, top: 0, width: 30, height: 72,
  } }),
  defineAsset('potentiometer', 'potentiometer', '三端旋钮电位器', 85, 107, 95, [
    { id: 'a', x: 17, y: 98, dir: 'bottom', label: 'A 固定端（示意）', contact: 'pin' },
    { id: 'w', x: 43, y: 102, dir: 'bottom', label: 'W 滑动端（示意）', contact: 'pin' },
    { id: 'b', x: 65, y: 98, dir: 'bottom', label: 'B 固定端（示意）', contact: 'pin' },
  ], { connectionNote: 'A/W/B 为实验示意引脚分配，实物引脚功能应以器件资料或测量为准。' }),
  defineAsset('buzzer', 'buzzer', '两脚蜂鸣器', 76, 82, 90, [
    { id: 'left', x: 21, y: 78, dir: 'bottom', label: '接脚 1', contact: 'pin' },
    { id: 'right', x: 59, y: 78, dir: 'bottom', label: '接脚 2', contact: 'pin' },
  ], { connectionNote: '图片无法判断有源/无源及极性；仿真采用等效负载。' }),
  defineAsset('motor-fan', 'motor', '电动机（风扇）', 124, 124, 125, [
    { id: 'left', x: 17, y: 81, dir: 'left' }, { id: 'right', x: 107, y: 81, dir: 'right' },
  ]),
  defineAsset('motor-bare', 'motor', '电动机（裸机）', 129, 85, 135, [
    { id: 'left', x: 138, y: 24, dir: 'right', label: '示意接点 1', virtual: true },
    { id: 'right', x: 138, y: 65, dir: 'right', label: '示意接点 2', virtual: true },
  ], { connectionNote: '示意接点：图片未显示电气端子，虚线接点为编辑位置。' }),
  defineAsset('ammeter', 'ammeter', '电流表', 139, 175, 120, [
    { id: 'left', x: 28, y: 137, dir: 'bottom', label: '- 公共端', contact: 'binding-post' },
    { id: 'right', x: 68, y: 137, dir: 'bottom', label: '0.6 A', contact: 'binding-post' },
    { id: 'high', x: 108, y: 137, dir: 'bottom', label: '3 A', contact: 'binding-post' },
  ], { meterDial: {
    baseSrc: publicAsset('/assets/components/dynamic/ammeter-base.png'), pivot: { x: 68, y: 78 },
    radius: 68, startAngle: -140, endAngle: -40, ranges: [0.6, 3], unit: 'A',
  } }),
  defineAsset('voltmeter', 'voltmeter', '电压表', 139, 174, 120, [
    { id: 'right', x: 29, y: 137, dir: 'bottom', label: '- 公共端', contact: 'binding-post' },
    { id: 'left', x: 69, y: 137, dir: 'bottom', label: '3 V', contact: 'binding-post' },
    { id: 'high', x: 109, y: 137, dir: 'bottom', label: '15 V', contact: 'binding-post' },
  ], { meterDial: {
    baseSrc: publicAsset('/assets/components/dynamic/voltmeter-base.png'), pivot: { x: 69, y: 78 },
    radius: 68, startAngle: -140, endAngle: -40, ranges: [3, 15], unit: 'V',
  } }),
  defineAsset('galvanometer', 'galvanometer', '灵敏电流计', 134, 173, 110, [
    { id: 'left', x: 42, y: 144, dir: 'bottom', label: '-', contact: 'socket' },
    { id: 'right', x: 94, y: 144, dir: 'bottom', label: '+', contact: 'socket' },
  ]),
]

export const physicalAssets: Readonly<Record<string, PhysicalAsset>> = Object.fromEntries(physicalAssetList.map(asset => [asset.id, asset]))
const defaultAssets = new Map<ComponentType, PhysicalAsset>()
for (const asset of physicalAssetList) if (!defaultAssets.has(asset.type)) defaultAssets.set(asset.type, asset)

export function getPhysicalAsset(type: ComponentType, assetId?: string): PhysicalAsset | undefined {
  if (assetId === undefined) return defaultAssets.get(type)
  if (!Object.prototype.hasOwnProperty.call(physicalAssets, assetId)) return undefined
  const asset = physicalAssets[assetId]
  return asset.type === type ? asset : undefined
}

export function getComponentVisual(component: CircuitComponent, mode: ViewMode) {
  const asset = getPhysicalAsset(component.type, component.assetId)
  const def = componentLibrary[component.type]
  return mode === 'real' && asset
    ? { width: asset.width, height: asset.height, terminals: asset.terminals, asset }
    : { width: def.width, height: def.height, terminals: def.terminals as PhysicalTerminal[], asset: undefined }
}

export function getVisualOrientation(component: CircuitComponent, mode: ViewMode): Orientation {
  return mode === 'real' ? component.realOrientation ?? 'horizontal' : component.orientation
}
