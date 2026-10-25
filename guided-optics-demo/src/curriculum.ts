import { optics } from './model'
import { exportTable } from './exportTable'
export type RecordRow = { v:string; orientation:string; size:string; nature:string }
export type Phase = 'adjust'|'observe'|'answer'|'done'
export type LabState = {
  version:4; step:number; phase:Phase; equipment:number; height:number; u:number; screen:number;
  throughLens:boolean; records:RecordRow[]; completedSteps:number[]; scanned:[number,number];
  source:'candle'|'F'; glasses:'none'|'near'|'far'; water:number; waterInstalled:boolean;
  cover:number; touched:boolean; swapped:boolean; lit:boolean; burned:number; causes:number[];
  samples:{u:number;v:number}[]; motion:'water-in'|'water-out'|'burn'|null;
}
export type Field = {label:string; answer:string; options?:string[]; tolerance?:number}
export type Question = {prompt:string; fields:Field[]; hint:string}
export type Stage = {
  id:string; group:string; title:string; cue:string; actionCue?:string; resultCue:string;
  task:string; question?:Question; u?:number; screen?:number; parallel?:boolean;
  object?:boolean; screenMove?:boolean; height?:boolean; targetU?:number; targetURange?:[number,number]; screenDirection?:'farther'|'nearer';
}
const select=(label:string,answer:string,options:string[]):Field=>({label,answer,options})
const q=(prompt:string,fields:Field[],hint:string):Question=>({prompt,fields,hint})
const direction=['靠近透镜','远离透镜'],sizes=['缩小','等大','放大']
const imageQ=(size:string,application?:string)=>q('观察清晰的像，填写成像特点与应用。',[select('正倒','倒立',['正立','倒立']),select('大小',size,sizes),select('虚实','实像',['实像','虚像']),...(application?[select('应用',application,['照相机','投影仪','放大镜'])]:[])],'比较光屏上的像和原烛焰；能被光屏承接的像是实像。')
export const stages:Stage[]=[
  {id:'setup',group:'粗测焦距（会聚）',title:'放置器材',cue:'001',actionCue:'002',resultCue:'003',parallel:true,task:'依次放好平行光源、凸透镜、光屏。'},
  {id:'focus',group:'粗测焦距（会聚）',title:'最小最亮光斑',cue:'003',resultCue:'004',parallel:true,screenMove:true,task:'缓慢移动光屏，找到最小、最亮的光斑。',question:q('平行光经凸透镜后，光斑最小最亮的位置代表什么？',[select('这个位置','透镜的焦点',['透镜的焦点','透镜的二倍焦点','光屏中心'])],'凸透镜会使平行光会聚，最小最亮的光斑位于焦点。')},
  {id:'graph',group:'粗测焦距（图像）',title:'看图像认识二倍焦距',cue:'005',actionCue:'006',resultCue:'007',u:20,screen:20,object:true,screenMove:true,task:'拖动蜡烛或光屏，看图上的点同步移动；物距与像距相等时，都等于二倍焦距。',question:q('图中标出的物距＝像距位置，对应怎样的焦距关系？',[select('物距与像距','两者都等于二倍焦距',['两者都等于二倍焦距','两者都等于焦距','物距等于焦距、像距等于二倍焦距'])],'物距与像距相等时，u = v = 2f；焦距是这个距离的一半。')},
  {id:'alignment',group:'三心同高',title:'调节焰心高度',cue:'008',actionCue:'009',resultCue:'old-06',height:true,u:20,screen:20,task:'上下拖动蜡烛，让焰心、光心与光屏中心同高。',question:q('为了使像落在光屏中央，应怎样调整？',[select('三个中心应','大致同高',['大致同高','依次升高','依次降低'])],'看水平主光轴，让三个中心落在同一条水平线上。')},
  {id:'f-source',group:'F 型光源',title:'比较上下与左右',cue:'010',resultCue:'011',u:20,screen:20,task:'将蜡烛替换为 F 光源，比较物与像。',question:q('光屏上的 F 像与光源相比怎样变化？',[select('上下方向','颠倒',['相同','颠倒']),select('左右方向','相反',['相同','相反'])],'实像相当于将 F 绕中心转过 180°，同时比较上下和左右。')},
  {id:'small',group:'成像特点与应用',title:'缩小实像与照相机',cue:'012',actionCue:'013',resultCue:'014',object:true,screenMove:true,targetU:30,targetURange:[22,35],task:'把蜡烛放到离透镜较远的位置，再移动光屏寻找清晰的像。',question:imageQ('缩小','照相机')},
  {id:'equal',group:'成像特点与应用',title:'二倍焦距处等大',cue:'015',resultCue:'018',object:true,screenMove:true,targetU:20,targetURange:[19,21],task:'把蜡烛放在二倍焦距附近，再移动光屏寻找清晰的像。',question:q('物体在二倍焦距处时，像距与成像特点是什么？',[select('像距','等于二倍焦距',['等于二倍焦距','小于一倍焦距','大于二倍焦距']),select('像的大小','等大',sizes),select('像的性质','倒立实像',['倒立实像','正立虚像'])],'对照光屏上的清晰像与原物大小，并比较物距和像距。')},
  {id:'large',group:'成像特点与应用',title:'放大实像与投影仪',cue:'016',resultCue:'017',object:true,screenMove:true,targetU:15,targetURange:[14,19],task:'把蜡烛放到一倍、二倍焦距之间，再移动光屏找到清晰的像。',question:imageQ('放大','投影仪')},
  {id:'real',group:'实像虚像的判断',title:'在光屏上接实像',cue:'019',resultCue:'019',u:20,screen:24,screenMove:true,task:'移动光屏，找到能被光屏承接的清晰像。',question:q('这个像能被光屏承接，它是什么像？',[select('像的性质','实像',['实像','虚像'])],'光屏能够承接由实际光线会聚形成的像。')},
  {id:'virtual',group:'实像虚像的判断',title:'换视角看虚像',cue:'020',resultCue:'022',u:6,screen:24,screenMove:true,task:'先试着移动光屏，再移开光屏，从透镜另一侧观察。',question:q('焦点以内看到的像，有什么特点？',[select('正倒','正立',['正立','倒立']),select('大小','放大',sizes),select('能否用光屏承接','不能',['能','不能'])],'像在物体同侧；不要把模糊光斑当作清晰实像。')},
  {id:'infinity',group:'实像虚像的判断',title:'焦点处的边界情况',cue:'old-16',resultCue:'022',u:10,screen:24,screenMove:true,task:'物体位于焦点处，移动光屏并观察出射光。',question:q('物体在焦点处时，光线与成像情况怎样？',[select('出射光','近似平行',['近似平行','会聚于光屏中央']),select('有限距离的清晰像','没有',['有','没有'])],'折射光近似平行，不能在有限距离的光屏上形成清晰像。')},
  {id:'object-far',group:'动态成像',title:'蜡烛远离透镜',cue:'023',actionCue:'024',resultCue:'025',u:20,screen:20,object:true,screenMove:true,targetU:30,targetURange:[22,35],task:'先让清晰像出现在二倍焦距附近，再把蜡烛向远处移动并重新调清光屏。',question:q('蜡烛远离透镜，怎样再次成像？',[select('光屏应','靠近透镜',direction),select('像会','缩小',sizes)],'比较蜡烛移动前后，清晰像的位置和大小变化。')},
  {id:'object-near',group:'动态成像',title:'蜡烛靠近透镜',cue:'024',resultCue:'026',u:20,screen:20,object:true,screenMove:true,targetU:15,targetURange:[14,19],task:'先让清晰像出现在二倍焦距附近，再把蜡烛向透镜移动并重新调清光屏。',question:q('蜡烛在焦点外靠近透镜，怎样再次成像？',[select('光屏应','远离透镜',direction),select('像会','放大',sizes)],'物体仍在焦点外，像距随物距减小而增大。')},
  {id:'screen-far',group:'动态成像',title:'先将光屏移远',cue:'027',resultCue:'028',u:20,screen:20,object:true,screenMove:true,screenDirection:'farther',task:'先把光屏移远一些，再移动蜡烛恢复清晰的像。',question:q('光屏远离透镜后，蜡烛应向哪里移动？',[select('蜡烛应','靠近透镜',direction),select('像会','放大',sizes)],'比较蜡烛与透镜之间的距离变化。')},
  {id:'screen-near',group:'动态成像',title:'先将光屏移近',cue:'027',resultCue:'028',u:20,screen:20,object:true,screenMove:true,screenDirection:'nearer',task:'先把光屏移近一些，再移动蜡烛恢复清晰的像。',question:q('光屏靠近透镜后，蜡烛应向哪里移动？',[select('蜡烛应','远离透镜',direction),select('像会','缩小',sizes)],'保持物距在焦点外，比较本次与原来的像大小。')},
  {id:'cover',group:'透镜遮挡',title:'移动遮光板',cue:'030',actionCue:'031',resultCue:'033',u:30,screen:15,task:'移动遮光板，比较无遮挡、部分遮挡时的像。',question:q('只挡住一部分透镜，光屏上的像怎样变化？',[select('像的完整性','仍然完整',['仍然完整','缺少一半']),select('像的亮度','变暗',['不变','变暗']),select('像的位置与大小','不变',['不变','改变'])],'来自物体各点的光仍能通过未遮挡部分，只是通过的光变少。')},
  {id:'near-glasses',group:'眼镜判断',title:'近视镜的作用',cue:'034',resultCue:'036',u:30,screen:15,screenMove:true,task:'选择近视镜并放到凸透镜前，再移动光屏重新对焦。',question:q('近视镜使成像位置变远，说明它是什么透镜？',[select('透镜类型','凹透镜',['凹透镜','凸透镜']),select('对光的作用','发散',['发散','会聚'])],'比较加入眼镜前后的清晰成像位置。')},
  {id:'far-glasses',group:'眼镜判断',title:'远视镜的作用',cue:'034',resultCue:'038',u:30,screen:15,screenMove:true,task:'选择远视镜并放到凸透镜前，再移动光屏重新对焦。',question:q('远视镜使成像位置变近，说明它是什么透镜？',[select('透镜类型','凸透镜',['凹透镜','凸透镜']),select('对光的作用','会聚',['发散','会聚'])],'比较加入眼镜前后的清晰成像位置。')},
  {id:'water-in',group:'水透镜',title:'注水：透镜变鼓',cue:'039',actionCue:'040',resultCue:'042',u:30,screen:15,screenMove:true,task:'安装水透镜并注水，再移动光屏重新对焦。',question:q('物距不变、仍成实像时，注水使透镜变鼓，会怎样？',[select('焦距','变小',['变小','变大']),select('成像位置','更靠近透镜',['更靠近透镜','更远离透镜'])],'观察透镜变厚前后，清晰像的位置变化。')},
  {id:'water-out',group:'水透镜',title:'抽水：透镜变扁',cue:'040',resultCue:'046',u:30,screen:15,screenMove:true,task:'抽出水透镜中的水，再移动光屏重新对焦。',question:q('物距不变、仍成实像时，抽水使透镜变扁，会怎样？',[select('焦距','变大',['变小','变大']),select('成像位置','更远离透镜',['更靠近透镜','更远离透镜'])],'观察透镜变薄前后，清晰像的位置变化。')},
  {id:'causes',group:'无法成像',title:'逐个排查三类原因',cue:'047',resultCue:'050',task:'依次点开三个原因，观察各自对应的实验现象。',question:q('三个中心已同高，物体在焦点外，但导轨上仍找不到清晰像，可能是什么原因？',[select('最可能的原因','光具座太短',['三心不同高','物体位于焦点内','光具座太短'])],'物体在焦点外应成实像；如果像距超过光具座范围，光屏便无法承接。')},
  {id:'burn',group:'蜡烛燃烧',title:'观察烛焰与像的升降',cue:'051',resultCue:'052',u:20,screen:20,task:'点燃蜡烛，观察它逐渐变短时，焰心和像怎样移动。',question:q('成实像时，烛焰下降，像怎样移动？',[select('像的移动方向','上升',['上升','下降','不动'])],'物距与焦距不变，实像与物体的竖直移动方向相反。')},
  {id:'swap',group:'像物互换',title:'验证光路可逆',cue:'053',resultCue:'054',u:30,screen:15,task:'保持凸透镜不动，将蜡烛和光屏在透镜两侧的位置互换。',question:q('互换后仍能成清晰的像，它有什么变化？',[select('像的大小','放大',sizes),select('说明','光路可逆',['光路可逆','焦距改变'])],'物距和像距互换后，像仍清晰，说明光路可逆。')},
  {id:'summary',group:'结课总结',title:'凸透镜成像规律总表',cue:'055',resultCue:'055',task:'本课结论已整理好，截图保存这张成像规律总表吧！'},
]
export const groups=[...new Set(stages.map(s=>s.group))]
export const topicNames:Record<string,string>={
  '粗测焦距（会聚）':'根据会聚光斑测焦距',
  '粗测焦距（图像）':'根据图像确定焦距',
  '三心同高':'调节三心同高',
  'F 型光源':'用 F 光源观察成像',
  '成像特点与应用':'成像特点与实际应用',
  '实像虚像的判断':'实像与虚像的判断',
  '动态成像':'物像移动的变化规律',
  '透镜遮挡':'探究透镜遮挡的影响',
  '眼镜判断':'近视镜与远视镜判断',
  '水透镜':'水透镜与焦距变化',
  '无法成像':'无法成像的原因排查',
  '蜡烛燃烧':'蜡烛燃烧与像的变化',
  '像物互换':'物像互换与光路可逆',
  '结课总结':'凸透镜成像规律总结',
}
export const STORAGE_KEY='guided-optics.curriculum.v4'
export const trials=[
  {u:30,v:'15',condition:'u > 2f',range:'f < v < 2f',orientation:'倒立',size:'缩小',nature:'实像'},
  {u:20,v:'20',condition:'u = 2f',range:'v = 2f',orientation:'倒立',size:'等大',nature:'实像'},
  {u:15,v:'30',condition:'f < u < 2f',range:'v > 2f',orientation:'倒立',size:'放大',nature:'实像'},
  {u:10,v:'∞',condition:'u = f',range:'不成有限远像',orientation:'—',size:'—',nature:'不成有限远像'},
  {u:6,v:'15',condition:'u < f',range:'与物同侧',orientation:'正立',size:'放大',nature:'虚像'},
]
export const conclusionRows=[
  {condition:'u > 2f',position:'f < v < 2f',orientation:'倒立',size:'缩小',nature:'实像',application:'照相机'},
  {condition:'u = 2f',position:'v = 2f',orientation:'倒立',size:'等大',nature:'实像',application:'—'},
  {condition:'f < u < 2f',position:'v > 2f',orientation:'倒立',size:'放大',nature:'实像',application:'投影仪'},
  {condition:'u = f',position:'折射光近似平行',orientation:'—',size:'—',nature:'不成有限远像',application:'—'},
  {condition:'u < f',position:'物体同侧',orientation:'正立',size:'放大',nature:'虚像',application:'放大镜'},
]
export const emptyRow=():RecordRow=>({v:'',orientation:'',size:'',nature:''})
export const fresh=():LabState=>({version:4,step:0,phase:'adjust',equipment:0,height:0,u:30,screen:24,throughLens:false,records:trials.map(emptyRow),completedSteps:[],scanned:[24,24],source:'candle',glasses:'none',water:0,waterInstalled:false,cover:0,touched:false,swapped:false,lit:false,burned:0,causes:[],samples:[],motion:null})
export function selectStep(s:LabState,target:number):LabState{
  const step=Math.max(0,Math.min(stages.length-1,Math.trunc(target))),stage=stages[step]
  return {...fresh(),records:s.records,completedSteps:s.completedSteps,step,equipment:stage.id==='setup'?s.equipment:3,u:stage.u??26,screen:stage.screen??24,scanned:[stage.screen??24,stage.screen??24],height:stage.height?-3:0,waterInstalled:stage.id==='water-out',phase:stage.id==='setup'&&s.equipment===3?'done':'adjust'}
}
export function load():LabState{
  try{
    let raw=JSON.parse(localStorage.getItem(STORAGE_KEY)||localStorage.getItem('guided-optics.curriculum.v3')||'null')
    if(!raw){const legacy=JSON.parse(localStorage.getItem('guided-optics.imaging.v2')||'null');return legacy?.records?.length===5&&legacy.records.every((r:RecordRow)=>r&&['v','orientation','size','nature'].every(k=>typeof r[k as keyof RecordRow]==='string'))?{...fresh(),records:legacy.records}:fresh()}
    // Version 3 had a navigation-only activity at index 15. Keep saved progress on the same experiment.
    if(raw.version===3){
      const removed=raw.step===15
      raw={...raw,version:4,motion:null,step:raw.step>15?raw.step-1:raw.step,completedSteps:(Array.isArray(raw.completedSteps)?raw.completedSteps:[]).filter((n:number)=>Number.isInteger(n)&&n!==15).map((n:number)=>n>15?n-1:n)}
      if(removed)raw=selectStep({...fresh(),records:raw.records,completedSteps:raw.completedSteps},15)
    }
    if(raw.version!==4||!Number.isInteger(raw.step)||!stages[raw.step]||!['adjust','observe','answer','done'].includes(raw.phase))return fresh()
    const base=fresh()
    if(Object.keys(base).some(key=>key!=='motion'&&typeof raw[key]!==typeof base[key as keyof LabState]))return fresh()
    if(![null,'water-in','water-out','burn'].includes(raw.motion))return fresh()
    if(raw.motion&&(raw.motion!==stages[raw.step].id||raw.phase!=='adjust'||(raw.motion==='burn'?!raw.lit:!raw.waterInstalled)))return fresh()
    if(!([['u',5,35],['screen',5,38],['height',-6,6],['equipment',0,3],['cover',0,75],['water',-1,1],['burned',0,3]]as const).every(([key,min,max])=>Number.isFinite(raw[key])&&raw[key]>=min&&raw[key]<=max))return fresh()
    if(!['candle','F'].includes(raw.source)||!['none','near','far'].includes(raw.glasses)||!Array.isArray(raw.records)||raw.records.length!==5||!raw.records.every((r:RecordRow)=>r&&['v','orientation','size','nature'].every(k=>typeof r[k as keyof RecordRow]==='string')))return fresh()
    if(!Array.isArray(raw.scanned)||raw.scanned.length!==2||!raw.scanned.every((n:number)=>Number.isFinite(n)&&n>=5&&n<=38))return fresh()
    if(!Array.isArray(raw.samples)||!raw.samples.every((p:{u:number;v:number})=>p&&Number.isFinite(p.u)&&p.u>10&&p.u<=35&&Number.isFinite(p.v)&&Math.abs(p.v-10*p.u/(p.u-10))<.3))return fresh()
    return {...base,...raw,completedSteps:[...new Set<number>((Array.isArray(raw.completedSteps)?raw.completedSteps:[]).filter((n:number)=>Number.isInteger(n)&&!!stages[n]))],causes:[...new Set<number>((Array.isArray(raw.causes)?raw.causes:[]).filter((n:number)=>[0,1,2].includes(n)))]}
  }catch{return fresh()}
}
export const focalLength=(s:LabState)=>s.waterInstalled?10-s.water*2:10
export function physicsFor(s:LabState){return optics(s.u,s.screen,!!stages[s.step].parallel,s.throughLens,{focal:focalLength(s),height:s.height,glasses:s.glasses,cover:s.cover,swapped:s.swapped})}
export function ready(s:LabState):boolean{
  if(s.motion)return false
  const stage=stages[s.step],p=physicsFor(s)
  switch(stage.id){
    case 'setup':return s.equipment===3
    case 'graph':return s.touched
    case 'alignment':return s.height===0
    case 'f-source':return s.source==='F'
    case 'virtual':return s.throughLens
    case 'infinity':return s.scanned[0]<=8&&s.scanned[1]>=34
    case 'cover':return s.touched&&s.cover>=25&&s.cover<=75
    case 'near-glasses':return s.glasses==='near'&&p.focused
    case 'far-glasses':return s.glasses==='far'&&p.focused
    case 'water-in':return s.waterInstalled&&s.water===1&&p.focused
    case 'water-out':return s.waterInstalled&&s.water===-1&&p.focused
    case 'causes':return s.causes.length===3
    case 'burn':return s.burned>=3
    case 'swap':return s.swapped&&p.focused
    case 'summary':return false
    default:{
      const inObjectRange=!stage.targetURange||(s.u>=stage.targetURange[0]&&s.u<=stage.targetURange[1])
      const screenDirectionOk=stage.screenDirection==='farther'?s.screen>=24:stage.screenDirection==='nearer'?s.screen<=17:true
      return p.focused&&inObjectRange&&screenDirectionOk
    }
  }
}
export function wrongAnswers(question:Question,answers:string[]):number[]{return question.fields.flatMap((f,i)=>{const a=answers[i]?.trim()||'',correct=f.tolerance!==undefined?a!==''&&Number.isFinite(Number(a))&&Math.abs(Number(a)-Number(f.answer))<=f.tolerance:a===f.answer;return correct?[]:[i]})}
export function wrongCells(records:RecordRow[]):string[]{return records.flatMap((row,i)=>(['v','orientation','size','nature']as const).filter(key=>{if(key!=='v')return row[key]!==trials[i][key];const v=row.v.trim();return i===3?!['∞','无穷大','无限远'].includes(v):v===''||!Number.isFinite(Number(v))||Math.abs(Number(v)-Number(trials[i].v))>.1}).map(key=>`${i}-${key}`))}
export function downloadRecords(){const lines=['物距条件,物距(cm),像距绝对值(cm),像的位置,正倒,大小,虚实',...trials.map(t=>[t.condition,t.u,t.v,t.range,t.orientation,t.size,t.nature].join(','))];return exportTable('\uFEFF'+lines.join('\r\n'))}
