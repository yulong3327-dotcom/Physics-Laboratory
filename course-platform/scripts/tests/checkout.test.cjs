const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const flush=()=>new Promise(setImmediate);

async function harness(){
  const calls=[],payments=[],timers=[],modals=[];
  let definition;
  const app={globalData:{token:'test-token'},setUser(){}};
  const request=(path,options)=>new Promise((resolve,reject)=>calls.push({path,options,resolve,reject}));
  vm.runInNewContext(fs.readFileSync(__dirname+'/../../miniprogram/pages/checkout/index.js','utf8'),{
    Page:value=>{definition=value;},
    require:path=>path.endsWith('/api')?{request,config:()=>Promise.resolve({demoMode:false}),requireLogin:()=>true,failToast:()=>assert.fail('Unexpected error toast')}:{course:value=>value},
    getApp:()=>app,setTimeout:callback=>timers.push(callback),
    wx:{requestPayment:options=>payments.push(options),showModal:options=>modals.push(options)}
  });
  const page=Object.assign({},definition,{data:structuredClone(definition.data),updates:0,setData(value){this.updates++;Object.assign(this.data,value);}});
  const find=path=>calls.filter(call=>call.path===path);
  page.onLoad({courseId:'course'});
  find('/courses/course')[0].resolve({id:'course',price:100,enrolled:false});find('/me')[0].resolve({wechatLinked:true});await flush();
  return {page,calls,payments,timers,modals,find};
}

test('leaving checkout before order creation completes never starts payment',async()=>{
  const h=await harness();const paying=h.page.pay();
  h.page.onUnload();const updates=h.page.updates;
  h.find('/orders')[0].resolve({id:'order-1',status:'pending'});await paying;
  assert.equal(h.find('/orders/order-1/pay').length,0);assert.equal(h.payments.length,0);assert.equal(h.page.updates,updates);
});

test('leaving checkout before payment parameters arrive never opens WeChat payment',async()=>{
  const h=await harness();const paying=h.page.pay();
  h.find('/orders')[0].resolve({id:'order-1',status:'pending'});await flush();
  h.page.onUnload();const updates=h.page.updates;
  h.find('/orders/order-1/pay')[0].resolve({paymentParams:{timeStamp:'1'}});await paying;
  assert.equal(h.payments.length,0);assert.equal(h.page.updates,updates);
});

test('payment polling follows the captured order and waits for server confirmation',async()=>{
  const h=await harness();const paying=h.page.pay();
  h.find('/orders')[0].resolve({id:'order-1',status:'pending'});await flush();
  h.find('/orders/order-1/pay')[0].resolve({paymentParams:{timeStamp:'1'}});await flush();
  h.payments[0].success({});await flush();
  assert.equal(h.page.data.paid,false);
  h.find('/orders/order-1')[0].resolve({status:'pending'});await flush();
  h.page._orderId='order-2';h.timers.shift()();await flush();
  assert.equal(h.find('/orders/order-2').length,0);assert.equal(h.find('/orders/order-1').length,2);
  h.find('/orders/order-1')[1].resolve({status:'paid'});await paying;
  assert.equal(h.page.data.paid,true);assert.equal(h.page.data.pending,false);assert.equal(h.page.data.busy,false);
});

test('unloading during the poll delay stops further order requests',async()=>{
  const h=await harness();h.page._orderId='order-1';
  const confirming=h.page.confirmPayment(0,'order-1',h.page._paymentId);
  h.find('/orders/order-1')[0].resolve({status:'pending'});await flush();
  h.page.onUnload();const updates=h.page.updates;h.timers.shift()();await confirming;
  assert.equal(h.find('/orders/order-1').length,1);assert.equal(h.page.updates,updates);
});

const nativeOrder={id:'web-order',status:'pending',paymentChannel:'native'};

test('declining the Native order switch keeps the old order payable without requesting payment',async()=>{
  const h=await harness();const paying=h.page.pay();
  h.find('/orders')[0].resolve(nativeOrder);await flush();
  assert.equal(h.modals.length,1);assert.equal(h.find('/orders/web-order/pay').length,0);
  h.modals[0].success({confirm:false,cancel:true});await paying;
  assert.equal(h.find('/orders/web-order/cancel').length,0);assert.equal(h.find('/orders').length,1);
  assert.equal(h.page._orderId,'web-order');assert.equal(h.page.data.busy,false);assert.equal(h.page.data.paid,false);assert.equal(h.page.data.pending,false);
});

test('an existing Native order is closed before creating and paying a replacement order',async()=>{
  const h=await harness();h.page._orderId='web-order';const paying=h.page.pay();
  h.find('/orders/web-order')[0].resolve(nativeOrder);await flush();
  h.modals[0].success({confirm:true});await flush();
  assert.equal(h.find('/orders').length,0);assert.equal(h.find('/orders/web-order/pay').length,0);
  h.find('/orders/web-order/cancel')[0].resolve({cancelled:true,order:{...nativeOrder,status:'cancelled'}});await flush();
  assert.equal(h.find('/orders').length,1);assert.equal(h.find('/orders')[0].options.method,'POST');assert.equal(h.find('/orders')[0].options.data.courseId,'course');
  h.find('/orders')[0].resolve({id:'new-order',status:'pending',paymentChannel:null});await flush();
  assert.equal(h.find('/orders/web-order/pay').length,0);assert.equal(h.find('/orders/new-order/pay').length,1);
  h.find('/orders/new-order/pay')[0].resolve({paid:true});await paying;
  assert.equal(h.page._orderId,'new-order');assert.equal(h.page.data.paid,true);
});

for(const result of [{paid:true,order:{...nativeOrder,status:'paid'}},{cancelled:true,order:{...nativeOrder,status:'paid'}}]){
  test('a Native order paid during cancellation opens the course without a second order ('+(result.paid?'paid flag':'paid order')+')',async()=>{
    const h=await harness();const paying=h.page.pay();
    h.find('/orders')[0].resolve(nativeOrder);await flush();h.modals[0].success({confirm:true});await flush();
    h.find('/orders/web-order/cancel')[0].resolve(result);await paying;
    assert.equal(h.find('/orders').length,1);assert.equal(h.page.data.paid,true);assert.equal(h.payments.length,0);
    assert.equal(h.calls.filter(call=>call.path.endsWith('/pay')).length,0);
  });
}

test('a failed Native order close keeps the original order and never creates or pays another',async()=>{
  const h=await harness();const paying=h.page.pay();
  h.find('/orders')[0].resolve(nativeOrder);await flush();h.modals[0].success({confirm:true});await flush();
  h.find('/orders/web-order/cancel')[0].reject(new Error('微信关单失败'));await paying;
  assert.equal(h.find('/orders').length,1);assert.equal(h.page._orderId,'web-order');assert.equal(h.page.data.error,'微信关单失败');assert.equal(h.page.data.busy,false);
  assert.equal(h.calls.filter(call=>call.path.endsWith('/pay')).length,0);
});

test('an unconfirmed close response cannot create a replacement order',async()=>{
  const h=await harness();const paying=h.page.pay();
  h.find('/orders')[0].resolve(nativeOrder);await flush();h.modals[0].success({confirm:true});await flush();
  h.find('/orders/web-order/cancel')[0].resolve({cancelled:true,order:nativeOrder});await paying;
  assert.equal(h.find('/orders').length,1);assert.equal(h.page._orderId,'web-order');assert.match(h.page.data.error,/尚未确认关闭/);
});

for(const invalidate of ['unload','operation']){
  for(const stage of ['modal','cancel','replacement']){
    test('a stale '+invalidate+' during '+stage+' never starts another payment',async()=>{
      const h=await harness();const paying=h.page.pay();
      h.find('/orders')[0].resolve(nativeOrder);await flush();
      if(stage!=='modal'){
        h.modals[0].success({confirm:true});await flush();
        if(stage==='replacement'){
          h.find('/orders/web-order/cancel')[0].resolve({cancelled:true,order:{...nativeOrder,status:'cancelled'}});await flush();
        }
      }
      if(invalidate==='unload')h.page.onUnload();else h.page._paymentId++;
      const updates=h.page.updates;
      if(stage==='modal')h.modals[0].success({confirm:true});
      if(stage==='cancel')h.find('/orders/web-order/cancel')[0].resolve({cancelled:true,order:{...nativeOrder,status:'cancelled'}});
      if(stage==='replacement')h.find('/orders')[1].resolve({id:'new-order',status:'pending',paymentChannel:null});
      await paying;
      assert.equal(h.calls.filter(call=>call.path.endsWith('/pay')).length,0);assert.equal(h.payments.length,0);assert.equal(h.page.updates,updates);
      if(stage==='modal')assert.equal(h.find('/orders/web-order/cancel').length,0);
      if(stage!=='replacement')assert.equal(h.find('/orders').length,1);
    });
  }
}
