const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const flush=()=>new Promise(setImmediate);

function pageHarness(name){
  let definition;const calls=[],toasts=[],navigation=[],modals=[];
  const app={globalData:{token:'student-session',user:{id:'student-one'}},setUser(user){this.globalData.user=user;}};
  const request=(path,settings)=>new Promise((resolve,reject)=>calls.push({path,settings,resolve,reject}));
  vm.runInNewContext(fs.readFileSync(__dirname+'/../../miniprogram/pages/'+name+'/index.js','utf8'),{
    Page:value=>definition=value,require:()=>({request,requireLogin:()=>Boolean(app.globalData.token),failToast:e=>toasts.push(e.message)}),getApp:()=>app,
    wx:{showToast:value=>toasts.push(value.title),navigateTo:value=>navigation.push(value.url),showModal:value=>modals.push(value),stopPullDownRefresh(){},setClipboardData(){}}
  });
  const page=Object.assign({},definition,{data:structuredClone(definition.data),setData(value){Object.assign(this.data,value);}});page.onLoad({});
  return {page,app,calls,toasts,navigation,modals};
}

test('address validation stops incomplete and invalid delivery details before saving',()=>{
  const h=pageHarness('addresses');h.page.add();h.page.save();assert.match(h.page.data.formError,/完整填写/);assert.equal(h.calls.length,0);
  h.page.data.form={recipient:'学员',phone:'123',province:'广东省',city:'广州市',district:'天河区',detail:'测试路 1 号',isDefault:true};h.page.save();assert.match(h.page.data.formError,/11 位/);assert.equal(h.calls.length,0);
});

test('address saves one ownership-free request and does not apply a late result to another session',async()=>{
  const h=pageHarness('addresses');h.page.data.form={recipient:' 学员 ',phone:'13800138000',province:'广东省',city:'广州市',district:'天河区',detail:'测试路 1 号',isDefault:true};
  const saving=h.page.save();h.page.save();assert.equal(h.calls.length,1);assert.equal(h.calls[0].path,'/me/addresses');assert.equal(h.calls[0].settings.method,'POST');assert.equal(h.calls[0].settings.data.recipient,'学员');assert.equal('userId' in h.calls[0].settings.data,false);
  h.app.globalData.token='another-session';h.calls[0].resolve({id:'address'});await saving;assert.equal(h.calls.length,1);assert.equal(h.toasts.length,0);
});

test('shipments offer requests only for paid orders including physical handouts and no prior request',async()=>{
  const h=pageHarness('shipments'),loading=h.page.load();
  h.calls.find(c=>c.path==='/me/shipments').resolve([{id:'shipment',orderId:'already',status:'pending',createdAt:''}]);
  h.calls.find(c=>c.path==='/me/addresses').resolve([]);
  h.calls.find(c=>c.path==='/my/orders').resolve([{id:'eligible',status:'paid',shippingEnabled:true},{id:'unpaid',status:'pending',shippingEnabled:true},{id:'digital-only',status:'paid',shippingEnabled:false},{id:'already',status:'paid',shippingEnabled:true}]);
  await loading;assert.deepEqual(Array.from(h.page.data.eligibleOrders,o=>o.id),['eligible']);
});

test('shipment requests require an address, submit only order and address IDs, and ignore late account changes',async()=>{
  const h=pageHarness('shipments');h.page.data.selectedOrder={id:'paid-order'};h.page.save();assert.match(h.page.data.formError,/收货地址/);assert.equal(h.calls.length,0);
  h.page.data.addresses=[{id:'my-address'}];h.page.data.addressIndex=0;
  const saving=h.page.save();h.page.save();assert.equal(h.calls.length,1);assert.equal(h.calls[0].path,'/me/shipments');assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].settings.data)),{orderId:'paid-order',addressId:'my-address'});
  h.app.globalData.token='different-account';h.calls[0].resolve({id:'shipment'});await saving;assert.equal(h.calls.length,1);assert.equal(h.toasts.length,0);
});

test('pending shipment address edits use the shipment update route and preserve existing order identity',async()=>{
  const h=pageHarness('shipments');h.page.data.addresses=[{id:'new-address',isDefault:true}];h.page.beginEdit(null,{id:'shipment',orderId:'paid-order',courseTitle:'化学课'});
  const saving=h.page.save();assert.equal(h.calls[0].path,'/me/shipments/shipment');assert.equal(h.calls[0].settings.method,'PATCH');assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].settings.data)),{addressId:'new-address'});
  h.page.onUnload();h.calls[0].resolve({});await saving;assert.equal(h.toasts.length,0);
});

test('logistics uses the authenticated shipment endpoint and discards responses after closing',async()=>{
  const h=pageHarness('shipments');h.page.data.shipments=[{id:'shipment',status:'shipped',trackingNumber:'SF123'}];
  const pending=h.page.tracking({currentTarget:{dataset:{id:'shipment'}}});assert.equal(h.calls[0].path,'/me/shipments/shipment/tracking');
  h.page.closeTracking();h.calls[0].resolve({configured:true,events:[{time:'now',description:'已签收'}]});await pending;
  assert.equal(h.page.data.trackingId,'');assert.equal(h.page.data.tracking,null);
});

test('receipt confirmation is explicit and impossible before dispatch',async()=>{
  const h=pageHarness('shipments');h.page.data.shipments=[{id:'pending',status:'pending'},{id:'shipped',status:'shipped'}];h.page.receive({currentTarget:{dataset:{id:'pending'}}});assert.equal(h.modals.length,0);
  h.page.receive({currentTarget:{dataset:{id:'shipped'}}});assert.equal(h.calls.length,0);h.modals[0].success({confirm:false});assert.equal(h.calls.length,0);
  h.page.receive({currentTarget:{dataset:{id:'shipped'}}});h.modals[1].success({confirm:true});assert.equal(h.calls[0].path,'/me/shipments/shipped/receive');assert.equal(h.calls[0].settings.method,'POST');
  h.page.onUnload();h.calls[0].resolve({});await flush();assert.equal(h.toasts.length,0);
});

function contactHarness(){
  let definition;const calls=[],events=[];
  const app={globalData:{token:'token',user:{id:'student'}},writes:[],setUser(user){this.writes.push(user);this.globalData.user=user;}};
  vm.runInNewContext(fs.readFileSync(__dirname+'/../../miniprogram/components/contact-dialog/index.js','utf8'),{Component:value=>definition=value,getApp:()=>app,require:()=>({request:(path,settings)=>new Promise((resolve,reject)=>calls.push({path,settings,resolve,reject}))})});
  const component=Object.assign({},definition.methods,{data:structuredClone(definition.data),properties:{user:{id:'student'}},setData(value){Object.assign(this.data,value);},triggerEvent:(name,value)=>events.push({name,value})});definition.lifetimes.attached.call(component);
  return {component,definition,app,calls,events};
}

test('manual contact save never sends a phone authentication or merge request',async()=>{
  const h=contactHarness();h.component.data.phone='13800138000';h.component.data.wechatId='student_wechat';const saving=h.component.save();h.component.save();
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].path,'/me/contact');assert.equal(h.calls[0].settings.method,'PATCH');assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].settings.data)),{contactPhone:'13800138000',wechatId:'student_wechat'});
  h.calls[0].resolve({id:'student',contactPhone:'13800138000',wechatId:'student_wechat',contactPhoneVerified:false});await saving;assert.equal(h.app.writes.length,1);assert.equal(h.events[0].name,'saved');
});

test('manual contact completion cannot overwrite a different signed-in student',async()=>{
  const h=contactHarness();h.component.data.phone='13800138000';h.component.data.wechatId='student_wechat';const saving=h.component.save();h.app.globalData.token='other';h.app.globalData.user={id:'other-student'};h.calls[0].resolve({id:'student'});await saving;
  assert.equal(h.app.writes.length,0);assert.equal(h.events.length,0);
});
