import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fresh, groups, stages, STORAGE_KEY, topicNames } from '../src/curriculum'

const cues=JSON.parse(readFileSync('src/curriculumVoice.json','utf8')) as {id:string;audio:string}[]
const state=(page:Page)=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),STORAGE_KEY)
async function topic(page:Page,id:string){
  const stage=stages.find(stage=>stage.id===id)!,number=groups.indexOf(stage.group)+1
  await page.getByRole('button',{name:'选择实验题型'}).click()
  await page.getByRole('dialog').getByRole('button',{name:`题型 ${number} · ${topicNames[stage.group]}`,exact:true}).click()
}

test('every supplied MP3 decodes to non-silent audio',async({page})=>{
  await page.goto('/#/optics')
  const decoded=await page.evaluate(async files=>{
    const context=new AudioContext(),results=[]
    try{
      for(const file of files){
        const response=await fetch(file.audio)
        if(!response.ok)throw new Error(`${file.id}: ${response.status}`)
        const buffer=await context.decodeAudioData(await response.arrayBuffer())
        const audible=buffer.getChannelData(0).some(value=>Math.abs(value)>.005)
        results.push({id:file.id,duration:buffer.duration,audible})
      }
    }finally{await context.close()}
    return results
  },cues)
  for(const file of decoded){expect(file.duration,file.id).toBeGreaterThan(.5);expect(file.audible,file.id).toBe(true)}
  expect(decoded).toHaveLength(55)
})

test('real MP3 playback continues during operations and stops only for topic switches and mute',async({page})=>{
  await page.setViewportSize({width:844,height:390})
  // Capture real audio elements without replacing browser playback or its events.
  await page.addInitScript(()=>{
    const NativeAudio=window.Audio
    const audios:HTMLAudioElement[]=[]
    Object.assign(window,{lessonAudios:audios})
    window.Audio=class extends NativeAudio{constructor(src?:string){super(src);audios.push(this)}}
  })
  const playing=()=>page.evaluate(()=>(window as unknown as {lessonAudios:HTMLAudioElement[]}).lessonAudios.filter(a=>!a.paused&&!a.ended).map(a=>({file:a.src.split('/').pop(),time:a.currentTime})))
  await page.goto('/#/optics');await topic(page,'water-in')
  await expect.poll(async()=> (await playing()).map(a=>a.file)).toEqual(['039.mp3'])
  await expect(page.locator('.mentor-prompt')).toHaveAttribute('data-cue','040',{timeout:10000})
  await expect.poll(async()=> (await playing()).some(a=>a.file==='040.mp3'&&a.time>0)).toBe(true)
  const before=(await playing())[0].time
  await page.getByRole('button',{name:'安装水透镜'}).click()
  await page.getByRole('button',{name:'注水',exact:true}).click()
  const during=(await playing())[0]
  expect(during.file).toBe('040.mp3');expect(during.time).toBeGreaterThan(before)
  await expect(page.locator('.mentor-prompt')).toHaveAttribute('data-cue','041',{timeout:20000})
  await expect.poll(async()=> (await playing()).map(a=>a.file)).toEqual(['041.mp3'])
  await topic(page,'near-glasses')
  await expect.poll(async()=> (await playing()).map(a=>a.file)).toEqual(['034.mp3'])
  await page.getByRole('button',{name:'近视镜',exact:true}).click()
  await expect.poll(async()=> (await playing()).map(a=>a.file)).toEqual(['034.mp3'])
  await expect.poll(async()=> (await playing()).map(a=>a.file),{timeout:15000}).toEqual(['035.mp3'])
  await page.getByLabel('更多引导选项').click();await page.getByRole('button',{name:'静音',exact:true}).click()
  await expect.poll(playing).toEqual([])
  await topic(page,'water-in');await expect.poll(playing).toEqual([])
  await page.getByLabel('更多引导选项').click();await page.getByRole('button',{name:'取消静音',exact:true}).click()
  await expect.poll(async()=> (await playing()).map(a=>a.file)).toEqual(['039.mp3'])
  await topic(page,'near-glasses')
  await expect.poll(async()=> (await playing()).map(a=>a.file)).toEqual(['034.mp3'])
  await page.getByLabel('更多引导选项').click();await page.getByRole('button',{name:'关闭引导',exact:true}).click()
  await expect.poll(playing).toEqual([])
  await page.getByRole('button',{name:'打开语音引导'}).click()
  await expect.poll(async()=> (await playing()).map(a=>a.file)).toEqual(['034.mp3'])
})

test('desktop topic 8 matches mobile and plays its queued lesson audio',async({page})=>{
  await page.setViewportSize({width:1280,height:800})
  await page.addInitScript(()=>{
    const NativeAudio=window.Audio
    const audios:HTMLAudioElement[]=[]
    Object.assign(window,{lessonAudios:audios})
    window.Audio=class extends NativeAudio{constructor(src?:string){super(src);audios.push(this)}}
  })
  await page.goto('/#/optics')
  await topic(page,'near-glasses')
  await expect(page.locator('.current-topic-number')).toHaveText('题型 8')
  await expect(page.locator('.current-topic-name')).toHaveText('近视镜与远视镜判断')
  await expect(page.locator('.mentor-prompt')).toHaveAttribute('data-cue','034')
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {lessonAudios:HTMLAudioElement[]}).lessonAudios.some(a=>a.src.endsWith('/034.mp3')&&!a.paused))).toBe(true)
  await page.getByRole('button',{name:'近视镜',exact:true}).click()
  await expect(page.locator('.mentor-prompt')).toHaveAttribute('data-cue','035',{timeout:15000})
  await expect.poll(()=>page.evaluate(()=>{
    const audio=(window as unknown as {lessonAudios:HTMLAudioElement[]}).lessonAudios[0]
    return audio?.src.endsWith('/035.mp3')&&!audio.paused&&audio.currentTime>0
  }),{timeout:15000}).toBe(true)
})

test('water changes continuously, updates rays and waits for completion before refocusing',async({page})=>{
  await page.goto('/#/optics');await topic(page,'water-in');await page.getByRole('button',{name:'安装水透镜'}).click()
  const lens=page.getByTestId('main-lens').locator('path').first(),rays=page.getByTestId('ray-paths')
  const initialLens=await lens.getAttribute('d'),initialRays=await rays.innerHTML()
  await page.getByRole('button',{name:'注水',exact:true}).click()
  await expect(page.getByRole('button',{name:'注水中…',exact:true})).toBeDisabled()
  await expect(page.getByRole('slider',{name:'调节光屏距透镜'})).toBeDisabled()
  await expect.poll(async()=>{const s=await state(page);return s.water>.1&&s.water<.9&&s.motion==='water-in'}).toBe(true)
  const partial=await state(page),partialLens=await lens.getAttribute('d')
  expect(partialLens).not.toBe(initialLens);expect(await rays.innerHTML()).not.toBe(initialRays)
  expect(partial.screen).toBe(15)
  await expect.poll(async()=> (await state(page)).motion,{timeout:10000}).toBeNull()
  expect((await state(page)).water).toBe(1);expect(await lens.getAttribute('d')).not.toBe(partialLens)
  await expect(page.getByRole('slider',{name:'调节光屏距透镜'})).toBeEnabled()
  await expect(page.getByRole('button',{name:'确认位置，观察结果'})).toBeDisabled()
  await page.getByRole('button',{name:'抽水',exact:true}).click()
  await expect.poll(async()=>{const s=await state(page);return s.water<.8&&s.water>-.8&&s.motion==='water-out'}).toBe(true)
  await page.reload()
  await expect.poll(async()=> (await state(page)).water,{timeout:10000}).toBe(-1)
  await page.getByRole('slider',{name:'调节光屏距透镜'}).fill('20')
  await expect(page.getByRole('button',{name:'确认位置，观察结果'})).toBeEnabled()
})

test('burning continuously shortens the candle, raises its image and can be restarted or left',async({page})=>{
  await page.goto('/#/optics');await topic(page,'burn')
  const candle=page.getByTestId('candle'),body=candle.locator('rect[fill="#f1eee8"]')
  const originalHeight=Number(await body.getAttribute('height'))
  const support=candle.locator('line[stroke="#879fa3"]'),supportY=await support.getAttribute('y1')
  await page.getByRole('button',{name:'点燃蜡烛',exact:true}).click()
  await expect(page.getByRole('button',{name:'确认位置，观察结果'})).toBeDisabled()
  await expect.poll(async()=>{const s=await state(page);return s.burned>.2&&s.burned<2.5}).toBe(true)
  const partial=await state(page),partialHeight=Number(await body.getAttribute('height'))
  expect(partialHeight).toBeLessThan(originalHeight);expect(partialHeight).toBeGreaterThan(34)
  expect(partial.height).toBe(partial.burned)
  expect(Number(await page.getByTestId('screen-preview').getAttribute('data-image-y'))).toBeLessThan(0)
  expect(Number(await support.getAttribute('y1'))).toBeCloseTo(Number(supportY),8)
  await page.getByRole('button',{name:'换新蜡烛'}).click()
  await expect(body).toHaveAttribute('height',String(originalHeight));expect((await state(page)).motion).toBeNull()
  await page.getByRole('button',{name:'点燃蜡烛',exact:true}).click()
  await expect.poll(async()=> (await state(page)).burned,{timeout:10000}).toBe(3)
  await expect(page.getByTestId('screen-preview')).toHaveAttribute('data-image-y','-3.00')
  await expect(page.getByRole('button',{name:'确认位置，观察结果'})).toBeEnabled()
  await page.getByRole('button',{name:'换新蜡烛'}).click();await page.getByRole('button',{name:'点燃蜡烛',exact:true}).click()
  await topic(page,'graph');await page.getByRole('button',{name:'安装蜡烛'}).click()
  const next=await state(page);expect(next.motion).toBeNull();expect(next.burned).toBe(0);expect(next.height).toBe(0)
  await expect(page.getByRole('button',{name:'确认位置，观察结果'})).toBeEnabled()
})

for(const [oldStep,id]of [[15,'near-glasses'],[16,'near-glasses'],[19,'water-in'],[22,'burn'],[24,'summary']]as const)test(`saved v3 activity ${oldStep} migrates to ${id}`,async({page})=>{
  await page.addInitScript(({saved})=>localStorage.setItem('guided-optics.curriculum.v3',JSON.stringify(saved)),{saved:{...fresh(),version:3,step:oldStep,equipment:3,completedSteps:[1,15,16,23]}})
  await page.goto('/#/optics')
  const saved=await state(page)
  expect(stages[saved.step].id).toBe(id);expect(saved.completedSteps).toEqual([1,21]);expect(saved.version).toBe(5)
})

for(const [oldStep,id]of [[15,'near-glasses'],[18,'water-in'],[21,'burn'],[23,'summary']]as const)test(`saved v4 activity ${oldStep} migrates to ${id}`,async({page})=>{
  await page.addInitScript(({saved})=>localStorage.setItem('guided-optics.curriculum.v4',JSON.stringify(saved)),{saved:{...fresh(),version:4,step:oldStep,equipment:3,completedSteps:[1,15,16,22]}})
  await page.goto('/#/optics')
  const saved=await state(page)
  expect(stages[saved.step].id).toBe(id);expect(saved.completedSteps).toEqual([1,15,21]);expect(saved.version).toBe(5)
})
