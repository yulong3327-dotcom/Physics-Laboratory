import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root=new URL('../',import.meta.url)
const manifest=new URL('src/curriculumVoice.json',root)
const cues=JSON.parse(readFileSync(manifest,'utf8'))
const legacy=JSON.parse(readFileSync(new URL('src/voiceCues.json',root),'utf8'))
const ranges=[[4,'粗测焦距（会聚）'],[7,'粗测焦距（图像）'],[9,'三心同高'],[11,'F 型光源'],[18,'成像特点与应用'],[22,'实像虚像的判断'],[28,'动态成像'],[29,'更多探究'],[33,'透镜遮挡'],[38,'眼镜判断'],[46,'水透镜'],[50,'无法成像'],[52,'蜡烛燃烧'],[54,'像物互换'],[55,'结语']]
let changed=false
for(const cue of cues){
  const path=new URL(`public/${cue.file}`,root)
  if(!existsSync(path))continue
  const bytes=readFileSync(path)
  if(bytes.length<128||!(bytes.subarray(0,3).toString()==='ID3'||bytes[0]===0xff&&(bytes[1]&0xe0)===0xe0))throw new Error(`${cue.file}: 文件不像 MP3，请检查格式。`)
  if(cue.audio!==cue.file){cue.audio=cue.file;changed=true}
}
if(changed)writeFileSync(manifest,`${JSON.stringify(cues,null,2)}\n`)
const rows=cues.map(cue=>{
  const group=ranges.find(([last])=>Number(cue.id)<=last)[1]
  const old=legacy.find(c=>cue.audio===`voice/${c.id}.wav`)
  return `| ${cue.id} | ${group} | ${cue.text} | ${cue.speech} | ${old?`沿用旧 ${old.id}.wav`:cue.audio?'新 MP3 已接入':'待补录'} | ${old?old.script:'—'} |`
})
const reused=cues.filter(c=>c.audio?.endsWith('.wav')).length
const pending=cues.filter(c=>!c.audio).length
const text=`# 凸透镜课程：音频编号与台词\n\n按用户提供的题型顺序排列，共 ${cues.length} 句。主线现沿用 ${reused} 段旧录音，${pending} 句待补录；拖动纠错、对齐、观察、答错和表格核对也保留了原版语音。弹窗短提示与录音允许使用关联表述。\n\n录音请沿用 001–055 编号，不因旧音频已可用而重新编号。新文件预留为 public/voice/curriculum/001.mp3 至 055.mp3，可只提供待补录的编号；也可整批提供，新 MP3 会优先替换旧录音。不要直接覆盖原 public/voice/01.wav–32.wav。\n\n列中的“计划录音台词”是修订后建议录制的版本；“当前沿用音频台词”是旧录音的实际内容，便于决定是否补录。未提供的录音仅显示文字，不播放不匹配音频。\n\n| 编号 | 题型 | 弹窗短提示 | 计划录音台词 | 当前状态 | 当前沿用音频台词 |\n| --- | --- | --- | --- | --- | --- |\n${rows.join('\n')}\n\n## 旧版操作提示\n\n${legacy.filter(c=>['02','05','06','08','09','13','15','16','17','18','19','22','23','24','25','26','28','31','32'].includes(c.id)).map(c=>`- ${c.id}.wav：${c.script}`).join('\n')}\n\n## 接入方法\n\n将收到的 MP3 放入 public/voice/curriculum/，执行 npm run prepare:audio。脚本会检查文件头、更新 src/curriculumVoice.json 中的 audio 路径，并重新生成本文档。构建时也会自动执行。新弹窗出现时自动播放对应录音；切换题型、重启或关闭引导会中止旧录音与待播队列。\n\n物理条件已修订：等大成像对应 u = 2f；“无法成像”改为排查移动光屏；动态成像、水透镜口诀均限定仍成实像的条件；遮挡只讨论部分遮挡；焦点处单独列为边界情况。\n`
writeFileSync(new URL('AUDIO_SCRIPT.md',root),text)
console.log(`音频清单：${cues.length} 句，${reused} 句沿用旧录音，${pending} 句待补录。文档：${fileURLToPath(new URL('AUDIO_SCRIPT.md',root))}`)
