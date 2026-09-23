import { componentLibrary } from './componentLibrary'
import type { CircuitGraph, ComponentType } from '../types/circuit'

export function createDemoCircuit(): CircuitGraph {
  const parts: { id: string; type: ComponentType; x: number; y: number; label: string }[] = [
    { id: 'demo_battery', type: 'battery', x: 260, y: 140, label: 'E' },
    { id: 'demo_switch', type: 'switch', x: 540, y: 140, label: 'S' },
    { id: 'demo_lamp', type: 'lamp', x: 540, y: 380, label: 'L1' },
    { id: 'demo_resistor', type: 'resistor', x: 260, y: 380, label: 'R1' },
  ]
  return {
    id: 'series_example',
    components: parts.map(part => ({ id: part.id, type: part.type, label: part.label,
      position: { x: part.x, y: part.y }, orientation: 'horizontal', source: 'manual',
      terminals: componentLibrary[part.type].terminals.map(terminal => ({ ...terminal })) })),
    connections: [
      { id: 'demo_wire_1', from: 'demo_battery.negative', to: 'demo_switch.left' },
      { id: 'demo_wire_2', from: 'demo_switch.right', to: 'demo_lamp.right' },
      { id: 'demo_wire_3', from: 'demo_lamp.left', to: 'demo_resistor.right' },
      { id: 'demo_wire_4', from: 'demo_resistor.left', to: 'demo_battery.positive' },
    ], warnings: [], meta: { inputType: 'manual', createdAt: new Date().toISOString() },
  }
}
