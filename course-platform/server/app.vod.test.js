import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from './app.js';

async function fixture(t,{configured=true}={}) {
  const dir=mkdtempSync(join(tmpdir(),'course-vod-'));
  const state={sourceContext:'',ready:false,taskFailed:false,unprotected:false,calls:[]};
  const env={NODE_ENV:'test',DEMO_MODE:'true',...(configured?{TENCENT_VOD_SECRET_ID:'test-id',TENCENT_VOD_SECRET_KEY:'test-secret',TENCENT_VOD_SUB_APP_ID:'1458910441',TENCENT_VOD_PLAYBACK_DOMAIN:'video.example.cn',TENCENT_VOD_URL_KEY:'testUrlKey123456',TENCENT_VOD_TRANSCODE_DEFINITION:'100230'}:{TENCENT_VOD_SECRET_ID:'',TENCENT_VOD_SECRET_KEY:'',TENCENT_VOD_SUB_APP_ID:'',TENCENT_VOD_URL_KEY:'',TENCENT_VOD_PLAYBACK_DOMAIN:''})};
  const client={
    async DescribeVodDomains(params){state.calls.push(['domains',params]);return {DomainSet:[{Domain:'video.example.cn',DeployStatus:'Online',HTTPSConfig:{CertExpireTime:'2099-01-01T00:00:00Z'},UrlSignatureAuthPolicy:{Status:state.unprotected?'Disabled':'Enabled',EncryptedKey:'testUrlKey123456'}}],TotalCount:1};},
    async DescribeMediaInfos(params){state.calls.push(['media',params]);return {MediaInfoSet:[{FileId:params.FileIds[0],BasicInfo:{Status:'Normal',Category:'Video',Name:'直传课程',SourceInfo:{SourceContext:state.sourceContext},MediaUrl:'https://video.example.cn/course/original.mp4'},MetaData:{Duration:65,Size:5000},TranscodeInfo:{TranscodeSet:state.ready?[{Definition:100230,Container:'hls',Url:'https://video.example.cn/course/hls/video.m3u8'}]:[]}}]};},
    async ProcessMedia(params){state.calls.push(['transcode',params]);return {TaskId:'task-1'};},
    async DescribeTaskDetail(){return {Status:state.taskFailed?'FINISH':'PROCESSING',ProcedureTask:{MediaProcessResultSet:[{Type:'Transcode',TranscodeTask:{Status:state.taskFailed?'FAIL':'PROCESSING',Input:{Definition:100230}}}]}};}
  };
  const instance=createApp({env,databasePath:join(dir,'db.sqlite'),uploadsDir:join(dir,'uploads'),vodClient:client,mediaFetch(){throw Error('VOD must never proxy media');},quiet:true});
  const server=instance.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const request=async(path,{token,method='GET',body}={})=>{
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method,headers:{...(token?{Authorization:`Bearer ${token}`} :{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    return {status:response.status,data:await response.json(),headers:response.headers};
  };
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));instance.close();rmSync(dir,{recursive:true,force:true});});
  const admin=(await request('/admin/login',{method:'POST',body:{username:'admin',password:'admin123456'}})).data.token;
  return {...instance,request,state,admin};
}

test('VOD is administrator-only and missing cloud credentials do not affect local courses',async t=>{
  const f=await fixture(t,{configured:false}),r=f.request;
  assert.equal((await r('/admin/vod/config')).status,401);
  assert.equal((await r('/admin/vod/config',{token:f.admin})).data.configured,false);
  assert.equal((await r('/admin/vod/upload-signature',{method:'POST',token:f.admin,body:{}})).status,503);
  assert.equal((await r('/courses')).status,200);assert.equal(f.state.calls.length,0);
  const student=(await r('/auth/demo',{method:'POST',body:{}})).data;
  assert.equal((await r('/admin/vod/upload-signature',{method:'POST',token:student.token,body:{}})).status,403);
});

test('VOD admin readiness requires deployed cloud protection, not only environment values',async t=>{
  const f=await fixture(t);f.state.unprotected=true;
  const result=await f.request('/admin/vod/config',{token:f.admin});
  assert.equal(result.status,200);assert.equal(result.data.configured,true);
  assert.equal(result.data.protectionReady,false);assert.equal(result.data.uploadConfigured,false);assert.equal(result.data.playbackConfigured,false);
  assert.match(result.data.message,/防盗链/);
});

test('direct VOD upload verifies cloud ownership and readiness; paid lessons never disclose a playable URL before enrollment',async t=>{
  const f=await fixture(t),r=f.request,{admin}=f;
  const signed=await r('/admin/vod/upload-signature',{method:'POST',token:admin,body:{name:'test.mp4'}});assert.equal(signed.status,200);
  const original=Buffer.from(signed.data.signature,'base64').subarray(20).toString(),params=new URLSearchParams(original);
  assert.equal(params.get('vodSubAppId'),'1458910441');assert.equal(params.get('oneTimeValid'),'1');
  const fileId='123456789',uploadId=signed.data.uploadId;
  assert.equal((await r('/admin/vod/media/confirm',{method:'POST',token:admin,body:{fileId,uploadId}})).status,403);
  f.state.sourceContext=params.get('sourceContext');
  const confirmed=await r('/admin/vod/media/confirm',{method:'POST',token:admin,body:{fileId,uploadId}});
  assert.equal(confirmed.status,200);assert.equal(confirmed.data.ready,false);assert.equal(confirmed.data.status,'processing');assert.equal(confirmed.data.videoUrl,`vod:${fileId}`);
  assert.equal((await r('/admin/courses/course-math/lessons',{method:'POST',token:admin,body:{title:'云视频',duration:65,videoUrl:`vod:${fileId}`}})).status,409);
  assert.equal((await r('/admin/courses/course-math/lessons',{method:'POST',token:admin,body:{title:'外来视频',duration:65,videoUrl:'vod:999'}})).status,404);
  f.state.taskFailed=true;assert.equal((await r(`/admin/vod/media/${fileId}`,{token:admin})).data.status,'failed');
  assert.equal((await r(`/admin/vod/media/${fileId}/transcode`,{method:'POST',token:admin,body:{}})).status,200);
  f.state.taskFailed=false;f.state.ready=true;
  const ready=await r(`/admin/vod/media/${fileId}`,{token:admin});assert.equal(ready.data.ready,true);assert.equal(ready.data.duration,65);assert.equal(JSON.stringify(ready.data).includes('https://'),false);
  const lesson=(await r('/admin/courses/course-math/lessons',{method:'POST',token:admin,body:{title:'云视频',duration:65,videoUrl:`vod:${fileId}`}})).data;assert.ok(lesson.id);
  f.db.prepare('UPDATE vod_uploads SET subAppId=? WHERE fileId=?').run(999,fileId);
  assert.equal((await r(`/admin/vod/media/${fileId}`,{token:admin})).status,404);
  f.db.prepare('UPDATE vod_uploads SET subAppId=? WHERE fileId=?').run(1458910441,fileId);
  const student=(await r('/auth/demo',{method:'POST',body:{}})).data;
  const before=f.state.calls.length;
  assert.equal((await r(`/lessons/${lesson.id}/play`)).status,401);
  assert.equal((await r(`/lessons/${lesson.id}/play`,{token:student.token})).status,403);
  assert.equal(f.state.calls.length,before);
  const detail=(await r('/courses/course-math',{token:student.token})).data;
  assert.equal(detail.lessons.find(item=>item.id===lesson.id).videoUrl,'');
  f.db.prepare('INSERT INTO enrollments VALUES(?,?,?)').run(student.user.id,'course-math',new Date().toISOString());
  const playback=await r(`/lessons/${lesson.id}/play`,{token:student.token});assert.equal(playback.status,200);assert.equal(playback.data.playbackProvider,'tencent-vod');assert.equal(playback.data.requiresAuthorizedDownload,false);assert.equal(playback.data.format,'hls');assert.match(playback.data.videoUrl,/^https:\/\/video.example.cn\/course\/hls\/video.m3u8\?t=/);assert.match(playback.headers.get('cache-control'),/no-store/);
  const stream=await r(`/lessons/${lesson.id}/stream?lessonId=${lesson.id}`,{token:student.token});assert.equal(stream.status,404);
  f.db.prepare('DELETE FROM enrollments WHERE userId=?').run(student.user.id);
  assert.equal((await r(`/lessons/${lesson.id}/play`,{token:student.token})).status,403);
});
