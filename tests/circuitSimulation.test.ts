import assert from 'node:assert/strict';
import test from 'node:test';
import { componentLibrary } from '../src/data/componentLibrary';
import { getComponentParameters, simulateCircuit } from '../src/lib/circuitSimulation';
import { parseCircuitGraph } from '../src/lib/graphSchema';
import type { CircuitComponent, CircuitGraph, ComponentParameters, ComponentType } from '../src/types/circuit';

function component(id: string, type: ComponentType, parameters: ComponentParameters = {}): CircuitComponent {
  return { id, type, parameters, orientation: 'horizontal', position: { x: 0, y: 0 }, terminals: structuredClone(componentLibrary[type].terminals) };
}
function graph(components: CircuitComponent[], pairs: string[][]): CircuitGraph {
  return { id: 'simulation', components, connections: pairs.map(([from, to], number) => ({ id: `wire${number}`, from, to })), warnings: [], meta: { inputType: 'manual', createdAt: '2026-09-08T00:00:00.000Z' } };
}
function close(actual: number | null | undefined, expected: number | null, tolerance = 1e-7) {
  assert.ok(actual != null && expected != null && Math.abs(actual - expected) < tolerance, `${actual} should equal ${expected}`);
}

test('Ohm law includes cell internal resistance and does not mutate the graph', () => {
  const input = graph([component('b', 'battery'), component('r', 'resistor', { resistance: 9.9 })], [['b.positive', 'r.left'], ['r.right', 'b.negative']]);
  const snapshot = structuredClone(input);
  const result = simulateCircuit(input);
  assert.equal(result.status, 'operating');
  close(result.totalCurrent, 0.3);
  close(result.components.r.voltage, 2.97);
  close(result.components.r.power, 0.891);
  assert.deepEqual(input, snapshot);
});

test('parallel currents obey Kirchhoff current conservation', () => {
  const input = graph([component('b', 'battery'), component('r1', 'resistor', { resistance: 20 }), component('r2', 'resistor', { resistance: 20 })], [['b.positive', 'r1.left'], ['r1.left', 'r2.left'], ['r1.right', 'r2.right'], ['r2.right', 'b.negative']]);
  const result = simulateCircuit(input);
  close(result.totalCurrent, 3 / 10.1);
  close(result.components.r1.current + result.components.r2.current, result.totalCurrent);
});

test('an open switch stops the lamp but retains source voltage across the contacts', () => {
  const input = graph([component('b', 'battery'), component('s', 'switch'), component('l', 'lamp')], [['b.positive', 's.left'], ['s.right', 'l.left'], ['l.right', 'b.negative']]);
  const result = simulateCircuit(input);
  assert.equal(result.status, 'open');
  close(result.components.s.voltage, 3);
  close(result.components.l.current, 0);
  assert.equal(result.components.l.active, false);
  input.components[1].parameters!.switchClosed = true;
  const closed = simulateCircuit(input);
  assert.equal(closed.status, 'operating');
  assert.equal(closed.components.l.active, true);
  close(closed.components.l.brightness, (3 / 30.1001) ** 2 * 30 / 0.3);
});

test('legacy closed switch asset sets its physical electrical state', () => {
  const legacy = component('s', 'switch');
  legacy.assetId = 'switch-closed';
  assert.equal(getComponentParameters(legacy).switchClosed, true);
  legacy.parameters = { switchClosed: false };
  assert.equal(getComponentParameters(legacy).switchClosed, false);
});

test('direct cell short has finite limited current and explicit short status', () => {
  const result = simulateCircuit(graph([component('b', 'battery')], [['b.positive', 'b.negative']]));
  assert.equal(result.status, 'short_circuit');
  close(result.totalCurrent, 30);
  close(result.components.b.voltage, 0);
  assert.ok(result.warnings.some(warning => warning.type === 'short_circuit'));
});

test('independent source islands solve without a shared artificial ground wire', () => {
  const result = simulateCircuit(graph([component('b1', 'battery'), component('r1', 'resistor', { resistance: 9.9 }), component('b2', 'battery', { voltage: 6 }), component('r2', 'resistor', { resistance: 19.9 }), component('loose', 'resistor')], [['b1.positive', 'r1.left'], ['r1.right', 'b1.negative'], ['b2.positive', 'r2.left'], ['r2.right', 'b2.negative']]));
  close(result.components.r1.current, 0.3);
  close(result.components.r2.current, 0.3);
  close(result.components.loose.current, 0);
});

test('ammeter measures signed current and chooses range from the wired binding post', () => {
  const input = graph([component('b', 'battery'), component('a', 'ammeter'), component('r', 'resistor', { resistance: 9.88 })], [['b.positive', 'a.right'], ['a.left', 'r.left'], ['r.right', 'b.negative']]);
  const low = simulateCircuit(input).components.a;
  close(low.reading, 0.3);
  close(low.range, 0.6);
  assert.equal(low.meterStatus, 'ok');
  input.connections[0].to = 'a.high';
  const high = simulateCircuit(input).components.a;
  close(high.reading, 3 / (0.1 + 9.88 + 0.004));
  close(high.range, 3);
  input.connections[0].to = 'a.left';
  input.connections[1].from = 'a.right';
  const reversed = simulateCircuit(input).components.a;
  close(reversed.reading, -0.3);
  assert.equal(reversed.meterStatus, 'reverse');
});

test('voltmeter loading is modeled while manual pointer settings leave electrical results untouched', () => {
  const input = graph([component('b', 'battery'), component('r', 'resistor', { resistance: 9.9 }), component('v', 'voltmeter', { meterMode: 'manual', manualReading: 2 })], [['b.positive', 'r.left'], ['r.right', 'b.negative'], ['v.left', 'r.left'], ['v.right', 'r.right']]);
  const result = simulateCircuit(input);
  const equivalent = 1 / (1 / 9.9 + 1 / 1e6);
  close(result.components.v.reading, 3 * equivalent / (equivalent + 0.1));
  close(result.components.v.calculatedReading, result.components.v.reading!);
  close(result.components.v.range, 3);
  input.connections[2].from = 'v.high';
  close(simulateCircuit(input).components.v.range, 15);
});

test('voltmeter measures an open switch without claiming the lamp is lit', () => {
  const input = graph([component('b', 'battery'), component('s', 'switch'), component('l', 'lamp'), component('v', 'voltmeter')], [['b.positive', 's.left'], ['s.right', 'l.left'], ['l.right', 'b.negative'], ['v.left', 's.left'], ['v.right', 's.right']]);
  const result = simulateCircuit(input);
  close(result.components.v.reading, 3 * 1e6 / (1e6 + 30.1));
  assert.equal(result.components.v.meterStatus, 'ok');
  assert.equal(result.components.l.active, false);
  assert.equal(result.status, 'open');
});

test('meters diagnose floating, missing common, both positive taps and overload', () => {
  const input = graph([component('b', 'battery', { voltage: 6 }), component('v', 'voltmeter')], []);
  assert.equal(simulateCircuit(input).components.v.meterStatus, 'floating');
  assert.equal(simulateCircuit(input).components.v.reading, undefined);
  assert.equal(simulateCircuit(input).components.v.calculatedReading, undefined);
  input.connections.push({ id: 'w1', from: 'b.positive', to: 'v.left' });
  assert.equal(simulateCircuit(input).components.v.meterStatus, 'miswired');
  assert.equal(simulateCircuit(input).components.v.reading, undefined);
  input.connections.push({ id: 'w2', from: 'b.negative', to: 'v.right' });
  assert.equal(simulateCircuit(input).components.v.meterStatus, 'overload');
  input.connections.push({ id: 'w3', from: 'b.positive', to: 'v.high' });
  assert.equal(simulateCircuit(input).components.v.meterStatus, 'miswired');
});

test('galvanometer supports center-zero signed current instead of declaring reverse polarity', () => {
  const input = graph([component('b', 'battery'), component('g', 'galvanometer'), component('r', 'resistor', { resistance: 9900 })], [['b.positive', 'g.left'], ['g.right', 'r.left'], ['r.right', 'b.negative']]);
  const state = simulateCircuit(input).components.g;
  close(state.reading, -3 / 10000.1);
  assert.equal(state.meterStatus, 'ok');
});

test('a voltmeter between two isolated source islands has no shared reference', () => {
  const input = graph([component('b1', 'battery'), component('b2', 'battery'), component('v', 'voltmeter')], [['b1.positive', 'v.left'], ['b2.positive', 'v.right']]);
  assert.equal(simulateCircuit(input).components.v.meterStatus, 'floating');
  assert.equal(simulateCircuit(input).components.v.reading, undefined);
});

test('rheostat four-terminal topology uses two resistor sections and a shared rail', () => {
  const input = graph([component('b', 'battery'), component('r', 'rheostat', { maxResistance: 20, sliderPosition: 0.25 })], [['b.positive', 'r.a'], ['r.d', 'b.negative']]);
  close(simulateCircuit(input).totalCurrent, 3 / 5.1);
  close(simulateCircuit(input).components.r.effectiveResistance, 5);
  input.components[1].parameters!.sliderPosition = 0.75;
  close(simulateCircuit(input).totalCurrent, 3 / 15.1);
  input.connections[0].to = 'r.b';
  close(simulateCircuit(input).totalCurrent, 3 / 5.1);
  input.connections[1].from = 'r.a';
  close(simulateCircuit(input).totalCurrent, 3 / 20.1);
  close(simulateCircuit(input).components.r.effectiveResistance, 20);
  input.connections[0].to = 'r.c'; input.connections[1].from = 'r.d';
  const rail = simulateCircuit(input);
  assert.equal(rail.status, 'short_circuit');
  close(rail.totalCurrent, 30);
});

test('potentiometer provides a loaded three-terminal voltage divider', () => {
  const input = graph([component('b', 'battery'), component('p', 'potentiometer', { maxResistance: 20, sliderPosition: 0.25 }), component('v', 'voltmeter')], [['b.positive', 'p.a'], ['p.b', 'b.negative'], ['v.left', 'p.w'], ['v.right', 'p.b']]);
  const lower = 1 / (1 / 15 + 1 / 1e6);
  close(simulateCircuit(input).components.v.reading, 3 * lower / (5.1 + lower));
});

test('SPDT powers only the selected branch and can disconnect both branches', () => {
  const input = graph([component('b', 'battery'), component('s', 'switch_spdt'), component('l1', 'lamp'), component('l2', 'lamp')], [['b.positive', 's.common'], ['s.left', 'l1.left'], ['s.right', 'l2.left'], ['l1.right', 'b.negative'], ['l2.right', 'b.negative']]);
  assert.equal(simulateCircuit(input).components.l1.active, true);
  assert.equal(simulateCircuit(input).components.l2.active, false);
  input.components[1].parameters!.switchPosition = 'right';
  assert.equal(simulateCircuit(input).components.l1.active, false);
  assert.equal(simulateCircuit(input).components.l2.active, true);
  input.components[1].parameters!.switchPosition = 'open';
  assert.equal(simulateCircuit(input).status, 'open');
});

test('lamp power above its rating is flagged and buzzer assumptions are explicit', () => {
  const input = graph([component('b', 'battery', { voltage: 6 }), component('l', 'lamp'), component('z', 'buzzer')], [['b.positive', 'l.left'], ['l.right', 'b.negative'], ['z.left', 'l.left'], ['z.right', 'l.right']]);
  const result = simulateCircuit(input);
  assert.equal(result.components.l.brightness, 1);
  assert.ok(result.warnings.some(warning => warning.componentId === 'l' && warning.type === 'overload'));
  assert.ok(result.warnings.some(warning => warning.componentId === 'z' && warning.type === 'simulation_limit'));
  assert.equal(result.components.z.active, true);
});

test('empty and unpowered circuits are finite and have no_source status', () => {
  assert.equal(simulateCircuit(graph([], [])).status, 'no_source');
  const result = simulateCircuit(graph([component('r', 'resistor'), component('v', 'voltmeter')], []));
  assert.equal(result.status, 'no_source');
  assert.ok(Object.values(result.terminalVoltages).every(value => value === 0));
});

test('schema preserves simulation settings, legacy sliders and independent real orientation', () => {
  const input = graph([component('p', 'potentiometer', { sliderPosition: 0.7, maxResistance: 100 }), component('r', 'rheostat')], []);
  input.components[0].realOrientation = 'vertical';
  input.components[1].rheostatConfig = { activeTerminals: ['a', 'c'], sliderPosition: 0.3 };
  assert.deepEqual(parseCircuitGraph(input), input);
  close(getComponentParameters(input.components[1]).sliderPosition, 0.3);
});

test('schema rejects malformed or unbounded electrical settings before solving', () => {
  for (const parameters of [{ resistance: NaN }, { resistance: Infinity }, { resistance: -1 }, { maxResistance: 1e12 }, { sliderPosition: 1.01 }, { ratedPower: 0 }, { switchClosed: 'yes' }, { meterMode: 'bad' }, { manualReading: Infinity }, { unknown: 2 }]) {
    const input = graph([component('r', 'resistor', parameters as ComponentParameters)], []);
    assert.equal(parseCircuitGraph(input), null, JSON.stringify(parameters));
  }
});

test('a series battery pack reports its port current once, while multiple supply ports have no single total', () => {
  const input = graph([component('b1', 'battery'), component('b2', 'battery'), component('r', 'resistor', { resistance: 9.8 })],
    [['b1.negative', 'b2.positive'], ['b1.positive', 'r.left'], ['r.right', 'b2.negative']]);
  const result = simulateCircuit(input);
  close(result.components.r.current, 0.6);
  close(result.totalCurrent, 0.6);
  // A load on the middle tap creates another supply port, even if its current is small.
  input.components.push(component('tap', 'resistor', { resistance: 100 }));
  input.connections.push({ id: 't1', from: 'b1.negative', to: 'tap.left' }, { id: 't2', from: 'tap.right', to: 'b2.negative' });
  assert.equal(simulateCircuit(input).totalCurrent, null);
  const separate = graph([component('b1', 'battery'), component('b2', 'battery'), component('r1', 'resistor'), component('r2', 'resistor')],
    [['b1.positive', 'r1.left'], ['r1.right', 'b1.negative'], ['b2.positive', 'r2.left'], ['r2.right', 'b2.negative']]);
  assert.equal(simulateCircuit(separate).totalCurrent, null);
});

test('parallel batteries report net port current without counting charging/circulating current as load current', () => {
  const input = graph([component('b1', 'battery', { voltage: 3 }), component('b2', 'battery', { voltage: 2 }), component('r', 'resistor')],
    [['b1.positive', 'b2.positive'], ['b1.negative', 'b2.negative'], ['b1.positive', 'r.left'], ['r.right', 'b1.negative']]);
  const result = simulateCircuit(input);
  assert.ok(result.components.b2.current < 0);
  close(result.totalCurrent, result.components.r.current);
  close(result.components.b1.current + result.components.b2.current, result.components.r.current);
});

test('parallel and bridge loads are checked by their equivalent resistance', () => {
  const parts = [component('b', 'battery'), ...[0, 1, 2].map(i => component(`r${i}`, 'resistor', { resistance: 0.2 }))];
  const pairs = [0, 1, 2].flatMap(i => [['b.positive', `r${i}.left`], [`r${i}.right`, 'b.negative']]);
  const result = simulateCircuit(graph(parts, pairs));
  close(result.totalCurrent, 18);
  assert.equal(result.status, 'short_circuit');
  assert.ok(result.warnings.some(warning => warning.type === 'short_circuit' && warning.componentId === 'b'));
  parts[1].parameters!.resistance = 10;
  parts[2].parameters!.resistance = 10;
  parts[3].parameters!.resistance = 10;
  assert.equal(simulateCircuit(graph(parts, pairs)).status, 'operating');
  const bridge = graph([component('b', 'battery'), ...[1, 2, 3, 4, 5].map(i => component(`r${i}`, 'resistor', { resistance: i === 5 ? 1 : 0.09 }))],
    [['b.positive', 'r1.left'], ['r1.right', 'r2.left'], ['r2.right', 'b.negative'],
      ['b.positive', 'r3.left'], ['r3.right', 'r4.left'], ['r4.right', 'b.negative'], ['r5.left', 'r1.right'], ['r5.right', 'r3.right']]);
  assert.equal(simulateCircuit(bridge).status, 'short_circuit');
  close(simulateCircuit(bridge).totalCurrent, 3 / 0.19);
});

test('closed high-resistance loops remain operating independently of visual current thresholds', () => {
  for (const voltage of [0.001, 3, 15]) {
    const result = simulateCircuit(graph([component('b', 'battery', { voltage }), component('r', 'resistor', { resistance: 1e9 })],
      [['b.positive', 'r.left'], ['r.right', 'b.negative']]));
    assert.equal(result.status, 'operating');
    assert.ok(!result.warnings.some(warning => warning.type === 'open_circuit'));
    const expectedCurrent = voltage / (1e9 + .1);
    for (const current of [result.totalCurrent!, result.components.b.current, result.components.r.current,
      ...Object.values(result.wireCurrents).map(Math.abs)]) {
      assert.ok(Math.abs(current / expectedCurrent - 1) < 1e-6, `${current} must retain real small current ${expectedCurrent}`);
    }
    assert.ok(Math.abs(result.components.r.power / (expectedCurrent ** 2 * 1e9) - 1) < 1e-6);
  }
  for (const voltage of [3, 15, 100]) {
    const meterOnly = simulateCircuit(graph([component('b', 'battery', { voltage }), component('v', 'voltmeter')],
      [['b.positive', 'v.left'], ['v.right', 'b.negative']]));
    assert.equal(meterOnly.status, 'open');
  }
});

test('series battery packs detect low external resistance and direct source-loop shorts', () => {
  const input = graph([component('b1', 'battery'), component('b2', 'battery'), component('r', 'resistor', { resistance: .01 })],
    [['b1.negative', 'b2.positive'], ['b1.positive', 'r.left'], ['r.right', 'b2.negative']]);
  const loaded = simulateCircuit(input);
  assert.equal(loaded.status, 'short_circuit');
  close(loaded.totalCurrent, 6 / .21);
  assert.ok(loaded.warnings.some(warning => warning.type === 'short_circuit'));
  const shorted = simulateCircuit(graph(input.components.slice(0, 2), [['b1.negative', 'b2.positive'], ['b1.positive', 'b2.negative']]));
  assert.equal(shorted.status, 'short_circuit');
  assert.equal(shorted.totalCurrent, null, 'a closed source loop must not report misleading zero supply current');
  close(shorted.components.b1.current, 30);
  close(shorted.components.b2.current, 30);
  assert.ok(shorted.warnings.some(warning => warning.message.includes('环流')));
});

test('parallel cells preserve their net load current and diagnose internal circulation separately', () => {
  const input = graph([component('b1', 'battery'), component('b2', 'battery'), component('r', 'resistor')],
    [['b1.positive', 'b2.positive'], ['b1.negative', 'b2.negative'], ['b1.positive', 'r.left'], ['r.right', 'b1.negative']]);
  const normal = simulateCircuit(input);
  assert.equal(normal.status, 'operating');
  assert.ok(!normal.warnings.some(warning => warning.type === 'short_circuit' || warning.type === 'polarity_error'));
  input.components[1].parameters!.voltage = 2;
  const charging = simulateCircuit(input);
  assert.equal(charging.status, 'operating');
  close(charging.totalCurrent, charging.components.r.current);
  assert.ok(charging.components.b2.current < 0);
  assert.ok(charging.warnings.some(warning => warning.message.includes('环流')));
});

test('an open side branch remains exactly zero next to a real picoampere load', () => {
  const input = graph([component('b', 'battery', { voltage: .001 }), component('r', 'resistor', { resistance: 1e9 }), component('open', 'resistor')],
    [['b.positive', 'r.left'], ['r.right', 'b.negative'], ['b.positive', 'open.left']]);
  const result = simulateCircuit(input);
  assert.equal(result.components.open.current, 0);
  assert.equal(result.components.open.power, 0);
  assert.equal(result.wireCurrents.wire2, 0);
  assert.ok(Math.abs(result.components.r.current / 1e-12 - 1) < 1e-6);
});

test('loaded potentiometers expose each section and the actual A-B terminal voltage', () => {
  const result = simulateCircuit(graph([component('b', 'battery'), component('p', 'potentiometer', { maxResistance: 20, sliderPosition: 0.25 }), component('r', 'resistor')],
    [['b.positive', 'p.a'], ['p.b', 'b.negative'], ['p.w', 'r.left'], ['r.right', 'p.b']]));
  const p = result.components.p;
  close(p.voltage, 3 * 11 / 11.1);
  assert.deepEqual(p.measurementTerminals, ['a', 'b']);
  assert.equal(p.effectiveResistance, undefined, 'three ports have no single resistance');
  assert.equal(p.branches?.length, 2);
  const [upper, lower] = p.branches!;
  close(upper.voltage + lower.voltage, p.voltage);
  close(upper.current, lower.current + result.components.r.current);
  close(upper.power + lower.power, p.power);
  close(p.power + result.components.r.power, result.components.b.power);
});

test('a rheostat with joined fixed ends reports the two sections in parallel', () => {
  const result = simulateCircuit(graph([component('b', 'battery'), component('r', 'rheostat', { maxResistance: 20, sliderPosition: 0.25 })],
    [['b.positive', 'r.a'], ['r.a', 'r.b'], ['r.c', 'b.negative']]));
  close(result.components.r.effectiveResistance, 3.75);
  close(result.components.r.current, 3 / 3.85);
  close(result.components.r.voltage, result.components.b.voltage);
});

test('lamp overload begins above its rating and clears without inventing a burnt-out state', () => {
  const input = graph([component('b', 'battery', { voltage: 3.1 }), component('l', 'lamp')], [['b.positive', 'l.left'], ['l.right', 'b.negative']]);
  const overloaded = simulateCircuit(input);
  assert.ok(overloaded.components.l.power > 0.3 && overloaded.components.l.power < 0.36);
  assert.equal(overloaded.components.l.lampStatus, 'overload');
  assert.equal(overloaded.status, 'overload');
  assert.equal(overloaded.components.l.ratedPower, 0.3);
  assert.ok(overloaded.components.l.active);
  assert.ok(overloaded.warnings.some(warning => warning.componentId === 'l' && warning.type === 'overload' && warning.severity === 'error'));
  input.components[0].parameters!.voltage = 3.01; // Exactly rated terminal voltage after the source's internal drop.
  assert.equal(simulateCircuit(input).components.l.lampStatus, 'normal');
  input.components[0].parameters!.voltage = 0;
  assert.equal(simulateCircuit(input).components.l.lampStatus, 'off');
});
