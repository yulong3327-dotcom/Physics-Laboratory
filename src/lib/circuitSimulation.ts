import { Matrix, solve } from 'ml-matrix';
import { solveWireCurrents } from './wireCurrents';
import { getPhysicalAsset } from '../data/physicalAssets';
import type { CircuitComponent, CircuitGraph, CircuitWarning, ComponentParameters } from '../types/circuit';

export type MeterStatus = 'ok' | 'reverse' | 'overload' | 'floating' | 'miswired';
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
}

export interface CircuitSimulationResult {
  status: 'no_source' | 'open' | 'operating' | 'short_circuit' | 'error';
  components: Record<string, ComponentSimulationResult>;
  terminalVoltages: Record<string, number>;
  wireCurrents: Record<string, number>;
  totalCurrent: number;
  warnings: CircuitWarning[];
}

const MIN_RESISTANCE = 1e-4;
const ACTIVE_CURRENT = 1e-5;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const resistance = (value: number) => clamp(value, MIN_RESISTANCE, 1e9);
const zero = (value: number) => Math.abs(value) < 1e-10 ? 0 : value;

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

function lowResistancePath(a: string, b: string, branches: Branch[]): boolean {
  const distances = new Map<string, number>([[a, 0]]);
  const queue = [a];
  while (queue.length) {
    const node = queue.shift()!;
    const cost = distances.get(node)!;
    if (node === b) return true;
    for (const branch of branches) {
      const other = branch.a === node ? branch.b : branch.b === node ? branch.a : undefined;
      if (other === undefined || cost + branch.resistance > 0.1) continue;
      const next = cost + branch.resistance;
      if (next < (distances.get(other) ?? Infinity)) { distances.set(other, next); queue.push(other); }
    }
  }
  return false;
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
      sources.forEach((source, number) => sourceCurrents.set(source.componentId, zero(solution.get(unknownNodes.length + number, 0))));
    } else nodeNames.forEach(node => voltages.set(node, 0));
  } catch {
    result.status = 'error';
    warning('simulation_limit', '电路参数导致方程无法求解，请检查电源与极端阻值。', undefined, 'error');
    return result;
  }
  const voltage = (node: string) => voltages.get(node) ?? 0;
  const branchCurrent = (branch: Branch) => zero((voltage(branch.a) - voltage(branch.b)) / branch.resistance);
  const injections = new Map<string, number>();
  const inject = (endpoint: string, current: number) => injections.set(endpoint, (injections.get(endpoint) || 0) + current);
  for (const branch of branches) { const current = branchCurrent(branch); inject(branch.terminalA, -current); inject(branch.terminalB, current); }
  for (const source of sources) { const current = sourceCurrents.get(source.componentId) || 0; inject(`${source.componentId}.positive`, -current); inject(`${source.componentId}.negative`, current); }
  const internalRails = graph.components.filter(component => component.type === 'rheostat').map(component => ({ id: `internal:${component.id}`, from: `${component.id}.c`, to: `${component.id}.d` }));
  const flows = solveWireCurrents([...graph.connections, ...internalRails], injections);
  for (const wire of graph.connections) result.wireCurrents[wire.id] = flows[wire.id] || 0;
  for (const value of endpoints) result.terminalVoltages[value] = voltage(nets.find(value));
  let hasLoadCurrent = false;
  let hasShort = false;
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
      result.totalCurrent += Math.max(0, state.current);
      if (source.voltage > 0 && lowResistancePath(source.a, source.b, branches)) {
        hasShort = true;
        warning('short_circuit', `${component.label || '电源'}两端存在低阻通路，短路电流 ${Math.abs(state.current).toFixed(2)} A。`, component.id, 'error');
      }
    } else if (component.type === 'switch' || component.type === 'switch_spdt') {
      const left = component.type === 'switch' ? 'left' : 'common';
      const right = component.type === 'switch' ? 'right' : params.switchPosition === 'right' ? 'right' : 'left';
      state.voltage = zero(voltage(endpoint(component, left)) - voltage(endpoint(component, right)));
    } else if (component.type === 'rheostat' || component.type === 'potentiometer') {
      const currents = parts.map(branchCurrent);
      state.current = zero(currents.reduce((chosen, current) => Math.abs(current) > Math.abs(chosen) ? current : chosen, 0));
      const usedA = wired.has(`${component.id}.a`), usedB = wired.has(`${component.id}.b`);
      const usedSlider = component.type === 'rheostat' ? wired.has(`${component.id}.c`) || wired.has(`${component.id}.d`) : wired.has(`${component.id}.w`);
      state.effectiveResistance = usedA && usedB && !usedSlider ? params.maxResistance
        : usedA ? params.maxResistance * params.sliderPosition
        : usedB ? params.maxResistance * (1 - params.sliderPosition) : 0;
      state.voltage = zero(state.current * state.effectiveResistance);
      state.active = Math.abs(state.current) > ACTIVE_CURRENT;
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
      if (state.power > params.ratedPower * 1.2) warning('overload', '灯泡功率超过额定值，存在烧毁风险。', component.id);
    }
    if (component.type === 'motor' || component.type === 'bell' || component.type === 'buzzer') {
      warning('simulation_limit', component.type === 'buzzer'
        ? '蜂鸣器按有源直流负载计算；素材未标明极性和类型，响声及声学过程不在仿真范围内。'
        : '该元件按等效电阻计算；机械运动、反电动势和瞬态过程未建模。', component.id, 'info');
    }
    if (!['battery', 'voltmeter', 'ammeter', 'galvanometer', 'switch', 'switch_spdt'].includes(component.type) && state.active) hasLoadCurrent = true;
  }
  result.totalCurrent = zero(result.totalCurrent);
  result.status = !sources.some(source => source.voltage > 0) ? 'no_source' : hasShort ? 'short_circuit'
    : hasLoadCurrent || result.totalCurrent > ACTIVE_CURRENT ? 'operating' : 'open';
  if (result.status === 'open') warning('open_circuit', '电路无闭合供电回路或仅有高阻测量支路。', undefined, 'info');
  return result;
}
