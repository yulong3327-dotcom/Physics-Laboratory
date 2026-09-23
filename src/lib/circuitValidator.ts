import type { CircuitGraph, CircuitWarning, CircuitComponent } from '../types/circuit';
import { componentLibrary } from '../data/componentLibrary';

export function validateCircuit(graph: CircuitGraph): CircuitWarning[] {
  const warnings: CircuitWarning[] = [];

  checkShortCircuit(graph, warnings);
  checkOpenCircuit(graph, warnings);
  checkIsolatedComponents(graph, warnings);
  checkMeterUsage(graph, warnings);
  checkPolarity(graph, warnings);

  return warnings;
}

function checkShortCircuit(graph: CircuitGraph, warnings: CircuitWarning[]) {
  const batteryIds = graph.components
    .filter((c) => c.type === 'battery')
    .map((c) => c.id);

  for (const batId of batteryIds) {
    const def = componentLibrary.battery;
    const posTerm = def.terminals.find((t) => t.label === '+')?.id || 'positive';
    const negTerm = def.terminals.find((t) => t.label === '-')?.id || 'negative';

    const fromPos = `${batId}.${posTerm}`;
    const toNeg = `${batId}.${negTerm}`;

    const direct = graph.connections.some(
      (c) =>
        (c.from === fromPos && c.to === toNeg) ||
        (c.from === toNeg && c.to === fromPos)
    );

    if (direct) {
      warnings.push({
        type: 'short_circuit',
        message: '电池正负极直接短接，存在短路危险',
        componentId: batId,
        severity: 'error',
      });
    }
  }
}

function checkOpenCircuit(graph: CircuitGraph, warnings: CircuitWarning[]) {
  if (graph.components.length === 0) return;
  if (graph.connections.length === 0) {
    warnings.push({
      type: 'open_circuit',
      message: '电路中没有任何连接，无法形成回路',
      severity: 'warning',
    });
    return;
  }

  const battery = graph.components.find((c) => c.type === 'battery');
  if (!battery) {
    const hasConnections = graph.connections.length > 0;
    if (!hasConnections) {
      warnings.push({
        type: 'open_circuit',
        message: '缺少电源，电路不完整',
        severity: 'warning',
      });
    }
    return;
  }

  const reachable = findConnectedSet(battery.id, graph);
  for (const comp of graph.components) {
    if (comp.type === 'voltmeter') continue;
    if (!reachable.has(comp.id)) {
      warnings.push({
        type: 'isolated_component',
        message: `${componentLibrary[comp.type].name}未接入主回路`,
        componentId: comp.id,
        severity: 'warning',
      });
    }
  }
}

function findConnectedSet(
  startCompId: string,
  graph: CircuitGraph
): Set<string> {
  const visited = new Set<string>();
  const queue = [startCompId];
  visited.add(startCompId);

  while (queue.length > 0) {
    const compId = queue.shift()!;
    for (const conn of graph.connections) {
      const [fromComp] = conn.from.split('.');
      const [toComp] = conn.to.split('.');
      if (fromComp === compId && !visited.has(toComp)) {
        visited.add(toComp);
        queue.push(toComp);
      }
      if (toComp === compId && !visited.has(fromComp)) {
        visited.add(fromComp);
        queue.push(fromComp);
      }
    }
  }

  return visited;
}

function checkIsolatedComponents(
  graph: CircuitGraph,
  warnings: CircuitWarning[]
) {
  const usedCompIds = new Set<string>();
  for (const conn of graph.connections) {
    const [fromComp] = conn.from.split('.');
    const [toComp] = conn.to.split('.');
    usedCompIds.add(fromComp);
    usedCompIds.add(toComp);
  }

  for (const comp of graph.components) {
    if (!usedCompIds.has(comp.id) && graph.connections.length > 0) {
      warnings.push({
        type: 'isolated_component',
        message: `${componentLibrary[comp.type].name}没有任何连线`,
        componentId: comp.id,
        severity: 'warning',
      });
    }
  }
}

function checkMeterUsage(graph: CircuitGraph, warnings: CircuitWarning[]) {
  const ammeters = graph.components.filter((c) => c.type === 'ammeter');
  const voltmeters = graph.components.filter((c) => c.type === 'voltmeter');

  for (const ammeter of ammeters) {
    const connectedTerms = getConnectedTerminals(ammeter.id, graph);
    if (connectedTerms.size < 2) {
      warnings.push({
        type: 'meter_misuse',
        message: '电流表只接了一个接线柱，必须串联接入电路',
        componentId: ammeter.id,
        severity: 'error',
      });
    }
  }

  for (const voltmeter of voltmeters) {
    const connectedTerms = getConnectedTerminals(voltmeter.id, graph);
    if (connectedTerms.size < 2) {
      warnings.push({
        type: 'meter_misuse',
        message: '电压表只接了一个接线柱，必须并联在被测元件两端',
        componentId: voltmeter.id,
        severity: 'error',
      });
    }
  }
}

function getConnectedTerminals(
  compId: string,
  graph: CircuitGraph
): Set<string> {
  const terms = new Set<string>();
  for (const conn of graph.connections) {
    const [fromComp, fromTerm] = conn.from.split('.');
    const [toComp, toTerm] = conn.to.split('.');
    if (fromComp === compId) terms.add(fromTerm);
    if (toComp === compId) terms.add(toTerm);
  }
  return terms;
}

function checkPolarity(graph: CircuitGraph, warnings: CircuitWarning[]) {
  for (const comp of graph.components) {
    if (!componentLibrary[comp.type].hasPolarity) continue;
    const connectedTerms = getConnectedTerminals(comp.id, graph);
    if (connectedTerms.size < 2) continue;

    const def = componentLibrary[comp.type];
    const posTerm = def.terminals.find((t) => t.label === '+');
    const negTerm = def.terminals.find((t) => t.label === '-');

    if (posTerm && negTerm) {
      const allTerms = new Set(connectedTerms);
      if (allTerms.size === 2 && allTerms.has(posTerm.id) && allTerms.has(negTerm.id)) {
        const connectedToPos = getComponentsConnectedToTerminal(
          comp.id,
          posTerm.id,
          graph
        );
        const connectedToNeg = getComponentsConnectedToTerminal(
          comp.id,
          negTerm.id,
          graph
        );

        if (
          connectedToPos.some((c) => c.type === 'battery') &&
          connectedToNeg.some((c) => c.type === 'battery')
        ) {
          const batteryConnectedToPos = connectedToPos.find(
            (c) => c.type === 'battery'
          );
          if (batteryConnectedToPos) {
            const batDef = componentLibrary.battery;
            const batPos = batDef.terminals.find((t) => t.label === '+');
            if (batPos) {
              const batConnected = getConnectedTerminals(
                batteryConnectedToPos.id,
                graph
              );
              const batConnToThisPos = checkIfConnectionExists(
                batteryConnectedToPos.id,
                batPos.id,
                comp.id,
                posTerm.id,
                graph
              );
              if (batConnToThisPos) {
                warnings.push({
                  type: 'polarity_error',
                  message: `${def.name}的正极可能连接到电池正极，请确认极性是否正确`,
                  componentId: comp.id,
                  severity: 'info',
                });
              }
            }
          }
        }
      }
    }
  }
}

function getComponentsConnectedToTerminal(
  compId: string,
  termId: string,
  graph: CircuitGraph
): CircuitComponent[] {
  const target = `${compId}.${termId}`;
  const connectedCompIds = new Set<string>();
  for (const conn of graph.connections) {
    if (conn.from === target) {
      connectedCompIds.add(conn.to.split('.')[0]);
    }
    if (conn.to === target) {
      connectedCompIds.add(conn.from.split('.')[0]);
    }
  }
  return graph.components.filter((c) => connectedCompIds.has(c.id));
}

function checkIfConnectionExists(
  comp1Id: string,
  term1Id: string,
  comp2Id: string,
  term2Id: string,
  graph: CircuitGraph
): boolean {
  const from = `${comp1Id}.${term1Id}`;
  const to = `${comp2Id}.${term2Id}`;
  return graph.connections.some(
    (c) => (c.from === from && c.to === to) || (c.from === to && c.to === from)
  );
}
