import { getPhysicalAsset, type PhysicalAsset } from '../data/physicalAssets'
import { getComponentParameters, type ComponentSimulationResult } from './circuitSimulation'
import type { CircuitComponent } from '../types/circuit'

export function escapeSvg(value: string) { return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]!)) }

export function getPhysicalImageSource(component: CircuitComponent, asset: PhysicalAsset, state?: ComponentSimulationResult) {
  if (asset.meterDial) return asset.meterDial.baseSrc
  if (asset.sliderVisual) return asset.sliderVisual.baseSrc
  if (asset.switchVisual) return asset.switchVisual.baseSrc
  if (asset.lampVisual) return asset.lampVisual.baseSrc
  if (asset.stateImages && component.type === 'switch') return getComponentParameters(component).switchClosed ? asset.stateImages.onSrc : asset.stateImages.offSrc
  if (asset.stateImages && component.type === 'lamp' && state) return state.brightness > 0.005 ? asset.stateImages.onSrc : asset.stateImages.offSrc
  return asset.src
}

export function renderPhysicalOverlay(component: CircuitComponent, asset: PhysicalAsset, state?: ComponentSimulationResult) {
  const p = getComponentParameters(component)
  const parts: string[] = []
  if (asset.switchVisual) {
    const blade = asset.switchVisual
    const angle = p.switchClosed ? blade.closedAngle : blade.openAngle
    parts.push(`<image data-switch-blade="${p.switchClosed ? 'closed' : 'open'}" href="${escapeSvg(blade.bladeSrc)}" width="${asset.sourceWidth}" height="${asset.sourceHeight}" preserveAspectRatio="xMidYMid meet" transform="rotate(${angle} ${blade.pivot.x} ${blade.pivot.y})"/>`)
  }
  if (asset.lampVisual) {
    const lamp = asset.lampVisual
    const brightness = Math.max(0, Math.min(1, state?.brightness ?? lamp.defaultBrightness))
    parts.push(`<image data-lamp-glow="${brightness}" href="${escapeSvg(lamp.glowSrc)}" width="${asset.sourceWidth}" height="${asset.sourceHeight}" preserveAspectRatio="xMidYMid meet" opacity="${Math.sqrt(brightness)}"/>`)
  }
  if (component.type === 'lamp' && state?.lampStatus === 'overload') {
    parts.push(`<g data-lamp-status="overload"><title>灯泡过载：实际 ${Number(state.power.toPrecision(4))} W / 额定 ${state.ratedPower ?? p.ratedPower} W，有烧毁风险</title><rect x="3" y="3" width="${asset.sourceWidth - 6}" height="${asset.sourceHeight - 6}" rx="18" fill="none" stroke="#c4473b" stroke-width="6"/><circle cx="${asset.sourceWidth - 25}" cy="25" r="19" fill="#c4473b"/><text x="${asset.sourceWidth - 25}" y="34" text-anchor="middle" font-size="29" font-weight="bold" fill="white">!</text></g>`)
  }
  const dial = asset.meterDial
  if (dial) {
    const range = state?.range || p.meterRange
    const reading = p.meterMode === 'manual' ? p.manualReading : state?.reading ?? 0
    const fraction = dial.centerZero ? 0.5 + reading / (2 * range) : reading / range
    const angle = (dial.startAngle + (dial.endAngle - dial.startAngle) * Math.max(-0.06, Math.min(1.06, fraction))) * Math.PI / 180
    const x = dial.pivot.x + Math.cos(angle) * dial.radius
    const y = dial.pivot.y + Math.sin(angle) * dial.radius
    const stroke = state?.meterStatus === 'overload' ? '#c4473b' : '#353a3f'
    parts.push(`<g data-meter-needle="true" data-reading="${reading}" data-range="${range}"><line x1="${dial.pivot.x}" y1="${dial.pivot.y}" x2="${x}" y2="${y}" stroke="${stroke}" stroke-width="1.5" stroke-linecap="round"/><circle cx="${dial.pivot.x}" cy="${dial.pivot.y}" r="3.2" fill="#727a80" stroke="#e4e7e9" stroke-width="1"/></g>`)
  }
  if (asset.sliderVisual) {
    const slider = asset.sliderVisual
    const x = slider.left + (slider.right - slider.left) * p.sliderPosition - slider.width / 2
    parts.push(`<image data-slider-position="${p.sliderPosition}" href="${escapeSvg(slider.sliderSrc)}" x="${x}" y="${slider.top}" width="${slider.width}" height="${slider.height}"/>`)
  }
  if (component.type === 'potentiometer') {
    const angle = (-135 + p.sliderPosition * 270) * Math.PI / 180
    parts.push(`<line x1="42" y1="43" x2="${42 + Math.sin(angle) * 10}" y2="${43 - Math.cos(angle) * 10}" stroke="#126d87" stroke-width="3" stroke-linecap="round"/>`)
  }
  if ((component.type === 'buzzer' || component.type === 'motor') && state?.active) {
    parts.push(`<path d="M${asset.sourceWidth - 12} 14 q7 7 0 14 M${asset.sourceWidth - 7} 9 q12 12 0 24" fill="none" stroke="#087f72" stroke-width="2"/>`)
  }
  return parts.join('')
}

export function symbolOptions(component: CircuitComponent, state?: ComponentSimulationResult, vertical = component.orientation === 'vertical') {
  const p = getComponentParameters(component)
  return { switchClosed: p.switchClosed, switchPosition: p.switchPosition, sliderPosition: p.sliderPosition, brightness: state?.brightness ?? 0,
    lampOverload: state?.lampStatus === 'overload', lampPower: state?.power, lampRatedPower: state?.ratedPower ?? p.ratedPower, textRotation: vertical ? -90 : 0 }
}

export function componentImageSources(component: CircuitComponent) {
  const asset = getPhysicalAsset(component.type, component.assetId)
  return asset ? [asset.src, asset.meterDial?.baseSrc, asset.sliderVisual?.baseSrc, asset.sliderVisual?.sliderSrc,
    asset.switchVisual?.baseSrc, asset.switchVisual?.bladeSrc, asset.lampVisual?.baseSrc, asset.lampVisual?.glowSrc,
    asset.stateImages?.onSrc, asset.stateImages?.offSrc].filter((src): src is string => !!src) : []
}
