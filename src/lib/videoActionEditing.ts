import type { CircuitAction, CircuitAsset } from '../../server/videoTypes'
import type { CircuitComponent, ComponentParameters } from '../types/circuit'

export const stateParameterLabels: Record<keyof ComponentParameters, string> = {
  switchClosed: '开关状态', switchPosition: '开关位置', resistance: '电阻 / Ω', maxResistance: '最大电阻 / Ω',
  sliderPosition: '滑片位置 / 0–1', voltage: '电源电压 / V', internalResistance: '内阻 / Ω',
  ratedVoltage: '额定电压 / V', ratedPower: '额定功率 / W', meterRange: '量程', meterMode: '读数模式', manualReading: '手动读数',
}
export function editableStateParameters(component: CircuitComponent): (keyof ComponentParameters)[] {
  switch (component.type) {
    case 'switch': return ['switchClosed']
    case 'switch_spdt': return ['switchPosition']
    case 'battery': return ['voltage', 'internalResistance']
    case 'resistor': return ['resistance']
    case 'rheostat': case 'potentiometer': return ['sliderPosition', 'maxResistance', 'resistance']
    case 'lamp': case 'motor': case 'bell': case 'buzzer': return ['resistance', 'ratedVoltage', 'ratedPower']
    case 'ammeter': case 'voltmeter': case 'galvanometer': return ['meterRange', 'meterMode', 'manualReading']
    default: return []
  }
}
export function editableStateComponents(asset?: CircuitAsset): CircuitComponent[] {
  const graph = asset?.graph as { components?: CircuitComponent[] } | undefined
  return Array.isArray(graph?.components) ? graph.components.filter(component => editableStateParameters(component).length) : []
}
export function defaultComponentState(component: CircuitComponent): NonNullable<CircuitAction['state']> {
  const parameters = component.parameters || {}
  const key = editableStateParameters(component)[0]
  let value: ComponentParameters[keyof ComponentParameters] = parameters[key]
  if (key === 'switchClosed') value = !parameters.switchClosed
  else if (key === 'switchPosition') value = parameters.switchPosition === 'left' ? 'right' : 'left'
  else if (key === 'sliderPosition') value = (parameters.sliderPosition ?? component.rheostatConfig?.sliderPosition ?? .5) >= .5 ? .25 : .75
  else if (value === undefined) value = key === 'voltage' ? 6 : key === 'meterRange' ? 3 : 10
  return { componentId: component.id, parameters: { [key]: value } }
}
/** Type changes discard payloads for the previous kind, including prepared snapshots. */
export function changeCircuitActionType(action: CircuitAction, type: CircuitAction['type'], asset?: CircuitAsset): CircuitAction {
  if (type === action.type) return action
  const result: CircuitAction = { id: action.id, type, targetIds: action.targetIds, cue: action.cue, durationSeconds: action.durationSeconds }
  if (type === 'state') {
    const components = editableStateComponents(asset)
    const component = components.find(item => action.targetIds.includes(item.id)) || components.find(item => item.type === 'switch' || item.type === 'switch_spdt') || components[0]
    if (component) { result.state = defaultComponentState(component); result.targetIds = [component.id] }
    else result.targetIds = []
  } else if (type === 'annotation') {
    result.annotation = { kind: 'voltage', label: action.text || 'U', side: 'below', offset: 40, color: '#FF6600', direction: 'forward' }
    const ids = new Set([...(asset?.geometry?.components.map(item => item.id) || []), ...(asset?.geometry?.wires.map(item => item.id) || []), ...editableStateComponents(asset).map(item => item.id)])
    result.targetIds = action.targetIds.filter(id => ids.has(id))
    if (!result.targetIds.length) result.targetIds = editableStateComponents(asset).filter(item => item.type === 'resistor' || item.type === 'rheostat').slice(0, 1).map(item => item.id)
  } else if (type === 'label') result.text = action.annotation?.label || action.text || ''
  return result
}
