const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const flush=()=>new Promise(setImmediate);
const validSession={token:'real-session-token',user:{id:'student-id',role:'student',wechatLinked:true}};

async function harness(options={}){
  const calls=[],configCalls=[],wxLogins=[],sessions=[],navigation=[],toasts=[],errors=[];
  const timers=new Map(),intervals=new Map();let nextTimer=0,definition;
  const app={globalData:{token:''},setSession(token,user){sessions.push({token,user});this.globalData.token=token;this.globalData.user=user;}};
  const request=(path,settings)=>new Promise((resolve,reject)=>calls.push({path,settings,resolve,reject}));
  const config=()=>new Promise((resolve,reject)=>configCalls.push({resolve,reject}));
  vm.runInNewContext(fs.readFileSync(__dirname+'/../../miniprogram/pages/login/index.js','utf8'),{
    Page:value=>{definition=value;},require:()=>({request,config,failToast:error=>errors.push(error.message)}),getApp:()=>app,
    getCurrentPages:()=>Array(options.pageCount||1).fill({}),
    setTimeout:(callback,delay)=>{const id=++nextTimer;timers.set(id,{callback,delay});return id;},clearTimeout:id=>timers.delete(id),
    setInterval:(callback,delay)=>{const id=++nextTimer;intervals.set(id,{callback,delay});return id;},clearInterval:id=>intervals.delete(id),
    wx:{login:settings=>{if(options.sdkThrows)throw new Error('SDK unavailable');wxLogins.push(settings);},showToast:value=>toasts.push(value),
      switchTab:value=>navigation.push({type:'switchTab',url:value.url}),redirectTo:value=>navigation.push({type:'redirectTo',url:value.url}),navigateBack:()=>navigation.push({type:'navigateBack'})}
  });
  const page=Object.assign({},definition,{data:structuredClone(definition.data),updates:0,setData(value){this.updates++;Object.assign(this.data,value);}});
  const configPromise=page.onLoad({returnTo:options.rawReturnTo===undefined?encodeURIComponent(options.target||''):options.rawReturnTo});
  if(!options.deferConfig){configCalls[0].resolve({demoMode:false,wechatConfigured:true});await configPromise;}
  if(options.agreed!==false)page.data.agreed=true;
  const find=path=>calls.filter(call=>call.path===path);
  const fireTimeout=()=>{assert.equal(timers.size,1);const [id,timer]=timers.entries().next().value;timers.delete(id);timer.callback();};
  return {page,app,calls,configCalls,configPromise,wxLogins,sessions,navigation,toasts,errors,timers,intervals,find,fireTimeout};
}

async function login(h,...responses){
  const result=responses.length?responses[0]:validSession;
  const logging=h.page.wechatLogin();h.wxLogins[h.wxLogins.length-1].success({code:'temporary-wechat-code'});await flush();
  const requests=h.find('/auth/wechat');requests[requests.length-1].resolve(result);await logging;
}

test('WeChat remains the default and requires consent before requesting a credential',async()=>{
  const h=await harness({agreed:false});assert.equal(h.page.data.mode,'wechat');h.page.wechatLogin();
  assert.equal(h.wxLogins.length,0);assert.equal(h.calls.length,0);assert.equal(h.errors.length,1);assert.equal(h.page.data.busy,false);
});

test('duplicate taps and duplicate SDK callbacks exchange one credential and save one session',async()=>{
  const h=await harness();const logging=h.page.wechatLogin();h.page.wechatLogin();h.page.phoneLogin();
  assert.equal(h.wxLogins.length,1);assert.equal(h.wxLogins[0].timeout,10000);
  h.wxLogins[0].success({code:'one-use-code'});h.wxLogins[0].success({code:'duplicate-code'});h.wxLogins[0].fail({errMsg:'late failure'});await flush();
  assert.equal(h.find('/auth/wechat').length,1);assert.equal(h.find('/auth/wechat')[0].settings.method,'POST');assert.equal(h.find('/auth/wechat')[0].settings.data.code,'one-use-code');assert.equal(h.timers.size,0);
  h.find('/auth/wechat')[0].resolve(validSession);await logging;h.page.wechatLogin();
  assert.equal(h.sessions.length,1);assert.equal(h.navigation.length,1);assert.equal(h.wxLogins.length,1);assert.equal(h.page.data.busy,false);
});

for(const result of [undefined,{}, {code:''},{code:123},{code:' '},{code:'bad code'}]){
  test('a missing or invalid WeChat credential never reaches the backend: '+JSON.stringify(result),async()=>{
    const h=await harness();const logging=h.page.wechatLogin();h.wxLogins[0].success(result);await logging;
    assert.equal(h.calls.length,0);assert.equal(h.sessions.length,0);assert.equal(h.page.data.busy,false);assert.match(h.page.data.error,/未获取微信登录凭证/);assert.equal(h.timers.size,0);
  });
}

for(const failure of [{errMsg:'login:fail'}, {errMsg:'login:fail timeout'}]){
  test('an SDK failure is actionable and releases the busy state: '+failure.errMsg,async()=>{
    const h=await harness();const logging=h.page.wechatLogin();h.wxLogins[0].fail(failure);await logging;
    assert.equal(h.calls.length,0);assert.equal(h.sessions.length,0);assert.equal(h.page.data.busy,false);assert.match(h.page.data.error,/微信登录未完成|微信登录超时/);assert.equal(h.timers.size,0);
  });
}

test('a synchronous SDK exception releases the busy state',async()=>{
  const h=await harness({sdkThrows:true});await h.page.wechatLogin();
  assert.equal(h.page.data.busy,false);assert.match(h.page.data.error,/微信登录未完成/);assert.equal(h.calls.length,0);assert.equal(h.timers.size,0);
});

test('a silent SDK times out; a retry ignores callbacks from the timed-out attempt',async()=>{
  const h=await harness();const old=h.page.wechatLogin();h.fireTimeout();await old;
  assert.equal(h.page.data.busy,false);assert.match(h.page.data.error,/微信登录超时/);
  const current=h.page.wechatLogin();const updates=h.page.updates;
  h.wxLogins[0].success({code:'expired-code'});h.wxLogins[0].fail({errMsg:'old failure'});await flush();
  assert.equal(h.page.updates,updates);assert.equal(h.calls.length,0);assert.equal(h.page.data.busy,true);
  h.wxLogins[1].success({code:'fresh-code'});await flush();h.find('/auth/wechat')[0].resolve(validSession);await current;
  assert.equal(h.sessions.length,1);assert.equal(h.find('/auth/wechat')[0].settings.data.code,'fresh-code');
});

test('unloading while wx.login is pending cancels the timeout and ignores later SDK callbacks',async()=>{
  const h=await harness();const logging=h.page.wechatLogin();h.page.onUnload();const updates=h.page.updates;
  h.wxLogins[0].success({code:'late-code'});h.wxLogins[0].fail({errMsg:'late failure'});await logging;
  assert.equal(h.page.updates,updates);assert.equal(h.calls.length,0);assert.equal(h.sessions.length,0);assert.equal(h.navigation.length,0);assert.equal(h.timers.size,0);
});

for(const outcome of ['resolve','reject']){
  test('unloading before the backend '+outcome+' prevents session writes, navigation and UI updates',async()=>{
    const h=await harness();const logging=h.page.wechatLogin();h.wxLogins[0].success({code:'code'});await flush();
    h.page.onUnload();const updates=h.page.updates;h.find('/auth/wechat')[0][outcome](outcome==='resolve'?validSession:new Error('late network error'));await logging;
    assert.equal(h.page.updates,updates);assert.equal(h.sessions.length,0);assert.equal(h.navigation.length,0);assert.equal(h.toasts.length,0);
  });
}

test('switching to phone login invalidates a pending WeChat backend response',async()=>{
  const h=await harness();const wechat=h.page.wechatLogin();h.wxLogins[0].success({code:'old-code'});await flush();
  h.page.changeMode({currentTarget:{dataset:{mode:'phone'}}});h.page.data.phone='13800138000';h.page.data.code='123456';const phone=h.page.phoneLogin();
  h.find('/auth/wechat')[0].resolve(validSession);await wechat;assert.equal(h.sessions.length,0);assert.equal(h.page.data.busy,true);
  h.find('/auth/phone')[0].resolve({token:'phone-session',user:{id:'phone-user'}});await phone;
  assert.equal(h.sessions.length,1);assert.equal(h.sessions[0].token,'phone-session');assert.equal(h.navigation.length,1);
});

test('a backend rejection preserves its message and permits retry',async()=>{
  const h=await harness();const logging=h.page.wechatLogin();h.wxLogins[0].success({code:'code'});await flush();
  h.find('/auth/wechat')[0].reject(new Error('微信登录尚未配置 AppID 和 AppSecret'));await logging;
  assert.match(h.page.data.error,/AppID 和 AppSecret/);assert.equal(h.page.data.busy,false);assert.equal(h.sessions.length,0);
});

const malformed=[undefined,null,{}, {token:'token'}, {token:123,user:{id:'u'}},{token:'',user:{id:'u'}},{token:'bad token',user:{id:'u'}},{token:'token',user:null},{token:'token',user:[]},{token:'token',user:{}},{token:'token',user:{id:123}},{token:'token',user:{id:' '}}];
for(const result of malformed){
  test('malformed backend response never saves a session: '+JSON.stringify(result),async()=>{
    const h=await harness();await login(h,result);
    assert.equal(h.sessions.length,0);assert.equal(h.navigation.length,0);assert.equal(h.page.data.busy,false);assert.match(h.page.data.error,/返回的信息不完整/);
  });
}

for(const target of ['/pages/discover/index','/pages/my-courses/index','/pages/profile/index']){
  test('successful login preserves tab navigation to '+target,async()=>{
    const h=await harness({target});await login(h);assert.deepEqual(h.navigation,[{type:'switchTab',url:target}]);assert.equal(h.sessions.length,1);
  });
}
for(const target of ['/pages/course/index?id=one','/pages/checkout/index?courseId=one','/pages/learn/index?courseId=one&lessonId=two','/pages/orders/index','/pages/materials/index?courseId=one']){
  test('successful login preserves the return route '+target,async()=>{
    const h=await harness({target});await login(h);assert.deepEqual(h.navigation,[{type:'redirectTo',url:target}]);
  });
}
test('unknown return routes navigate back when a previous page exists',async()=>{
  const h=await harness({target:'https://example.com',pageCount:2});await login(h);assert.deepEqual(h.navigation,[{type:'navigateBack'}]);
});
test('invalid return encoding safely falls back to the course tab',async()=>{
  const h=await harness({rawReturnTo:'%broken'});await login(h);assert.deepEqual(h.navigation,[{type:'switchTab',url:'/pages/my-courses/index'}]);
});

test('late configuration responses cannot update an unloaded page',async()=>{
  const h=await harness({deferConfig:true});h.page.onUnload();const updates=h.page.updates;h.configCalls[0].resolve({demoMode:true});await h.configPromise;
  assert.equal(h.page.updates,updates);assert.equal(h.page.data.config,null);
});
test('a stale configuration failure cannot overwrite a newer successful configuration',async()=>{
  const h=await harness({deferConfig:true});const latest=h.page.loadConfig();h.configCalls[1].resolve({demoMode:false,wechatConfigured:true});await latest;
  h.configCalls[0].reject(new Error('old config failed'));await h.configPromise;
  assert.equal(h.page.data.config.wechatConfigured,true);assert.equal(h.page.data.error,'');
});

test('an SMS response after unloading creates no countdown or toast',async()=>{
  const h=await harness();h.page.data.phone='13800138000';const sending=h.page.sendCode();h.page.onUnload();const updates=h.page.updates;
  h.find('/auth/sms/send')[0].resolve({retryAfter:60});await sending;
  assert.equal(h.page.updates,updates);assert.equal(h.intervals.size,0);assert.equal(h.toasts.length,0);
});
for(const method of ['phoneLogin','demoLogin']){
  test(method+' also ignores successful responses after unloading',async()=>{
    const h=await harness();h.page.data.phone='13800138000';h.page.data.code='123456';h.page.data.config.demoMode=true;
    const logging=h.page[method]();h.page.onUnload();const updates=h.page.updates;h.calls[0].resolve(validSession);await logging;
    assert.equal(h.sessions.length,0);assert.equal(h.navigation.length,0);assert.equal(h.page.updates,updates);
  });
}
