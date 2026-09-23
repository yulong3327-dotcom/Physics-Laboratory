import { Matrix, SingularValueDecomposition } from 'ml-matrix';
import { getComponentParameters } from './circuitSimulation';
import type { CircuitGraph, CircuitWarning } from '../types/circuit';

/** Undefined physics is never encoded as zero or an arbitrary least-squares value. */
export type IdealQuantity =
  | { status: 'defined'; value: number }
  | { status: 'indeterminate' | 'inconsistent'; reason: string };

export interface IdealBranchResult {
  componentId?: string;
  from: string;
  to: string;
  voltage: IdealQuantity;
  /** Positive from the branch start terminal to its end terminal, including wires. */
  current: IdealQuantity;
  /** Absorbed power; batteries report delivered power at component level. */
  power: IdealQuantity;
}

export interface IdealComponentResult {
  voltage: IdealQuantity;
  /** Battery: delivered current. Meter: current entering its selected positive terminal. */
  current: IdealQuantity;
  /** Battery: delivered power. Other components: absorbed power. */
  power: IdealQuantity;
  /** Positive current entering the component at each terminal. */
  terminalCurrents: Record<string, IdealQuantity>;
  branchIds: string[];
  effectiveResistance?: number;
  reading?: IdealQuantity;
  unit?: 'A' | 'V';
  range?: number;
  meterStatus?: 'ok' | 'reverse' | 'overload' | 'floating' | 'miswired' | 'indeterminate' | 'inconsistent';
}

export interface IdealCircuitSimulationResult {
  mode: 'ideal';
  status: 'solved' | 'indeterminate' | 'inconsistent' | 'error';
  components: Record<string, IdealComponentResult>;
  branches: Record<string, IdealBranchResult>;
  /** Voltages relative to the explicit local reference in terminalReferences. */
  terminalVoltages: Record<string, IdealQuantity>;
  /** Different reference IDs denote floating islands; do not subtract their voltages. */
  terminalReferences: Record<string, string>;
  wireCurrents: Record<string, IdealQuantity>;
  /** Algebraic sum of delivered battery currents, preserving correlated unknown currents. */
  totalCurrent: IdealQuantity;
  diagnostics: { islands: number; equations: number; rank: number; nullity: number; maxResidual: number };
  warnings: CircuitWarning[];
}

interface Branch {
  id: string;
  from: string;
  to: string;
  componentId?: string;
  resistance: number;
  emf: number;
  open?: boolean;
}

interface IslandSolution {
  reference: string;
  nodeIndex: Map<string, number>;
  branchIndex: Map<string, number>;
  values: number[];
  nullspace: number[][];
  inconsistent: boolean;
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

const defined = (value: number): IdealQuantity => ({ status: 'defined', value: Math.abs(value) < 1e-12 ? 0 : value });
const unknown = (reason: string): IdealQuantity => ({ status: 'indeterminate', reason });
const inconsistent = (): IdealQuantity => ({ status: 'inconsistent', reason: '该连通电路的理想约束相互冲突，无有限直流解。' });
function scale(quantity: IdealQuantity, factor: number): IdealQuantity {
  return quantity.status === 'defined' ? defined(quantity.value * factor) : quantity;
}
function sum(quantities: IdealQuantity[]): IdealQuantity {
  return quantities.find(value => value.status === 'inconsistent')
    ?? quantities.find(value => value.status === 'indeterminate')
    ?? defined(quantities.reduce((total, value) => total + (value.status === 'defined' ? value.value : 0), 0));
}
function power(voltage: IdealQuantity, current: IdealQuantity): IdealQuantity {
  if (voltage.status === 'inconsistent' || current.status === 'inconsistent') return inconsistent();
  if ((voltage.status === 'defined' && voltage.value === 0) || (current.status === 'defined' && current.value === 0)) return defined(0);
  return voltage.status === 'defined' && current.status === 'defined' ? defined(voltage.value * current.value)
    : unknown('电压或电流不唯一，无法确定功率。');
}

/** Safe voltage subtraction, including a voltmeter between independent islands. */
export function idealVoltageBetween(result: IdealCircuitSimulationResult, from: string, to: string): IdealQuantity {
  const a = result.terminalVoltages[from], b = result.terminalVoltages[to];
  if (!a || !b) return unknown('端口不存在。');
  if (a.status === 'inconsistent' || b.status === 'inconsistent') return inconsistent();
  if (result.terminalReferences[from] !== result.terminalReferences[to]) return unknown('两个端口属于彼此浮置的电路，没有共同电压参考。');
  if (a.status !== 'defined') return a;
  if (b.status !== 'defined') return b;
  return defined(a.value - b.value);
}

/**
 * Strict steady-state linear textbook model. All branch currents are MNA unknowns:
 * KCL at terminals, then Va - Vb - R I = E for each conducting branch. Thus wires,
 * ideal sources, ammeters and closed contacts use exact voltage constraints (R=0).
 * One reference per conductive island removes only its arbitrary voltage gauge.
 * SVD residuals detect contradictions; its nullspace determines each observable's
 * uniqueness. No leakage, contact resistance, source resistance or gmin is added.
 */
export function simulateIdealCircuit(graph: CircuitGraph): IdealCircuitSimulationResult {
  const result: IdealCircuitSimulationResult = {
    mode: 'ideal', status: 'solved', components: {}, branches: {}, terminalVoltages: {}, terminalReferences: {},
    wireCurrents: {}, totalCurrent: defined(0), diagnostics: { islands: 0, equations: 0, rank: 0, nullity: 0, maxResidual: 0 }, warnings: [],
  };
  const warn = (message: string, componentId?: string, type: CircuitWarning['type'] = 'simulation_limit', severity: CircuitWarning['severity'] = 'warning') => {
    result.warnings.push({ type, severity, message, ...(componentId ? { componentId } : {}) });
  };
  const endpointList = graph.components.flatMap(component => component.terminals.map(terminal => component.id + '.' + terminal.id));
  const endpoints = new Set(endpointList);
  if (graph.components.length > 180 || graph.connections.length > 1200 || endpoints.size !== endpointList.length
    || new Set(graph.components.map(component => component.id)).size !== graph.components.length
    || new Set(graph.connections.map(connection => connection.id)).size !== graph.connections.length) {
    result.status = 'error';
    warn('元件/端口/连线 ID 重复，或电路超过 180 个元件、1200 条连线的求解限制。', undefined, 'simulation_limit', 'error');
    return result;
  }
  const wired = new Set<string>();
  const branches: Branch[] = [];
  const componentBranches = new Map<string, Branch[]>();
  const componentPorts = new Map<string, [string, string]>();
  const meters = new Map<string, { positive: string; negative: string; range: number; invalid?: 'miswired' | 'floating'; branchId: string }>();
  const add = (branch: Branch) => {
    if (!endpoints.has(branch.from) || !endpoints.has(branch.to) || !Number.isFinite(branch.resistance)
      || branch.resistance < 0 || !Number.isFinite(branch.emf)) {
      result.status = 'error';
      warn('电路端口不存在，或电压/电阻参数无效。', branch.componentId, 'simulation_limit', 'error');
      return;
    }
    branches.push(branch);
    if (branch.componentId) componentBranches.set(branch.componentId, [...(componentBranches.get(branch.componentId) ?? []), branch]);
  };
  for (const wire of graph.connections) {
    add({ id: 'wire:' + wire.id, from: wire.from, to: wire.to, resistance: 0, emf: 0 });
    wired.add(wire.from); wired.add(wire.to);
  }
  for (const component of graph.components) {
    const params = getComponentParameters(component);
    const port = (id: string) => component.id + '.' + id;
    const part = (tag: string, from: string, to: string, resistance: number, emf = 0, open = false) => {
      add({ id: 'component:' + component.id + ':' + tag, componentId: component.id, from: port(from), to: port(to), resistance, emf, open });
    };
    if (component.type === 'battery') {
      part('source', 'positive', 'negative', 0, params.voltage);
      componentPorts.set(component.id, [port('positive'), port('negative')]);
    } else if (component.type === 'switch') {
      part('contact', 'left', 'right', 0, 0, !params.switchClosed);
      componentPorts.set(component.id, [port('left'), port('right')]);
    } else if (component.type === 'switch_spdt') {
      part('left', 'common', 'left', 0, 0, params.switchPosition !== 'left');
      part('right', 'common', 'right', 0, 0, params.switchPosition !== 'right');
      componentPorts.set(component.id, [port('common'), port(params.switchPosition === 'right' ? 'right' : 'left')]);
    } else if (component.type === 'rheostat' || component.type === 'potentiometer') {
      const slider = component.type === 'rheostat' ? 'c' : 'w';
      if (!Number.isFinite(params.sliderPosition) || params.sliderPosition < 0 || params.sliderPosition > 1) {
        result.status = 'error'; warn('滑片位置必须在 0 到 1 之间。', component.id, 'simulation_limit', 'error');
      }
      part('a', 'a', slider, params.maxResistance * params.sliderPosition);
      part('b', slider, 'b', params.maxResistance * (1 - params.sliderPosition));
      if (component.type === 'rheostat' && endpoints.has(port('d'))) part('rail', 'c', 'd', 0);
      const used = component.terminals.filter(terminal => wired.has(port(terminal.id))).map(terminal => port(terminal.id));
      if (used.length === 2) componentPorts.set(component.id, [used[0], used[1]]);
    } else if (['ammeter', 'voltmeter', 'galvanometer'].includes(component.type)) {
      const isVoltage = component.type === 'voltmeter';
      const negative = isVoltage ? 'right' : 'left', positiveLow = isVoltage ? 'left' : 'right';
      const hasLow = wired.has(port(positiveLow)), hasHigh = endpoints.has(port('high')) && wired.has(port('high'));
      const positive = hasHigh && !hasLow ? 'high' : positiveLow;
      const range = component.type === 'galvanometer' ? params.meterRange : isVoltage ? (positive === 'high' ? 15 : 3) : positive === 'high' ? 3 : 0.6;
      const invalid = hasLow && hasHigh ? 'miswired' : !wired.has(port(negative)) && (hasHigh || hasLow) ? 'miswired'
        : !wired.has(port(negative)) || !(hasHigh || hasLow) ? 'floating' : undefined;
      for (const terminal of [positiveLow, ...(endpoints.has(port('high')) ? ['high'] : [])]) part(terminal, terminal, negative, 0, 0, isVoltage);
      meters.set(component.id, { positive: port(positive), negative: port(negative), range, invalid, branchId: 'component:' + component.id + ':' + positive });
      componentPorts.set(component.id, [port(positive), port(negative)]);
    } else {
      part('load', 'left', 'right', params.resistance);
      componentPorts.set(component.id, [port('left'), port('right')]);
      if (['motor', 'bell', 'buzzer'].includes(component.type)) warn('此元件在教材直流模式下按等效电阻计算，不包含机械、声学或瞬态过程。', component.id, 'simulation_limit', 'info');
    }
  }
  if (result.status === 'error') return result;

  const islands = new DisjointSets();
  endpoints.forEach(endpoint => islands.find(endpoint));
  branches.filter(branch => !branch.open).forEach(branch => islands.join(branch.from, branch.to));
  const islandNodes = new Map<string, string[]>();
  for (const endpoint of endpoints) {
    const island = islands.find(endpoint);
    islandNodes.set(island, [...(islandNodes.get(island) ?? []), endpoint]);
  }
  const solutions = new Map<string, IslandSolution>();
  result.diagnostics.islands = islandNodes.size;
  try {
    for (const [island, nodes] of islandNodes) {
      const parts = branches.filter(branch => !branch.open && islands.find(branch.from) === island);
      const source = parts.find(branch => branch.componentId && graph.components.find(component => component.id === branch.componentId)?.type === 'battery');
      const reference = source?.to ?? nodes[0];
      const nodeIndex = new Map(nodes.filter(node => node !== reference).map((node, index) => [node, index]));
      const branchIndex = new Map(parts.map((branch, index) => [branch.id, nodeIndex.size + index]));
      const size = nodeIndex.size + parts.length;
      if (size > 900) throw new Error('单个连通电路超过 900 个理想方程，请拆分教学电路。');
      const solution: IslandSolution = { reference, nodeIndex, branchIndex, values: [], nullspace: [], inconsistent: false };
      solutions.set(island, solution);
      result.diagnostics.equations += size;
      if (!size) continue;
      const matrix = Matrix.zeros(size, size), rhs = new Array<number>(size).fill(0);
      const stamp = (row: number | undefined, column: number | undefined, value: number) => {
        if (row !== undefined && column !== undefined) matrix.set(row, column, matrix.get(row, column) + value);
      };
      for (const branch of parts) {
        const a = nodeIndex.get(branch.from), b = nodeIndex.get(branch.to), index = branchIndex.get(branch.id)!;
        stamp(a, index, 1); stamp(b, index, -1);
        stamp(index, a, 1); stamp(index, b, -1); stamp(index, index, -branch.resistance);
        rhs[index] = branch.emf;
      }
      // Row equilibration changes neither constraints nor their nullspace.
      for (let row = 0; row < size; row++) {
        const magnitude = Math.max(...matrix.getRow(row).map(Math.abs), 1);
        for (let col = 0; col < size; col++) matrix.set(row, col, matrix.get(row, col) / magnitude);
        rhs[row] /= magnitude;
      }
      const svd = new SingularValueDecomposition(matrix, { autoTranspose: true });
      const singular = svd.diagonal, left = svd.leftSingularVectors, right = svd.rightSingularVectors;
      const tolerance = Number.EPSILON * size * Math.max(singular[0] ?? 0, 1) * 16;
      solution.values = new Array<number>(size).fill(0);
      for (let axis = 0; axis < size; axis++) {
        if (singular[axis] > tolerance) {
          result.diagnostics.rank++;
          let projection = 0;
          for (let row = 0; row < size; row++) projection += left.get(row, axis) * rhs[row];
          for (let row = 0; row < size; row++) solution.values[row] += right.get(row, axis) * projection / singular[axis];
        } else {
          solution.nullspace.push(right.getColumn(axis));
          result.diagnostics.nullity++;
        }
      }
      for (let row = 0; row < size; row++) {
        let calculated = 0;
        for (let col = 0; col < size; col++) calculated += matrix.get(row, col) * solution.values[col];
        const residual = Math.abs(calculated - rhs[row]);
        result.diagnostics.maxResidual = Math.max(result.diagnostics.maxResidual, residual);
        if (!Number.isFinite(residual) || residual > 1e-8 * Math.max(1, Math.abs(rhs[row]))) solution.inconsistent = true;
      }
      if (solution.inconsistent) warn('理想电源与零电阻通路的电压约束冲突，电路没有有限直流解；请检查短路或冲突电源。', source?.componentId, 'short_circuit', 'error');
    }
  } catch (error) {
    result.status = 'error';
    warn(error instanceof Error ? error.message : '理想电路方程求解失败。', undefined, 'simulation_limit', 'error');
    return result;
  }

  const observe = (solution: IslandSolution, coefficients: Map<number, number>): IdealQuantity => {
    if (solution.inconsistent) return inconsistent();
    const norm = Math.sqrt([...coefficients.values()].reduce((total, value) => total + value * value, 0));
    for (const direction of solution.nullspace) {
      let projection = 0;
      for (const [index, value] of coefficients) projection += value * direction[index];
      if (Math.abs(projection) > 1e-8 * norm) return unknown('此物理量随理想电路的自由电流变化，无法唯一确定。');
    }
    let value = 0;
    for (const [index, coefficient] of coefficients) value += coefficient * solution.values[index];
    return defined(value);
  };
  const linearCurrent = (parts: { branch: Branch; coefficient: number }[]): IdealQuantity => {
    const grouped = new Map<IslandSolution, Map<number, number>>();
    for (const { branch, coefficient } of parts) {
      if (branch.open) continue;
      const solution = solutions.get(islands.find(branch.from))!;
      const index = solution.branchIndex.get(branch.id)!;
      const expression = grouped.get(solution) ?? new Map<number, number>();
      expression.set(index, (expression.get(index) ?? 0) + coefficient);
      grouped.set(solution, expression);
    }
    return sum([...grouped].map(([solution, expression]) => observe(solution, expression)));
  };
  for (const endpoint of endpoints) {
    const solution = solutions.get(islands.find(endpoint))!;
    const index = solution.nodeIndex.get(endpoint);
    result.terminalReferences[endpoint] = solution.reference;
    result.terminalVoltages[endpoint] = observe(solution, index === undefined ? new Map() : new Map([[index, 1]]));
  }
  for (const branch of branches) {
    const voltage = idealVoltageBetween(result, branch.from, branch.to);
    const current = branch.open ? defined(0) : linearCurrent([{ branch, coefficient: 1 }]);
    result.branches[branch.id] = { from: branch.from, to: branch.to, ...(branch.componentId ? { componentId: branch.componentId } : {}), voltage, current, power: power(voltage, current) };
    if (!branch.componentId) result.wireCurrents[branch.id.slice('wire:'.length)] = current;
  }
  for (const component of graph.components) {
    const parts = componentBranches.get(component.id) ?? [];
    const ports = componentPorts.get(component.id);
    const terminalCurrents: Record<string, IdealQuantity> = {};
    for (const terminal of component.terminals) {
      const endpoint = component.id + '.' + terminal.id;
      terminalCurrents[terminal.id] = linearCurrent(parts.flatMap(branch => [
        ...(branch.from === endpoint ? [{ branch, coefficient: 1 }] : []),
        ...(branch.to === endpoint ? [{ branch, coefficient: -1 }] : []),
      ]));
    }
    const state: IdealComponentResult = {
      branchIds: parts.map(branch => branch.id), terminalCurrents,
      voltage: ports ? idealVoltageBetween(result, ports[0], ports[1]) : unknown('多端元件请读取具体端口之间的电压。'),
      current: ports ? terminalCurrents[ports[0].slice(component.id.length + 1)] : unknown('多端元件请读取端口电流或分段电流。'),
      power: sum(parts.map(branch => result.branches[branch.id].power)),
    };
    if (component.type === 'battery') {
      state.current = scale(state.current, -1);
      state.power = scale(state.power, -1);
      state.effectiveResistance = 0;
    } else if (parts.length === 1 && !parts[0].open) state.effectiveResistance = parts[0].resistance;
    const meter = meters.get(component.id);
    if (meter) {
      state.current = result.branches[meter.branchId].current;
      state.reading = component.type === 'voltmeter' ? state.voltage : state.current;
      state.unit = component.type === 'voltmeter' ? 'V' : 'A';
      state.range = meter.range;
      state.meterStatus = meter.invalid ?? (state.reading.status === 'defined' ? 'ok'
        : state.reading.status === 'inconsistent' ? 'inconsistent'
          : component.type === 'voltmeter' ? 'floating' : 'indeterminate');
      if (meter.invalid && state.reading.status !== 'inconsistent') state.reading = unknown(meter.invalid === 'floating' ? '仪表端口未完整接线。' : '仪表必须使用公共端与一个正量程端。');
      if (state.meterStatus === 'ok' && state.reading.status === 'defined') {
        if (Math.abs(state.reading.value) > meter.range * (1 + 1e-9)) state.meterStatus = 'overload';
        else if (state.reading.value < -1e-9 && component.type !== 'galvanometer') state.meterStatus = 'reverse';
      }
      if (state.meterStatus !== 'ok') warn(state.reading.status === 'defined' ? '仪表状态：' + state.meterStatus + '。' : state.reading.reason, component.id, 'meter_misuse');
    }
    result.components[component.id] = state;
  }
  result.totalCurrent = linearCurrent(branches.filter(branch => branch.componentId && graph.components.find(component => component.id === branch.componentId)?.type === 'battery').map(branch => ({ branch, coefficient: -1 })));
  result.status = [...solutions.values()].some(solution => solution.inconsistent) ? 'inconsistent'
    : result.diagnostics.nullity > 0 || Object.values(result.components).some(component => [component.voltage, component.current, component.power, component.reading].some(quantity => quantity?.status === 'indeterminate')) ? 'indeterminate' : 'solved';
  if (result.diagnostics.nullity) warn('存在理想并联通路，部分支路或导线电流不能唯一确定；有唯一解的电压、电流仍可使用。', undefined, 'simulation_limit', 'info');
  return result;
}


