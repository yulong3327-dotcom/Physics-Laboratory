const test=require('node:test');
const assert=require('node:assert/strict');
const modulePromise=import('../../web/src/student/lesson-stream.js');
const flush=()=>new Promise(setImmediate);
const start=Date.parse('2026-10-22T12:00:00Z');
const vod=(overrides={})=>({videoUrl:'https://video.example.cn/course/index.m3u8?sign=first',contentType:'application/vnd.apple.mpegurl',playbackProvider:'tencent-vod',playbackAuth:'signed-url',expiresAt:new Date(start+300000).toISOString(),resumeSeconds:7,...overrides});
class FakeVideo{
  constructor(nativeHls=true){this.currentTime=0;this.duration=1800;this.paused=true;this.ended=false;this.nativeHls=nativeHls;this.events=new Map();this.playCalls=0;this.sources=[];}
  set src(value){this.sources.push(value);this.source=value;}get src(){return this.source;}
  canPlayType(){return this.nativeHls?'maybe':'';}
  addEventListener(name,callback){this.events.set(name,callback);}
  removeEventListener(name,callback){if(this.events.get(name)===callback)this.events.delete(name);}
  pause(){this.paused=true;}play(){this.paused=false;this.playCalls++;return Promise.resolve();}
  load(){}removeAttribute(name){if(name==='src')this.source='';}
  metadata(){this.events.get('loadedmetadata')?.();}
}
async function harness(options={}){
  const {createLessonStream}=await modulePromise;
  const video=new FakeVideo(options.nativeHls??true),errors=[],requests=[],timers=new Map();let timerId=0,active=true,time=start;
  const controller=createLessonStream({video,playback:vod(),authorize:()=>new Promise((resolve,reject)=>requests.push({resolve,reject})),isActive:()=>active,onError:error=>errors.push(error),now:()=>time,timers:{setTimeout(callback,delay){const id=++timerId;timers.set(id,{callback,delay});return id;},clearTimeout(id){timers.delete(id);}},...options});
  return {video,errors,requests,timers,controller,setActive(value){active=value;},setTime(value){time=value;}};
}

test('native HLS starts directly with a signed URL and schedules renewal before expiry',async()=>{
  const h=await harness();await h.controller.ready;
  assert.equal(h.video.src,vod().videoUrl);assert.equal(h.video.crossOrigin,'anonymous');assert.equal(h.video.playCalls,0);
  h.video.metadata();assert.equal(h.video.currentTime,7);assert.equal(h.video.playCalls,1);
  assert.equal([...h.timers.values()][0].delay,240000);h.controller.destroy();assert.equal(h.timers.size,0);assert.equal(h.video.src,'');
});

test('desktop HLS uses hls.js with no login header or cross-site cookies',async()=>{
  const instances=[];
  class Hls{static Events={ERROR:'error'};static isSupported(){return true;}constructor(config){this.config=config;instances.push(this);}on(name,callback){this.error=callback;}attachMedia(video){this.video=video;}loadSource(url){this.url=url;}destroy(){this.destroyed=true;}}
  const h=await harness({nativeHls:false,loadHls:async()=>({default:Hls})});await h.controller.ready;
  assert.equal(instances.length,1);assert.equal(instances[0].url,vod().videoUrl);assert.equal(h.video.src,undefined);
  const xhr={withCredentials:true};instances[0].config.xhrSetup(xhr);assert.equal(xhr.withCredentials,false);assert.equal(Object.hasOwn(instances[0].config,'headers'),false);
  instances[0].error('error',{fatal:true});assert.match(h.errors[0].message,/加载失败/);
  h.controller.destroy();assert.equal(instances[0].destroyed,true);
});

for(const paused of [true,false])test('renewal preserves playback position and '+(paused?'a pause':'playing intent'),async()=>{
  const h=await harness();await h.controller.ready;h.video.metadata();h.video.currentTime=123;h.video.paused=paused;
  const refresh=h.controller.refresh();await flush();h.requests[0].resolve(vod({videoUrl:'https://video.example.cn/course/index.m3u8?sign=fresh',progress:1}));await refresh;
  const playCalls=h.video.playCalls;h.video.metadata();assert.equal(h.video.currentTime,123);assert.equal(h.video.playCalls,playCalls+(paused?0:1));
  assert.match(h.video.src,/sign=fresh/);h.controller.destroy();
});

test('a pause made while authorization is pending survives source replacement',async()=>{
  const h=await harness();await h.controller.ready;h.video.metadata();const refresh=h.controller.refresh();await flush();h.video.pause();
  h.requests[0].resolve(vod({videoUrl:'https://video.example.cn/fresh.m3u8'}));await refresh;const playCalls=h.video.playCalls;h.video.metadata();assert.equal(h.video.playCalls,playCalls);h.controller.destroy();
});

for(const action of ['logout','destroy'])test('late authorization responses cannot restore playback after '+action,async()=>{
  const h=await harness();await h.controller.ready;const refresh=h.controller.refresh();await flush();
  if(action==='destroy')h.controller.destroy();else h.setActive(false);
  h.requests[0].resolve(vod({videoUrl:'https://video.example.cn/stale-user.m3u8'}));await refresh;
  assert.equal(h.video.sources.some(value=>value.includes('stale-user')),false);assert.equal(h.errors.length,0);h.controller.destroy();
});

test('destroying while hls.js loads does not attach a stale video',async()=>{
  let resolveImport;const instances=[];
  class Hls{static isSupported(){return true;}constructor(){instances.push(this);}}
  const h=await harness({nativeHls:false,loadHls:()=>new Promise(resolve=>{resolveImport=resolve;})});await flush();h.controller.destroy();resolveImport({default:Hls});await h.controller.ready;
  assert.equal(instances.length,0);assert.equal(h.timers.size,0);assert.equal(h.video.events.size,0);
});

test('renewal authorization failures stop the old stream and surface the failure',async()=>{
  const h=await harness();await h.controller.ready;const oldMetadata=h.video.events.get('loadedmetadata');const refresh=h.controller.refresh();await flush();const error=new Error('课程权限已失效');error.status=403;h.requests[0].reject(error);await refresh;
  oldMetadata();assert.equal(h.video.playCalls,0);assert.equal(h.video.events.size,0);
  assert.equal(h.video.src,'');assert.equal(h.video.paused,true);assert.equal(h.timers.size,0);assert.equal(h.errors[0],error);h.controller.destroy();
});

test('a temporary renewal failure retries only while the previous signature is valid',async()=>{
  const h=await harness();await h.controller.ready;const refresh=h.controller.refresh();await flush();h.requests[0].reject(new Error('offline'));await refresh;
  assert.equal(h.errors.length,0);assert.equal([...h.timers.values()][0].delay,10000);
  h.setTime(start+301000);const expired=h.controller.refresh();await flush();h.requests[1].reject(new Error('offline'));await expired;
  assert.equal(h.video.src,'');assert.equal(h.errors.length,1);assert.equal(h.timers.size,0);h.controller.destroy();
});

test('expired initial credentials are reauthorized before any CDN request',async()=>{
  const h=await harness({playback:vod({expiresAt:new Date(start-1000).toISOString()})});await flush();assert.equal(h.video.sources.length,0);
  h.requests[0].resolve(vod({videoUrl:'https://video.example.cn/fresh-initial.m3u8'}));await h.controller.ready;
  assert.equal(h.video.src,'https://video.example.cn/fresh-initial.m3u8');h.controller.destroy();
});

test('numeric backend expiries and a short session lifetime schedule a bounded renewal',async()=>{
  const h=await harness({playback:vod({expiresAt:start+30000})});await h.controller.ready;
  assert.equal(h.errors.length,0);assert.equal([...h.timers.values()][0].delay,15000);h.controller.destroy();
});

test('manual cloud retry reauthorizes and preserves unsaved local progress instead of server progress',async()=>{
  const h=await harness({playback:vod({resumeSeconds:136}),refreshOnStart:true});await flush();assert.equal(h.video.sources.length,0);
  h.requests[0].resolve(vod({resumeSeconds:0,progress:4,videoUrl:'https://video.example.cn/manual-retry.m3u8'}));await h.controller.ready;h.video.metadata();
  assert.equal(h.video.currentTime,136);assert.equal(h.video.src,'https://video.example.cn/manual-retry.m3u8');h.controller.destroy();
});

test('manual retry reauthorizes legacy protected media instead of reusing its expired URL',async()=>{
  const h=await harness({playback:{videoUrl:'/api/media/private?expired=1',resumeSeconds:44},refreshOnStart:true});await flush();assert.equal(h.video.sources.length,0);
  h.requests[0].resolve({url:'/api/media/private?fresh=1',progress:2});await h.controller.ready;h.video.metadata();
  assert.equal(h.video.currentTime,44);assert.equal(h.video.src,'/api/media/private?fresh=1');h.controller.destroy();
});

test('legacy MP4 remains a normal media source without signed credential timers',async()=>{
  const h=await harness({playback:{videoUrl:'/api/media/protected?token=legacy',contentType:'video/mp4'}});await h.controller.ready;
  assert.equal(h.video.src,'/api/media/protected?token=legacy');assert.equal(h.timers.size,0);assert.equal(h.requests.length,0);h.controller.destroy();
});
