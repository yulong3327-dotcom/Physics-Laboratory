import {api} from './api';

const aborted=()=>Object.assign(new Error('已取消上传'),{name:'AbortError'});

// The SDK uploads the File directly to Tencent VOD. Only the short-lived
// signature and the resulting media ID pass through the course API.
export async function uploadVodVideo(file,{signal,onProgress}={}){
 if(signal?.aborted)throw aborted();
 let ticket=await api('/admin/vod/upload-signature',{method:'POST',body:{name:file.name},signal});
 const sdk=await import('vod-js-sdk-v6');
 if(signal?.aborted)throw aborted();
 const TcVod=sdk.default?.default||sdk.default;
 const client=new TcVod({getSignature:async()=>{
  if(signal?.aborted)throw aborted();
  if(ticket.expiresAt&&Date.now()>=Number(ticket.expiresAt)-60000)ticket=await api('/admin/vod/upload-signature',{method:'POST',body:{name:file.name},signal});
  return ticket.signature;
 }});
 const uploader=client.upload({mediaFile:file});
 let rejectAbort;
 const cancelled=new Promise((resolve,reject)=>{rejectAbort=reject});
 const cancel=()=>{try{uploader.cancel()}finally{rejectAbort(aborted())}};
 signal?.addEventListener('abort',cancel,{once:true});
 uploader.on('media_progress',info=>{if(signal?.aborted){uploader.cancel();return}onProgress?.({percent:Number.isFinite(info.percent)?Math.min(100,Math.round(info.percent*100)):null})});
 try{
  const uploaded=await Promise.race([uploader.done(),cancelled]);
  if(signal?.aborted)throw aborted();
  if(!uploaded.fileId)throw new Error('云点播未返回视频编号，请重新上传');
  onProgress?.({percent:100,confirming:true});
  return await api('/admin/vod/media/confirm',{method:'POST',body:{uploadId:ticket.uploadId,fileId:String(uploaded.fileId)},signal});
 }catch(error){
  if(signal?.aborted)throw aborted();
  if(error instanceof Error)throw error;
  throw new Error(error?.message||'云端上传失败，请检查网络后重试');
 }finally{signal?.removeEventListener('abort',cancel)}
}
