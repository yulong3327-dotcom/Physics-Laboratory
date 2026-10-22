import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from './app.js';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from './database.js';
import { logisticsProvider } from './logistics.js';

async function fixture(t,options={}) {
  const dir=mkdtempSync(join(tmpdir(),'course-contacts-'));
  const instance=createApp({databasePath:join(dir,'data.sqlite'),uploadsDir:join(dir,'uploads'),quiet:true,seedDemoContent:true,env:{NODE_ENV:'test',DEMO_MODE:'true'},wechatProvider:{appConfigured:true,async login(code){return {openid:`private-openid-${code}`,session_key:'private-session-key'};}},...options});
  const server=instance.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  async function request(path,{token,method='GET',body}={}) {
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method,headers:{...(token?{Authorization:`Bearer ${token}`} :{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    return {status:response.status,data:await response.json()};
  }
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));instance.close();rmSync(dir,{recursive:true,force:true});});
  const login=async code=>(await request('/auth/wechat',{method:'POST',body:{code}})).data;
  const admin=(await request('/admin/login',{method:'POST',body:{username:'admin',password:'admin123456'}})).data;
  return {...instance,request,login,admin};
}

const address={recipient:'测试学员',phone:'13800138001',province:'广东省',city:'广州市',district:'天河区',detail:'测试路 1 号',isDefault:false};
async function paidShippingOrder(f,student,{shipping=true,paid=true}={}) {
  const r=f.request,adminToken=f.admin.token;
  await r('/admin/courses/course-math',{method:'PUT',token:adminToken,body:{shippingEnabled:shipping}});
  const order=(await r('/orders',{method:'POST',token:student.token,body:{courseId:'course-math'}})).data;
  if(paid)await r(`/orders/${order.id}/demo-pay`,{method:'POST',token:student.token});
  return order;
}

test('WeChat identity survives re-login without phone; manual contacts never bind or merge accounts',async t=>{
  const f=await fixture(t),r=f.request,a=await f.login('alice'),b=await f.login('bob');
  assert.equal(a.user.phone,'');assert.equal(a.user.wechatLinked,true);assert.equal(a.user.authMethod,'wechat');assert.equal(a.user.studentNumber,a.user.id);
  assert.doesNotMatch(JSON.stringify(a),/private-openid|private-session/);
  const update=await r('/me',{method:'PATCH',token:a.token,body:{contactPhone:'13800138001',wechatId:'student_alice'}});
  assert.equal(update.status,200);assert.equal(update.data.contactInfoCompleted,true);assert.equal(update.data.contactPhoneVerified,false);assert.equal(update.data.phone,'');
  assert.equal((await r('/me/contact',{method:'PATCH',token:b.token,body:{contactPhone:'13800138001',wechatId:'student_alice'}})).status,200);
  const again=await f.login('alice');assert.equal(again.user.id,a.user.id);assert.equal(again.user.contactPhone,'13800138001');assert.notEqual(again.user.id,b.user.id);
  const stored=f.db.prepare('SELECT phone,openid FROM users WHERE id=?').get(a.user.id);assert.equal(stored.phone,null);assert.equal(stored.openid,'private-openid-alice');
  for(const body of [{contactPhone:'123'},{wechatId:'12bad'},{wechatId:'a'.repeat(21)},{contactPhone:123},{wechatId:null}])assert.equal((await r('/me',{method:'PATCH',token:a.token,body})).status,400);
  assert.equal((await r('/me',{method:'PATCH',token:a.token,body:{contactPhone:''}})).data.contactCompleted,false);
  assert.equal((await r('/me',{token:a.token})).data.wechatId,'student_alice');
  const order=await paidShippingOrder(f,a);
  const students=(await r('/admin/students',{token:f.admin.token})).data,orders=(await r('/admin/orders',{token:f.admin.token})).data,stats=(await r('/admin/stats',{token:f.admin.token})).data;
  const adminStudent=students.find(u=>u.id===a.user.id);assert.equal(adminStudent.studentNumber,a.user.id);assert.equal(adminStudent.wechatLinked,true);assert.equal(adminStudent.wechatId,'student_alice');
  const adminOrder=orders.find(o=>o.id===order.id);assert.equal(adminOrder.studentNumber,a.user.id);assert.equal(adminOrder.authMethod,'wechat');assert.equal(adminOrder.phone,'');
  assert.doesNotMatch(JSON.stringify([students,orders,stats]),/private-openid|private-session/);
});

test('addresses enforce ownership, limits, strict fields, and exactly one default',async t=>{
  const f=await fixture(t),r=f.request,a=await f.login('alice'),b=await f.login('bob');
  assert.equal((await r('/me/addresses')).status,401);
  const first=(await r('/me/addresses',{method:'POST',token:a.token,body:address})).data;
  assert.equal(first.isDefault,true);
  const second=(await r('/my/addresses',{method:'POST',token:a.token,body:{...address,recipient:'第二地址',isDefault:true}})).data;
  const addresses=(await r('/me/addresses',{token:a.token})).data;assert.equal(addresses.filter(x=>x.isDefault).length,1);assert.equal(addresses[0].id,second.id);
  assert.equal((await r(`/me/addresses/${first.id}`,{method:'PATCH',token:b.token,body:{detail:'恶意改写'}})).status,404);
  assert.equal((await r(`/my/addresses/${first.id}`,{method:'DELETE',token:b.token})).status,404);
  assert.deepEqual((await r('/me/addresses',{token:b.token})).data,[]);
  for(const body of [{...address,recipient:'x'.repeat(51)},{...address,phone:'123'},{...address,detail:'\n'},{...address,isDefault:'true'}])assert.equal((await r('/me/addresses',{method:'POST',token:a.token,body})).status,400);
  await r(`/me/addresses/${second.id}`,{method:'DELETE',token:a.token});assert.equal((await r('/me/addresses',{token:a.token})).data[0].isDefault,true);
  for(let i=1;i<20;i++)assert.equal((await r('/me/addresses',{method:'POST',token:a.token,body:address})).status,201);
  assert.equal((await r('/me/addresses',{method:'POST',token:a.token,body:address})).status,400);
  assert.equal((await r('/me/addresses',{token:a.token})).data.length,20);
});

test('shipments gate paid eligible orders, preserve snapshots, prevent IDOR, and enforce lifecycle',async t=>{
  const f=await fixture(t),r=f.request,a=await f.login('alice'),b=await f.login('bob'),admin=f.admin.token;
  const ownAddress=(await r('/me/addresses',{method:'POST',token:a.token,body:address})).data;
  const otherAddress=(await r('/me/addresses',{method:'POST',token:b.token,body:address})).data;
  const order=await paidShippingOrder(f,a,{paid:false});
  const create=(token=a.token,addressId=ownAddress.id)=>r('/me/shipments',{method:'POST',token,body:{orderId:order.id,addressId}});
  assert.equal((await create()).status,403);assert.equal((await create(b.token,otherAddress.id)).status,404);
  await r(`/orders/${order.id}/demo-pay`,{method:'POST',token:a.token});
  assert.equal((await create(a.token,otherAddress.id)).status,404);
  await r('/admin/courses/course-math',{method:'PUT',token:admin,body:{shippingEnabled:false}});assert.equal((await create()).status,400);
  await r('/admin/courses/course-math',{method:'PUT',token:admin,body:{shippingEnabled:true}});
  const concurrent=await Promise.all([create(),create()]);assert.deepEqual(concurrent.map(x=>x.status).sort(),[200,201]);
  const shipment=concurrent[0].data;assert.equal(concurrent[1].data.id,shipment.id);assert.equal(shipment.studentNumber,a.user.id);assert.equal(shipment.status,'pending');
  await r(`/me/addresses/${ownAddress.id}`,{method:'PATCH',token:a.token,body:{detail:'更新后的地址'}});
  assert.equal((await r(`/me/shipments/${shipment.id}`,{token:a.token})).data.address.detail,address.detail);
  assert.equal((await r(`/me/shipments/${shipment.id}`,{method:'PATCH',token:a.token,body:{addressId:ownAddress.id}})).data.address.detail,'更新后的地址');
  for(const [path,method,body] of [[`/me/shipments/${shipment.id}`,'GET'],[`/me/shipments/${shipment.id}`,'PATCH',{addressId:otherAddress.id}],[`/me/shipments/${shipment.id}/receive`,'POST']])assert.equal((await r(path,{token:b.token,method,body})).status,404);
  assert.equal((await r('/admin/shipments',{token:a.token})).status,403);
  assert.equal((await r(`/me/shipments/${shipment.id}/receive`,{method:'POST',token:a.token})).status,409);
  const patch=body=>r(`/admin/shipments/${shipment.id}`,{method:'PATCH',token:admin,body});
  assert.equal((await patch({status:'shipped'})).status,400);
  assert.equal((await patch({status:'cancelled',note:'等待确认地址'})).data.status,'cancelled');
  assert.equal((await patch({status:'shipped',courierCode:'shunfeng',courierName:'顺丰',trackingNumber:'SF1234567890'})).status,409);
  assert.equal((await patch({status:'pending'})).data.status,'pending');
  const shipped=await patch({status:'shipped',courierCode:'shunfeng',courierName:'顺丰',trackingNumber:'SF1234567890'});assert.equal(shipped.status,200);assert.ok(shipped.data.shippedAt);assert.equal(shipped.data.courierCode,'shunfeng');
  assert.equal((await patch({status:'pending'})).status,409);
  assert.equal((await r(`/me/shipments/${shipment.id}`,{method:'PATCH',token:a.token,body:{addressId:ownAddress.id}})).status,409);
  await r(`/me/addresses/${ownAddress.id}`,{method:'DELETE',token:a.token});
  assert.equal((await r(`/me/shipments/${shipment.id}`,{token:a.token})).data.address.detail,'更新后的地址');
  const receive=await r(`/me/shipments/${shipment.id}/receive`,{method:'POST',token:a.token});assert.equal(receive.data.status,'delivered');assert.ok(receive.data.deliveredAt);
  assert.equal((await r(`/me/shipments/${shipment.id}/receive`,{method:'POST',token:a.token})).data.deliveredAt,receive.data.deliveredAt);
  assert.equal((await patch({status:'shipped',trackingNumber:'changed'})).status,409);
  assert.equal((await r('/admin/shipments',{token:admin})).data.length,1);
  const publicCourse=(await r('/courses/course-math')).data;assert.equal(publicCourse.shippingEnabled,true);assert.doesNotMatch(JSON.stringify(publicCourse),/更新后的地址|SF1234567890|13800138001/);
});

test('a refunded order cannot create a shipment or leave pending for shipped',async t=>{
  const f=await fixture(t),r=f.request,a=await f.login('alice'),admin=f.admin.token;
  const ownAddress=(await r('/me/addresses',{method:'POST',token:a.token,body:address})).data;
  const order=await paidShippingOrder(f,a);
  const shipment=(await r('/me/shipments',{method:'POST',token:a.token,body:{orderId:order.id,addressId:ownAddress.id}})).data;
  f.db.prepare("UPDATE orders SET status='refunded' WHERE id=?").run(order.id);
  assert.equal((await r('/me/shipments',{method:'POST',token:a.token,body:{orderId:order.id,addressId:ownAddress.id}})).status,403);
  assert.equal((await r(`/admin/shipments/${shipment.id}`,{method:'PATCH',token:admin,body:{status:'shipped',courierCode:'shunfeng',courierName:'顺丰',trackingNumber:'SF1234567890'}})).status,409);
  assert.equal((await r(`/me/shipments/${shipment.id}`,{method:'PATCH',token:a.token,body:{addressId:ownAddress.id}})).status,403);
});

test('legacy database migrates shipping opt-in and private contact tables without changing identities',t=>{
  const dir=mkdtempSync(join(tmpdir(),'course-legacy-')),filename=join(dir,'legacy.sqlite');t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const db=new DatabaseSync(filename);
  db.exec("CREATE TABLE users(id TEXT PRIMARY KEY,phone TEXT UNIQUE,openid TEXT UNIQUE,name TEXT NOT NULL,createdAt TEXT NOT NULL); CREATE TABLE courses(id TEXT PRIMARY KEY,title TEXT NOT NULL,subtitle TEXT NOT NULL DEFAULT '',subject TEXT NOT NULL,grade TEXT NOT NULL,type TEXT NOT NULL,price REAL NOT NULL,originalPrice REAL NOT NULL,teacher TEXT NOT NULL,teacherRole TEXT NOT NULL,teacherColor TEXT NOT NULL,description TEXT NOT NULL,coverTheme TEXT NOT NULL,tags TEXT NOT NULL DEFAULT '[]',status TEXT NOT NULL,createdAt TEXT NOT NULL);");
  db.prepare('INSERT INTO users(id,phone,openid,name,createdAt) VALUES(?,?,?,?,?)').run('stable-user',null,'private-stable-openid','原有学员','2026-01-01');
  db.prepare('INSERT INTO courses(id,title,subject,grade,type,price,originalPrice,teacher,teacherRole,teacherColor,description,coverTheme,status,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('old-course','原有课程','化学','高三','系统课',99,199,'老师','主讲','#ff8a21','说明','orange','published','2026-01-01');db.close();
  const migrated=openDatabase(filename,join(dir,'uploads'),{seedDemoContent:false});
  assert.equal(migrated.prepare('SELECT shippingEnabled FROM courses WHERE id=?').get('old-course').shippingEnabled,0);assert.equal(migrated.prepare('SELECT openid FROM users WHERE id=?').get('stable-user').openid,'private-stable-openid');
  assert.equal(migrated.prepare('SELECT COUNT(*) AS count FROM student_contacts').get().count,0);assert.equal(migrated.prepare('SELECT COUNT(*) AS count FROM shipments').get().count,0);migrated.close();
  const reopened=openDatabase(filename,join(dir,'uploads'),{seedDemoContent:false});assert.equal(reopened.prepare('SELECT COUNT(*) AS count FROM users').get().count,1);reopened.close();
});

test('authenticated tracking checks ownership before cache, protects configuration, and never changes delivery state',async t=>{
  let calls=0;
  const logistics=logisticsProvider({LOGISTICS_PROVIDER:'kuaidi100',KUAIDI100_CUSTOMER:'test-customer',KUAIDI100_KEY:'test-key'},{fetcher:async(url,options)=>{calls++;const param=JSON.parse(new URLSearchParams(options.body).get('param'));assert.equal(param.phone,address.phone);return new Response(JSON.stringify({status:'200',com:param.com,nu:param.num,state:'3',data:[{time:'2026-10-23 12:00',context:'快递公司标记签收'}]}));}});
  const f=await fixture(t,{logisticsProvider:logistics}),r=f.request,a=await f.login('alice'),b=await f.login('bob'),admin=f.admin.token;
  assert.equal((await r('/admin/logistics/config')).status,401);assert.equal((await r('/admin/logistics/config',{token:a.token})).status,403);
  const configResponse=(await r('/admin/logistics/config',{token:admin})).data;assert.equal(configResponse.configured,true);assert.ok(configResponse.supportedCarriers.some(x=>x.code==='shunfeng'));assert.doesNotMatch(JSON.stringify(configResponse),/test-key|test-customer/);
  const ownAddress=(await r('/me/addresses',{method:'POST',token:a.token,body:address})).data,order=await paidShippingOrder(f,a);
  const shipment=(await r('/me/shipments',{method:'POST',token:a.token,body:{orderId:order.id,addressId:ownAddress.id}})).data;
  const path=`/me/shipments/${shipment.id}/tracking`;
  assert.equal((await r(path)).status,401);assert.equal((await r(path,{token:b.token})).status,404);
  const pending=await r(path,{token:a.token});assert.equal(pending.data.status,'pending');assert.equal(calls,0);
  assert.equal((await r(`/admin/shipments/${shipment.id}`,{method:'PATCH',token:admin,body:{status:'shipped',courierCode:'sf',courierName:'顺丰',trackingNumber:'SF1234567890'}})).status,400);
  await r(`/admin/shipments/${shipment.id}`,{method:'PATCH',token:admin,body:{status:'shipped',courierCode:'shunfeng',courierName:'顺丰',trackingNumber:'SF1234567890'}});
  const queried=await r(path,{token:a.token});assert.equal(queried.status,200);assert.equal(queried.data.status,'3');assert.equal(calls,1);
  assert.equal((await r(path,{token:b.token})).status,404);assert.equal((await r(path,{token:a.token})).status,200);assert.equal((await r(`/admin/shipments/${shipment.id}/tracking`,{token:admin})).status,200);assert.equal(calls,1);
  assert.equal((await r(`/me/shipments/${shipment.id}`,{token:a.token})).data.status,'shipped');
  await r(`/admin/shipments/${shipment.id}`,{method:'PATCH',token:admin,body:{trackingNumber:'SF1234567899'}});await r(path,{token:a.token});assert.equal(calls,2);
});

test('unconfigured authenticated tracking returns a clear 503 without fabricating events',async t=>{
  const f=await fixture(t),r=f.request,a=await f.login('alice');
  const ownAddress=(await r('/me/addresses',{method:'POST',token:a.token,body:address})).data,order=await paidShippingOrder(f,a);
  const shipment=(await r('/me/shipments',{method:'POST',token:a.token,body:{orderId:order.id,addressId:ownAddress.id}})).data;
  const response=await r(`/me/shipments/${shipment.id}/tracking`,{token:a.token});assert.equal(response.status,503);assert.match(response.data.message,/尚未配置/);assert.equal(response.data.events,undefined);
});
