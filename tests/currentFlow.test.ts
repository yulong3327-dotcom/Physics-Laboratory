import assert from 'node:assert/strict'
import test from 'node:test'
import { componentLibrary } from '../src/data/componentLibrary'
import { simulateCircuit } from '../src/lib/circuitSimulation'
import { currentParticleDistances, renderCurrentParticles } from '../src/lib/currentAnimation'
import { solveWireCurrents } from '../src/lib/wireCurrents'
import type { CircuitComponent, CircuitGraph, ComponentParameters, ComponentType } from '../src/types/circuit'

const close = (actual: number, expected: number, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`)
const component = (id: string, type: ComponentType, parameters?: ComponentParameters): CircuitComponent => ({
  id, type, parameters, position: { x: 0, y: 0 }, orientation: 'horizontal', terminals: structuredClone(componentLibrary[type].terminals),
})
const graph = (components: CircuitComponent[], pairs: [string, string][]): CircuitGraph => ({
  id: 'flow', components, connections: pairs.map(([from, to], i) => ({ id: `wire${i}`, from, to })), warnings: [],
  meta: { inputType: 'manual', createdAt: '2026-09-08T00:00:00.000Z' },
})

test('series wires carry source current and reversed stored endpoints reverse only the signed wire flow', () => {
  const input = graph([component('b', 'battery', { voltage: 6, internalResistance: 1 }), component('r', 'resistor', { resistance: 11 })],
    [['b.positive', 'r.left'], ['r.right', 'b.negative']])
  const result = simulateCircuit(input)
  assert.equal(result.status, 'operating')
  close(result.totalCurrent, 0.5)
  close(result.wireCurrents.wire0, 0.5)
  close(result.wireCurrents.wire1, 0.5)
  const reversed = structuredClone(input)
  reversed.connections[0] = { ...reversed.connections[0], from: 'r.left', to: 'b.positive' }
  const opposite = simulateCircuit(reversed)
  close(opposite.wireCurrents.wire0, -0.5)
  close(opposite.wireCurrents.wire1, 0.5)
  close(opposite.totalCurrent, result.totalCurrent)
  close(opposite.components.r.power, result.components.r.power)
})

test('parallel branches satisfy KCL at shared positive and negative binding posts', () => {
  const input = graph([component('b', 'battery', { voltage: 6, internalResistance: 1 }),
    component('r1', 'resistor', { resistance: 10 }), component('r2', 'resistor', { resistance: 20 })],
  [['b.positive', 'r1.left'], ['r1.left', 'r2.left'], ['r1.right', 'b.negative'], ['r2.right', 'r1.right']])
  const result = simulateCircuit(input)
  const total = 6 / (1 + 1 / (1 / 10 + 1 / 20))
  const terminalVoltage = 6 - total
  close(result.wireCurrents.wire0, total)
  close(result.wireCurrents.wire1, terminalVoltage / 20)
  close(result.wireCurrents.wire2, total)
  close(result.wireCurrents.wire3, terminalVoltage / 20)
  close(result.wireCurrents.wire0, result.components.r1.current + result.wireCurrents.wire1)
  close(result.wireCurrents.wire2, result.components.r1.current + result.wireCurrents.wire3)
})

test('opening a switch stops current on every lead and closing it restores finite flow', () => {
  const input = graph([component('b', 'battery'), component('s', 'switch', { switchClosed: false }), component('l', 'lamp')],
    [['b.positive', 's.left'], ['s.right', 'l.left'], ['l.right', 'b.negative']])
  const open = simulateCircuit(input)
  assert.equal(open.status, 'open')
  assert.deepEqual(Object.values(open.wireCurrents), [0, 0, 0])
  assert.equal(open.components.l.brightness, 0)
  input.components[1].parameters!.switchClosed = true
  const closed = simulateCircuit(input)
  assert.equal(closed.status, 'operating')
  for (const current of Object.values(closed.wireCurrents)) close(current, closed.totalCurrent)
  assert.ok(closed.components.l.brightness > 0)
})

test('rheostat rail carries current to the slider when the opposite external rail post is used', () => {
  const input = graph([component('b', 'battery', { voltage: 6, internalResistance: 1 }),
    component('r', 'rheostat', { maxResistance: 20, sliderPosition: 0.25 }), component('load', 'resistor', { resistance: 10 })],
  [['b.positive', 'r.d'], ['r.a', 'load.left'], ['load.right', 'b.negative']])
  const result = simulateCircuit(input)
  assert.equal(result.status, 'operating')
  for (const current of Object.values(result.wireCurrents)) close(current, 6 / 16)
  assert.deepEqual(Object.keys(result.wireCurrents).sort(), ['wire0', 'wire1', 'wire2'])
  input.components[1].parameters!.sliderPosition = 0.75
  const adjusted = simulateCircuit(input)
  for (const current of Object.values(adjusted.wireCurrents)) close(current, 6 / 26)
})

test('redundant ideal-wire loops use a finite deterministic flow that preserves each terminal KCL', () => {
  const wires = [
    { id: 'direct', from: 'source', to: 'load' },
    { id: 'first', from: 'source', to: 'junction' },
    { id: 'second', from: 'junction', to: 'load' },
    { id: 'idle', from: 'isolated-a', to: 'isolated-b' },
  ]
  const injections = new Map([['source', 0.6], ['load', -0.6]])
  const flows = solveWireCurrents(wires, injections)
  close(flows.direct, 0.4)
  close(flows.first, 0.2)
  close(flows.second, 0.2)
  assert.equal(flows.idle, 0)
  for (const endpoint of new Set(wires.flatMap(wire => [wire.from, wire.to]))) {
    const outgoing = wires.reduce((sum, wire) => sum + (wire.from === endpoint ? flows[wire.id] : 0) - (wire.to === endpoint ? flows[wire.id] : 0), 0)
    close(outgoing, injections.get(endpoint) || 0)
  }
  const reordered = solveWireCurrents([...wires].reverse(), injections)
  for (const wire of wires) close(reordered[wire.id], flows[wire.id])
})

test('a redundant external cable loop preserves the operating point and branch-current sum', () => {
  const input = graph([component('b', 'battery', { voltage: 6, internalResistance: 1 }), component('r', 'resistor', { resistance: 11 }), component('s', 'switch')],
    [['b.positive', 'r.left'], ['b.positive', 's.left'], ['s.left', 'r.left'], ['r.right', 'b.negative']])
  const result = simulateCircuit(input)
  close(result.totalCurrent, 0.5)
  close(result.wireCurrents.wire0, 1 / 3)
  close(result.wireCurrents.wire1, 1 / 6)
  close(result.wireCurrents.wire2, 1 / 6)
  close(result.wireCurrents.wire0 + result.wireCurrents.wire1, result.totalCurrent)
  close(result.wireCurrents.wire3, result.totalCurrent)
})

test('current particles advance in conventional-current direction and absent current produces no dots', () => {
  const length = 240
  const start = currentParticleDistances(length, 0.5, 0)
  const forward = currentParticleDistances(length, 0.5, 0.1)
  const reverse = currentParticleDistances(length, -0.5, 0.1)
  assert.equal(start.length, 5)
  assert.equal(start[0], 0)
  assert.ok(forward[0] > 0 && forward[0] < 20)
  assert.ok(reverse[0] > 220 && reverse[0] < length)
  close(forward[0], length - reverse[0])
  assert.ok([...forward, ...reverse].every(distance => distance >= 0 && distance < length))
  for (const current of [0, 1e-7, -1e-7, NaN, Infinity]) assert.deepEqual(currentParticleDistances(length, current, 10), [])
  assert.deepEqual(currentParticleDistances(0, 0.5, 10), [])
  assert.deepEqual(currentParticleDistances(-1, 0.5, 10), [])
})

test('exported dots sample the actual SVG wire path at the same directed distances as live animation', () => {
  const sampled: number[] = []
  const path = { getTotalLength: () => 100, getPointAtLength: (distance: number) => {
    sampled.push(distance)
    return { x: distance / 2, y: distance / 3 + 10 }
  } } as unknown as SVGPathElement
  const expected = currentParticleDistances(100, -0.2, 1)
  const markup = renderCurrentParticles(path, -0.2, 1)
  assert.deepEqual(sampled, expected)
  assert.equal([...markup.matchAll(/<g transform=/g)].length, expected.length)
  assert.match(markup, /fill="#ffe45c"/)
  for (const distance of expected) assert.ok(markup.includes(`translate(${distance / 2} ${distance / 3 + 10})`))
  assert.equal(renderCurrentParticles(path, 0, 1), '')
})

test('extreme wire lengths have a bounded particle count and invalid animation inputs are rejected', () => {
  for (const length of [1e6, 1e12]) {
    for (const current of [0.5, -0.5]) {
      const particles = currentParticleDistances(length, current, 10)
      assert.equal(particles.length, 256)
      assert.ok(particles.every(distance => Number.isFinite(distance) && distance >= 0 && distance < length))
    }
  }
  for (const invalid of [Infinity, -Infinity, NaN]) {
    assert.deepEqual(currentParticleDistances(invalid, 0.5, 10), [])
    assert.deepEqual(currentParticleDistances(100, invalid, 10), [])
    assert.deepEqual(currentParticleDistances(100, 0.5, invalid), [])
  }
})
