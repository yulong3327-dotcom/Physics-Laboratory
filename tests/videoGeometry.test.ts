import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { svgPathProperties } from 'svg-path-properties'
import { componentLibrary } from '../src/data/componentLibrary'
import { getPhysicalAsset, getVisualOrientation } from '../src/data/physicalAssets'
import { hasLayoutOverlap } from '../src/lib/autoLayout'
import { currentParticleDistances } from '../src/lib/currentAnimation'
import { simulateCircuit } from '../src/lib/circuitSimulation'
import { exportCircuitGeometry, prepareCircuitGeometry } from '../src/lib/videoGeometry'
import { createPowerLessonProject } from '../src/lib/videoProject'
import { getWireEndpoint } from '../src/lib/wireRenderer'
import type { CircuitGeometry } from '../server/videoTypes'
import type { CircuitComponent, CircuitGraph, ComponentParameters, ComponentType } from '../src/types/circuit'

const resolveImage = async (src: string) => 'data:image/png;base64,' + (await readFile(resolve('public', src.replace(/^\//, '')))).toString('base64')
function component(id: string, type: ComponentType, parameters: ComponentParameters = {}): CircuitComponent {
  return { id, type, parameters, orientation: 'horizontal', position: { x: 0, y: 0 }, terminals: structuredClone(componentLibrary[type].terminals) }
}
function graph(components: CircuitComponent[], pairs: string[][]): CircuitGraph {
  return { id: 'real-video', components, connections: pairs.map(([from, to], i) => ({ id: 'w' + i, from, to })), warnings: [], meta: { inputType: 'manual', createdAt: '2026-09-09' } }
}
function single() { return graph([component('b', 'battery', { voltage: 16, internalResistance: 8 }), component('r', 'resistor', { resistance: 8 })], [['b.positive', 'r.left'], ['r.right', 'b.negative']]) }
function near(actual: number, expected: number, epsilon = 1e-7) { assert.ok(Math.abs(actual - expected) < epsilon, actual + ' != ' + expected) }
function attached(geometry: CircuitGeometry) {
  for (const wire of geometry.wires) {
    const endpoint = (id: string) => { const [c, p] = id.split('.'); return geometry.components.find(item => item.id === c)!.terminals[p] }
    const start = endpoint(wire.from), end = endpoint(wire.to), path = new svgPathProperties(wire.path)
    const a = path.getPointAtLength(0), b = path.getPointAtLength(path.getTotalLength())
    near(a.x, start.x); near(a.y, start.y); near(b.x, end.x); near(b.y, end.y)
  }
}

test('all seven lesson real scenes embed actual assets and use non-overlapping physical layouts while preserving schematic data', async () => {
  for (const asset of createPowerLessonProject().circuits) {
    const input = asset.graph as CircuitGraph, before = structuredClone(input)
    const { graph: physical, geometry } = await prepareCircuitGeometry(input, { viewMode: 'real', currentFlow: true, mode: asset.mode, resolveImage })
    assert.deepEqual(input, before)
    assert.equal(hasLayoutOverlap(physical.components, 'real'), false, asset.id)
    assert.deepEqual(physical.components.map(c => [c.id, c.position, c.orientation, c.parameters]), before.components.map(c => [c.id, c.position, c.orientation, c.parameters]))
    assert.equal(geometry.viewMode, 'real')
    for (const part of geometry.components) {
      assert.match(part.image!.dataUrl, /^data:image\/png;base64,/)
      assert.ok(part.image!.dataUrl.length > 100)
      assert.ok(!part.svg.includes('/assets/'))
      assert.equal(getVisualOrientation(physical.components.find(c => c.id === part.id)!, 'real'), 'horizontal')
    }
    attached(geometry)
    if (asset.mode === 'symbolic') {
      assert.equal(geometry.currentFlow, false)
      assert.ok(geometry.wires.every(w => w.current === undefined))
    } else assert.ok(geometry.wires.every(w => Number.isFinite(w.current)))
  }
})

test('physical poses, independent manual cable routes and rotated bitmap anchors survive export', async () => {
  const input = single()
  input.components[0].position = { x: 100, y: 70 }
  input.components[1].position = { x: 220, y: 70 }
  input.components[0].realPosition = { x: 250, y: 280 }
  input.components[1].realPosition = { x: 700, y: 340 }
  input.components[1].realOrientation = 'vertical'
  input.connections[0].routes = { schematic: { points: [{ x: 110, y: -100 }] }, real: { points: [{ x: 0, y: 0 }, { x: 400, y: 30 }, { x: 600, y: 50 }, { x: 900, y: 900 }] } }
  const before = structuredClone(input)
  const { graph: prepared, geometry } = await prepareCircuitGeometry(input, { viewMode: 'real', resolveImage })
  assert.deepEqual(prepared, before)
  assert.deepEqual(input, before)
  const resistor = geometry.components.find(c => c.id === 'r')!, asset = getPhysicalAsset('resistor')!
  assert.equal(resistor.image!.rotation, 90)
  near(resistor.image!.width, asset.width); near(resistor.image!.height, asset.height)
  near(resistor.x, 700); near(resistor.y, 340)
  for (const terminal of asset.terminals) {
    near(resistor.terminals[terminal.id].x, 700 - terminal.dy)
    near(resistor.terminals[terminal.id].y, 340 + terminal.dx)
  }
  assert.ok(geometry.bounds.y < 30, 'manual cable bends remain above the two physical components')
  attached(geometry)
  const standard = exportCircuitGeometry(prepared)
  assert.ok(standard.components.every(c => !c.image))
  near(standard.components.find(c => c.id === 'r')!.x, 220)
  attached(standard)
})

test('real auto-layout removes only stale real routes and keeps schematic routes unchanged', async () => {
  const input = single()
  input.connections[0].routes = { schematic: { points: [{ x: 50, y: -500 }] }, real: { points: [{ x: 5, y: 4 }] } }
  const { graph: prepared } = await prepareCircuitGeometry(input, { viewMode: 'real', resolveImage })
  assert.deepEqual(prepared.connections[0].routes?.schematic, input.connections[0].routes?.schematic)
  assert.equal(prepared.connections[0].routes?.real, undefined)
})

test('positive and reversed wire definitions drive the existing particles along the corresponding path direction in both views', async () => {
  const input = single()
  input.components.forEach((c, i) => { c.position = { x: 150 + i * 350, y: 200 } })
  input.connections[1] = { id: 'w1', from: 'b.negative', to: 'r.right' }
  for (const viewMode of ['schematic', 'real'] as const) {
    const { geometry } = await prepareCircuitGeometry(input, { viewMode, currentFlow: true, resolveImage })
    near(geometry.wires[0].current!, 2)
    near(geometry.wires[1].current!, -2)
    attached(geometry)
    for (const wire of geometry.wires) {
      const path = new svgPathProperties(wire.path), length = path.getTotalLength()
      const before = currentParticleDistances(length, wire.current!, 0)[0]
      const after = currentParticleDistances(length, wire.current!, 0.01)[0]
      if (wire.current! > 0) assert.ok(after > before && after < length / 2)
      else assert.ok(after > length / 2, 'negative current wraps backwards from the start of the path')
    }
  }
})

test('experimental and textbook current exports use their own physics without changing the old solver', () => {
  const input = single()
  const ideal = exportCircuitGeometry(input, { currentFlow: true, physicsModel: 'ideal_textbook' })
  const experimental = exportCircuitGeometry(input, { currentFlow: true, physicsModel: 'experiment' })
  near(ideal.wires[0].current!, 2)
  near(experimental.wires[0].current!, simulateCircuit(input).wireCurrents.w0)
  assert.ok(experimental.wires[0].current! < ideal.wires[0].current!)
})

test('lamp overload warnings survive numeric exports in both views even without current animation', async () => {
  const input = graph([component('b', 'battery', { voltage: 3.1 }), component('l', 'lamp')], [['b.positive', 'l.left'], ['l.right', 'b.negative']])
  for (const physicsModel of ['experiment', 'ideal_textbook'] as const) {
    for (const viewMode of ['schematic', 'real'] as const) {
      const { geometry } = await prepareCircuitGeometry(input, { physicsModel, viewMode, currentFlow: false, resolveImage })
      assert.match(geometry.components.find(part => part.id === 'l')!.svg, /data-lamp-status="overload"/)
      assert.ok(geometry.wires.every(wire => wire.current === undefined))
    }
  }
  const symbolic = exportCircuitGeometry(input, { mode: 'symbolic', physicsModel: 'experiment' })
  assert.doesNotMatch(symbolic.components.find(part => part.id === 'l')!.svg, /data-lamp-status="overload"/)
})

test('zero, inconsistent and indeterminate ideal wire currents never become fictitious flowing values', () => {
  const zero = single(); zero.components[0].parameters!.voltage = 0
  assert.ok(exportCircuitGeometry(zero, { currentFlow: true }).wires.every(w => w.current === 0))
  const inconsistent = single(); inconsistent.connections.push({ id: 'short', from: 'b.positive', to: 'b.negative' })
  assert.ok(exportCircuitGeometry(inconsistent, { currentFlow: true }).wires.every(w => w.current === undefined))
  const redundant = single(); redundant.connections.push({ ...redundant.connections[0], id: 'duplicate' })
  const geometry = exportCircuitGeometry(redundant, { currentFlow: true })
  assert.equal(geometry.wires.find(w => w.id === 'w0')!.current, undefined)
  assert.equal(geometry.wires.find(w => w.id === 'duplicate')!.current, undefined)
  near(geometry.wires.find(w => w.id === 'w1')!.current!, 2)
})

test('symbolic and disabled flow exports carry no numerical currents', () => {
  const input = single()
  for (const options of [{ currentFlow: false }, { currentFlow: true, mode: 'symbolic' as const }]) {
    const geometry = exportCircuitGeometry(input, options)
    assert.equal(geometry.currentFlow, false)
    assert.ok(geometry.wires.every(w => !Object.hasOwn(w, 'current')))
  }
})

test('dynamic physical layers are embedded independently from the bitmap and unknown meters do not claim zero', async () => {
  const parts = [component('s', 'switch', { switchClosed: false }), component('v', 'rheostat', { sliderPosition: 0.3 }), component('l', 'lamp'), component('a', 'ammeter')]
  parts[0].assetId = 'switch-closed'
  parts.forEach((c, i) => { c.realPosition = { x: 200 + i * 350, y: 300 } })
  const { geometry } = await prepareCircuitGeometry(graph(parts, []), { viewMode: 'real', mode: 'symbolic', resolveImage })
  const overlay = (id: string) => geometry.components.find(c => c.id === id)!.svg
  assert.match(overlay('s'), /data-switch-blade="open"/)
  assert.match(overlay('v'), /data-slider-position="0.3"/)
  assert.match(overlay('s'), /href="data:image\/png;base64,/)
  assert.match(overlay('v'), /href="data:image\/png;base64,/)
  assert.ok(!overlay('a').includes('data-meter-needle'))
  assert.ok(!overlay('l').includes('data-lamp-glow'))
  const switchPart = geometry.components.find(c => c.id === 's')!
  assert.ok(switchPart.height > switchPart.image!.height + 20, 'open blade extension remains inside component bounds')
})

test('CLI bounds enclose complete curved cables even far outside component rectangles', async () => {
  const input = single()
  input.components.forEach((c, i) => { c.realPosition = { x: 150 + i * 450, y: 250 } })
  input.connections[0].routes = { real: { points: [{ x: 0, y: 0 }, { x: 350, y: -800 }, { x: 1400, y: -550 }, { x: 900, y: 900 }] } }
  const { geometry } = await prepareCircuitGeometry(input, { viewMode: 'real', resolveImage })
  const { x, y, width, height } = geometry.bounds
  for (const wire of geometry.wires) {
    const path = new svgPathProperties(wire.path), length = path.getTotalLength()
    for (let d = 0; d <= length; d += 1) {
      const point = path.getPointAtLength(d)
      assert.ok(point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height)
    }
  }
  attached(geometry)
})

test('real geometry rejects unresolved bitmap URLs and cancelled preparation', async () => {
  assert.throws(() => exportCircuitGeometry(single(), { viewMode: 'real' }), /尚未嵌入/)
  const abort = new AbortController(); abort.abort()
  await assert.rejects(prepareCircuitGeometry(single(), { viewMode: 'real', signal: abort.signal, resolveImage }))
})

test('exported endpoints coincide with the live editor anchors for both independently rotated views', async () => {
  const input = single()
  input.components.forEach((c, i) => { c.position = { x: 100 + i * 150, y: 100 }; c.orientation = 'vertical'; c.realPosition = { x: 300 + i * 400, y: 400 }; c.realOrientation = i ? 'vertical' : 'horizontal' })
  for (const viewMode of ['schematic', 'real'] as const) {
    const { graph: prepared, geometry } = await prepareCircuitGeometry(input, { viewMode, resolveImage })
    for (const part of geometry.components) for (const [id, anchor] of Object.entries(part.terminals)) {
      const editor = getWireEndpoint(prepared.components.find(c => c.id === part.id), id, viewMode, prepared.connections)!
      near(anchor.x, editor.x); near(anchor.y, editor.y)
    }
    attached(geometry)
  }
})



test('new-script vertical source and resistor enclose all automatically routed schematic wires in CLI exports', () => {
  // Exact poses/topology from the reviewed 3-ohm/6-volt new-script project.
  for (const [voltage, resistance] of [[6, 3], [9, 3], [6, 6]]) {
    const input=graph([component('source','battery',{voltage,internalResistance:0}),component('r1','resistor',{resistance})], [['source.positive','r1.left'],['r1.right','source.negative']])
    input.components[0].position={x:200,y:180};input.components[0].orientation='vertical'
    input.components[1].position={x:380,y:180};input.components[1].orientation='vertical'
    const geometry=exportCircuitGeometry(input),{x,y,width,height}=geometry.bounds
    assert.ok(input.connections.every(w=>!w.routes),'the new-script generator relies on automatic routes')
    for(const wire of geometry.wires) {
      const path=new svgPathProperties(wire.path),length=path.getTotalLength()
      for(let d=0;d<=length;d+=1) {
        const point=path.getPointAtLength(d)
        assert.ok(point.x>=x&&point.x<=x+width&&point.y>=y&&point.y<=y+height,wire.id+' extends outside the exported frame')
      }
    }
    attached(geometry)
  }
})

test('preparing an existing real layout preserves deliberate overlap and hand-routed cables', async () => {
  const input=single()
  input.components[0].realPosition={x:220,y:240}
  input.components[1].realPosition={x:250,y:250}
  input.components[1].realOrientation='vertical'
  input.connections[0].routes={real:{points:[{x:0,y:0},{x:90,y:50},{x:90,y:400},{x:500,y:500}]}}
  assert.equal(hasLayoutOverlap(input.components,'real'),true)
  const before=structuredClone(input)
  const result=await prepareCircuitGeometry(input,{viewMode:'real',resolveImage})
  assert.deepEqual(result.graph,before)
  assert.deepEqual(input,before)
  for(const part of result.geometry.components){const pos=input.components.find(c=>c.id===part.id)!.realPosition!;near(part.x,pos.x);near(part.y,pos.y)}
  attached(result.geometry)
})
