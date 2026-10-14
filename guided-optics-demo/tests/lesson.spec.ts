import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { optics } from '../src/model'
import { trials, wrongCells } from '../src/lesson'

mkdirSync('artifacts', { recursive: true })

async function next(page: Page) { await page.getByRole('button', { name: '进入下一步', exact: true }).click() }
async function observe(page: Page) {
  await page.getByRole('button', { name: '确认位置，观察结果' }).click()
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '确认判断' })).toHaveCount(0)
  if (await page.getByTestId('ray-paths').count()) {
    await expect(page.getByTestId('ray-paths')).toBeVisible()
    await expect(page.getByTestId('screen-preview')).toBeVisible()
  }
}
async function judge(page: Page, answer: string) {
  await page.getByRole('button', { name: '已观察，开始判断' }).click()
  await page.getByRole('button', { name: answer, exact: false }).click()
  await page.getByRole('button', { name: '确认判断', exact: true }).click()
  await expect(page.getByRole('button', { name: '进入下一步' })).toBeVisible()
}

test('thin-lens engine focuses real images and preserves virtual and infinity cases', () => {
  for (const [u, v, mag] of [[30,15,-.5],[20,20,-1],[15,30,-2],[6,-15,2.5]]) {
    const result = optics(u, Math.abs(v), false, v < 0)
    expect(result.v).toBeCloseTo(v)
    expect(result.magnification).toBeCloseTo(mag)
    expect(result.segments.length).toBeGreaterThanOrEqual(4)
    if (v > 0) {
      expect(result.focused).toBe(true)
      expect(result.screenHits.length).toBeGreaterThanOrEqual(2)
      for (const hit of result.screenHits) expect(hit.point.y).toBeCloseTo(25 - 1.4 * mag)
      expect(optics(u, Math.abs(v) + 4, false, false).blur).toBeGreaterThan(0)
    } else expect(result.segments.some(s => s.virtual)).toBe(true)
  }
  expect(optics(10,20,false,false).v).toBe(Infinity)
  expect(optics(30,10,true,false).focused).toBe(true)
  const rows = trials.map(t => ({ v: t.v, orientation: t.orientation, size: t.size, nature: t.nature }))
  expect(wrongCells(rows)).toEqual([])
  expect(wrongCells(rows.map((r,i) => i === 0 ? { ...r, v: 'abc' } : r))).toContain('0-v')
})

test('student sees live results before judging and completes the locked course', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({ width: 1440, height: 1050 })
  await page.goto('/')
  await expect(page.getByText('按顺序摆放蜡烛、凸透镜与光屏。')).toBeVisible()
  for (const name of ['放置蜡烛','放置凸透镜','放置光屏']) await page.getByRole('button', { name, exact: true }).click()
  await next(page)
  await expect(page.getByText('怎样调整器材，才能让烛焰的像落在光屏中央？')).toBeVisible()
  await page.getByRole('slider', { name: '调节火焰高度' }).fill('0')
  await observe(page)
  await judge(page, '三者中心大致处于同一高度')
  await next(page)
  await page.getByRole('slider', { name: '调节光屏距透镜的距离' }).fill('10')
  await observe(page)
  await judge(page, '10 cm')
  await next(page)

  for (let i = 0; i < trials.length; i++) {
    const t = trials[i]
    await expect(page.getByRole('slider', { name: '调节光屏距透镜的距离' })).toHaveCount(0)
    await page.getByRole('slider', { name: '调节蜡烛与透镜的距离' }).fill(String(t.u))
    await page.getByRole('button', { name: '确认物距' }).click()
    if (i < 3) {
      const before = await page.getByTestId('screen-preview').getAttribute('data-blur')
      await page.getByRole('slider', { name: '调节光屏距透镜的距离' }).fill(t.v)
      expect(Number(await page.getByTestId('screen-preview').getAttribute('data-blur'))).toBe(0)
      expect(Number(before)).toBeGreaterThan(0)
    } else {
      await expect(page.getByRole('button', { name: '确认位置，观察结果' })).toBeDisabled()
      await page.getByRole('slider', { name: '调节光屏距透镜的距离' }).fill('8')
      await page.getByRole('slider', { name: '调节光屏距透镜的距离' }).fill('34')
      if (i === 4) await page.getByRole('button', { name: '移开光屏，透过透镜观察' }).click()
    }
    await observe(page)
    if (i === 0) {
      await page.screenshot({ path: 'artifacts/desktop-observation.png', fullPage: true })
      await page.getByRole('button', { name: '已观察，开始判断' }).click()
      await page.getByRole('button', { name: /正立、放大的虚像/ }).click()
      await page.getByRole('button', { name: '确认判断' }).click()
      await expect(page.getByRole('alert')).toBeVisible()
      await expect(page.getByRole('button', { name: '进入下一步' })).toHaveCount(0)
      await page.getByRole('button', { name: '再观察一下' }).click()
      await page.reload()
      await expect(page.getByRole('button', { name: '已观察，开始判断' })).toBeVisible()
    }
    if (i === 4) await page.screenshot({ path: 'artifacts/virtual-observation.png', fullPage: true })
    await judge(page, t.choices[t.answer])
    await next(page)
  }
  await page.getByRole('button', { name: '核对并完成实验' }).click()
  await expect(page.getByRole('alert')).toContainText('20')
  for (const t of trials) {
    await page.getByRole('textbox', { name: `物距${t.u}厘米时的像距` }).fill(t.v)
    await page.getByRole('combobox', { name: `物距${t.u}厘米时的正倒` }).selectOption(t.orientation)
    await page.getByRole('combobox', { name: `物距${t.u}厘米时的大小` }).selectOption(t.size)
    await page.getByRole('combobox', { name: `物距${t.u}厘米时的虚实` }).selectOption(t.nature)
  }
  await page.getByRole('button', { name: '核对并完成实验' }).click()
  await expect(page.getByText('实验结论')).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载实验表格' }).click()
  const file = await download
  await file.saveAs('artifacts/成像规律.csv')
  expect(file.suggestedFilename()).toBe('凸透镜成像规律实验记录.csv')
  await page.getByRole('tab', { name: '回看光路' }).click()
  await page.getByRole('tab', { name: /u < f/ }).click()
  await expect(page.getByText('透过透镜观察', { exact: true }).first()).toBeVisible()
  await page.screenshot({ path: 'artifacts/completed.png', fullPage: true })
  expect(errors).toEqual([])
})

test('mobile remains within viewport and has live screen feedback', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: 'artifacts/mobile.png', fullPage: true })
  await page.getByRole('button', { name: '放置蜡烛' }).click()
  await page.getByRole('button', { name: '放置凸透镜' }).click()
  await page.getByRole('button', { name: '放置光屏' }).click()
  await next(page)
  await page.getByRole('slider', { name: '调节火焰高度' }).fill('0')
  await observe(page)
  await judge(page, '三者中心大致处于同一高度')
  await next(page)
  await page.getByRole('slider', { name: '调节光屏距透镜的距离' }).fill('10')
  await expect(page.getByTestId('screen-preview')).toHaveAttribute('data-blur','0.00')
  await page.screenshot({ path: 'artifacts/mobile-simulation.png', fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})

test('landscape layout, drag placement, and contextual hints', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await page.goto('/')
  const tray = page.getByRole('button', { name: '拖拽蜡烛到指定位置' })
  await tray.dragTo(page.getByRole('button', { name: '重新开始实验' }))
  await expect(page.getByRole('status')).toContainText('还没放到圆形目标处')
  await expect(page.getByRole('button', { name: '放置蜡烛' })).toBeVisible()
  await tray.dragTo(page.getByRole('button', { name: '放置蜡烛' }))
  await expect(page.getByTestId('candle')).toBeVisible()
  for (const name of ['放置凸透镜', '放置光屏']) await page.getByRole('button', { name }).click()
  await next(page)
  await page.getByRole('slider', { name: '调节火焰高度' }).fill('2')
  await expect(page.getByRole('status')).toContainText('偏低')
  await page.getByRole('slider', { name: '调节火焰高度' }).fill('0')
  await observe(page)
  await judge(page, '三者中心大致处于同一高度')
  await next(page)
  await page.getByRole('slider', { name: '调节光屏距透镜的距离' }).fill('30')
  await expect(page.getByRole('status')).toContainText('太远')
  await page.getByRole('slider', { name: '调节光屏距透镜的距离' }).fill('10')
  await expect(page.getByRole('status')).toContainText('最小')
  await expect(page.getByTestId('screen-preview')).toBeVisible()
  const sizes = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, width: innerWidth, preview: document.querySelector('.screen-status')!.getBoundingClientRect().width, bench: document.querySelector('.visual-area')!.getBoundingClientRect().width, questionTop: document.querySelector('.question-line')!.getBoundingClientRect().top, panelBottom: document.querySelector('.action-panel')!.getBoundingClientRect().bottom }))
  expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.width)
  expect(sizes.preview).toBeGreaterThan(250)
  expect(sizes.bench).toBeGreaterThan(sizes.preview)
  expect(sizes.questionTop).toBeGreaterThanOrEqual(0)
  expect(sizes.panelBottom).toBeLessThanOrEqual(390)
  await page.screenshot({ path: 'artifacts/landscape-844.png' })
  await page.setViewportSize({ width: 667, height: 375 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(667)
  expect(await page.locator('.action-panel').evaluate(el => el.getBoundingClientRect().bottom)).toBeLessThanOrEqual(375)
  await page.screenshot({ path: 'artifacts/landscape-667.png' })
})
