import { Matrix, solve } from 'ml-matrix';
import { solveWireCurrents } from './wireCurrents';
import { getPhysicalAsset } from '../data/physicalAssets';
import type { CircuitComponent, CircuitGraph, CircuitWarning, ComponentParameters } from '../types/circuit';

export type MeterStatus = 'ok' | 'reverse' | 'overload' | 'floating' | 'miswired';
export interface SimulationBranchReading {
  from: string;
  to: string;
  voltage: number;
  current: number;
  power: number;
  resistance: number;
}
export interface ComponentSimulationResult {
  voltage: number;
  current: number;
  power: number;
  brightness: number;
  active: boolean;
  effectiveResistance?: number;
  reading?: number;
  calculatedReading?: number;
  range?: number;
  unit?: 'A' | 'V';
  meterStatus?: MeterStatus;
  lampStatus?: 'off' | 'normal' | 'overload';
  ratedPower?: number;
  /** Direction and terminal pair of the scalar voltage/current, when applicable. */
  measurementTerminals?: [string, string];
  branches?: SimulationBranchReading[];
}

export interface CircuitSimulationResult {
  status: 'no_source' | 'open' | 'operating' | 'overload' | 'short_circuit' | 'error';
  components: Record<string, ComponentSimulationResult>;
  terminalVoltages: Record<string, number>;
  wireCurrents: Record<string, number>;
  /** Single supply port magnitude; null for multiple ports/islands or a shorted source loop. */
  totalCurrent: number | null;
  warnings: CircuitWarning[];
}

const MIN_RESISTANCE = 1e-4;
const ACTIVE_CURRENT = 1e-5;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const resistance = (value: number) => clamp(value, MIN_RESISTANCE, 1e9);
// Preserve real small quantities; display/animation thresholds belong in the UI.
const zero = (value: number) => value === 0 ? 0 : value;

export function getComponentParameters(component: CircuitComponent): Required<ComponentParameters> {
  const values = component.parameters ?? {};
  const ratedVoltage = values.ratedVoltage ?? 3;
  const ratedPower = values.ratedPower ?? 0.3;
  const defaultResistance = component.type === 'lamp' ? ratedVoltage ** 2 / ratedPower
    : component.type === 'ammeter' ? 0.02
    : component.type === 'voltmeter' ? 1e6
    : component.type === 'galvanometer' ? 100
    : component.type === 'buzzer' || component.type === 'bell' ? 100
    : component.type === 'motor' ? 15 : 10;
  return {
    voltage: values.voltage ?? (component.assetId === 'battery-single' ? 1.5 : 3),
    internalResistance: values.internalResistance ?? 0.1,
    resistance: values.resistance ?? defaultResistance,
    maxResistance: values.maxResistance ?? 20,
    sliderPosition: values.sliderPosition ?? component.rheostatConfig?.sliderPosition ?? 0.5,
    switchClosed: values.switchClosed ?? getPhysicalAsset(component.type, component.assetId)?.switchClosed ?? false,
    switchPosition: values.switchPosition ?? 'left',
    ratedVoltage, ratedPower,
    meterRange: values.meterRange ?? (component.type === 'voltmeter' ? 3 : component.type === 'galvanometer' ? 0.003 : 0.6),
    meterMode: values.meterMode ?? 'auto',
    manualReading: values.manualReading ?? 0,
  };
}

class DisjointSets {
  private parents = new Map<string, string>();
  find(value: string): string {
    const parent = this.parents.get(value);
    if (!parent) { this.parents.set(value, value); return value; }
    if (parent === value) return value;
    const root = this.find(parent);
    this.parents.set(value, root);
    return root;
  }
  join(a: string, b: string) { this.parents.set(this.find(b), this.find(a)); }
}

interface Branch {
  terminalA: string;
  terminalB: string;
  componentId: string;
  a: string;
  b: string;
  resistance: number;
  meter?: boolean;
  tag?: string;
}
interface Source { componentId: string; a: string; b: string; voltage: number; resistance: number }
interface Meter { positive: string; negative: string; range: number; status: MeterStatus; branch?: Branch }

function reachableNodes(start: string, edges: { a: string; b: string }[]) {
  const nodes = new Set([start]);
  for (const node of nodes) for (const edge of edges) {
    if (edge.a === node) nodes.add(edge.b);
    if (edge.b === node) nodes.add(edge.a);
  }
  return nodes;
}

/** Resistance seen by a 1 V test supply, including parallel paths and bridges. */
function equivalentResistance(a: string, b: string, branches: Branch[]): number {
  if (a === b) return 0;
  const connected = reachableNodes(a, branches);
  if (!connected.has(b)) return Infinity;
  const nodes = [...connected].filter(node => node !== a && node !== b);
  const indices = new Map(nodes.map((node, index) => [node, index]));
  const matrix = Matrix.zeros(nodes.length, nodes.length), rhs = Matrix.zeros(nodes.length, 1);
  for (const branch of branches) {
    if (!connected.has(branch.a) || branch.a === branch.b) continue;
    const g = 1 / branch.resistance;
    for (const [from, to] of [[branch.a, branch.b], [branch.b, branch.a]]) {
      const row = indices.get(from), col = indices.get(to);
      if (row === undefined) continue;
      matrix.set(row, row, matrix.get(row, row) + g);
      if (col !== undefined) matrix.set(row, col, matrix.get(row, col) - g);
      else if (to === a) rhs.set(row, 0, rhs.get(row, 0) + g);
    }
  }
  try {
    const solution = nodes.length ? solve(matrix, rhs) : undefined;
    const potential = (node: string) => node === a ? 1 : node === b ? 0 : solution!.get(indices.get(node)!, 0);
    const current = branches.reduce((sum, branch) => sum + (branch.a === a ? (1 - potential(branch.b)) / branch.resistance
      : branch.b === a ? (1 - potential(branch.a)) / branch.resistance : 0), 0);
    return current > 0 ? 1 / current : Infinity;
  } catch { return Infinity; }
}

/** Do not add currents through cells in series or invent a total for multiple ports. */
function supplyCurrent(sources: Source[], branches: Branch[], currents: Map<string, number>): number | null {
  if (!sources.length) return 0;
  if (sources.length === 1) return Math.abs(currents.get(sources[0].componentId) ?? 0);
  const nodes = new Set(sources.flatMap(source => [source.a, source.b]));
  if (reachableNodes(sources[0].a, sources).size !== nodes.size) return null;
  const terminals = [...nodes].filter(node => sources.filter(source => source.a === node || source.b === node).length === 1
    || branches.some(branch => branch.a !== branch.b && (branch.a === node || branch.b === node)));
  // With no external load, two parallel source nodes still define one supply port.
  const ports = nodes.size === 2 ? [...nodes] : terminals;
  if (ports.length !== 2) return null;
  const node = ports[0];
  return Math.abs(sources.reduce((sum, source) => sum + (source.a === node ? 1 : 0) * (currents.get(source.componentId) ?? 0)
    - (source.b === node ? 1 : 0) * (currents.get(source.componentId) ?? 0), 0));
}

/** Linear DC operating point; each disconnected island receives its own voltage reference. */
export function simulateCircuit(graph: CircuitGraph): CircuitSimulationResult {
  const result: CircuitSimulationResult = { status: 'no_source', components: {}, terminalVoltages: {}, wireCurrents: {}, totalCurrent: 0, warnings: [] };
  const warning = (type: CircuitWarning['type'], message: string, componentId?: string, severity: CircuitWarning['severity'] = 'warning') => {
    result.warnings.push({ type, message, componentId, severity });
  };
  for (const component of graph.components) {
    result.components[component.id] = { voltage: 0, current: 0, power: 0, brightness: 0, active: false };
  }
  if (graph.components.length > 180 || graph.connections.length > 1200) {
    result.status = 'error';
    warning('simulation_limit', '当前直流仿真最多支持 180 个元件、1200 条连线。', undefined, 'error');
    return result;
  }

  const nets = new DisjointSets();
  const endpoints = new Set(graph.components.flatMap(component => component.terminals.map(terminal => `${component.id}.${terminal.id}`)));
  const wired = new Set<string>();
  endpoints.forEach(endpoint => nets.find(endpoint));
  for (const wire of graph.connections) {
    if (!endpoints.has(wire.from) || !endpoints.has(wire.to)) continue;
    nets.join(wire.from, wire.to);
    wired.add(wire.from); wired.add(wire.to);
  }
  for (const component of graph.components) {
    if (component.type === 'rheostat' && endpoints.has(`${component.id}.d`)) nets.join(`${component.id}.c`, `${component.id}.d`);
  }
  const branches: Branch[] = [];
  const sources: Source[] = [];
  const meters = new Map<string, Meter>();
  const componentBranches = new Map<string, Branch[]>();
  const endpoint = (component: CircuitComponent, terminal: string) => nets.find(`${component.id}.${terminal}`);
  const addBranch = (component: CircuitComponent, a: string, b: string, r: number, tag?: string): Branch => {
    const branch = { componentId: component.id, terminalA: `${component.id}.${a}`, terminalB: `${component.id}.${b}`, a: endpoint(component, a), b: endpoint(component, b), resistance: resistance(r), meter: component.type === 'voltmeter', tag };
    branches.push(branch);
    componentBranches.set(component.id, [...(componentBranches.get(component.id) ?? []), branch]);
    return branch;
  };

  for (const component of graph.components) {
    const params = getComponentParameters(component);
    if (component.type === 'battery') {
      sources.push({ componentId: component.id, a: endpoint(component, 'positive'), b: endpoint(component, 'negative'), voltage: params.voltage, resistance: resistance(params.internalResistance) });
    } else if (component.type === 'switch') {
      if (params.switchClosed) addBranch(component, 'left', 'right', MIN_RESISTANCE);
    } else if (component.type === 'switch_spdt') {
      if (params.switchPosition !== 'open') addBranch(component, 'common', params.switchPosition, MIN_RESISTANCE);
    } else if (component.type === 'rheostat' || component.type === 'potentiometer') {
      const slider = component.type === 'rheostat' ? 'c' : 'w';
      const ratio = clamp(params.sliderPosition, 0, 1);
      addBranch(component, 'a', slider, params.maxResistance * ratio, 'a');
      addBranch(component, slider, 'b', params.maxResistance * (1 - ratio), 'b');
    } else if (['ammeter', 'voltmeter', 'galvanometer'].includes(component.type)) {
      const isVoltmeter = component.type === 'voltmeter';
      const negative = isVoltmeter ? 'right' : 'left';
      const positiveLow = isVoltmeter ? 'left' : 'right';
      const hasLow = wired.has(`${component.id}.${positiveLow}`);
      const hasHigh = component.type !== 'galvanometer' && wired.has(`${component.id}.high`);
      const positive = hasHigh && !hasLow ? 'high' : positiveLow;
      const range = component.type === 'galvanometer' ? params.meterRange : isVoltmeter ? (positive === 'high' ? 15 : 3) : positive === 'high' ? 3 : 0.6;
      const status: MeterStatus = hasHigh && hasLow ? 'miswired'
        : !wired.has(`${component.id}.${negative}`) && (hasHigh || hasLow) ? 'miswired'
        : !wired.has(`${component.id}.${negative}`) || !(hasHigh || hasLow) ? 'floating' : 'ok';
      let measuredBranch: Branch | undefined;
      for (const terminal of [positiveLow, ...(component.type === 'galvanometer' ? [] : ['high'])]) {
        const r = params.resistance * (terminal === 'high' ? (isVoltmeter ? 5 : 0.2) : 1);
        const branch = addBranch(component, terminal, negative, r, terminal);
        if (terminal === positive) measuredBranch = branch;
      }
      meters.set(component.id, { positive: endpoint(component, positive), negative: endpoint(component, negative), range, status, branch: measuredBranch });
    } else {
      addBranch(component, 'left', 'right', params.resistance);
    }
  }

  const nodeNames = [...new Set([...endpoints].map(value => nets.find(value)))];
  const islands = new DisjointSets();
  const drivenIslands = new DisjointSets();
  nodeNames.forEach(name => { islands.find(name); drivenIslands.find(name); });
  for (const branch of branches) {
    islands.join(branch.a, branch.b);
    if (!branch.meter) drivenIslands.join(branch.a, branch.b);
  }
  for (const source of sources) { islands.join(source.a, source.b); drivenIslands.join(source.a, source.b); }
  const sourceIslands = new Set(sources.filter(source => source.voltage > 0).map(source => drivenIslands.find(source.a)));
  const references = new Map<string, string>();
  for (const source of sources) references.set(islands.find(source.b), source.b);
  for (const node of nodeNames) if (!references.has(islands.find(node))) references.set(islands.find(node), node);
  const groundNodes = new Set(references.values());
  const unknownNodes = nodeNames.filter(node => !groundNodes.has(node));
  const index = new Map(unknownNodes.map((name, number) => [name, number]));
  const size = unknownNodes.length + sources.length;
  const voltages = new Map<string, number>();
  const sourceCurrents = new Map<string, number>();
  // A branch with no alternative conductive path is a graph bridge. KCL fixes
  // its current at exactly zero without truncating tiny currents in real loops.
  const conductive = [...branches, ...sources];
  const bridges = new Set(conductive.filter(edge => edge.a !== edge.b
    && !reachableNodes(edge.a, conductive.filter(other => other !== edge)).has(edge.b)));

  try {
    if (size) {
      const matrix = Matrix.zeros(size, size);
      const rhs = Matrix.zeros(size, 1);
      const stamp = (row: number | undefined, col: number | undefined, value: number) => {
        if (row !== undefined && col !== undefined) matrix.set(row, col, matrix.get(row, col) + value);
      };
      for (const branch of branches) {
        const a = index.get(branch.a), b = index.get(branch.b), conductance = 1 / branch.resistance;
        stamp(a, a, conductance); stamp(b, b, conductance);
        stamp(a, b, -conductance); stamp(b, a, -conductance);
      }
      for (let number = 0; number < sources.length; number++) {
        const source = sources[number];
        const a = index.get(source.a), b = index.get(source.b), row = unknownNodes.length + number;
        stamp(a, row, 1); stamp(b, row, -1);
        stamp(row, a, 1); stamp(row, b, -1); stamp(row, row, -source.resistance);
        rhs.set(row, 0, source.voltage);
      }
      // LU is provided by ml-matrix; finite source/contact resistance keeps ideal shorts solvable.
      const solution = solve(matrix, rhs);
      if (solution.to1DArray().some(value => !Number.isFinite(value))) throw new Error('Nonfinite operating point');
      for (const node of nodeNames) voltages.set(node, groundNodes.has(node) ? 0 : zero(solution.get(index.get(node)!, 0)));
      sources.forEach((source, number) => sourceCurrents.set(source.componentId, bridges.has(source) ? 0 : zero(solution.get(unknownNodes.length + number, 0))));
    } else nodeNames.forEach(node => voltages.set(node, 0));
  } catch {
    result.status = 'error';
    warning('simulation_limit', '电路参数导致方程无法求解，请检查电源与极端阻值。', undefined, 'error');
    return result;
  }
  const voltage = (node: string) => voltages.get(node) ?? 0;
  const branchCurrent = (branch: Branch) => bridges.has(branch) ? 0 : zero((voltage(branch.a) - voltage(branch.b)) / branch.resistance);
  const injections = new Map<string, number>();
  const inject = (endpoint: string, current: number) => injections.set(endpoint, (injections.get(endpoint) || 0) + current);
  for (const branch of branches) { const current = branchCurrent(branch); inject(branch.terminalA, -current); inject(branch.terminalB, current); }
  for (const source of sources) { const current = sourceCurrents.get(source.componentId) || 0; inject(`${source.componentId}.positive`, -current); inject(`${source.componentId}.negative`, current); }
  const internalRails = graph.components.filter(component => component.type === 'rheostat').map(component => ({ id: `internal:${component.id}`, from: `${component.id}.c`, to: `${component.id}.d` }));
  const flows = solveWireCurrents([...graph.connections, ...internalRails], injections);
  for (const wire of graph.connections) result.wireCurrents[wire.id] = flows[wire.id] || 0;
  for (const value of endpoints) result.terminalVoltages[value] = voltage(nets.find(value));
  // A closed supply path is a topology fact, independent of the display/animation threshold.
  // Exclude voltmeters so their loading does not turn an otherwise open experiment into a closed one.
  const hasSupplyLoop = sources.some(source => source.voltage > 0 && reachableNodes(source.a,
    [...branches.filter(branch => !branch.meter), ...sources.filter(other => other !== source)]).has(source.b));
  const equivalentResistances = new Map<string, number>();
  const loadResistance = (source: Source) => {
    const key = JSON.stringify([source.a, source.b].sort());
    if (!equivalentResistances.has(key)) equivalentResistances.set(key, equivalentResistance(source.a, source.b, branches));
    return equivalentResistances.get(key)!;
  };
  let hasShort = false;
  let hasOverload = false;
  const shortedSources = new Set<string>();
  // The external load can span several cells in series. Test passive paths
  // between every pair of nodes in each source group, excluding cell internals.
  const checkedSourceNodes = new Set<string>();
  for (const source of sources) {
    if (checkedSourceNodes.has(source.a)) continue;
    const group = reachableNodes(source.a, sources);
    group.forEach(node => checkedSourceNodes.add(node));
    const nodes = [...group].filter(node => branches.some(branch => branch.a !== branch.b && (branch.a === node || branch.b === node)));
    const groupSources = sources.filter(item => group.has(item.a));
    if (!groupSources.some(item => item.voltage > 0)) continue;
    const lowResistance = nodes.some((a, i) => nodes.slice(i + 1).some(b => equivalentResistance(a, b, branches) <= .1 * (1 + 1e-9)));
    if (lowResistance) groupSources.forEach(item => shortedSources.add(item.componentId));
  }
  let sourceLoopShort = false;
  // A wire-shortened series pack becomes a source-only loop after net merging.
  // Compare EMFs around that loop separately from its external load resistance.
  for (const source of sources) {
    if (source.a === source.b || source.voltage <= 0) continue; // Single-cell shorts are checked below.
    const potentials = new Map([[source.b, 0]]);
    for (const [node, value] of potentials) for (const other of sources) {
      if (other === source) continue;
      if (other.b === node && !potentials.has(other.a)) potentials.set(other.a, value + other.voltage);
      if (other.a === node && !potentials.has(other.b)) potentials.set(other.b, value - other.voltage);
    }
    const parallelVoltage = potentials.get(source.a);
    if (parallelVoltage === undefined || Math.abs(parallelVoltage - source.voltage) <= Math.max(Math.abs(parallelVoltage), source.voltage) * 1e-9) continue;
    if (parallelVoltage <= 0) {
      sourceLoopShort = true;
      shortedSources.add(source.componentId);
    } else {
      warning('polarity_error', '直接相连的电源组电动势不一致，存在内部环流或充电电流；请查看各电池电流。', source.componentId);
    }
  }
  for (const component of graph.components) {
    const state = result.components[component.id];
    const params = getComponentParameters(component);
    const parts = componentBranches.get(component.id) ?? [];
    state.voltage = parts[0] ? zero(voltage(parts[0].a) - voltage(parts[0].b)) : 0;
    state.current = parts[0] ? branchCurrent(parts[0]) : 0;
    state.power = parts.reduce((sum, branch) => sum + branchCurrent(branch) ** 2 * branch.resistance, 0);
    state.effectiveResistance = parts[0]?.resistance;
    state.active = Math.abs(state.current) > ACTIVE_CURRENT;

    if (component.type === 'battery') {
      const source = sources.find(item => item.componentId === component.id)!;
      state.voltage = zero(voltage(source.a) - voltage(source.b));
      state.current = -(sourceCurrents.get(component.id) ?? 0);
      state.power = state.voltage * state.current;
      state.active = Math.abs(state.current) > ACTIVE_CURRENT;
      state.effectiveResistance = params.internalResistance;
      if (source.voltage > 0 && (shortedSources.has(component.id) || loadResistance(source) <= 0.1 * (1 + 1e-9))) {
        hasShort = true;
        warning('short_circuit', `${component.label || '电源'}所在电源组存在低阻通路或电源短接环流，该电池电流 ${Math.abs(state.current).toFixed(2)} A。`, component.id, 'error');
      }
    } else if (component.type === 'switch' || component.type === 'switch_spdt') {
      const left = component.type === 'switch' ? 'left' : 'common';
      const right = component.type === 'switch' ? 'right' : params.switchPosition === 'right' ? 'right' : 'left';
      state.voltage = zero(voltage(endpoint(component, left)) - voltage(endpoint(component, right)));
    } else if (component.type === 'rheostat' || component.type === 'potentiometer') {
      const currents = parts.map(branchCurrent);
      const usedA = wired.has(`${component.id}.a`), usedB = wired.has(`${component.id}.b`);
      const usedSlider = component.type === 'rheostat' ? wired.has(`${component.id}.c`) || wired.has(`${component.id}.d`) : wired.has(`${component.id}.w`);
      const slider = component.type === 'rheostat' ? 'c' : 'w';
      state.branches = parts.map(branch => ({ from: branch.terminalA.split('.').at(-1)!, to: branch.terminalB.split('.').at(-1)!,
        voltage: zero(voltage(branch.a) - voltage(branch.b)), current: branchCurrent(branch),
        power: branchCurrent(branch) ** 2 * branch.resistance, resistance: branch.resistance }));
      const used = [usedA ? 'a' : undefined, usedB ? 'b' : undefined, usedSlider ? slider : undefined].filter((value): value is string => !!value);
      const ports = [...new Set(used.map(terminal => endpoint(component, terminal)))];
      const from = usedA ? 'a' : slider;
      const to = usedA && usedSlider && (!usedB || endpoint(component, 'a') === endpoint(component, 'b')) ? slider : 'b';
      const fromNode = endpoint(component, from);
      state.measurementTerminals = [from, to];
      state.voltage = zero(voltage(fromNode) - voltage(endpoint(component, to)));
      state.current = zero(parts.reduce((sum, branch) => sum + (branch.a === fromNode ? branchCurrent(branch) : 0)
        - (branch.b === fromNode ? branchCurrent(branch) : 0), 0));
      state.effectiveResistance = ports.length === 2 && state.current !== 0 ? Math.abs(state.voltage / state.current) : undefined;
      state.active = currents.some(current => Math.abs(current) > ACTIVE_CURRENT);
      if (component.type === 'rheostat' && !usedA && !usedB && wired.has(`${component.id}.c`) && wired.has(`${component.id}.d`)) {
        warning('short_circuit', '变阻器 C、D 同属滑杆，接这两个端子不会接入电阻。', component.id);
      }
    } else if (meters.has(component.id)) {
      const meter = meters.get(component.id)!;
      state.voltage = zero(voltage(meter.positive) - voltage(meter.negative));
      state.current = meter.branch ? branchCurrent(meter.branch) : 0;
      state.reading = state.calculatedReading = component.type === 'voltmeter' ? state.voltage : state.current;
      state.range = meter.range;
      state.unit = component.type === 'voltmeter' ? 'V' : 'A';
      const positiveIsland = drivenIslands.find(meter.positive);
      const negativeIsland = drivenIslands.find(meter.negative);
      const powered = positiveIsland === negativeIsland && sourceIslands.has(positiveIsland);
      state.meterStatus = meter.status === 'ok' && !powered ? 'floating' : meter.status;
      if (state.meterStatus === 'ok') {
        if (Math.abs(state.reading) > meter.range * 1.001) state.meterStatus = 'overload';
        else if (state.reading < -1e-8 && component.type !== 'galvanometer') state.meterStatus = 'reverse';
      }
      if (state.meterStatus === 'miswired') warning('meter_misuse', '仪表应连接公共负端与一个正量程端，请检查接线。', component.id, 'error');
      if (state.meterStatus === 'floating') warning('meter_misuse', '仪表接点悬空或未接入有电源的电路，读数无效。', component.id);
      if (state.meterStatus === 'reverse') warning('polarity_error', '仪表电流或电压方向为反向，请对调正负接线。', component.id);
      if (state.meterStatus === 'overload') warning('overload', `仪表读数超过 ${meter.range} ${state.unit} 量程。`, component.id, 'error');
      if (state.meterStatus === 'floating' || state.meterStatus === 'miswired') {
        state.reading = undefined;
        state.calculatedReading = undefined;
      }
    } else if (component.type === 'lamp') {
      state.brightness = clamp(state.power / params.ratedPower, 0, 1);
      state.active = state.brightness > 0.005;
      state.ratedPower = params.ratedPower;
      // Only suppress floating-point roundoff at the rating; this is not a thermal failure model.
      state.lampStatus = state.power > params.ratedPower * (1 + 1e-9) ? 'overload' : state.active ? 'normal' : 'off';
      if (state.lampStatus === 'overload') {
        hasOverload = true;
        warning('overload', `灯泡实际功率 ${Number(state.power.toPrecision(4))} W 超过额定 ${params.ratedPower} W，存在烧毁风险；尚未模拟热损坏过程。`, component.id, 'error');
      }
    }
    if (component.type === 'motor' || component.type === 'bell' || component.type === 'buzzer') {
      warning('simulation_limit', component.type === 'buzzer'
        ? '蜂鸣器按有源直流负载计算；素材未标明极性和类型，响声及声学过程不在仿真范围内。'
        : '该元件按等效电阻计算；机械运动、反电动势和瞬态过程未建模。', component.id, 'info');
    }
  }
  const totalCurrent = supplyCurrent(sources, branches, sourceCurrents);
  result.totalCurrent = sourceLoopShort || totalCurrent === null ? null : zero(totalCurrent);
  result.status = !sources.some(source => source.voltage > 0) ? 'no_source' : hasShort ? 'short_circuit'
    : hasOverload ? 'overload' : hasSupplyLoop ? 'operating' : 'open';
  if (result.status === 'open') warning('open_circuit', '电路无闭合供电回路或仅有高阻测量支路。', undefined, 'info');
  return result;
}
