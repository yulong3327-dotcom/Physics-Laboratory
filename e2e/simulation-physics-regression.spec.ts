import { test, expect } from '@playwright/test'
import { createOpticalComponent, createOpticsScene } from '../src/optics/library'
import { componentLibrary } from '../src/data/componentLibrary'
import type { CircuitComponent, CircuitGraph } from '../src/types/circuit'

for (const [kind, objectX, nature, expectedX, expectedY] of [
  ['convex-lens', 20, 'real', 70, 34 + 4 / 3],
  ['convex-lens', 42, 'virtual', 26, 28],
  ['concave-lens', 20, 'virtual', 50 - 60 / 7, 34 - 4 / 7],
] as const) {
  test(`off-axis ${kind} ${nature} image remains visible after moving the object`, async ({ page }, info) => {
    const mobile = info.project.name === 'mobile'
    await page.goto('./#optics')
    const scene = { ...createOpticsScene(), components: [
      { ...createOpticalComponent('object', objectX, 34), height: 8 }, createOpticalComponent(kind, 50, 34),
    ] }
    await page.getByLabel('导入光学工程文件', { exact: true }).setInputFiles({ name: 'off-axis.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(scene)) })
    await page.locator('[data-optics-kind="object"]').click()
    // Move the base 6 cm away from the lens axis through the real editor.
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowDown')
    const image = page.getByTestId('optics-image')
    await expect(image).toHaveCount(1)
    await expect(image).toHaveAttribute('data-image-nature', nature)
    await expect.poll(async () => Number(await image.getAttribute('data-image-x'))).toBeCloseTo(expectedX, 4)
    await expect.poll(async () => Number(await image.getAttribute('data-image-y'))).toBeCloseTo(expectedY, 4)
    if (nature === 'virtual') await expect(page.locator('[data-testid="optics-ray"][data-virtual="true"]')).toHaveCount(3)
    if (mobile) await page.getByRole('button', { name: '打开光学属性面板', exact: true }).click()
    await expect(page.getByTestId('optics-image-measurement')).toContainText(nature === 'real' ? '实像' : '虚像')
    if (mobile) await page.getByRole('button', { name: '关闭光学属性面板', exact: true }).click()
    await page.screenshot({ path: `artifacts/off-axis-${kind}-${nature}-${info.project.name}.png`, fullPage: true })
  })
}

test('lamp overload is distinct from ordinary illumination in schematic and physical views', async ({ page }, info) => {
  const components: CircuitComponent[] = [
    { id: 'b', type: 'battery', label: '6 V 电源', position: { x: 200, y: 180 }, orientation: 'horizontal', terminals: structuredClone(componentLibrary.battery.terminals), parameters: { voltage: 6 } },
    { id: 'l', type: 'lamp', label: '3 V / 0.3 W 灯泡', position: { x: 450, y: 180 }, orientation: 'horizontal', terminals: structuredClone(componentLibrary.lamp.terminals), parameters: { ratedVoltage: 3, ratedPower: .3 } },
  ]
  const graph: CircuitGraph = { id: 'overload-regression', components, connections: [{ id: 'w1', from: 'b.positive', to: 'l.left' }, { id: 'w2', from: 'l.right', to: 'b.negative' }], warnings: [], meta: { inputType: 'manual', createdAt: '2026-09-23T00:00:00Z' } }
  await page.goto('./#circuit')
  await page.locator('header input[type=file]').setInputFiles({ name: 'overload.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(graph)) })
  await page.getByRole('button', { name: '开始实验', exact: true }).click()
  await expect(page.getByTestId('simulation-status')).toHaveText('过载')
  const lamp = page.locator('.react-flow__node[data-id="l"]')
  await expect(lamp.getByTestId('node-reading')).toContainText('过载')
  await page.screenshot({ path: `artifacts/lamp-overload-schematic-${info.project.name}.png`, fullPage: true })
  await page.getByRole('button', { name: '实物图', exact: true }).click()
  await expect(lamp.getByTestId('node-reading')).toContainText('过载')
  await expect(lamp.locator('[data-lamp-status="overload"]')).toBeVisible()
  await page.screenshot({ path: `artifacts/lamp-overload-physical-${info.project.name}.png`, fullPage: true })
})
