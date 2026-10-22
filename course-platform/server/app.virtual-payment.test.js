import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,createCipheriv} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from './app.js';
import {virtualPaymentProvider} from './virtual-payment.js';

const environment={NODE_ENV:'production',DEMO_MODE:'false',ADMIN_PASSWORD:'Strong-Test-Password-2026',SESSION_SECRET:'test-only-independent-session-secret-longer-than-32-characters',WECHAT_APP_ID:'wx1234567890abcdef',WECHAT_APP_SECRET:'app-secret-for-tests',WECHAT_MCH_ID:'test-merchant',WECHAT_VIRTUAL_OFFER_ID:'1450688403',WECHAT_VIRTUAL_APP_KEY:'virtual-app-key-for-tests',WECHAT_VIRTUAL_ENV:'0',WECHAT_MESSAGE_TOKEN:'message-token-for-tests',WECHAT_MESSAGE_AES_KEY:Buffer.alloc(32,29).toString('base64').slice(0,-1)};
const sessionKey='9hAb/NEYUlkaMBEsmFgzig==',openid='student_openid_001';
const timestamp=()=>new Date().toISOString();
const response=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
function signatureQuery(encrypted) {
  const time=String(Math.floor(Date.now()/1000)),nonce=randomBytes(10).toString('hex'),parts=[environment.WECHAT_MESSAGE_TOKEN,time,nonce];
  if(encrypted!==undefined)parts.push(encrypted);
  const query=new URLSearchParams({timestamp:time,nonce});
  query.set(encrypted===undefined?'signature':'msg_signature',createHash('sha1').update(parts.sort().join('')).digest('hex'));
  return query;
}
function encrypt(xml) {
  const key=Buffer.from(`${environment.WECHAT_MESSAGE_AES_KEY}=`,'base64'),body=Buffer.from(xml),length=Buffer.alloc(4);length.writeUInt32BE(body.length);
  const clear=Buffer.concat([randomBytes(16),length,body,Buffer.from(environment.WECHAT_APP_ID)]),pad=32-clear.length%32;
  const cipher=createCipheriv('aes-256-cbc',key,key.subarray(0,16));cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(Buffer.concat([clear,Buffer.alloc(pad,pad)])),cipher.final()]).toString('base64');
}
async function setup(t,options={}) {
  const directory=mkdtempSync(join(tmpdir(),'virtual-course-test-'));
  const states=new Map(),calls={queries:[],deliveries:[],signatures:[],ordinary:0,native:0},controls={deliveryFailure:false,queryFailure:false,loginHook:null,queryHook:null};
  const provider=virtualPaymentProvider(environment,{fetch:async(url,request)=>{
    if(url.includes('/cgi-bin/token'))return response({access_token:'private-api-token',expires_in:7200});
    const body=JSON.parse(request.body);
    if(url.includes('/xpay/query_order')) {
      const queryId=body.order_id||body.wx_order_id;
      calls.queries.push(queryId);
      if(controls.queryHook)await controls.queryHook(queryId);
      if(controls.queryFailure)throw new Error('secret-app-key-and-private-api-token');
      if(states.get(queryId)?.errorResponse)return response(states.get(queryId).errorResponse);
      return response({errcode:0,order:{order_id:queryId,env_type:1,order_type:0,order_fee:100,paid_fee:100,left_fee:100,status:1,wx_order_id:`WX${queryId}`,token:'upstream-private-order-token',...states.get(queryId)}});
    }
    if(url.includes('/xpay/notify_provide_goods')) {
      calls.deliveries.push(body.order_id);
      if(controls.deliveryFailure)return response({errcode:-1,errmsg:'contains-private-token-and-key'});
      return response({errcode:0});
    }
    throw new Error('Unexpected endpoint');
  }});
  const originalSign=provider.createPayment;provider.createPayment=input=>{calls.signatures.push({...input});return originalSign(input);};
  const wechat={appConfigured:true,payConfigured:true,async login(code){if(controls.loginHook)await controls.loginHook();return {openid:code==='wrong-account'?'other_openid_002':openid,session_key:sessionKey};},async createPayment(){calls.ordinary++;return {package:'ordinary-prepay'};},async createNativePayment(){calls.native++;return {codeUrl:'weixin://private-native-qr'};},async closePayment(){return {closed:true};},verifyNotification(headers,raw){return JSON.parse(raw);}};
  const settings={env:environment,databasePath:join(directory,'course.sqlite'),uploadsDir:join(directory,'uploads'),quiet:true,virtualReconciliation:false,wechatProvider:wechat,virtualPaymentProvider:provider,...options};
  let instance=createApp(settings),server,base;
  async function start(){server=instance.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${server.address().port}`;}
  await start();
  const courseRow=['chemistry','化学测试课程','测试课程副标题','化学','高二','系统课',1,1,'测试老师','主讲老师','#6793ef','课程说明','blue','[]','published',timestamp(),'chem_beta_2027'];
  instance.db.prepare('INSERT INTO courses(id,title,subtitle,subject,grade,type,price,originalPrice,teacher,teacherRole,teacherColor,description,coverTheme,tags,status,createdAt,productId) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...courseRow);
  for(const [id,studentOpenid,token] of [['student',openid,'student-session-token'],['other','other_openid_002','other-session-token']]) {
    instance.db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run(id,null,studentOpenid,'测试同学',timestamp());
    instance.db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,'student',Date.now()+3600000);
  }
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));instance.close();rmSync(directory,{recursive:true,force:true});});
  async function request(path,{method='GET',token='student-session-token',body,xml,query}={}) {
    const headers={};if(token)headers.Authorization=`Bearer ${token}`;
    if(xml!==undefined)headers['Content-Type']='application/xml';else if(body!==undefined)headers['Content-Type']='application/json';
    const result=await fetch(`${base}/api${path}${query?`?${query}`:''}`,{method,headers,body:xml??(body===undefined?undefined:JSON.stringify(body))});
    const text=await result.text();return {status:result.status,data:result.headers.get('content-type')?.includes('application/json')?JSON.parse(text):text,headers:result.headers};
  }
  async function order(){const result=await request('/orders',{method:'POST',body:{courseId:'chemistry'}});assert.equal(result.status,201);return result.data;}
  async function payment(orderId,code='fresh-code'){return request(`/orders/${orderId}/virtual-pay`,{method:'POST',body:{code}});}
  async function notify(attemptId,{event='xpay_goods_deliver_notify',safe=false,fields=''}={}) {
    const xml=`<xml><MsgType>event</MsgType><Event>${event}</Event><${event==='xpay_refund_notify'?'MchOrderId':'OutTradeNo'}>${attemptId}</${event==='xpay_refund_notify'?'MchOrderId':'OutTradeNo'}><OpenId>${openid}</OpenId>${fields}</xml>`;
    let query=signatureQuery(),body=xml;
    if(safe){const encrypted=encrypt(xml);query=signatureQuery(encrypted);query.set('encrypt_type','aes');body=`<xml><Encrypt><![CDATA[${encrypted}]]></Encrypt></xml>`;}
    return request('/payments/wechat-virtual/notify',{method:'POST',token:null,xml:body,query});
  }
  return {get db(){return instance.db;},request,order,payment,notify,states,calls,controls,settings,async reconcile(){await instance.reconcileVirtualPayments({force:true});},async restart(overrides={}){await new Promise(resolve=>server.close(resolve));instance.close();instance=createApp({...settings,...overrides});await start();}};
}

test('virtual checkout creates a fresh attempt per invocation, verifies identity and blocks other channels',async t=>{
  const f=await setup(t),order=await f.order(),path=`/orders/${order.id}`;
  const config=(await f.request('/config')).data;assert.equal(config.virtualPaymentConfigured,true);assert.equal(config.paymentMode,'wechat-virtual');assert.equal(config.paymentConfigured,true);
  assert.equal((await f.request(`${path}/virtual-pay`,{method:'POST',token:null,body:{code:'fresh'}})).status,401);
  assert.equal((await f.request(`${path}/virtual-pay`,{method:'POST',token:'other-session-token',body:{code:'fresh'}})).status,404);
  assert.equal((await f.payment(order.id,'wrong-account')).status,403);
  const replies=await Promise.all(Array.from({length:5},()=>f.payment(order.id)));
  for(const reply of replies){assert.equal(reply.status,200);assert.equal(reply.data.provider,'wechat-virtual');assert.equal(reply.data.mode,'short_series_goods');assert.doesNotMatch(JSON.stringify(reply.data),/session_key|9hAb|private|app-key/);}
  const attempts=new Set(replies.map(reply=>JSON.parse(reply.data.signData).outTradeNo));assert.equal(attempts.size,5);
  const attempt=f.db.prepare('SELECT * FROM virtual_payments').get();assert.match(attempt.id,/^[A-Za-z0-9]{30}$/);assert.equal(attempt.amount,100);assert.equal(attempt.productId,'chem_beta_2027');assert.equal(attempt.openid,openid);assert.equal(attempt.env,0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM virtual_payments').get().n,5);
  assert.equal(f.calls.queries.length,10);assert.equal(replies[0].data.paymentParams,undefined);
  for(const route of ['pay','native-pay','cancel'])assert.equal((await f.request(`${path}/${route}`,{method:'POST',body:{}})).status,409,route);
  assert.equal(f.calls.ordinary,0);assert.equal(f.calls.native,0);
  const callback=await f.request('/payments/wechat/notify',{method:'POST',token:null,body:{mchid:environment.WECHAT_MCH_ID,appid:environment.WECHAT_APP_ID,trade_state:'SUCCESS',trade_type:'JSAPI',out_trade_no:order.id,transaction_id:'forged-ordinary-transaction',amount:{total:100,currency:'CNY'},payer:{openid}}});
  assert.equal(callback.status,409);assert.equal(f.db.prepare('SELECT status FROM orders WHERE id=?').get(order.id).status,'pending');
  const safeStored=JSON.stringify(f.db.prepare('SELECT * FROM virtual_payments').all());assert.doesNotMatch(safeStored,/session_key|9hAb|private-api-token|app-key/);
});

test('payment confirmation validates every authoritative field and never trusts callback goods or client success',async t=>{
  const f=await setup(t),order=await f.order(),pay=await f.payment(order.id),attempt=JSON.parse(pay.data.signData).outTradeNo,path=`/orders/${order.id}/sync-payment`;
  const pending=await f.notify(attempt,{fields:'<GoodsInfo><ActualPrice>100</ActualPrice><ProductId>chem_beta_2027</ProductId></GoodsInfo>'});assert.equal(pending.status,200);
  assert.equal(f.db.prepare('SELECT status FROM orders WHERE id=?').get(order.id).status,'pending');assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM enrollments').get().n,0);
  for(const invalid of [{order_id:'wrong-order'},{env_type:2},{order_fee:1},{paid_fee:1},{order_type:1},{status:'2'},{wx_order_id:''}]) {
    f.states.set(attempt,{status:2,...invalid});const result=await f.request(path,{method:'POST',body:{status:'paid',amount:100}});assert.equal(result.status,502,JSON.stringify(invalid));assert.equal(f.db.prepare('SELECT status FROM orders WHERE id=?').get(order.id).status,'pending');
  }
  f.states.set(attempt,{status:2});
  const paid=await f.request(path,{method:'POST'});assert.equal(paid.status,200);assert.equal(paid.data.order.status,'paid');assert.equal(paid.data.order.amountFen,100);assert.doesNotMatch(JSON.stringify(paid.data),/upstream-private|session_key|9hAb|signData/);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM enrollments').get().n,1);assert.equal(f.calls.deliveries.length,1);
  const repeated=await Promise.all([f.notify(attempt),f.notify(attempt,{safe:true}),f.request(path,{method:'POST'})]);assert.ok(repeated.every(result=>result.status===200));assert.equal(f.calls.deliveries.length,1);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM enrollments').get().n,1);
  f.states.set(attempt,{status:2,wx_order_id:'different-transaction'});assert.equal((await f.request(path,{method:'POST'})).status,502);
});

test('message endpoint checks signed handshake, rejects tampering, and reconciles safe AES notifications',async t=>{
  const f=await setup(t),query=signatureQuery();query.set('echostr','endpoint-check');
  assert.equal((await f.request('/payments/wechat-virtual/notify',{token:null,query})).data,'endpoint-check');
  query.set('signature','0'.repeat(40));assert.equal((await f.request('/payments/wechat-virtual/notify',{token:null,query})).status,403);
  const order=await f.order(),pay=await f.payment(order.id),attempt=JSON.parse(pay.data.signData).outTradeNo;
  f.states.set(attempt,{status:4,order_type:7});
  const wrongQuery=signatureQuery();wrongQuery.set('signature','f'.repeat(40));
  assert.equal((await f.request('/payments/wechat-virtual/notify',{method:'POST',token:null,query:wrongQuery,xml:`<xml><Event>xpay_goods_deliver_notify</Event><OutTradeNo>${attempt}</OutTradeNo></xml>`})).status,403);
  assert.equal(f.db.prepare('SELECT status FROM orders WHERE id=?').get(order.id).status,'pending');
  const paid=await f.notify(attempt,{safe:true});assert.equal(paid.status,200);assert.match(paid.data,/<ErrCode>0<\/ErrCode>/);assert.equal(f.db.prepare('SELECT status FROM orders WHERE id=?').get(order.id).status,'paid');assert.equal(f.calls.deliveries.length,0);
  assert.equal((await f.notify(attempt,{fields:'<Env>1</Env>'})).status,400);
});

test('refund query revokes access idempotently, preserves a second paid entitlement and cannot be resurrected',async t=>{
  const f=await setup(t),order=await f.order(),pay=await f.payment(order.id),attempt=JSON.parse(pay.data.signData).outTradeNo;
  f.states.set(attempt,{status:2});await f.notify(attempt);
  f.states.set(attempt,{status:8,left_fee:0});assert.equal((await f.notify(attempt,{event:'xpay_refund_notify',safe:true})).status,200);
  assert.equal(f.db.prepare('SELECT status FROM orders WHERE id=?').get(order.id).status,'refunded');assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM enrollments').get().n,0);
  assert.equal((await f.notify(attempt,{event:'xpay_refund_notify'})).status,200);
  f.states.set(attempt,{status:2});await f.notify(attempt);assert.equal(f.db.prepare('SELECT status FROM orders WHERE id=?').get(order.id).status,'refunded');assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM enrollments').get().n,0);
  const replacement=await f.order(),replacementPay=await f.payment(replacement.id),replacementAttempt=JSON.parse(replacementPay.data.signData).outTradeNo;
  f.states.set(replacementAttempt,{status:2});await f.notify(replacementAttempt);
  f.states.set(attempt,{status:8,left_fee:0});await f.notify(attempt,{event:'xpay_refund_notify'});assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM enrollments').get().n,1);
  f.states.set(replacementAttempt,{status:8,left_fee:0});await f.notify(replacementAttempt,{event:'xpay_refund_notify'});assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM enrollments').get().n,0);
});

test('background recovery after restart grants pending purchases and retries failed delivery without the frontend',async t=>{
  const f=await setup(t),order=await f.order(),pay=await f.payment(order.id),attempt=JSON.parse(pay.data.signData).outTradeNo;
  f.states.set(attempt,{status:2});f.controls.deliveryFailure=true;
  await f.restart({virtualReconciliation:true,virtualReconcileStartupMs:10,virtualReconcileIntervalMs:50});
  const deadline=Date.now()+3000;
  while(f.db.prepare('SELECT status FROM orders WHERE id=?').get(order.id).status!=='paid' && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(f.db.prepare('SELECT status FROM orders WHERE id=?').get(order.id).status,'paid');assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM enrollments').get().n,1);
  assert.equal(f.db.prepare('SELECT deliveredAt FROM virtual_payments WHERE id=?').get(attempt).deliveredAt,null);
  f.controls.deliveryFailure=false;await f.reconcile();assert.ok(f.db.prepare('SELECT deliveredAt FROM virtual_payments WHERE id=?').get(attempt).deliveredAt);
  f.states.set(attempt,{status:8,left_fee:0});await f.restart({virtualReconciliation:true,virtualReconcileStartupMs:10});
  const refundDeadline=Date.now()+3000;
  while(f.db.prepare('SELECT status FROM orders WHERE id=?').get(order.id).status!=='refunded' && Date.now()<refundDeadline)await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(f.db.prepare('SELECT status FROM orders WHERE id=?').get(order.id).status,'refunded');assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM enrollments').get().n,0);
});

test('an upstream closed attempt permits retry on the same order; checks serialize and errors stay private',async t=>{
  const f=await setup(t),order=await f.order(),pay=await f.payment(order.id),attempt=JSON.parse(pay.data.signData).outTradeNo,path=`/orders/${order.id}/sync-payment`;
  f.controls.queryFailure=true;const failed=await f.request(path,{method:'POST'});assert.equal(failed.status,502);assert.doesNotMatch(JSON.stringify(failed.data),/secret-app-key|private-api-token/);assert.equal(f.db.prepare('SELECT error FROM virtual_payments WHERE id=?').get(attempt).error,'RECONCILIATION_REQUIRED');
  f.controls.queryFailure=false;f.states.set(attempt,{status:6});
  let release;const gate=new Promise(resolve=>{release=resolve;});f.controls.queryHook=()=>gate;
  const before=f.calls.queries.length,requests=Array.from({length:5},()=>f.request(path,{method:'POST'}));
  await new Promise(resolve=>setTimeout(resolve,30));release();const results=await Promise.all(requests);
  assert.ok(results.every(result=>result.data.order.status==='pending'));assert.equal(f.calls.queries.length,before+1);
  f.controls.queryHook=null;
  const retry=await f.payment(order.id);assert.equal(retry.status,200);assert.notEqual(JSON.parse(retry.data.signData).outTradeNo,attempt);
  assert.equal(f.db.prepare('SELECT status FROM virtual_payments WHERE id=?').get(attempt).status,'closed');
  assert.equal((await f.order()).id,order.id);
});

test('channel is reserved before awaiting WeChat login, preventing a concurrent Native charge',async t=>{
  const f=await setup(t),order=await f.order();let entered,release;
  const started=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  f.controls.loginHook=async()=>{entered();await gate;};
  const virtual=f.payment(order.id);await started;
  assert.equal((await f.request(`/orders/${order.id}/native-pay`,{method:'POST'})).status,409);assert.equal(f.calls.native,0);
  release();assert.equal((await virtual).status,200);
});

test('cancel retry checks every historical attempt and a prior payment stops another payment launch',async t=>{
  const f=await setup(t),order=await f.order(),first=JSON.parse((await f.payment(order.id)).data.signData).outTradeNo;
  f.states.set(first,{status:6});
  const secondPay=await f.payment(order.id),second=JSON.parse(secondPay.data.signData).outTradeNo;
  assert.notEqual(first,second);assert.deepEqual(f.calls.queries,[first]);
  f.states.set(first,{status:2});
  const before=f.calls.queries.length,paid=await f.payment(order.id);
  assert.equal(paid.status,200);assert.equal(paid.data.paid,true);assert.equal(paid.data.signData,undefined);
  assert.deepEqual(new Set(f.calls.queries.slice(before)),new Set([first,second]));
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM virtual_payments').get().n,2);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM enrollments').get().n,1);
});

test('late duplicate payments retain separate transactions, expose admin review and refund only the matching attempt',async t=>{
  const f=await setup(t),order=await f.order(),first=JSON.parse((await f.payment(order.id)).data.signData).outTradeNo;
  f.states.set(first,{status:6});
  const second=JSON.parse((await f.payment(order.id)).data.signData).outTradeNo;
  const third=JSON.parse((await f.payment(order.id)).data.signData).outTradeNo;
  f.states.set(first,{status:2});assert.equal((await f.notify(first)).status,200);
  f.states.set(second,{status:4});assert.equal((await f.notify(second)).status,200);
  const rows=f.db.prepare('SELECT * FROM virtual_payments WHERE orderId=?').all(order.id);
  assert.equal(rows.filter(row=>row.status==='paid').length,2);assert.equal(rows.find(row=>row.id===second).duplicatePayment,1);
  assert.equal(rows.find(row=>row.id===first).transactionId,`WX${first}`);assert.equal(rows.find(row=>row.id===second).transactionId,`WX${second}`);
  assert.equal(f.db.prepare('SELECT transactionId FROM orders WHERE id=?').get(order.id).transactionId,`WX${first}`);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM enrollments').get().n,1);
  const admin=(await f.request('/admin/login',{method:'POST',token:null,body:{username:'admin',password:environment.ADMIN_PASSWORD}})).data.token;
  let visible=(await f.request('/admin/orders',{token:admin})).data.find(row=>row.id===order.id);
  assert.equal(visible.duplicatePayment,true);assert.equal(visible.duplicatePaymentCount,1);assert.equal(visible.paymentReviewRequired,true);assert.equal(visible.virtualPayments.length,3);
  assert.equal((await f.request('/admin/stats',{token:admin})).data.paymentReviewRequired,1);
  f.states.set(first,{status:8,left_fee:0});assert.equal((await f.notify(first,{event:'xpay_refund_notify'})).status,200);
  assert.equal(f.db.prepare('SELECT status FROM orders WHERE id=?').get(order.id).status,'paid');assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM enrollments').get().n,1);
  assert.equal(f.db.prepare('SELECT status FROM virtual_payments WHERE id=?').get(second).status,'paid');
  visible=(await f.request('/admin/orders',{token:admin})).data.find(row=>row.id===order.id);assert.equal(visible.duplicatePayment,true);assert.equal(visible.paymentReviewRequired,false);
  f.states.set(second,{status:8,left_fee:0});await f.notify(second,{event:'xpay_refund_notify',safe:true});
  assert.equal(f.db.prepare('SELECT status FROM orders WHERE id=?').get(order.id).status,'refunded');assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM enrollments').get().n,0);
  assert.ok(f.db.prepare('SELECT refundedAt FROM virtual_payments WHERE id=?').get(first).refundedAt);
  f.states.set(first,{status:2});await f.notify(first);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM enrollments').get().n,0);
  // A separate late payment can grant access after every earlier charge refunded.
  f.states.set(third,{status:2});await f.notify(third);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM enrollments').get().n,1);
  assert.equal(f.db.prepare('SELECT status FROM orders WHERE id=?').get(order.id).status,'paid');
  f.states.set(second,{status:8,left_fee:0});await f.notify(second,{event:'xpay_refund_notify'});assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM enrollments').get().n,1);
  assert.equal(f.db.prepare('SELECT duplicatePayment FROM virtual_payments WHERE id=?').get(third).duplicatePayment,1);
});

test('retry stops on an unverifiable older attempt and still reconciles a separate late payment',async t=>{
  const f=await setup(t),order=await f.order(),first=JSON.parse((await f.payment(order.id)).data.signData).outTradeNo;
  const second=JSON.parse((await f.payment(order.id)).data.signData).outTradeNo;
  f.controls.queryHook=id=>{if(id===first)throw new Error('private-upstream-query-failure');};f.states.set(second,{status:2});
  const failed=await f.payment(order.id);assert.equal(failed.status,502);assert.doesNotMatch(JSON.stringify(failed.data),/private-upstream/);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM virtual_payments').get().n,2);
  assert.equal(f.db.prepare('SELECT status FROM orders WHERE id=?').get(order.id).status,'paid');assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM enrollments').get().n,1);
  assert.equal(f.db.prepare('SELECT error FROM virtual_payments WHERE id=?').get(first).error,'RECONCILIATION_REQUIRED');
  f.controls.queryHook=null;f.states.set(first,{status:2,wx_order_id:`WX${second}`});
  assert.equal((await f.notify(first)).status,502);assert.equal(f.db.prepare('SELECT transactionId FROM virtual_payments WHERE id=?').get(first).transactionId,null);
});

test('existing unique-order schema migrates in place and retains old attempts while permitting new ones',async t=>{
  const f=await setup(t),order=await f.order(),first=JSON.parse((await f.payment(order.id)).data.signData).outTradeNo;
  f.db.exec('ALTER TABLE virtual_payments DROP COLUMN paidAt; ALTER TABLE virtual_payments DROP COLUMN refundedAt; ALTER TABLE virtual_payments DROP COLUMN duplicatePayment; CREATE UNIQUE INDEX idx_virtual_payments_unique_order ON virtual_payments(orderId)');
  await f.restart();
  const indexes=f.db.prepare('PRAGMA index_list(virtual_payments)').all();
  assert.equal(indexes.some(index=>index.name==='idx_virtual_payments_unique_order'),false);
  assert.ok(indexes.some(index=>index.name==='idx_virtual_payments_order' && index.unique===0));
  const columns=f.db.prepare('PRAGMA table_info(virtual_payments)').all().map(column=>column.name);
  assert.ok(['paidAt','refundedAt','duplicatePayment'].every(column=>columns.includes(column)));
  const retained=f.db.prepare('SELECT * FROM virtual_payments WHERE id=?').get(first);assert.equal(retained.orderId,order.id);assert.equal(retained.status,'pending');assert.equal(retained.duplicatePayment,0);
  const second=await f.payment(order.id);assert.equal(second.status,200);assert.notEqual(JSON.parse(second.data.signData).outTradeNo,first);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM virtual_payments').get().n,2);
});

test('a never-created or explicitly absent upstream order allows retry, while transient failures block it',async t=>{
  const f=await setup(t),order=await f.order(),first=JSON.parse((await f.payment(order.id)).data.signData).outTradeNo;
  f.states.set(first,{errorResponse:{errcode:268490002,errmsg:'order not exist'}});
  const secondPay=await f.payment(order.id);assert.equal(secondPay.status,200);const second=JSON.parse(secondPay.data.signData).outTradeNo;
  assert.notEqual(first,second);assert.equal(f.db.prepare('SELECT status FROM virtual_payments WHERE id=?').get(first).status,'not_created');
  f.states.set(second,{status:0,order_id:'',env_type:0,order_fee:0,paid_fee:0});
  const thirdPay=await f.payment(order.id);assert.equal(thirdPay.status,200);const third=JSON.parse(thirdPay.data.signData).outTradeNo;
  assert.equal(f.db.prepare('SELECT status FROM virtual_payments WHERE id=?').get(second).status,'not_created');
  f.states.set(third,{errorResponse:{errcode:268490002,errmsg:'invalid parameters'}});
  assert.equal((await f.payment(order.id)).status,502);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM virtual_payments').get().n,3);
  // A delayed SDK invocation can still settle an attempt previously absent.
  f.states.set(first,{status:2});await f.notify(first);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM enrollments').get().n,1);
  f.states.set(first,{errorResponse:{errcode:268490002,errmsg:'order not exist'}});assert.equal((await f.notify(first)).status,404);
  assert.equal(f.db.prepare('SELECT status FROM virtual_payments WHERE id=?').get(first).status,'paid');
});

test('authoritative payment left_fee revokes a full refund while the original order remains delivered',async t=>{
  const f=await setup(t),order=await f.order(),attempt=JSON.parse((await f.payment(order.id)).data.signData).outTradeNo;
  f.states.set(attempt,{status:4});await f.notify(attempt);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM enrollments').get().n,1);
  f.states.set(attempt,{status:4,left_fee:40});await f.reconcile();assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM enrollments').get().n,1);
  f.states.set(attempt,{status:4,left_fee:0});await f.restart({virtualReconciliation:true,virtualReconcileStartupMs:10});
  const deadline=Date.now()+3000;while(f.db.prepare('SELECT COUNT(*) AS n FROM enrollments').get().n!==0 && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM enrollments').get().n,0);
  const row=f.db.prepare('SELECT * FROM virtual_payments WHERE id=?').get(attempt);assert.equal(row.status,'refunded');assert.equal(row.remainingAmount,0);assert.equal(row.refundFinal,0);
});

test('independent refund state 5 stays recoverable through restart and failed state 7 restores provisional access',async t=>{
  const f=await setup(t),order=await f.order(),attempt=JSON.parse((await f.payment(order.id)).data.signData).outTradeNo;
  f.states.set(attempt,{status:4});await f.notify(attempt);
  const refund='REFUND_PENDING_001',wxRefund='WX_REFUND_PENDING_001',fields=`<MchRefundId>${refund}</MchRefundId><WxRefundId>${wxRefund}</WxRefundId><WxOrderId>WX${attempt}</WxOrderId><RefundFee>100</RefundFee><RetCode>0</RetCode>`;
  f.states.set(refund,{order_type:1,status:5,refund_fee:100,wx_order_id:wxRefund});
  assert.equal((await f.notify(attempt,{event:'xpay_refund_notify',safe:true,fields})).status,200);
  assert.equal(f.db.prepare('SELECT status FROM virtual_refunds').get().status,'processing');assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM enrollments').get().n,1);
  f.states.set(attempt,{status:4,left_fee:0});await f.reconcile();assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM enrollments').get().n,0);
  f.states.set(attempt,{status:4,left_fee:100});f.states.set(refund,{order_type:1,status:7,refund_fee:100,wx_order_id:wxRefund});
  await f.restart({virtualReconciliation:true,virtualReconcileStartupMs:10,virtualReconcileIntervalMs:50});
  const deadline=Date.now()+3000;while(f.db.prepare('SELECT status FROM virtual_refunds').get().status!=='failed' && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(f.db.prepare('SELECT status FROM virtual_refunds').get().status,'failed');assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM enrollments').get().n,1);
  assert.equal(f.db.prepare('SELECT refundFinal FROM virtual_payments WHERE id=?').get(attempt).refundFinal,0);
});

test('independent refund lookup verifies identity, type, environment, amount, transaction and original linkage',async t=>{
  const f=await setup(t),order=await f.order(),attempt=JSON.parse((await f.payment(order.id)).data.signData).outTradeNo;
  f.states.set(attempt,{status:4,order_type:7});await f.notify(attempt);
  const refund='REFUND_IOS_001',wxRefund='WX_REFUND_IOS_001',fields=`<MchRefundId>${refund}</MchRefundId><WxRefundId>${wxRefund}</WxRefundId><WxOrderId>WX${attempt}</WxOrderId><RefundFee>100</RefundFee>`;
  const valid={order_type:8,status:8,refund_fee:100,wx_order_id:wxRefund,pay_order_id:attempt,pay_wx_order_id:`WX${attempt}`};
  for(const invalid of [{order_id:'REFUND_WRONG_001'},{order_type:7},{env_type:2},{refund_fee:99},{wx_order_id:'WX_OTHER_REFUND'},{pay_order_id:'VP_UNKNOWN_PAYMENT'},{pay_wx_order_id:'WX_WRONG_ORIGINAL'}]) {
    f.states.set(refund,{...valid,...invalid});const result=await f.notify(attempt,{event:'xpay_refund_notify',safe:true,fields});assert.equal(result.status,502,JSON.stringify(invalid));assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM enrollments').get().n,1);
  }
  f.states.set(refund,valid);assert.equal((await f.notify(attempt,{event:'xpay_refund_notify',safe:true,fields})).status,200);
  const audit=f.db.prepare('SELECT * FROM virtual_refunds').get();assert.equal(audit.refundOrderId,refund);assert.equal(audit.wxRefundId,wxRefund);assert.equal(audit.amount,100);assert.equal(audit.status,'refunded');assert.equal(audit.linkVerified,1);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM enrollments').get().n,0);assert.equal(f.db.prepare('SELECT refundFinal FROM virtual_payments WHERE id=?').get(attempt).refundFinal,1);
  // Original order can lag behind a completed independent refund; it cannot resurrect access.
  await f.notify(attempt);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM enrollments').get().n,0);
});

test('plaintext refund claims cannot attach another refund to a paid course, while verified partial refunds accumulate',async t=>{
  const f=await setup(t),order=await f.order(),attempt=JSON.parse((await f.payment(order.id)).data.signData).outTradeNo;
  f.states.set(attempt,{status:4});await f.notify(attempt);
  const fake='REFUND_FOREIGN_001',fakeWx='WX_REFUND_FOREIGN_001';
  f.states.set(fake,{order_type:1,status:8,refund_fee:100,wx_order_id:fakeWx});
  await f.notify(attempt,{event:'xpay_refund_notify',fields:`<MchRefundId>${fake}</MchRefundId><WxRefundId>${fakeWx}</WxRefundId><RefundFee>100</RefundFee>`});
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM enrollments').get().n,1);assert.equal(f.db.prepare('SELECT linkVerified FROM virtual_refunds WHERE refundOrderId=?').get(fake).linkVerified,0);
  for(const [id,amount] of [['REFUND_PART_A_001',40],['REFUND_PART_B_001',60]]) {
    const wx=`WX${id}`;f.states.set(id,{order_type:1,status:8,refund_fee:amount,wx_order_id:wx});
    const result=await f.notify(attempt,{event:'xpay_refund_notify',safe:true,fields:`<MchRefundId>${id}</MchRefundId><WxRefundId>${wx}</WxRefundId><WxOrderId>WX${attempt}</WxOrderId><RefundFee>${amount}</RefundFee>`});assert.equal(result.status,200);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM enrollments').get().n,amount===40?1:0);
  }
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM virtual_refunds').get().n,3);assert.equal(f.db.prepare('SELECT refundFinal FROM virtual_payments WHERE id=?').get(attempt).refundFinal,1);
});

test('refund notification may query by WxRefundId and still confirms full refund from original left_fee',async t=>{
  const f=await setup(t),order=await f.order(),attempt=JSON.parse((await f.payment(order.id)).data.signData).outTradeNo;
  f.states.set(attempt,{status:4,left_fee:0});
  const wx='WX_ONLY_REFUND_001',merchant='MERCHANT_REFUND_001';f.states.set(wx,{order_id:merchant,order_type:1,status:8,refund_fee:100,wx_order_id:wx});
  const notified=await f.notify(attempt,{event:'xpay_refund_notify',fields:`<WxRefundId>${wx}</WxRefundId><RefundFee>100</RefundFee>`});assert.equal(notified.status,200);
  assert.ok(f.calls.queries.includes(wx));assert.equal(f.db.prepare('SELECT refundOrderId FROM virtual_refunds').get().refundOrderId,merchant);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM enrollments').get().n,0);
});
