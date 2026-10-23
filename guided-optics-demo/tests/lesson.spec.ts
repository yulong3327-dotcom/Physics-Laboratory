import { expect, test, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { optics } from '../src/model'
import { fresh, groups, physicsFor, ready, selectStep, stages, STORAGE_KEY, trials, wrongAnswers, wrongCells } from '../src/curriculum'
const cues=JSON.parse(readFileSync('src/curriculumVoice.json','utf8')) as {id:string;audio:string|null}[]
const legacy=JSON.parse(readFileSync('src/voiceCues.json','utf8')) as {id:string}[]
const voiceCatalogue=[...cues,...legacy.map(c=>({id:`old-${c.id}`,audio:`voice/${c.id}.wav`}))]
mkdirSync('artifacts',{recursive:true})
const index=(id:string)=>stages.findIndex(s=>s.id===id)
const jump=async(page:Page,id:string)=>{
  const step=index(id),stage=stages[step],type=groups.indexOf(stage.group),first=stages.findIndex(s=>s.group===stage.group)
  await page.getByRole('button',{name:'选择实验题型'}).click()
  await page.getByRole('dialog').getByRole('button',{name:`题型 ${type+1}`,exact:true}).click()
  for(let cursor=first;cursor<step;cursor++){
    const advance=page.getByRole('button',{name:'进入下一步',exact:true})
    if(!await advance.count()||!await advance.isEnabled())await solve(page,stages[cursor].id)
    await next(page)
  }
}
const slider=async(page:Page,label:string,value:number)=>page.getByRole('slider',{name:`调节${label}`,exact:true}).fill(String(Math.round(value*10)/10))
const next=async(page:Page)=>page.getByRole('button',{name:'进入下一步',exact:true}).click()
async function observe(page:Page){
  await page.getByRole('button',{name:'确认位置，观察结果'}).click()
  await expect(page.getByRole('button',{name:'确认答案',exact:true})).toHaveCount(0)
  await expect(page.getByTestId('screen-preview')).toBeVisible()
  await page.getByRole('button',{name:'已观察，开始答题'}).click()
}
async function answer(page:Page,id:string){
  const question=stages[index(id)].question!
  for(const f of question.fields){if(f.options)await page.getByRole('combobox',{name:f.label,exact:true}).selectOption(f.answer);else await page.getByRole('textbox',{name:f.label,exact:true}).fill(f.answer)}
  await page.getByRole('button',{name:'确认答案',exact:true}).click()
  await expect(page.getByRole('button',{name:'进入下一步'})).toHaveClass(/guided-action/)
}
async function solve(page:Page,id:string){
  switch(id){
    case 'setup':for(const name of ['平行光源','凸透镜','光屏'])await page.getByRole('button',{name:`放置${name}`,exact:true}).click();return
    case 'focus':await slider(page,'光屏距透镜',10);break
    case 'graph':
      await page.getByRole('button',{name:'安装蜡烛'}).click()
      for(const [u,v]of [[15,30],[20,20],[30,15]]){await slider(page,'物距 u',u);await slider(page,'光屏距透镜',v);await page.getByRole('button',{name:/记录此组数据/}).click()}
      await expect(page.getByTestId('graph-point')).toHaveCount(3);break
    case 'alignment':await slider(page,'焰心高度偏移',0);break
    case 'f-source':await page.getByRole('button',{name:'换成 F 光源'}).click();break
    case 'small':case 'equal':case 'large':case 'object-far':case 'object-near':{
      const u=stages[index(id)].targetU!;await slider(page,'物距 u',u-.7);await expect(page.getByRole('slider',{name:'调节物距 u'})).toHaveValue(String(u));await slider(page,'光屏距透镜',10*u/(u-10));break
    }
    case 'real':await slider(page,'光屏距透镜',20);break
    case 'virtual':case 'infinity':
      await slider(page,'光屏距透镜',8);await slider(page,'光屏距透镜',34)
      if(id==='virtual')await page.getByRole('button',{name:'移开光屏，透过透镜观察'}).click();break
    case 'screen-far':await slider(page,'光屏距透镜',30);await slider(page,'物距 u',15);break
    case 'screen-near':await slider(page,'光屏距透镜',15);await slider(page,'物距 u',30);break
    case 'more':return
    case 'cover':await slider(page,'透镜遮挡比例',50);break
    case 'near-glasses':case 'far-glasses':{
      const kind=id==='near-glasses'?'near':'far';await page.getByRole('button',{name:kind==='near'?'近视镜':'远视镜',exact:true}).click()
      await slider(page,'光屏距透镜',optics(30,15,false,false,{glasses:kind,height:0}).v);break
    }
    case 'water-in':await page.getByRole('button',{name:'安装水透镜'}).click();await page.getByRole('button',{name:'注水',exact:true}).click();await slider(page,'光屏距透镜',8*30/(30-8));break
    case 'water-out':await page.getByRole('button',{name:'抽水',exact:true}).click();await slider(page,'光屏距透镜',20);break
    case 'causes':for(const name of ['三心不同高','物体在焦点内','光具座太短'])await page.getByRole('button',{name,exact:false}).click();break
    case 'burn':await page.getByRole('button',{name:'点燃蜡烛',exact:true}).click();await page.getByRole('button',{name:'继续燃烧',exact:true}).click();await page.getByRole('button',{name:'继续燃烧',exact:true}).click();break
    case 'swap':await page.getByRole('button',{name:'互换蜡烛与光屏'}).click();break
  }
  await observe(page);await answer(page,id)
}
test('thin-lens engine: single lenses, separated spectacles, variable focal length, stops and reversibility',()=>{
  for(const [u,v,m]of [[30,15,-.5],[20,20,-1],[15,30,-2],[6,-15,2.5]]){
    const p=optics(u,Math.abs(v),false,v<0,{height:0});expect(p.v).toBeCloseTo(v);expect(p.magnification).toBeCloseTo(m)
    if(v>0){expect(p.focused).toBe(true);for(const hit of p.screenHits)expect(hit.point.y).toBeCloseTo(25)}else expect(p.segments.some(s=>s.virtual)).toBe(true)
  }
  const near=optics(30,15,false,false,{glasses:'near',height:0}),far=optics(30,15,false,false,{glasses:'far',height:0})
  expect(near.v).toBeGreaterThan(15);expect(far.v).toBeLessThan(15)
  for(const kind of ['near','far']as const){const v=optics(30,15,false,false,{glasses:kind,height:0}).v,p=optics(30,v,false,false,{glasses:kind,height:0});expect(p.focused).toBe(true);expect(p.screenHits.length).toBeGreaterThan(1);for(const hit of p.screenHits)expect(hit.point.y).toBeCloseTo(25)}
  expect(optics(30,15,false,false,{focal:8}).v).toBeLessThan(15);expect(optics(30,20,false,false,{focal:12}).focused).toBe(true)
  const blocked=optics(30,15,false,false,{cover:50,height:0});expect(blocked.v).toBeCloseTo(15);expect(blocked.magnification).toBeCloseTo(-.5);expect(blocked.brightness).toBe(.5);expect(blocked.screenHits.length).toBeGreaterThan(0)
  const reverse=optics(15,30,false,false,{swapped:true,height:0});expect(reverse.focused).toBe(true);expect(reverse.magnification).toBeCloseTo(-2);for(const hit of reverse.screenHits){expect(hit.point.x).toBeCloseTo(16);expect(hit.point.y).toBeCloseTo(25)}
  const burned=optics(20,20,false,false,{height:2});expect(burned.imageY).toBeCloseTo(23)
  expect(optics(10,20,false,false).v).toBe(Infinity);expect(optics(30,10,true,false).focused).toBe(true)
  const rows=trials.map(t=>({v:t.v,orientation:t.orientation,size:t.size,nature:t.nature}));expect(wrongCells(rows)).toEqual([]);expect(wrongCells(rows.map((r,i)=>i===0?{...r,v:''}:r))).toContain('0-v')
  expect(wrongAnswers(stages[index('focus')].question!,['光屏中心'])).toEqual([0]);expect(wrongAnswers(stages[index('focus')].question!,['透镜的焦点'])).toEqual([])
  const virtual=selectStep(fresh(),index('virtual'));virtual.throughLens=true;virtual.scanned=[8,34];const reset=selectStep(virtual,index('focus'));expect(reset.throughLens).toBe(false);expect(reset.scanned).toEqual([24,24]);expect(reset.completedSteps).toEqual([]);expect(ready(reset)).toBe(false);expect(physicsFor(reset).v).toBe(10)
})
test('55 ordered voice slots preserve matched legacy audio without requesting unavailable MP3',async({page,request})=>{
  expect(groups).toHaveLength(15);expect(stages).toHaveLength(25)
  const cues=voiceCatalogue.filter(c=>!c.id.startsWith('old-'));expect(cues).toHaveLength(55)
  expect(cues.map(c=>c.id)).toEqual(Array.from({length:55},(_,i)=>String(i+1).padStart(3,'0')))
  for(const cue of voiceCatalogue){if(cue.audio){expect(existsSync(`public/${cue.audio}`),cue.id).toBe(true);const r=await request.get(cue.audio);expect(r.status()).toBe(200)}}
  const unavailable:string[]=[];page.on('request',r=>{if(r.url().includes('/voice/curriculum/'))unavailable.push(r.url())})
  await page.goto('/');await expect(page.locator('.mentor-avatar')).toHaveJSProperty('naturalWidth',256)
  await expect(page.getByRole('button',{name:/^(播放语音|暂停语音)$/})).toHaveCount(0)
  await jump(page,'focus');await page.getByLabel('更多引导选项').click();await page.getByRole('button',{name:'重播引导'}).click();await expect(page.getByLabel('正在讲解')).toBeVisible()
  await page.getByLabel('更多引导选项').click();await page.getByRole('button',{name:'静音',exact:true}).click();await expect(page.getByLabel('正在讲解')).toHaveCount(0)
  await jump(page,'water-in');await page.getByLabel('更多引导选项').click();await page.getByRole('button',{name:'重播引导'}).click();expect(unavailable).toEqual([])
  await page.reload();await page.getByLabel('更多引导选项').click();await expect(page.getByRole('button',{name:'取消静音'})).toBeVisible();await page.getByRole('button',{name:'关闭引导'}).click();await page.getByRole('button',{name:'打开语音引导'}).click()
})
test('topic menu only exposes 15 types and enters the first activity of each type',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'选择实验题型'}).click()
  const dialog=page.getByRole('dialog');await expect(dialog.getByRole('button',{name:/^题型 \d+$/})).toHaveCount(15)
  await expect(dialog.getByRole('combobox')).toHaveCount(0);await expect(dialog.getByText(/例题|调节焰心|放置器材/)).toHaveCount(0)
  await dialog.getByRole('button',{name:'题型 5',exact:true}).click();await expect(page.locator('.step-select strong')).toHaveText('题型 5')
  await expect(page.locator('.panel-index')).toContainText('缩小实像与照相机')
})

test('graph follows both controls, identifies defocus and gives the focal conclusion without a sample quota',async({page})=>{
  await page.goto('/');await jump(page,'graph');await page.getByRole('button',{name:'安装蜡烛'}).click()
  const point=page.getByTestId('graph-live-point'),conclusion=page.getByTestId('graph-conclusion')
  await expect(point).toHaveAttribute('data-focused','true');await expect(page.getByTestId('distance-curve')).toBeVisible()
  await expect(page.getByTestId('equal-distance-point')).toBeVisible();await expect(conclusion).toContainText('焦距 10 cm')
  await expect(page.getByRole('button',{name:'确认位置，观察结果'})).toBeEnabled()
  await expect(page.getByTestId('graph-point')).toHaveCount(0)
  const initialX=await point.getAttribute('cx'),initialY=await point.getAttribute('cy')
  await slider(page,'物距 u',30);expect(await point.getAttribute('cx')).not.toBe(initialX)
  await expect(point).toHaveAttribute('data-focused','false');await expect(page.getByTestId('graph-reading')).toContainText('光屏距')
  await expect(page.getByRole('button',{name:/记录此组数据/})).toBeDisabled()
  await slider(page,'光屏距透镜',15);expect(await point.getAttribute('cy')).not.toBe(initialY)
  await expect(point).toHaveAttribute('data-focused','true');await expect(page.getByTestId('graph-reading')).toContainText('v 15.0')
  await page.getByRole('tab',{name:'光具座',exact:true}).click();await slider(page,'物距 u',15);await slider(page,'光屏距透镜',30)
  await page.getByRole('tab',{name:'物距—像距图像',exact:true}).click();await expect(point).toHaveAttribute('data-focused','true')
  await expect(page.getByTestId('graph-reading')).toContainText('u 15.0')
  await page.getByRole('button',{name:'回到物距像距相等的位置'}).click()
  await expect(point).toHaveAttribute('cx',initialX!);await expect(point).toHaveAttribute('cy',initialY!)
  await page.reload();await expect(point).toBeVisible();await expect(conclusion).toBeVisible()
  await observe(page);await answer(page,'graph')
})
test('complete all curriculum activities before answering and export the validated table',async({page})=>{
  test.setTimeout(120000);await page.setViewportSize({width:1440,height:1000})
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/')
  for(const stage of stages){
    await expect(page.locator('.step-select strong')).toHaveText(`题型 ${groups.indexOf(stage.group)+1}`)
    if(stage.id==='summary')break
    await solve(page,stage.id);await next(page)
  }
  await expect(page.locator('.conclusion-table tbody tr')).toHaveCount(5)
  await expect(page.getByRole('button',{name:'完成本课'})).toHaveCount(0);await expect(page.getByRole('complementary',{name:'当前步骤操作'})).toHaveCount(0)
  const state=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),STORAGE_KEY);expect(state.completedSteps).toHaveLength(stages.length-1)
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载规律表'}).click();const file=await download;await file.saveAs('artifacts/课程成像规律.csv');expect(readFileSync('artifacts/课程成像规律.csv','utf8')).toContain('u < f,6,15,与物同侧,正立,放大,虚像')
  await page.screenshot({path:'artifacts/curriculum-complete.png',fullPage:true});expect(errors).toEqual([])
})
test('free topic navigation, graph data, wrong answers, saved records and reset are independent',async({page})=>{
  await page.goto('/');await jump(page,'virtual');await slider(page,'光屏距透镜',8);await slider(page,'光屏距透镜',34);await page.getByRole('button',{name:'移开光屏，透过透镜观察'}).click()
  await jump(page,'focus');await expect(page.getByRole('button',{name:'确认位置，观察结果'})).toBeDisabled();await slider(page,'光屏距透镜',10.8);await expect(page.getByRole('slider',{name:'调节光屏距透镜'})).toHaveValue('10');await observe(page)
  await page.getByRole('combobox',{name:'这个位置'}).selectOption('光屏中心');await page.getByRole('button',{name:'确认答案'}).click();await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByRole('button',{name:'进入下一步'})).toHaveCount(0)
  await page.getByRole('combobox',{name:'这个位置'}).selectOption('透镜的焦点');await page.getByRole('button',{name:'确认答案'}).click()
  await jump(page,'summary');await expect(page.locator('.conclusion-table tbody tr')).toHaveCount(5);await page.reload();await expect(page.locator('.conclusion-table tbody tr')).toHaveCount(5)
  const state=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),STORAGE_KEY);expect(state.completedSteps).toEqual([index('real'),index('focus')])
  await jump(page,'f-source');await expect(page.locator('.step-select strong')).toHaveText(`题型 ${groups.indexOf(stages[index('f-source')].group)+1}`)
  await page.getByRole('button',{name:'重新开始实验'}).click();await page.getByRole('button',{name:'确认重新开始'}).click();await expect(page.locator('.step-select strong')).toHaveText('题型 1')
})
for(const [width,height]of [[667,375],[844,390],[390,844]])test(`phone layout and enlarged bench drag at ${width}x${height}`,async({page})=>{
  await page.setViewportSize({width,height});await page.goto('/');await jump(page,'alignment')
  const fontSize=await page.locator('.control-label').evaluate(el=>parseFloat(getComputedStyle(el).fontSize));expect(fontSize).toBeGreaterThanOrEqual(width>height?14:15)
  if(width>height){const prompt=await page.locator('.mentor-prompt').boundingBox();expect(prompt!.height).toBeLessThanOrEqual(56);const bench=await page.locator('.visual-area').boundingBox();expect(bench!.height).toBeGreaterThan(205)}
  await slider(page,'焰心高度偏移',.3);await expect(page.getByRole('slider',{name:'调节焰心高度偏移'})).toHaveValue('0');await expect(page.getByRole('button',{name:'确认位置，观察结果'})).toHaveClass(/guided-action/)
  await page.screenshot({path:`artifacts/curriculum-phone-${width}.png`,fullPage:true})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  await slider(page,'焰心高度偏移',1);await expect(page.getByRole('button',{name:'确认位置，观察结果'})).toBeDisabled()
  await jump(page,'small');await page.getByRole('button',{name:'放大实验台'}).click()
  const bench=page.getByRole('dialog',{name:'凸透镜成像实验台'}),b=await bench.boundingBox();expect(b!.width).toBeGreaterThan(width-16);expect(b!.height).toBeGreaterThan(height-16)
  const locations=await page.locator('.diagram-wrap svg').evaluate(el=>{const svg=el as SVGSVGElement,point=(x:number)=>{const p=svg.createSVGPoint();p.x=x;p.y=250;const t=p.matrixTransform(svg.getScreenCTM()!);return{x:t.x,y:t.y}};return{from:point(200),to:point(160)}})
  await page.mouse.move(locations.from.x,locations.from.y);await page.mouse.down();await page.mouse.move(locations.to.x,locations.to.y,{steps:12});await page.mouse.up()
  await page.screenshot({path:`artifacts/curriculum-expanded-${width}.png`})
  await page.getByRole('button',{name:'收起实验台'}).press('Escape');await expect(bench).toHaveCount(0);await expect(page.getByRole('slider',{name:'调节物距 u'})).toHaveValue('30')
  for(const id of ['graph','cover','near-glasses','water-in','causes','burn','swap']){await jump(page,id);expect(await page.evaluate(()=>document.documentElement.scrollWidth),id).toBeLessThanOrEqual(width)}
  await jump(page,'graph');await page.getByRole('button',{name:'安装蜡烛'}).click()
  await expect(page.getByTestId('graph-live-point')).toBeVisible();await expect(page.getByTestId('graph-conclusion')).toBeVisible()
  await page.screenshot({path:`artifacts/graph-phone-${width}.png`,fullPage:true})
  await jump(page,'summary');await expect(page.locator('.conclusion-table tbody tr')).toHaveCount(5)
  const table=await page.locator('.conclusion-table').boundingBox();expect(table!.width).toBeLessThanOrEqual(width)
  expect(table!.y+table!.height).toBeLessThanOrEqual(height)
  await page.screenshot({path:`artifacts/summary-phone-${width}.png`,fullPage:true})
})
