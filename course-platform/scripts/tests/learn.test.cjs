const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const flush=()=>new Promise(setImmediate);

function harness(){
  const calls=[];
  const app={globalData:{token:'test-token'}};
  let definition;
  const request=(path,options)=>new Promise((resolve,reject)=>calls.push({path,options,resolve,reject,token:app.globalData.token}));
  vm.runInNewContext(fs.readFileSync(__dirname+'/../../miniprogram/pages/learn/index.js','utf8'),{
    Page:value=>{definition=value;},
    require:path=>path.endsWith('/api')?{request,absoluteUrl:value=>value}:{course:value=>value,lesson:value=>value},
    getApp:()=>app,
    wx:{createVideoContext:()=>({pause(){}}),setNavigationBarTitle(){}}
  });
  const page=Object.assign({},definition,{data:structuredClone(definition.data),updates:0,setData(value){this.updates++;Object.assign(this.data,value);}});
  const find=path=>calls.filter(call=>call.path===path);
  const event=(session,seconds)=>({currentTarget:{dataset:{session}},detail:{currentTime:seconds}});
  const progress=()=>calls.filter(call=>call.path.endsWith('/progress'));
  async function boot(course={}){
    page.onLoad({courseId:'course',lessonId:'a'});
    find('/courses/course')[0].resolve({enrolled:true,canWatch:true,lessons:['a','b','c'].map(id=>({id})),progress:{},...course});
    await flush();
    find('/lessons/a/play')[0].resolve({id:'a',url:'/a.mp4',title:'A',progress:0});
    await flush();
  }
  return {page,app,calls,find,event,progress,boot};
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
