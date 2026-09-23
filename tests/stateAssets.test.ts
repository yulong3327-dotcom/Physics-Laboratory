import assert from 'node:assert/strict'
import test from 'node:test'
import { componentLibrary } from '../src/data/componentLibrary'
import { physicalAssets, getComponentVisual } from '../src/data/physicalAssets'
import { componentImageSources, getPhysicalImageSource, renderPhysicalOverlay, symbolOptions } from '../src/lib/simulationVisual'
import { renderSymbol } from '../src/lib/circuitRenderer'
import type { CircuitComponent } from '../src/types/circuit'
import type { ComponentSimulationResult } from '../src/lib/circuitSimulation'

function component(assetId: string): CircuitComponent {
  const asset = physicalAssets[assetId]
  return { id: assetId, assetId, type: asset.type, position: { x: 20, y: 30 }, orientation: 'horizontal', terminals: structuredClone(componentLibrary[asset.type].terminals) }
}
const state = (brightness: number): ComponentSimulationResult => ({ brightness, voltage: 3, current: 0.1, power: brightness, active: brightness > 0 })

test('switch toggles only rotate an independently registered blade and preserve old draft geometry', () => {
  for (const id of ['switch-open', 'switch-closed']) {
    const comp = component(id), asset = physicalAssets[id]
    const before = structuredClone(getComponentVisual(comp, 'real'))
    const source = getPhysicalImageSource(comp, asset)
    for (let i = 0; i < 6; i++) {
      const closed = i % 2 === 0
      const toggled = { ...comp, parameters: { switchClosed: closed } }
      assert.equal(getPhysicalImageSource(toggled, asset), source)
      assert.deepEqual(getComponentVisual(toggled, 'real'), before)
      const overlay = renderPhysicalOverlay(toggled, asset)
      assert.match(overlay, new RegExp(`data-switch-blade="${closed ? 'closed' : 'open'}"`))
      assert.match(overlay, /preserveAspectRatio="xMidYMid meet" transform="rotate\(/)
      assert.doesNotMatch(overlay, /scale\(|matrix\(/, 'a rigid blade never scales or shears')
    }
  }
})

test('lamp power changes only a continuous glow layer and keeps identical base geometry', () => {
  for (const id of ['lamp-bulb', 'lamp-on']) {
    const comp = component(id), asset = physicalAssets[id]
    const source = getPhysicalImageSource(comp, asset, state(0))
    const before = structuredClone(getComponentVisual(comp, 'real'))
    let previousOpacity = -1
    for (const brightness of [0, 0.001, 0.01, 0.25, 0.5, 1]) {
      assert.equal(getPhysicalImageSource(comp, asset, state(brightness)), source)
      assert.deepEqual(getComponentVisual(comp, 'real'), before)
      const overlay = renderPhysicalOverlay(comp, asset, state(brightness))
      const opacity = Number(overlay.match(/opacity="([\d.]+)"/)?.[1])
      assert.ok(opacity > previousOpacity && opacity <= 1)
      assert.match(overlay, /preserveAspectRatio="xMidYMid meet"/)
      previousOpacity = opacity
    }
    assert.match(renderPhysicalOverlay(comp, asset), new RegExp(`data-lamp-glow="${asset.lampVisual!.defaultBrightness}"`))
    for (const src of [source, asset.lampVisual!.glowSrc]) assert.ok(componentImageSources(comp).includes(src), 'exports preload both static and dynamic layers')
  }
})

test('overloaded lamps have distinct schematic and physical warnings with actual and rated power', () => {
  for (const id of ['lamp-bulb', 'lamp-on']) {
    const comp = component(id), asset = physicalAssets[id]
    const overloaded: ComponentSimulationResult = { ...state(1), power: 0.32, lampStatus: 'overload', ratedPower: 0.3 }
    const normal: ComponentSimulationResult = { ...overloaded, power: 0.3, lampStatus: 'normal' }
    for (const markup of [renderPhysicalOverlay(comp, asset, overloaded), renderSymbol('lamp', false, undefined, symbolOptions(comp, overloaded))]) {
      assert.match(markup, /data-lamp-status="overload"/)
      assert.match(markup, /实际 0.32 W \/ 额定 0.3 W/)
      assert.match(markup, /烧毁风险/)
    }
    assert.doesNotMatch(renderPhysicalOverlay(comp, asset, normal), /data-lamp-status="overload"/)
    assert.doesNotMatch(renderSymbol('lamp', false, undefined, symbolOptions(comp, normal)), /data-lamp-status="overload"/)
    assert.equal(getPhysicalImageSource(comp, asset, overloaded), getPhysicalImageSource(comp, asset, normal), 'overload does not invent a burnt-out image')
  }
})
