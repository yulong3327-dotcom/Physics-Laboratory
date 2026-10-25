import { expect, test } from '@playwright/test'
import { fresh, selectStep, stages, STORAGE_KEY } from '../src/curriculum'
import { snapAdjustment } from '../src/interaction'

for (const [width, height] of [[390,844],[844,390],[667,375],[1440,900]]) test(`library entry and saved progress at ${width}x${height}`, async ({page}) => {
  await page.setViewportSize({width,height})
  await page.goto('/')
  await expect(page).toHaveTitle('精准学AI实验室')
  await expect(page.locator('.library-brand')).toContainText('精准学AI实验室')
  await expect(page.locator('.experiment-image img')).toHaveJSProperty('complete',true)
  expect(await page.locator('.experiment-image img').evaluate((img:HTMLImageElement)=>img.naturalWidth)).toBeGreaterThan(100)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:`artifacts/library-${width}.png`,fullPage:true})
  await page.getByRole('button',{name:'进入凸透镜实验'}).click()
  await page.getByRole('button',{name:'放置平行光源',exact:true}).click()
  await page.getByRole('button',{name:'返回实验室首页'}).click()
  await expect(page.getByRole('button',{name:'进入凸透镜实验'})).toContainText('继续实验')
  await page.reload()
  await page.getByRole('button',{name:'进入凸透镜实验'}).click()
  await expect(page.getByRole('button',{name:'放置凸透镜',exact:true})).toBeVisible()
})

test('snapping holds through jitter, releases deliberately and allows precise steppers',()=>{
  const s=selectStep(fresh(),stages.findIndex(stage=>stage.id==='focus'))
  expect(snapAdjustment(s,'screen',11.5,1.7)).toBe(10)
  s.screen=10
  expect(snapAdjustment(s,'screen',12,1.7)).toBe(10)
  expect(snapAdjustment(s,'screen',13,1.7)).toBe(13)
  expect(snapAdjustment(s,'screen',10.1,0)).toBe(10.1)
  const shortBench=selectStep(fresh(),stages.findIndex(stage=>stage.id==='large'));shortBench.u=11
  expect(snapAdjustment(shortBench,'screen',38,2.2)).toBe(38)
})

test('touch dragging preserves grab offset and snaps near focus on a small screen',async({page,context})=>{
  await page.setViewportSize({width:844,height:390})
  const saved=selectStep(fresh(),stages.findIndex(stage=>stage.id==='focus'))
  await page.addInitScript(({saved,key})=>localStorage.setItem(key,JSON.stringify(saved)),{saved,key:STORAGE_KEY})
  await page.goto('/#/optics')
  const point=async(x:number)=>page.locator('.diagram-wrap svg').evaluate((svg:SVGSVGElement,x)=>{
    const p=svg.createSVGPoint();p.x=x;p.y=250;const result=p.matrixTransform(svg.getScreenCTM()!);return{x:result.x,y:result.y}
  },x)
  const start=await point(708),finish=await point(579)
  const cdp=await context.newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]})
  for(let i=1;i<=12;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x+(finish.x-start.x)*i/12,y:start.y}]})
  await expect(page.getByRole('slider',{name:'调节光屏距透镜'})).toHaveValue('10')
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:finish.x+1,y:finish.y}]})
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
  await expect(page.getByRole('slider',{name:'调节光屏距透镜'})).toHaveValue('10')
  await page.getByRole('button',{name:'增大光屏距透镜'}).click()
  await expect(page.getByRole('slider',{name:'调节光屏距透镜'})).toHaveValue('10.1')
})
