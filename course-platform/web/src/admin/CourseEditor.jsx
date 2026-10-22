import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowUp,ArrowDown,BookOpen,Check,FileText,ImagePlus,LoaderCircle,Pencil,Play,Plus,Settings2,Trash2,Upload,X} from 'lucide-react';
import {api,uploadFile} from '../shared/api';
import {uploadVodVideo} from '../shared/vod-upload';

const limit=250*1024*1024;
const bytes=n=>n>=1024*1024?`${(n/1024/1024).toFixed(1)} MB`:`${(n/1024).toFixed(1)} KB`;
const statusName=s=>s==='published'?'已上架':'草稿 / 已下架';
const reorder=(list,index,offset)=>{const next=[...list],target=index+offset;if(target<0||target>=next.length)return next;[next[index],next[target]]=[next[target],next[index]];return next};

function Progress({task,cancel}){
 if(!task)return null;
 return <div className="adm-transfer" role="status" aria-live="polite"><div><Upload size={16}/><b>{task.name}</b><span>{task.label||(task.percent===100?'正在保存…':task.percent===null?'正在上传…':`${task.percent}%`)}</span>{cancel&&<button type="button" onClick={cancel}>取消上传</button>}</div><progress max="100" value={task.percent??undefined}/><small>{task.hint||'上传完成后请保存课时，内容才会生效。'}</small></div>;
}
function Empty({children}){return <div className="adm-empty"><BookOpen size={28}/><p>{children}</p></div>}
function SortButtons({index,count,onMove,disabled}){return <div className="adm-sort-buttons"><button type="button" disabled={disabled||index===0} onClick={()=>onMove(-1)} title="上移" aria-label="上移"><ArrowUp size={16}/></button><button type="button" disabled={disabled||index===count-1} onClick={()=>onMove(1)} title="下移" aria-label="下移"><ArrowDown size={16}/></button></div>}

export default function CourseEditor({initial,onClose,onSaved,notify}){
 const [course,setCourse]=useState({...initial,detailImages:initial.detailImages||[]}),[tab,setTab]=useState('info'),[busy,setBusy]=useState(false),[dirty,setDirty]=useState(false),[error,setError]=useState(''),[lesson,setLesson]=useState(null),[task,setTask]=useState(null);
 const controller=useRef(null);
 useEffect(()=>{setCourse({...initial,detailImages:initial.detailImages||[]});setDirty(false)},[initial]);
 useEffect(()=>{const before=e=>{if(dirty||controller.current){e.preventDefault();e.returnValue=''}};window.addEventListener('beforeunload',before);return()=>window.removeEventListener('beforeunload',before)},[dirty]);
 useEffect(()=>()=>controller.current?.abort(),[]);
 const set=(key,value)=>{setCourse(c=>({...c,[key]:value}));setDirty(true)};
 const close=()=>{if((dirty||task)&&!window.confirm(task?'文件正在上传，确定取消上传并离开？':'课程还有未保存修改，确定离开？'))return;controller.current?.abort();onClose()};
 async function refresh(){const c=await api(`/admin/courses/${course.id}`);setCourse(previous=>({...previous,lessons:c.lessons,materials:c.materials,lessonCount:c.lessonCount,duration:c.duration}));return c}
 async function save(e,status){e?.preventDefault();if(task)return;setBusy(true);setError('');try{const payload={...course,status:status||course.status,price:Number(course.price),originalPrice:Number(course.originalPrice),detailImages:course.detailImages||[]};const saved=await api(course.id?`/admin/courses/${course.id}`:'/admin/courses',{method:course.id?'PUT':'POST',body:payload});setCourse({...saved,detailImages:saved.detailImages||[]});setDirty(false);onSaved(saved)}catch(e){setError(e.message)}finally{setBusy(false)}}
 async function upload(path,file){if(file.size>limit)throw new Error(`${file.name} 超过 250 MB，请压缩或分节后上传`);const ac=new AbortController(),hint=path.includes('/materials')?'讲义上传成功后自动加入当前课程。':'图片上传后请保存课程，修改才会同步。';controller.current=ac;setTask({name:file.name,percent:0,hint});try{return await uploadFile(path,file,{signal:ac.signal,onProgress:p=>setTask({name:file.name,percent:p.percent,hint})})}finally{controller.current=null;setTask(null)}}
 async function images(e,kind){const files=[...e.target.files];e.target.value='';if(!files.length)return;setError('');const added=[];try{if(kind==='details'&&files.length+(course.detailImages?.length||0)>20)throw new Error('商详图片最多 20 张，请减少文件数量');for(const file of files){if(!/\.(jpe?g|png|webp)$/i.test(file.name))throw new Error('图片仅支持 JPG、PNG、WebP');const result=await upload('/admin/uploads',file);if(kind==='cover')set('coverImage',result.url);else{added.push(result.url);setCourse(c=>({...c,detailImages:[...(c.detailImages||[]),result.url]}));setDirty(true)}}notify(kind==='cover'?'封面已上传，请保存课程':`${added.length} 张商详图片已上传，请保存课程`)}catch(e){if(e.name!=='AbortError')setError(`${e.message}${added.length?`；已成功添加 ${added.length} 张，其余文件可重新选择`:''}`)}}
 async function materials(e){const files=[...e.target.files];e.target.value='';setError('');let uploaded=0;try{for(const file of files){await upload(`/admin/courses/${course.id}/materials`,file);uploaded++}await refresh();notify(`${uploaded} 份讲义已上传`)}catch(e){await refresh().catch(()=>{});if(e.name!=='AbortError')setError(`${e.message}${uploaded?`；已成功上传 ${uploaded} 份`:''}`)}}
 async function remove(kind,item){if(!window.confirm(`删除“${item.title||item.name}”？${kind==='lessons'?'该课时的学习进度也会删除。':'购买学员将无法再下载此资料。'}`))return;setBusy(true);setError('');try{await api(`/admin/${kind}/${item.id}`,{method:'DELETE'});await refresh();notify('已删除')}catch(e){setError(e.message)}finally{setBusy(false)}}
 async function moveLesson(index,offset){const ordered=reorder(course.lessons,index,offset);setBusy(true);setError('');try{for(let i=0;i<ordered.length;i++){if(Number(ordered[i].sort)!==i)await api(`/admin/lessons/${ordered[i].id}`,{method:'PUT',body:{sort:i}})}await refresh();notify('课时顺序已保存')}catch(e){setError('调整顺序未全部完成，请重试。'+e.message);await refresh().catch(()=>{})}finally{setBusy(false)}}
 const disabled=busy||!!task;
 return <><button className="adm-back-link" onClick={close}><ArrowLeft size={17}/>返回课程列表</button><div className="adm-page-heading"><div><span className="adm-eyebrow">COURSE STUDIO</span><h1>{course.id?'编辑课程':'创建新课程'}</h1><p>编辑商详、视频与讲义，保存后同步至微信小程序。</p></div><span className={`adm-badge ${course.status}`}>{statusName(course.status)}</span></div>{error&&<div className="adm-error" role="alert">{error}<button type="button" onClick={()=>setError('')} aria-label="关闭错误"><X size={16}/></button></div>}<Progress task={task} cancel={()=>controller.current?.abort()}/><div className="adm-editor-tabs">{[['info','课程信息',Settings2],['images','封面与商详',ImagePlus],['lessons','视频课时',Play],['materials','讲义资料',FileText]].map(([id,label,Icon])=><button type="button" disabled={!!task||(!course.id&&['lessons','materials'].includes(id))} onClick={()=>setTab(id)} className={tab===id?'active':''} key={id}><Icon size={17}/>{label}{['lessons','materials'].includes(id)&&<span>{course[id]?.length||0}</span>}</button>)}</div>
 {tab==='info'&&<form id="course-info" className="adm-panel adm-course-form" onSubmit={save}><div className="adm-form-section-title"><h2>基本信息</h2><p>课程价格、名称和商品 ID 应与微信虚拟支付中的商品一致。</p></div><div className="adm-form-grid"><label className="adm-span2">课程名称 <em>*</em><input value={course.title||''} onChange={e=>set('title',e.target.value)} required maxLength={120} placeholder="2027 届高考化学系统全程班"/></label><label className="adm-span2">课程副标题<input value={course.subtitle||''} onChange={e=>set('subtitle',e.target.value)} maxLength={300} placeholder="一句话说明课程的学习目标"/></label><Select label="学科" value={course.subject} values={['化学','数学','英语','物理','语文','生物','政治','历史','地理','综合']} onChange={v=>set('subject',v)}/><Select label="年级" value={course.grade} values={['高一','高二','高三','初一','初二','初三','通用']} onChange={v=>set('grade',v)}/><Select label="课程类型" value={course.type} values={['系统课','专题课','体验课']} onChange={v=>set('type',v)}/><label>主讲老师 <em>*</em><input value={course.teacher||''} onChange={e=>set('teacher',e.target.value)} required maxLength={40}/></label><label>老师介绍<input value={course.teacherTitle||''} onChange={e=>set('teacherTitle',e.target.value)} maxLength={40}/></label><label>虚拟支付商品 ID<input value={course.productId||''} onChange={e=>set('productId',e.target.value.trim())} maxLength={128} title="商品 ID 仅支持字母、数字、点、下划线和短横线" autoComplete="off" placeholder="微信虚拟支付后台中的商品 ID"/><small>只填写商品 ID，支付密钥在服务器配置。</small></label><label>课程售价（元）<input type="number" min="0" max="999999" step="0.01" value={course.price} onChange={e=>set('price',e.target.value)} required/><small>0 元课程可免费选课；收费课程付款成功后开通。</small></label><label>原价（元）<input type="number" min="0" max="999999" step="0.01" value={course.originalPrice} onChange={e=>set('originalPrice',e.target.value)} required/></label><Select label="封面备用配色" value={course.coverTheme} values={['orange','blue','purple','teal','gold','rose']} labels={['暖橙','天蓝','浅紫','青绿','金色','浅粉']} onChange={v=>set('coverTheme',v)}/><Select label="发布状态" value={course.status} values={['draft','published']} labels={['草稿 / 下架','已上架']} onChange={v=>set('status',v)}/><label className="adm-span2">课程标签<input value={(course.tags||[]).join('，')} onChange={e=>set('tags',e.target.value.split(/[，,]/).map(t=>t.trim()).filter(Boolean).slice(0,8))} placeholder="用逗号分隔，最多 8 个"/></label><label className="adm-shipping-course-toggle"><span><input type="checkbox" checked={Boolean(course.shippingEnabled)} onChange={e=>set('shippingEnabled',e.target.checked)}/> 提供实物讲义寄送</span><small>开启后，已付款学员可选择收货地址申请寄送。请在课程介绍中说明运费及寄送范围。</small></label><label className="adm-span2">课程介绍<textarea rows={7} value={course.description||''} onChange={e=>set('description',e.target.value)} maxLength={10000} placeholder="课程内容、适合人群、学习计划与购买须知"/></label></div></form>}
 {tab==='images'&&<section className="adm-panel adm-course-form"><div className="adm-form-section-title"><h2>课程封面</h2><p>建议使用横版清晰图片，学生列表与商详顶部共用封面。</p></div><div className="adm-cover-editor">{course.coverImage?<img src={course.coverImage} alt="当前课程封面"/>:<div className="adm-cover-placeholder"><ImagePlus size={32}/><span>还未上传课程封面</span></div>}<div><label className={`adm-secondary adm-file-button ${disabled?'disabled':''}`}><Upload size={16}/>{course.coverImage?'替换封面':'上传封面'}<input type="file" accept=".jpg,.jpeg,.png,.webp" disabled={disabled} onChange={e=>images(e,'cover')}/></label>{course.coverImage&&<button type="button" className="adm-text-danger" disabled={disabled} onClick={()=>set('coverImage','')}>移除封面</button>}<small>JPG / PNG / WebP · 不超过 250 MB</small></div></div><div className="adm-form-section-title adm-section-space"><h2>课程商详图片 <span>{course.detailImages?.length||0} / 20</span></h2><p>按学生阅读顺序排列，上传后可通过箭头调整；修改后保存课程。</p></div><div className="adm-detail-image-list">{course.detailImages?.map((url,index)=><article key={`${url}-${index}`}><div className="adm-detail-thumb"><img src={url} alt={`商详第 ${index+1} 张`} loading="lazy"/></div><div><b>第 {index+1} 张</b><SortButtons index={index} count={course.detailImages.length} disabled={disabled} onMove={offset=>set('detailImages',reorder(course.detailImages,index,offset))}/><button type="button" disabled={disabled} className="adm-text-danger" onClick={()=>set('detailImages',course.detailImages.filter((_,i)=>i!==index))}><Trash2 size={15}/>删除</button></div></article>)}</div><label className={`adm-upload-zone adm-image-add ${disabled?'disabled':''}`}><ImagePlus size={24}/><b>添加商详图片</b><span>可多选，按选择顺序添加；最多 20 张</span><input type="file" accept=".jpg,.jpeg,.png,.webp" multiple disabled={disabled||(course.detailImages?.length||0)>=20} onChange={e=>images(e,'details')}/></label></section>}
 {tab==='lessons'&&<section className="adm-panel"><div className="adm-panel-heading"><div><h2>视频课时 <span>{course.lessons?.length||0}</span></h2><p>收费视频需通过鉴权播放。勾选试看后，该整节课会向未购买学员开放。</p></div><button type="button" className="adm-primary" disabled={disabled} onClick={()=>setLesson({title:'',duration:1800,videoUrl:'',isPreview:false,sort:course.lessons?.length||0})}><Plus size={17}/>添加课时</button></div><div className="adm-lessons-list">{course.lessons?.map((item,index)=><div key={item.id}><span className="adm-lesson-index">{String(index+1).padStart(2,'0')}</span><div><b>{item.title}</b><small>{Math.floor(item.duration/60)} 分 {item.duration%60} 秒 · {item.videoUrl?'已有视频':'待上传视频'} · {item.isPreview?'整节免费试看':'购买后观看'}</small></div><SortButtons index={index} count={course.lessons.length} disabled={disabled} onMove={offset=>moveLesson(index,offset)}/><button disabled={disabled} title="编辑课时" onClick={()=>setLesson(item)}><Pencil size={17}/></button><button disabled={disabled} title="删除课时" className="danger" onClick={()=>remove('lessons',item)}><Trash2 size={17}/></button></div>)}{!course.lessons?.length&&<Empty>先添加课时，再上传对应的视频文件。</Empty>}</div></section>}
 {tab==='materials'&&<section className="adm-panel"><div className="adm-panel-heading"><div><h2>课程讲义 <span>{course.materials?.length||0}</span></h2><p>PDF / Word / PPT / Excel / TXT；每份最大 250 MB，仅选课学员可下载。</p></div><label className={`adm-primary adm-file-button ${disabled?'disabled':''}`}><Upload size={17}/>上传讲义<input type="file" multiple accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.md" disabled={disabled} onChange={materials}/></label></div><div className="adm-lessons-list">{course.materials?.map(item=><div key={item.id}><span className="adm-file-icon"><FileText size={22}/></span><div><b>{item.name}</b><small>{item.fileName} · {bytes(item.size)}</small></div><button type="button" disabled={disabled} className="danger" title="删除资料" onClick={()=>remove('materials',item)}><Trash2 size={17}/></button></div>)}{!course.materials?.length&&<Empty>上传课程讲义，购买后即可下载。</Empty>}</div></section>}
 <div className="adm-editor-savebar"><span>{dirty?'有未保存的课程修改':course.id?'课程信息已保存':'先保存草稿，即可上传课时与讲义'}</span><div><button type="button" className="adm-secondary" disabled={disabled} onClick={e=>save(e,'draft')}>{course.status==='published'?'保存并下架':'保存草稿'}</button><button type="button" className="adm-primary" disabled={disabled} onClick={e=>{const form=document.getElementById('course-info');if(form&&!form.reportValidity())return;save(e)}}>{busy?<LoaderCircle size={17} className="adm-spin"/>:<Check size={17}/>}保存课程</button>{course.status!=='published'&&<button type="button" className="adm-secondary" disabled={disabled||!course.id} onClick={e=>save(e,'published')}>发布上架</button>}</div></div>
 {lesson&&<LessonModal lesson={lesson} courseId={course.id} close={()=>setLesson(null)} saved={async()=>{setLesson(null);await refresh();notify('课时已保存')}}/>}</>;
}
function Select({label,value,values,labels,onChange}){return <label>{label}<select value={value||values[0]} onChange={e=>onChange(e.target.value)}>{values.map((v,index)=><option value={v} key={v}>{labels?.[index]||v}</option>)}</select></label>}

function LessonModal({lesson,courseId,close,saved}){
 const initialVod=/^vod:/.test(lesson.videoUrl||'');
 const [value,setValue]=useState({...lesson}),[busy,setBusy]=useState(false),[task,setTask]=useState(null),[error,setError]=useState(''),[dirty,setDirty]=useState(false);
 const [mode,setMode]=useState(initialVod||!lesson.videoUrl?'vod':'local'),[config,setConfig]=useState(null),[configError,setConfigError]=useState(''),[configLoading,setConfigLoading]=useState(true);
 const [media,setMedia]=useState(initialVod?{fileId:lesson.videoUrl.slice(4),status:'processing'}:null),[mediaError,setMediaError]=useState(''),[checking,setChecking]=useState(false);
 const controller=useRef(null),lastFile=useRef(null),alive=useRef(true),mediaRequest=useRef(0);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;mediaRequest.current++;controller.current?.abort()}},[]);
 const set=(key,data)=>{setValue(v=>({...v,[key]:data}));setDirty(true)};
 const dismiss=()=>{if((dirty||task)&&!window.confirm(task?'视频还在上传，取消并关闭？':'课时修改尚未保存，确定关闭？'))return;controller.current?.abort();close()};
 useEffect(()=>{const onKey=e=>{if(e.key==='Escape')dismiss()};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey)},[dirty,task]);
 useEffect(()=>{const before=e=>{if(dirty||task){e.preventDefault();e.returnValue=''}};window.addEventListener('beforeunload',before);return()=>window.removeEventListener('beforeunload',before)},[dirty,task]);
 async function loadConfig(){setConfigLoading(true);setConfigError('');try{const result=await api('/admin/vod/config');if(alive.current)setConfig(result)}catch(e){if(alive.current)setConfigError(e.message)}finally{if(alive.current)setConfigLoading(false)}}
 useEffect(()=>{loadConfig()},[]);
 function applyMedia(result){
  setMedia(result);setMediaError('');
  if(result.status==='ready')setValue(v=>({...v,videoUrl:`vod:${result.fileId}`,...(Number(result.duration)>0?{duration:Math.max(1,Math.round(result.duration))}:{})}));
 }
 async function checkMedia(fileId){
  const request=++mediaRequest.current;setChecking(true);
  try{const result=await api(`/admin/vod/media/${encodeURIComponent(fileId)}`);if(alive.current&&request===mediaRequest.current)applyMedia(result)}
  catch(e){if(alive.current&&request===mediaRequest.current)setMediaError(e.message)}
  finally{if(alive.current&&request===mediaRequest.current)setChecking(false)}
 }
 useEffect(()=>{
  if(mode!=='vod'||task||!media?.fileId||media.status==='ready'||media.status==='failed'||mediaError)return;
  const timer=setTimeout(()=>checkMedia(media.fileId),4000);
  return()=>clearTimeout(timer);
 },[mode,media,mediaError,!!task]);
 const canUploadVod=!!config?.uploadConfigured&&!!config?.playbackConfigured;
 const pendingVod=mode==='vod'&&!!value.videoUrl&&(media?.status!=='ready'||media?.fileId!==value.videoUrl.slice(4)||!!mediaError);
 function changeMode(next){
  if(next===mode)return;
  mediaRequest.current++;setChecking(false);setMode(next);setMedia(null);setMediaError('');setError('');lastFile.current=null;set('videoUrl','');
 }
 async function sendVideo(file){
  setError('');setMediaError('');
  if(!/\.(mp4|webm|mov)$/i.test(file.name)){setError('请选择 MP4、WebM 或 MOV 视频');return}
  if(mode==='local'&&file.size>limit){setError('服务器上传最大 250 MB，大课时请选择云点播直传');return}
  if(mode==='vod'&&!canUploadVod){setError('请先完成云点播上传和播放配置，再上传视频');return}
  mediaRequest.current++;setChecking(false);
  const ac=new AbortController();controller.current=ac;lastFile.current=file;
  const hint=mode==='vod'?'视频直接上传云点播，完成处理后可保存课时。':'上传完成后请保存课时。';
  setTask({name:file.name,percent:0,hint});
  try{
   if(mode==='vod'){
    const result=await uploadVodVideo(file,{signal:ac.signal,onProgress:p=>{if(alive.current)setTask({name:file.name,percent:p.percent,hint,label:p.confirming?'正在确认云端视频…':undefined})}});
    if(!alive.current)return;
    set('videoUrl',`vod:${result.fileId}`);applyMedia(result);
   }else{
    const result=await uploadFile('/admin/uploads',file,{signal:ac.signal,onProgress:p=>{if(alive.current)setTask({name:file.name,percent:p.percent,hint})}});
    if(alive.current)set('videoUrl',result.url);
   }
  }catch(e){if(alive.current&&e.name!=='AbortError')setError(e.message)}
  finally{if(alive.current){controller.current=null;setTask(null)}}
 }
 async function retryProcessing(){
  setChecking(true);setMediaError('');
  const request=++mediaRequest.current;
  try{const result=await api(`/admin/vod/media/${encodeURIComponent(media.fileId)}/transcode`,{method:'POST',body:{}});if(alive.current&&request===mediaRequest.current)applyMedia(result)}
  catch(e){if(alive.current&&request===mediaRequest.current)setMediaError(e.message)}
  finally{if(alive.current&&request===mediaRequest.current)setChecking(false)}
 }
 function upload(e){const file=e.target.files[0];e.target.value='';if(file)sendVideo(file)}
 async function submit(e){
  e.preventDefault();if(task||pendingVod)return;
  setBusy(true);setError('');
  try{await api(value.id?`/admin/lessons/${value.id}`:`/admin/courses/${courseId}/lessons`,{method:value.id?'PUT':'POST',body:{title:value.title,duration:Number(value.duration),sort:Number(value.sort)||0,videoUrl:value.videoUrl,isPreview:!!value.isPreview}});await saved()}
  catch(e){setError(e.message)}finally{setBusy(false)}
 }
 return <div className="adm-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)dismiss()}}><div className="adm-modal adm-video-modal" role="dialog" aria-modal="true" aria-label="编辑视频课时"><header><div><span className="adm-eyebrow">LESSON STUDIO</span><h2>{value.id?'编辑课时':'添加视频课时'}</h2></div><button title="关闭" onClick={dismiss}><X size={21}/></button></header><form onSubmit={submit}>
  <label>课时名称<input autoFocus required maxLength={200} value={value.title} onChange={e=>set('title',e.target.value)} placeholder="第一讲 · 化学计量"/></label>
  <div className="adm-form-grid"><label>时长（秒）<input type="number" min="1" max="86400" step="1" required value={value.duration} onChange={e=>set('duration',e.target.value)}/><small>{mode==='vod'?'云端处理完成后自动填写，可手动调整。':'例如 30 分钟为 1800 秒。'}</small></label><label>排序（从 0 开始）<input type="number" min="0" step="1" value={value.sort} onChange={e=>set('sort',e.target.value)}/></label></div>
  <fieldset className="adm-video-source" disabled={!!task||busy}><legend>视频上传方式</legend><label><input type="radio" name="video-source" checked={mode==='vod'} onChange={()=>changeMode('vod')}/><span><b>云点播直传</b><small>适合正式课程，支持 CDN 加速播放</small></span></label><label><input type="radio" name="video-source" checked={mode==='local'} onChange={()=>changeMode('local')}/><span><b>服务器存储</b><small>兼容已有视频，占用服务器带宽</small></span></label></fieldset>
  {mode==='vod'&&<div className={`adm-vod-config ${canUploadVod?'ready':''}`} role="status"><div>{configLoading?<><LoaderCircle size={15} className="adm-spin"/><span>正在检查云点播配置…</span></>:canUploadVod?<><Check size={16}/><span>云点播已就绪 · 视频直接上传至腾讯云</span></>:<><Settings2 size={16}/><span>{configError?'暂时无法获取云点播配置':'云点播尚未就绪'}</span></>}<button type="button" disabled={configLoading||!!task} onClick={loadConfig}>重新检查</button></div>{!configLoading&&!canUploadVod&&<p>{configError||config?.message||(!config?.uploadConfigured?'请完成服务器的云点播上传授权。':'请完成云点播域名、转码与播放鉴权配置。')}配置完成后可在此重新检查。</p>}</div>}
  {mode==='local'&&<label>视频地址<input value={value.videoUrl||''} onChange={e=>set('videoUrl',e.target.value)} placeholder="上传后自动填写，可留空稍后补充"/><small>服务器视频保留购买鉴权。外部地址请使用带鉴权的 HTTPS 视频服务。</small></label>}
  <label className={`adm-upload-zone ${task||busy||(mode==='vod'&&!canUploadVod)?'disabled':''}`}><Upload size={24}/><b>{value.videoUrl?'替换视频文件':mode==='vod'?'上传至云点播':'上传到服务器'}</b><span>{mode==='vod'?'MP4 / WebM / MOV · 云端处理后可保存':'MP4 / WebM / MOV · 最大 250 MB'}</span><input type="file" accept=".mp4,.webm,.mov" disabled={!!task||busy||(mode==='vod'&&!canUploadVod)} onChange={upload}/></label>
  <Progress task={task} cancel={()=>controller.current?.abort()}/>
  {mode==='vod'&&media&&!task&&<div className={`adm-vod-media ${media.status}`} role="status" aria-live="polite"><div>{media.status==='ready'?<Check size={18}/>:media.status==='processing'?<LoaderCircle size={18} className="adm-spin"/>:<X size={18}/>}<b>{media.status==='ready'?'视频已就绪':media.status==='failed'?'视频处理失败':'云端处理中'}</b><button type="button" disabled={checking} onClick={()=>{setMediaError('');checkMedia(media.fileId)}}>{checking?'正在检查…':'刷新状态'}</button></div>{media.name&&<span className="adm-vod-filename">{media.name}</span>}<p>{media.status==='ready'?'保存课时后，学员按课程权限观看。':media.status==='failed'?(media.errorMessage||'请重试云端处理，或重新上传视频。'):'视频已上传，正在转码与检查播放状态；完成后才能保存。'}</p>{mediaError&&<p className="adm-vod-warning">检查失败：{mediaError}，请刷新状态重试。</p>}{media.status==='failed'&&<button type="button" className="adm-secondary" disabled={!canUploadVod||busy||checking} onClick={retryProcessing}>重新处理视频</button>}</div>}
  <label className="adm-checkbox"><input type="checkbox" checked={!!value.isPreview} onChange={e=>set('isPreview',e.target.checked)}/>向未购买学员开放整节免费试看</label>
  {error&&<div className="adm-error" role="alert"><span>{error}</span>{lastFile.current&&!task&&<button type="button" disabled={busy||(mode==='vod'&&!canUploadVod)} onClick={()=>sendVideo(lastFile.current)}>重试上传</button>}</div>}
  <div className="adm-modal-actions"><button type="button" className="adm-secondary" disabled={busy} onClick={dismiss}>取消</button><button className="adm-primary" disabled={busy||!!task||pendingVod}>{busy?<LoaderCircle className="adm-spin" size={17}/>:<Check size={17}/>}保存课时</button></div>
 </form></div></div>;
}
