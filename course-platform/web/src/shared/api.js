import React, {createContext,useContext,useState,useEffect} from 'react';
const KEY='zhike_session';
const read=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'null')}catch{return null}};
const isAdmin=()=>location.pathname.startsWith('/admin');
export async function api(path,options={}){
  const session=read();const token=options.token??(isAdmin()?localStorage.getItem('zhike_admin_token'):session?.token);
  const headers={...options.headers};if(token)headers.Authorization=`Bearer ${token}`;
  let body=options.body;if(body&&!(body instanceof FormData)){headers['Content-Type']='application/json';body=JSON.stringify(body)}
  const response=await fetch(`/api${path}`,{...options,headers,body});
  const result=await response.json().catch(()=>({message:'服务器返回格式异常'}));
  if(!response.ok){const error=new Error(result.message||result.error?.message||result.error||'操作失败，请重试');error.status=response.status;throw error}
  return result && Object.prototype.hasOwnProperty.call(result,'data') ? result.data : result;
}
// XMLHttpRequest exposes transfer progress for large teaching videos.
export function uploadFile(path,file,{onProgress,signal,fields={}}={}){
  return new Promise((resolve,reject)=>{
    const request=new XMLHttpRequest();
    const session=read(),token=isAdmin()?localStorage.getItem('zhike_admin_token'):session?.token;
    const form=new FormData();form.append('file',file);
    Object.entries(fields).forEach(([key,value])=>form.append(key,String(value)));
    request.open('POST',`/api${path}`);request.timeout=15*60*1000;
    if(token)request.setRequestHeader('Authorization',`Bearer ${token}`);
    const cleanup=()=>signal?.removeEventListener('abort',abort);
    const abort=()=>request.abort();
    request.upload.onprogress=e=>onProgress?.({loaded:e.loaded,total:e.total,percent:e.lengthComputable?Math.min(100,Math.round(e.loaded/e.total*100)):null});
    request.onload=()=>{
      cleanup();let result;try{result=JSON.parse(request.responseText)}catch{reject(new Error('服务器返回格式异常，请刷新后检查文件是否已上传'));return}
      if(request.status<200||request.status>=300){const error=new Error(result.message||result.error?.message||'上传失败，请重试');error.status=request.status;reject(error);return}
      resolve(result&&Object.prototype.hasOwnProperty.call(result,'data')?result.data:result);
    };
    request.onerror=()=>{cleanup();reject(new Error('网络中断，文件未确认上传成功，请重试'))};
    request.ontimeout=()=>{cleanup();reject(new Error('上传超时，请检查网络后重试'))};
    request.onabort=()=>{cleanup();const error=new Error('已取消上传');error.name='AbortError';reject(error)};
    if(signal?.aborted){reject(new Error('已取消上传'));return}
    signal?.addEventListener('abort',abort,{once:true});request.send(form);
  });
}
export async function downloadFile(id,name='课程资料'){
  const session=read();const response=await fetch(`/api/materials/${encodeURIComponent(id)}/download`,{headers:{Authorization:`Bearer ${session?.token||''}`}});
  if(!response.ok){const e=await response.json();throw new Error(e.message||e.error?.message||e.error||'下载失败')}
  const disposition=response.headers.get('content-disposition')||'';
  const encoded=disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if(encoded){try{name=decodeURIComponent(encoded)}catch{}}
  const url=URL.createObjectURL(await response.blob());const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),15000);
}
const Context=createContext(null);
export function SessionProvider({children}){
  const [session,setSession]=useState(read);
  const login=(token,user)=>{const s={token,user};localStorage.setItem(KEY,JSON.stringify(s));setSession(s)};
  const logout=()=>{localStorage.removeItem(KEY);setSession(null)};
  useEffect(()=>{if(session?.token)api('/me',{token:session.token}).then(user=>setSession(s=>s?{...s,user}:s)).catch(e=>{if(e.status===401)logout()})},[]);
  return React.createElement(Context.Provider,{value:{user:session?.user,token:session?.token,login,logout}},children);
}
export const useSession=()=>useContext(Context);
