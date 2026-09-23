import assert from 'node:assert/strict';
import test from 'node:test';
import { componentLibrary } from '../src/data/componentLibrary';
import { idealVoltageBetween, simulateIdealCircuit, type IdealQuantity } from '../src/lib/idealCircuitSimulation';
import { simulateCircuit } from '../src/lib/circuitSimulation';
import type { CircuitComponent, CircuitGraph, ComponentParameters, ComponentType } from '../src/types/circuit';

function component(id: string, type: ComponentType, parameters: ComponentParameters = {}): CircuitComponent {
  return { id, type, parameters, orientation: 'horizontal', position: { x: 0, y: 0 }, terminals: structuredClone(componentLibrary[type].terminals) };
}
function graph(components: CircuitComponent[], pairs: string[][]): CircuitGraph {
  return { id: 'ideal', components, connections: pairs.map(([from, to], number) => ({ id: 'w' + number, from, to })), warnings: [], meta: { inputType: 'manual', createdAt: '2026-09-09T00:00:00.000Z' } };
}
function close(quantity: IdealQuantity | undefined, expected: number, tolerance = 1e-8) {
  assert.equal(quantity?.status, 'defined', JSON.stringify(quantity));
  assert.ok(quantity?.status === 'defined' && Math.abs(quantity.value - expected) < tolerance, JSON.stringify(quantity) + ' should equal ' + expected);
}
function relativeClose(quantity: IdealQuantity | undefined, expected: number, tolerance = 1e-10) {
  assert.equal(quantity?.status, 'defined', JSON.stringify(quantity));
  assert.ok(quantity?.status === 'defined' && Math.abs((quantity.value - expected) / expected) < tolerance,
    JSON.stringify(quantity) + ' should equal ' + expected + ' within relative tolerance ' + tolerance);
}
function status(quantity: IdealQuantity | undefined, expected: IdealQuantity['status']) {
  assert.equal(quantity?.status, expected, JSON.stringify(quantity));
  if (quantity?.status !== 'defined') assert.equal(Object.hasOwn(quantity ?? {}, 'value'), false);
}
function series(voltage: number, resistances: number[]) {
  const components = [component('b', 'battery', { voltage, internalResistance: 123 }), ...resistances.map((resistance, i) => component('r' + (i + 1), 'resistor', { resistance }))];
  const pairs = [['b.positive', 'r1.left'], ['r' + resistances.length + '.right', 'b.negative']];
  for (let i = 1; i < resistances.length; i++) pairs.push(['r' + i + '.right', 'r' + (i + 1) + '.left']);
  return graph(components, pairs);
}
function parallel(voltage: number, resistances: number[]) {
  return graph([component('b', 'battery', { voltage }), ...resistances.map((resistance, i) => component('r' + (i + 1), 'resistor', { resistance }))],
    resistances.flatMap((_, i) => [['b.positive', 'r' + (i + 1) + '.left'], ['r' + (i + 1) + '.right', 'b.negative']]));
}

test('lesson single resistor: 8 ohm at 2 A consumes exactly 32 W, independent of source internal resistance', () => {
  const input = series(16, [8]), before = structuredClone(input);
  const result = simulateIdealCircuit(input);
  assert.equal(result.status, 'solved');
  close(result.components.r1.current, 2);
  close(result.components.r1.voltage, 16);
  close(result.components.r1.power, 32);
  close(result.components.b.power, 32);
  close(result.components.b.effectiveResistance === 0 ? { status: 'defined', value: 0 } : undefined, 0);
  assert.deepEqual(input, before);
  assert.ok(simulateCircuit(input).totalCurrent < 0.13, 'legacy source internal resistance remains in the old model');
});

test('lesson series example: P1=16 W across 4 ohm implies 48 W across 12 ohm', () => {
  const result = simulateIdealCircuit(series(32, [4, 12]));
  assert.equal(result.status, 'solved');
  close(result.components.r1.current, 2); close(result.components.r2.current, 2);
  close(result.components.r1.power, 16); close(result.components.r2.power, 48);
  close(result.totalCurrent, 2);
});

test('lesson parallel example: 10 and 15 ohm have powers 9 and 6 W', () => {
  const result = simulateIdealCircuit(parallel(Math.sqrt(90), [10, 15]));
  close(result.components.r1.power, 9); close(result.components.r2.power, 6);
  close(result.components.r1.voltage, Math.sqrt(90)); close(result.components.r2.voltage, Math.sqrt(90));
});

test('lesson three parallel resistors use reciprocal ratio 5:2:1 and powers 25,10,5 W', () => {
  const result = simulateIdealCircuit(parallel(10, [4, 10, 20]));
  [25, 10, 5].forEach((expected, i) => close(result.components['r' + (i + 1)].power, expected));
  close(result.totalCurrent, 4);
});

test('three series resistors have equal current and resistance-proportional power', () => {
  const result = simulateIdealCircuit(series(34, [4, 10, 20]));
  [4, 10, 20].forEach((expected, i) => { close(result.components['r' + (i + 1)].power, expected); close(result.components['r' + (i + 1)].current, 1); });
});

test('closed switches and ammeters impose zero voltage without perturbing current', () => {
  const input = graph([component('b', 'battery'), component('s', 'switch', { switchClosed: true }), component('a', 'ammeter', { resistance: 100 }), component('r', 'resistor')],
    [['b.positive', 's.left'], ['s.right', 'a.right'], ['a.left', 'r.left'], ['r.right', 'b.negative']]);
  const result = simulateIdealCircuit(input);
  close(result.components.r.current, 0.3);
  close(result.components.s.voltage, 0); close(result.components.a.voltage, 0);
  close(result.components.s.power, 0); close(result.components.a.power, 0);
  close(result.components.a.reading, 0.3);
  assert.equal(result.components.a.meterStatus, 'ok');
  input.connections[1].to = 'a.high';
  const high = simulateIdealCircuit(input);
  close(high.components.a.reading, 0.3);
  assert.equal(high.components.a.range, 3);
});

test('manual instrument pointer settings do not alter ideal physics', () => {
  const input = parallel(3, [10]);
  input.components.push(component('v', 'voltmeter', { resistance: 1, meterMode: 'manual', manualReading: 1 }));
  input.connections.push({ id: 'v1', from: 'v.left', to: 'b.positive' }, { id: 'v2', from: 'v.right', to: 'b.negative' });
  const result = simulateIdealCircuit(input);
  close(result.components.r1.current, 0.3); close(result.totalCurrent, 0.3);
  close(result.components.v.current, 0); close(result.components.v.power, 0); close(result.components.v.reading, 3);
});

test('an open switch carries zero current and can retain a defined source voltage', () => {
  const input = graph([component('b', 'battery'), component('s', 'switch'), component('r', 'resistor'), component('v', 'voltmeter')],
    [['b.positive', 's.left'], ['s.right', 'r.left'], ['r.right', 'b.negative'], ['v.left', 's.left'], ['v.right', 's.right']]);
  const result = simulateIdealCircuit(input);
  close(result.components.s.current, 0); close(result.components.s.power, 0);
  close(result.components.s.voltage, 3); close(result.components.v.reading, 3);
  close(result.components.r.current, 0);
});

test('an isolated open switch does not invent a voltage between floating contacts', () => {
  const result = simulateIdealCircuit(graph([component('s', 'switch')], []));
  close(result.components.s.current, 0); close(result.components.s.power, 0);
  status(result.components.s.voltage, 'indeterminate');
});

test('voltmeter between floating source islands has undefined reading but zero current', () => {
  const result = simulateIdealCircuit(graph([component('b1', 'battery', { voltage: 3 }), component('b2', 'battery', { voltage: 6 }), component('v', 'voltmeter')],
    [['b1.positive', 'v.left'], ['b2.positive', 'v.right']]));
  assert.equal(result.status, 'indeterminate');
  close(result.components.b1.voltage, 3); close(result.components.b2.voltage, 6);
  status(result.components.v.reading, 'indeterminate');
  assert.equal(result.components.v.meterStatus, 'floating');
  close(result.components.v.current, 0);
  status(idealVoltageBetween(result, 'b1.positive', 'b2.positive'), 'indeterminate');
});

test('source short circuit is inconsistent, not an invented finite short circuit current', () => {
  const result = simulateIdealCircuit(graph([component('b', 'battery')], [['b.positive', 'b.negative']]));
  assert.equal(result.status, 'inconsistent');
  status(result.totalCurrent, 'inconsistent'); status(result.components.b.current, 'inconsistent');
  status(result.wireCurrents.w0, 'inconsistent');
  assert.ok(result.diagnostics.maxResidual > 0.1);
});

test('finite small resistances retain Ohm law at large currents', () => {
  for (const resistance of [1e-8, 1e-12, 1e-15]) {
    const result = simulateIdealCircuit(series(3, [resistance]));
    assert.equal(result.status, 'solved');
    relativeClose(result.components.r1.current, 3 / resistance);
    relativeClose(result.components.r1.power, 9 / resistance);
    relativeClose(result.components.b.power, 9 / resistance);
    relativeClose(result.totalCurrent, 3 / resistance);
    assert.equal(result.warnings.some(warning => warning.type === 'short_circuit'), false);
  }
});

test('nonzero source short circuits remain inconsistent at tiny voltage scales', () => {
  for (const voltage of [1e-8, 1e-15, 1e-30]) {
    const result = simulateIdealCircuit(graph([component('b', 'battery', { voltage })], [['b.positive', 'b.negative']]));
    assert.equal(result.status, 'inconsistent');
    status(result.totalCurrent, 'inconsistent');
    assert.ok(result.warnings.some(warning => warning.type === 'short_circuit'));
  }
  const zeroSource = simulateIdealCircuit(graph([component('b', 'battery', { voltage: 0 })], [['b.positive', 'b.negative']]));
  assert.equal(zeroSource.status, 'indeterminate');
  close(zeroSource.components.b.power, 0);
});

test('normalizing very small resistances does not invent current in an open circuit', () => {
  for (const resistance of [1e-8, 1e-15, 1e13]) {
    const result = simulateIdealCircuit(graph([component('b', 'battery'), component('r', 'resistor', { resistance })],
      [['b.positive', 'r.left']]));
    assert.equal(result.status, 'solved');
    assert.deepEqual(result.components.r.current, { status: 'defined', value: 0 });
    assert.deepEqual(result.components.r.power, { status: 'defined', value: 0 });
    assert.deepEqual(result.totalCurrent, { status: 'defined', value: 0 });
    assert.deepEqual(result.wireCurrents.w0, { status: 'defined', value: 0 });
  }
});

test('an open lamp branch is exactly inactive alongside a real sub-picoampere load current', () => {
  const result = simulateIdealCircuit(graph([component('b', 'battery'), component('r', 'resistor', { resistance: 1e13 }), component('lamp', 'lamp')],
    [['b.positive', 'r.left'], ['r.right', 'b.negative'], ['b.positive', 'lamp.left']]));
  assert.equal(result.status, 'solved');
  relativeClose(result.components.r.current, 3e-13);
  relativeClose(result.totalCurrent, 3e-13);
  assert.deepEqual(result.components.lamp.current, { status: 'defined', value: 0 });
  assert.deepEqual(result.components.lamp.power, { status: 'defined', value: 0 });
  assert.deepEqual(result.wireCurrents.w2, { status: 'defined', value: 0 });
});

test('small nonzero voltages, currents and powers are not rounded to physical zero', () => {
  for (const [voltage, resistance] of [[3, 1e13], [1e-15, 10]]) {
    const result = simulateIdealCircuit(series(voltage, [resistance]));
    assert.equal(result.status, 'solved');
    relativeClose(result.components.r1.voltage, voltage);
    relativeClose(result.components.r1.current, voltage / resistance);
    relativeClose(result.components.r1.power, voltage ** 2 / resistance);
    relativeClose(result.components.b.power, voltage ** 2 / resistance);
    relativeClose(result.totalCurrent, voltage / resistance);
  }
});

test('different ideal sources in parallel are inconsistent', () => {
  const result = simulateIdealCircuit(graph([component('b1', 'battery'), component('b2', 'battery', { voltage: 6 })],
    [['b1.positive', 'b2.positive'], ['b1.negative', 'b2.negative']]));
  assert.equal(result.status, 'inconsistent');
  status(result.components.b1.voltage, 'inconsistent');
});

test('equal parallel ideal sources have indeterminate individual currents and a defined total', () => {
  const result = simulateIdealCircuit(graph([component('b1', 'battery'), component('b2', 'battery'), component('r', 'resistor')],
    [['b1.positive', 'b2.positive'], ['b1.negative', 'b2.negative'], ['b1.positive', 'r.left'], ['r.right', 'b1.negative']]));
  assert.equal(result.status, 'indeterminate');
  status(result.components.b1.current, 'indeterminate'); status(result.components.b2.current, 'indeterminate');
  close(result.components.b1.voltage, 3); close(result.components.r.current, 0.3); close(result.totalCurrent, 0.3);
});

test('series ideal cells report the supply port current only once, including zero-resistance contacts', () => {
  const result = simulateIdealCircuit(graph([component('b1', 'battery'), component('b2', 'battery'),
    component('s', 'switch', { switchClosed: true }), component('r', 'resistor')],
  [['b1.negative', 's.left'], ['s.right', 'b2.positive'], ['b1.positive', 'r.left'], ['r.right', 'b2.negative']]));
  assert.equal(result.status, 'solved');
  close(result.components.b1.current, 0.6); close(result.components.b2.current, 0.6);
  close(result.components.r.current, 0.6); close(result.totalCurrent, 0.6);
});

test('parallel strings of ideal series cells preserve a defined supply current', () => {
  const result = simulateIdealCircuit(graph([component('b1', 'battery'), component('b2', 'battery'),
    component('b3', 'battery'), component('b4', 'battery'), component('r', 'resistor')],
  [['b1.negative', 'b2.positive'], ['b3.negative', 'b4.positive'], ['b1.positive', 'b3.positive'],
    ['b2.negative', 'b4.negative'], ['b1.positive', 'r.left'], ['r.right', 'b2.negative']]));
  assert.equal(result.status, 'indeterminate');
  status(result.components.b1.current, 'indeterminate'); status(result.components.b3.current, 'indeterminate');
  close(result.components.r.current, 0.6); close(result.totalCurrent, 0.6);
});

test('independent source islands and tapped supplies do not invent a common total current', () => {
  const independent = simulateIdealCircuit(graph([component('b1', 'battery'), component('b2', 'battery'),
    component('r1', 'resistor'), component('r2', 'resistor')],
  [['b1.positive', 'r1.left'], ['r1.right', 'b1.negative'], ['b2.positive', 'r2.left'], ['r2.right', 'b2.negative']]));
  assert.equal(independent.status, 'solved');
  close(independent.components.r1.current, 0.3); close(independent.components.r2.current, 0.3);
  status(independent.totalCurrent, 'indeterminate');
  const tapped = simulateIdealCircuit(graph([component('b1', 'battery'), component('b2', 'battery'),
    component('r1', 'resistor'), component('r2', 'resistor')],
  [['b1.negative', 'b2.positive'], ['b1.positive', 'r1.left'], ['r1.right', 'b2.negative'],
    ['b2.positive', 'r2.left'], ['r2.right', 'b2.negative']]));
  assert.equal(tapped.status, 'solved');
  close(tapped.components.r1.current, 0.6); close(tapped.components.r2.current, 0.3);
  status(tapped.totalCurrent, 'indeterminate');
});

test('parallel ideal ammeters cannot uniquely divide current but load current remains defined', () => {
  const result = simulateIdealCircuit(graph([component('b', 'battery'), component('a1', 'ammeter'), component('a2', 'ammeter'), component('r', 'resistor')],
    [['b.positive', 'a1.right'], ['a1.right', 'a2.right'], ['a1.left', 'a2.left'], ['a1.left', 'r.left'], ['r.right', 'b.negative']]));
  assert.equal(result.status, 'indeterminate');
  status(result.components.a1.reading, 'indeterminate'); status(result.components.a2.reading, 'indeterminate');
  close(result.components.a1.voltage, 0); close(result.components.a1.power, 0);
  close(result.components.r.current, 0.3); close(result.totalCurrent, 0.3);
});

test('parallel ideal wires keep their arbitrary split out of the result', () => {
  const input = series(3, [10]);
  input.connections.push({ id: 'duplicate', from: 'b.positive', to: 'r1.left' });
  const result = simulateIdealCircuit(input);
  status(result.wireCurrents.w0, 'indeterminate'); status(result.wireCurrents.duplicate, 'indeterminate');
  close(result.components.r1.current, 0.3); close(result.wireCurrents.w1, 0.3);
});

test('a wire connected to itself has an indeterminate circulation current', () => {
  const result = simulateIdealCircuit(graph([component('r', 'resistor')], [['r.left', 'r.left']]));
  status(result.wireCurrents.w0, 'indeterminate');
  close(result.components.r.current, 0);
});

test('a contradictory island does not erase the valid solution of an independent island', () => {
  const result = simulateIdealCircuit(graph([component('bad', 'battery'), component('good', 'battery', { voltage: 16 }), component('r', 'resistor', { resistance: 8 })],
    [['bad.positive', 'bad.negative'], ['good.positive', 'r.left'], ['r.right', 'good.negative']]));
  assert.equal(result.status, 'inconsistent');
  status(result.components.bad.current, 'inconsistent'); close(result.components.r.power, 32);
});

test('rheostat slider extremes use exactly zero resistance and preserve rail currents', () => {
  const input = graph([component('b', 'battery'), component('r', 'rheostat', { maxResistance: 20, sliderPosition: 0 }), component('load', 'resistor')],
    [['b.positive', 'r.a'], ['r.d', 'load.left'], ['load.right', 'b.negative']]);
  const result = simulateIdealCircuit(input);
  close(result.components.load.current, 0.3); close(result.components.r.power, 0);
  close(result.components.r.terminalCurrents.a, 0.3); close(result.components.r.terminalCurrents.d, -0.3);
  input.connections[1].to = 'b.negative';
  assert.equal(simulateIdealCircuit(input).status, 'inconsistent');
});

test('rheostat and potentiometer retain their existing multi-terminal topology', () => {
  const input = graph([component('b', 'battery'), component('p', 'potentiometer', { maxResistance: 20, sliderPosition: 0.25 }), component('v', 'voltmeter')],
    [['b.positive', 'p.a'], ['p.b', 'b.negative'], ['v.left', 'p.w'], ['v.right', 'p.b']]);
  const result = simulateIdealCircuit(input);
  close(result.components.v.reading, 2.25); close(result.components.p.power, 0.45);
  close(result.components.p.terminalCurrents.a, 0.15);
  close(result.components.p.terminalCurrents.w, 0);
  status(result.components.p.current, 'indeterminate');
});

test('SPDT selects exactly one branch and can open both', () => {
  const input = graph([component('b', 'battery'), component('s', 'switch_spdt'), component('r1', 'resistor'), component('r2', 'resistor')],
    [['b.positive', 's.common'], ['s.left', 'r1.left'], ['s.right', 'r2.left'], ['r1.right', 'b.negative'], ['r2.right', 'b.negative']]);
  close(simulateIdealCircuit(input).components.r1.current, 0.3);
  close(simulateIdealCircuit(input).components.r2.current, 0);
  input.components[1].parameters!.switchPosition = 'right';
  close(simulateIdealCircuit(input).components.r1.current, 0);
  close(simulateIdealCircuit(input).components.r2.current, 0.3);
  input.components[1].parameters!.switchPosition = 'open';
  close(simulateIdealCircuit(input).components.s.current, 0); close(simulateIdealCircuit(input).totalCurrent, 0);
});

test('meter reverse, overload, missing terminal and simultaneous range connections remain explicit', () => {
  const input = graph([component('b', 'battery'), component('a', 'ammeter'), component('r', 'resistor')],
    [['b.positive', 'a.left'], ['a.right', 'r.left'], ['r.right', 'b.negative']]);
  const reversed = simulateIdealCircuit(input);
  close(reversed.components.a.reading, -0.3); assert.equal(reversed.components.a.meterStatus, 'reverse');
  input.components[2].parameters!.resistance = 1;
  assert.equal(simulateIdealCircuit(input).components.a.meterStatus, 'overload');
  input.connections.push({ id: 'extra', from: 'a.high', to: 'r.left' });
  const invalid = simulateIdealCircuit(input);
  assert.equal(invalid.components.a.meterStatus, 'miswired'); status(invalid.components.a.reading, 'indeterminate');
  const disconnected = simulateIdealCircuit(graph([component('a', 'ammeter')], []));
  assert.equal(disconnected.components.a.meterStatus, 'floating'); status(disconnected.components.a.reading, 'indeterminate');
});

test('galvanometer uses an ideal signed current measurement with no reverse warning', () => {
  const result = simulateIdealCircuit(graph([component('b', 'battery'), component('g', 'galvanometer'), component('r', 'resistor', { resistance: 10000 })],
    [['b.positive', 'g.left'], ['g.right', 'r.left'], ['r.right', 'b.negative']]));
  close(result.components.g.reading, -0.0003);
  assert.equal(result.components.g.meterStatus, 'ok');
});

test('invalid topology and nonfinite or negative parameters fail before numerical solving', () => {
  const broken = series(3, [10]);
  broken.connections[0].to = 'missing.left';
  assert.equal(simulateIdealCircuit(broken).status, 'error');
  for (const resistance of [-1, NaN, Infinity]) assert.equal(simulateIdealCircuit(series(3, [resistance])).status, 'error');
});

test('unpowered resistor and empty circuit have finite determinate zero-current solutions', () => {
  const result = simulateIdealCircuit(graph([component('r', 'resistor')], []));
  close(result.components.r.current, 0); close(result.components.r.voltage, 0);
  assert.equal(simulateIdealCircuit(graph([], [])).status, 'solved');
});
