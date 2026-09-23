import assert from 'node:assert/strict'
import test from 'node:test'
import { createOpticalComponent, opticalOrder, opticalOrientation, opticalOrientationAngle } from '../src/optics/library'

test('cardinal orientation maps to horizontal and vertical optical axes', () => {
  const lens = createOpticalComponent('convex-lens')
  assert.equal(opticalOrientationAngle(lens, 'horizontal'), 0)
  assert.equal(opticalOrientationAngle(lens, 'vertical'), 90)
  assert.equal(opticalOrientation({ ...lens, angle: 0 }), 'horizontal')
  assert.equal(opticalOrientation({ ...lens, angle: 90 }), 'vertical')
  assert.equal(opticalOrientation({ ...lens, angle: -90 }), 'vertical')
  assert.equal(opticalOrientation({ ...lens, angle: 180 }), 'horizontal')
})

test('all ordinary components use the same optical axis orientation', () => {
  for (const kind of opticalOrder) {
    const component = createOpticalComponent(kind)
    assert.equal(opticalOrientationAngle(component, 'horizontal'), 0)
    assert.equal(opticalOrientationAngle(component, 'vertical'), 90)
    assert.equal(opticalOrientation({ ...component, angle: 0 }), 'horizontal')
    assert.equal(opticalOrientation({ ...component, angle: 90 }), 'vertical')
  }
})

test('nearest cardinal direction wraps negative angles and angles near 180 degrees', () => {
  const lens = createOpticalComponent('convex-lens')
  for (const angle of [-360, -181, -179, -15, 15, 135, 179, 181, 345, 360]) {
    assert.equal(opticalOrientation({ ...lens, angle }), 'horizontal', `angle ${angle}`)
  }
  for (const angle of [-270, -100, -90, -46, 45, 75, 90, 134, 270]) {
    assert.equal(opticalOrientation({ ...lens, angle }), 'vertical', `angle ${angle}`)
  }
})
