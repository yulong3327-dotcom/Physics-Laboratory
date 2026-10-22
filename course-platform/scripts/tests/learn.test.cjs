const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const flush=()=>new Promise(setImmediate);

function harness(){
  const calls=[],downloads=[],removed=[],timers=new Map(),pauses=[];let timerId=0;
  const app={globalData:{token:'test-token'}};
  let definition;
  const request=(path,options)=>new Promise((resolve,reject)=>calls.push({path,options,resolve,reject,token:app.globalData.token}));
  vm.runInNewContext(fs.readFileSync(__dirname+'/../../miniprogram/pages/learn/index.js','utf8'),{
    Page:value=>{definition=value;},
    require:path=>path.endsWith('/api')?{request,absoluteUrl:value=>value,removeTempVideo:path=>removed.push(path),downloadVideo:(path,options)=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});const download={path,options,promise,resolve,reject,aborted:false,abort(){this.aborted=true;const error=new Error('cancelled');error.cancelled=true;reject(error);}};downloads.push(download);return download;}}:{course:value=>value,lesson:value=>value},
    getApp:()=>app,
    setTimeout:(callback,delay)=>{const id=++timerId;timers.set(id,{callback,delay});return id;},clearTimeout:id=>timers.delete(id),
    wx:{createVideoContext:id=>({pause(){pauses.push(id);}}),setNavigationBarTitle(){}}
  });
  const page=Object.assign({},definition,{data:structuredClone(definition.data),updates:0,setData(value){this.updates++;Object.assign(this.data,value);}});
  const find=path=>calls.filter(call=>call.path===path);
  const event=(session,seconds)=>({currentTarget:{dataset:{session}},detail:{currentTime:seconds}});
  const progress=()=>calls.filter(call=>call.path.endsWith('/progress'));
  async function boot(course={},play={}){
    page.onLoad({courseId:'course',lessonId:'a'});
    find('/courses/course')[0].resolve({enrolled:true,canWatch:true,lessons:['a','b','c'].map(id=>({id})),progress:{},...course});
    await flush();
    find('/lessons/a/play')[0].resolve({id:'a',url:'/a.mp4',title:'A',progress:0,...play});
    await flush();
  }
  return {page,app,calls,find,event,progress,boot,downloads,removed,timers,pauses};
}

test('old video events cannot change or complete a newly selected lesson',async()=>{
  const h=harness();await h.boot();
  const oldSession=h.page._playback.id;
  h.page.timeUpdate(h.event(oldSession,6));
  const opening=h.page.openLesson('b');
  h.page.timeUpdate(h.event(oldSession,99));h.page.ended(h.event(oldSession));
  h.find('/lessons/b/play')[0].resolve({id:'b',url:'/b.mp4',title:'B',progress:7});
  await opening;await flush();
  h.page.timeUpdate(h.event(oldSession,120));h.page.pause(h.event(oldSession));h.page.ended(h.event(oldSession));h.page.videoFailed(h.event(oldSession));
  assert.equal(h.page._playback.progress.position,7);
  assert.equal(h.page._playback.progress.completed,false);
  assert.equal(h.page.data.videoError,false);
  assert.deepEqual(h.progress().map(call=>[call.path,call.options.data.seconds,call.options.data.completed]),[['/lessons/a/progress',6,false]]);
  h.progress()[0].resolve({});await h.page._saveQueue;
});

test('a late lesson response cannot replace the latest selection',async()=>{
  const h=harness();await h.boot();
  const first=h.page.openLesson('b');const latest=h.page.openLesson('c');
  h.find('/lessons/c/play')[0].resolve({id:'c',url:'/c.mp4',title:'C',progress:8});await latest;
  h.find('/lessons/b/play')[0].resolve({id:'b',url:'/b.mp4',title:'B',progress:70});await first;
  assert.equal(h.page.data.lesson.id,'c');assert.equal(h.page._playback.progress.position,8);
  await flush();h.progress()[0].resolve({});await h.page._saveQueue;
});

test('progress writes stay ordered and failed writes can be retried',async()=>{
  const h=harness();await h.boot();const session=h.page._playback.id;
  h.page.timeUpdate(h.event(session,10));await flush();
  h.page.timeUpdate(h.event(session,20));await flush();
  assert.equal(h.progress().length,1);
  h.progress()[0].resolve({});await flush();
  assert.equal(h.progress().length,2);assert.equal(h.progress()[1].options.data.seconds,20);
  h.progress()[1].reject(new Error('offline'));await h.page._saveQueue;
  h.page.timeUpdate(h.event(session,21));await flush();
  assert.equal(h.progress().length,3);assert.equal(h.progress()[2].options.data.seconds,21);
  h.progress()[2].resolve({});await h.page._saveQueue;
  h.page.onHide();h.page.onUnload();await flush();assert.equal(h.progress().length,3);
});

test('retry preserves unsaved local progress and old save callbacks do not update the new player',async()=>{
  const h=harness();await h.boot();const oldSession=h.page._playback.id;
  h.page.timeUpdate(h.event(oldSession,37));await flush();
  const retry=h.page.retryVideo();
  h.find('/lessons/a/play')[1].resolve({id:'a',url:'/a-new.mp4',title:'A',progress:2});await retry;
  assert.equal(h.page.data.players[0].startTime,37);
  h.page.ended(h.event(oldSession));assert.equal(h.page._playback.progress.completed,false);
  const status=h.page.data.savedText;
  h.progress()[0].resolve({});await h.page._saveQueue;
  assert.equal(h.page.data.savedText,status);
});

test('unloading ignores a pending playback response',async()=>{
  const h=harness();await h.boot();const opening=h.page.openLesson('b');
  h.page.onUnload();const updates=h.page.updates;
  h.find('/lessons/b/play')[0].resolve({id:'b',url:'/b.mp4',title:'B',progress:4});await opening;await flush();
  h.progress()[0].resolve({});await h.page._saveQueue;
  assert.equal(h.page.updates,updates);assert.equal(h.page._playback,null);
});

test('the initial onShow does not duplicate course loading',async()=>{
  const h=harness();await h.boot();h.page.onShow();
  assert.equal(h.find('/courses/course').length,1);
});

test('returning after login and purchase refreshes access and uses the authenticated progress',async()=>{
  const h=harness();h.app.globalData.token='';await h.boot({enrolled:false,canWatch:false});
  h.page.timeUpdate(h.event(h.page._playback.id,15));assert.equal(h.progress().length,0);
  h.page.onHide();h.app.globalData.token='logged-in-token';const refresh=h.page.onShow();
  h.find('/courses/course')[1].resolve({enrolled:true,canWatch:true,lessons:['a','b','c'].map(id=>({id})),progress:{a:3}});await flush();
  h.find('/lessons/a/play')[1].resolve({id:'a',url:'/a.mp4',title:'A',progress:3});await refresh;
  assert.equal(h.page.data.isPreview,false);assert.equal(h.page._canSave,true);assert.equal(h.page.data.course.enrolled,true);assert.equal(h.page.data.players[0].startTime,3);
  h.page.timeUpdate(h.event(h.page._playback.id,25));await flush();
  assert.equal(h.progress().length,1);assert.equal(h.progress()[0].options.data.seconds,25);
  h.progress()[0].resolve({});await h.page._saveQueue;
});

for(const newToken of ['account-b','']){
  test('a queued save and old video events are ignored immediately after '+(newToken?'an account switch':'logout'),async()=>{
    const h=harness();await h.boot();const session=h.page._playback.id;
    h.page.timeUpdate(h.event(session,10));
    h.app.globalData.token=newToken;const updates=h.page.updates;
    h.page.timeUpdate(h.event(session,99));h.page.ended(h.event(session));h.page.pause(h.event(session));h.page.videoFailed(h.event(session));
    await h.page._saveQueue;
    assert.equal(h.progress().length,0);assert.equal(h.page.updates,updates);
    assert.equal(h.page._playback.progress.position,10);assert.equal(h.page._playback.progress.completed,false);
  });
}

test('returning as a new account clears cached progress, skips old queued writes, and ignores old completion responses',async()=>{
  const h=harness();await h.boot();const oldSession=h.page._playback.id,oldProgress=h.page._playback.progress;
  h.page.timeUpdate(h.event(oldSession,6));h.page.ended(h.event(oldSession));await flush();
  assert.equal(h.progress().length,1);assert.equal(h.progress()[0].options.header.Authorization,'Bearer test-token');
  h.page.timeUpdate(h.event(oldSession,20));h.page.onHide();const oldQueue=h.page._saveQueue;
  h.app.globalData.token='account-b';const refresh=h.page.onShow();
  assert.equal(h.progress().length,1);
  h.find('/courses/course')[1].resolve({enrolled:true,canWatch:true,lessons:['a','b','c'].map(id=>({id})),progress:{a:3},completedLessonIds:[]});await flush();
  h.find('/lessons/a/play')[1].resolve({id:'a',url:'/a.mp4',title:'A',progress:3});await refresh;
  assert.notEqual(h.page._playback.progress,oldProgress);assert.equal(h.page.data.players[0].startTime,3);assert.equal(h.page._playback.progress.completed,false);
  // The new account's queue is independent of the old in-flight request.
  h.page.timeUpdate(h.event(h.page._playback.id,13));await flush();
  assert.equal(h.progress().length,2);assert.equal(h.progress()[1].token,'account-b');assert.equal(h.progress()[1].options.header.Authorization,'Bearer account-b');
  assert.equal(h.progress()[1].options.data.seconds,13);assert.equal(h.progress()[1].options.data.completed,false);
  h.progress()[1].resolve({});await h.page._saveQueue;
  const updates=h.page.updates;
  h.progress()[0].resolve({});await oldQueue;
  assert.equal(h.progress().length,2);assert.equal(h.page.updates,updates);assert.notEqual(h.page.data.lessons[0].completed,true);
  assert.equal(h.page._playback.progress.savedPosition,13);
});

test('old playback responses are ignored when authentication changes before a refresh starts',async()=>{
  const h=harness();await h.boot();const opening=h.page.openLesson('b');await flush();
  h.app.globalData.token='account-b';const updates=h.page.updates;
  h.find('/lessons/b/play')[0].resolve({id:'b',url:'/private-old-account.mp4',title:'B',progress:42});await opening;
  assert.equal(h.page.updates,updates);assert.equal(h.page._playback,null);
  h.progress()[0].resolve({});await h.page._saveQueue;
  assert.equal(h.page.updates,updates);
});

test('protected video plays only the authenticated temporary file and cleans it on leaving',async()=>{
  const h=harness();await h.boot({}, {requiresAuthorizedDownload:true,playbackAuth:'session',url:'/api/media/private?signed=1'});
  assert.equal(h.page.data.players.length,0);assert.equal(h.page.data.downloading,true);assert.equal(h.downloads.length,1);
  assert.equal(h.downloads[0].options.token,'test-token');
  h.downloads[0].options.onProgress({progress:43});assert.equal(h.page.data.downloadProgress,43);
  h.downloads[0].resolve('wxfile://temporary-course.mp4');await flush();
  assert.equal(h.page.data.players[0].url,'wxfile://temporary-course.mp4');assert.equal(h.page.data.downloading,false);
  h.page.onHide();assert.equal(h.page.data.players.length,0);assert.deepEqual(h.removed,['wxfile://temporary-course.mp4']);
  await flush();h.progress()[0].resolve({});await h.page._saveQueue;
});

test('leaving while a protected video loads aborts the transfer and ignores progress',async()=>{
  const h=harness();await h.boot({}, {requiresAuthorizedDownload:true});const download=h.downloads[0];
  h.page.onUnload();const updates=h.page.updates;download.options.onProgress({progress:90});await flush();
  assert.equal(download.aborted,true);assert.equal(h.page.updates,updates);assert.equal(h.page._playback,undefined);assert.equal(h.page.data.players.length,0);
});

test('a protected video returned after an account change is discarded',async()=>{
  const h=harness();await h.boot({}, {requiresAuthorizedDownload:true});h.app.globalData.token='another-user';const updates=h.page.updates;
  h.downloads[0].resolve('wxfile://private-old-account.mp4');await flush();
  assert.deepEqual(h.removed,['wxfile://private-old-account.mp4']);assert.equal(h.page.data.players.length,0);assert.equal(h.page.updates,updates);
});

test('cancelling a protected video transfer leaves a recoverable loading error',async()=>{
  const h=harness();await h.boot({}, {requiresAuthorizedDownload:true});h.page.cancelLoading();await flush();
  assert.equal(h.downloads[0].aborted,true);assert.equal(h.page.data.loading,false);assert.equal(h.page.data.downloading,false);assert.match(h.page.data.error,/已取消/);assert.equal(h.page.data.players.length,0);
});

const vodPlayback=(overrides={})=>({id:'a',title:'Cloud lesson',url:'https://video.example.cn/course/index.m3u8?t=123&sign=secret',playbackProvider:'tencent-vod',playbackAuth:'signed-url',requiresAuthorizedDownload:false,expiresAt:new Date(Date.now()+300000).toISOString(),...overrides});

test('cloud HLS streams immediately from the signed CDN URL without a whole-file download',async()=>{
  const h=harness();const playback=vodPlayback({requiresAuthorizedDownload:true});await h.boot({},playback);
  assert.equal(h.downloads.length,0);assert.equal(h.page.data.players[0].url,playback.url);assert.equal(h.page.data.downloading,false);
  assert.equal(h.timers.size,1);assert.ok([...h.timers.values()][0].delay>=238000);
  h.page.onUnload();assert.equal(h.timers.size,0);
});

test('numeric backend expiries work and a short remaining login lifetime does not cause a refresh loop',async()=>{
  const h=harness();await h.boot({},vodPlayback({expiresAt:Date.now()+30000}));
  assert.equal(h.page.data.players.length,1);const delay=[...h.timers.values()][0].delay;assert.ok(delay>14000&&delay<=15000);h.page.onUnload();
});

for(const playing of [false,true])test('signed URL renewal preserves position and '+(playing?'active playback':'the paused state'),async()=>{
  const h=harness();await h.boot({},vodPlayback());const previous=h.page._playback;
  h.page.timeUpdate(h.event(previous.id,7));if(playing)h.page.play(h.event(previous.id));
  const refreshing=h.page.refreshPlayback(previous);
  h.page.timeUpdate(h.event(previous.id,9));
  h.find('/lessons/a/play')[1].resolve(vodPlayback({url:'https://video.example.cn/course/index.m3u8?sign=renewed',progress:1}));await refreshing;
  assert.notEqual(h.page._playback.id,previous.id);assert.equal(h.page.data.players[0].startTime,9);assert.equal(h.page.data.players[0].autoplay,playing);
  assert.equal(h.find('/lessons/a/play')[1].options.header.Authorization,'Bearer test-token');assert.equal(h.downloads.length,0);
  h.page.timeUpdate(h.event(previous.id,99));assert.equal(h.page._playback.progress.position,9);
  h.page.onUnload();assert.equal(h.timers.size,0);
});

test('pausing while renewal is in flight prevents autoplay after the renewed URL arrives',async()=>{
  const h=harness();await h.boot({},vodPlayback());const old=h.page._playback;h.page.play(h.event(old.id));
  const renewal=h.page.refreshPlayback(old);h.page.pause(h.event(old.id));
  h.find('/lessons/a/play')[1].resolve(vodPlayback());await renewal;
  assert.equal(h.page.data.players[0].autoplay,false);
});

for(const action of ['unload','switch','logout','other-lesson'])test('an in-flight CDN renewal is ignored after '+action,async()=>{
  const h=harness();await h.boot({},vodPlayback());const renewal=h.page.refreshPlayback(h.page._playback);
  if(action==='unload')h.page.onUnload();else if(action==='switch')h.app.globalData.token='another-user';else if(action==='logout')h.app.globalData.token='';else h.page.openLesson('b');
  const updates=h.page.updates;
  h.find('/lessons/a/play')[1].resolve(vodPlayback({url:'https://video.example.cn/late-old-user.m3u8'}));await renewal;
  assert.equal(h.page.updates,updates);assert.notEqual(h.page.data.players[0]?.url,'https://video.example.cn/late-old-user.m3u8');
});

test('a denied cloud renewal stops and removes the previously authorized video',async()=>{
  const h=harness();await h.boot({},vodPlayback());const renewal=h.page.refreshPlayback(h.page._playback);
  const denied=new Error('课程权限已失效');denied.status=403;h.find('/lessons/a/play')[1].reject(denied);await renewal;
  assert.equal(h.page.data.players.length,0);assert.equal(h.page._playback,null);assert.equal(h.timers.size,0);assert.match(h.page.data.error,/权限/);
});

test('an unsigned or expired cloud URL is rejected before a video component is created',async()=>{
  for(const overrides of [{playbackAuth:'session'},{url:'http://video.example.cn/course.mp4'},{expiresAt:new Date(Date.now()-1000).toISOString()}]){
    const h=harness();await h.boot({},vodPlayback(overrides));assert.equal(h.page.data.players.length,0);assert.equal(h.downloads.length,0);assert.match(h.page.data.error,/凭证无效/);
  }
});
