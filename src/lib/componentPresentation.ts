import { getComponentVisual, type PhysicalTerminal } from '../data/physicalAssets'
import type { CircuitComponent, CircuitConnection, ViewMode } from '../types/circuit'

export function getPresentedVisual(component: CircuitComponent, mode: ViewMode, connections: readonly CircuitConnection[] = []) {
  const visual = getComponentVisual(component, mode)
  if (mode !== 'schematic' || (component.type !== 'ammeter' && component.type !== 'voltmeter')) {
    return { ...visual, meterThirdTerminal: false, meterConnectionIssue: undefined }
  }

  const commonId = component.type === 'ammeter' ? 'left' : 'right'
  const lowId = component.type === 'ammeter' ? 'right' : 'left'
  const common = visual.terminals.find(terminal => terminal.id === commonId)!
  const low = visual.terminals.find(terminal => terminal.id === lowId)!
  const high = visual.terminals.find(terminal => terminal.id === 'high')!
  const connected = new Set(visual.terminals.filter(terminal => connections.some(connection => {
    const endpoint = `${component.id}.${terminal.id}`
    return connection.from === endpoint || connection.to === endpoint
  })).map(terminal => terminal.id))

  if (connected.size === 3) {
    return { ...visual, meterThirdTerminal: true, meterConnectionIssue: undefined }
  }

  const project = (terminal: PhysicalTerminal, position: PhysicalTerminal): PhysicalTerminal => ({
    ...terminal, dx: position.dx, dy: position.dy, dir: position.dir,
  })
  // Project actual electrical terminals, including invalid positive-to-positive wiring.
  if (connected.has(lowId) && connected.has('high')) {
    return { ...visual, terminals: [low, project(high, common)].sort((a, b) => a.dx - b.dx),
      meterThirdTerminal: false, meterConnectionIssue: 'missing-common' as const }
  }

  const lowRange = component.type === 'ammeter' ? 0.6 : 3
  const preferHigh = Number.isFinite(component.parameters?.meterRange) && component.parameters!.meterRange! > lowRange
  const useHigh = connected.has('high') || (!connected.has(lowId) && preferHigh)
  const positive = useHigh ? project(high, low) : low
  return { ...visual, terminals: [common, positive].sort((a, b) => a.dx - b.dx),
    meterThirdTerminal: false, meterConnectionIssue: undefined }
}
