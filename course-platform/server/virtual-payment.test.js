import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,createHash,createCipheriv,randomBytes} from 'node:crypto';
import {virtualPaymentProvider} from './virtual-payment.js';

const configuration={WECHAT_APP_ID:'wx1234567890abcdef',WECHAT_APP_SECRET:'test-app-secret',WECHAT_VIRTUAL_OFFER_ID:'1450688403',WECHAT_VIRTUAL_APP_KEY:'test-virtual-app-key',WECHAT_VIRTUAL_ENV:'0',WECHAT_MESSAGE_TOKEN:'test-message-token',WECHAT_MESSAGE_AES_KEY:Buffer.alloc(32,23).toString('base64').slice(0,-1)};
const payment={attemptId:'payment_attempt_0001',productId:'math_course',amount:29900,openid:'student_openid_001',sessionKey:'9hAb/NEYUlkaMBEsmFgzig==',attach:'{"courseId":"math_001"}'};
const digest=(key,value)=>createHmac('sha256',key).update(value).digest('hex');
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const tokenResponse=()=>response({access_token:'secret-access-token',expires_in:7200});
const querySignature=(encrypted)=>{
  const timestamp=String(Math.floor(Date.now()/1000)),nonce='test-nonce';
  const values=[configuration.WECHAT_MESSAGE_TOKEN,timestamp,nonce];if(encrypted!==undefined)values.push(encrypted);
  const signature=createHash('sha1').update(values.sort().join('')).digest('hex');
  return {timestamp,nonce,[encrypted===undefined?'signature':'msg_signature']:signature};
};
function encrypt(message,{appId=configuration.WECHAT_APP_ID,paddingByte}={}) {
  const key=Buffer.from(`${configuration.WECHAT_MESSAGE_AES_KEY}=`,'base64'),length=Buffer.alloc(4),body=Buffer.from(message);length.writeUInt32BE(body.length);
  const clear=Buffer.concat([randomBytes(16),length,body,Buffer.from(appId)]),padding=32-clear.length%32;
  const padded=Buffer.concat([clear,Buffer.alloc(padding,padding)]);if(paddingByte!==undefined)padded[padded.length-1]=paddingByte;
  const cipher=createCipheriv('aes-256-cbc',key,key.subarray(0,16));cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded),cipher.final()]).toString('base64');
}

test('virtual payment requires matching AppKey, app credentials and an explicit valid environment',()=>{
  assert.equal(virtualPaymentProvider({WECHAT_VIRTUAL_OFFER_ID:'1450688403'}).configured,false);
  for(const override of [{WECHAT_VIRTUAL_APP_KEY:''},{WECHAT_APP_SECRET:''},{WECHAT_VIRTUAL_ENV:'2'},{WECHAT_VIRTUAL_OFFER_ID:'invalid'}]) {
    const provider=virtualPaymentProvider({...configuration,...override});assert.equal(provider.configured,false);
    assert.throws(()=>provider.createPayment(payment),error=>error.status===503 && !error.message.includes(configuration.WECHAT_VIRTUAL_APP_KEY));
  }
  assert.equal(virtualPaymentProvider({...configuration,WECHAT_VIRTUAL_ENV:'1'}).envNumber,1);
});

test('direct purchase signs exact UTF-8 signData with distinct application and user session keys',()=>{
  const provider=virtualPaymentProvider(configuration),result=provider.createPayment(payment);
  assert.equal(provider.configured,true);assert.equal(result.mode,'short_series_goods');
  assert.deepEqual(JSON.parse(result.signData),{offerId:'1450688403',buyQuantity:1,env:0,currencyType:'CNY',productId:'math_course',goodsPrice:29900,outTradeNo:'payment_attempt_0001',attach:'{"courseId":"math_001"}'});
  assert.equal(result.paySig,digest(configuration.WECHAT_VIRTUAL_APP_KEY,`requestVirtualPayment&${result.signData}`));
  assert.equal(result.signature,digest(payment.sessionKey,result.signData));
  assert.notEqual(result.signature,digest(Buffer.from(payment.sessionKey,'base64'),result.signData),'WeChat signs with the session key string, not its decoded bytes');
  assert.doesNotMatch(JSON.stringify(result),/test-virtual-app-key|9hAb|test-app-secret|student_openid/);
  for(const invalid of [{attemptId:'_invalid_order'},{attemptId:'short'},{attemptId:'a'.repeat(33)},{amount:0},{amount:1.5},{amount:'29900'},{productId:''},{productId:'<xml>'},{attach:{}},{openid:'bad'},{sessionKey:''}])assert.throws(()=>provider.createPayment({...payment,...invalid}));
});

test('order lookup signs its actual JSON body and caches access tokens across concurrent requests',async()=>{
  const calls=[];
  const provider=virtualPaymentProvider(configuration,{fetch:async(url,options)=>{
    calls.push({url,options});if(url.includes('/cgi-bin/token'))return tokenResponse();
    return response({errcode:0,order:{order_id:payment.attemptId,status:2,order_fee:29900,paid_fee:29900,env_type:1,order_type:0}});
  }});
  const orders=await Promise.all([provider.queryOrder({openid:payment.openid,orderId:payment.attemptId}),provider.queryOrder({openid:payment.openid,orderId:payment.attemptId})]);
  assert.equal(calls.filter(call=>call.url.includes('/cgi-bin/token')).length,1);assert.equal(orders[0].status,2);
  const query=calls.find(call=>call.url.includes('/xpay/query_order')),url=new URL(query.url);
  assert.deepEqual(JSON.parse(query.options.body),{openid:payment.openid,env:0,order_id:payment.attemptId});
  assert.equal(url.searchParams.get('pay_sig'),digest(configuration.WECHAT_VIRTUAL_APP_KEY,`/xpay/query_order&${query.options.body}`));
  assert.equal(url.searchParams.get('access_token'),'secret-access-token');assert.equal(query.options.method,'POST');
});

test('expired upstream token is refreshed once without changing the signed order body',async()=>{
  let tokens=0,queries=0;const bodies=[];
  const provider=virtualPaymentProvider(configuration,{fetch:async(url,options)=>{
    if(url.includes('/cgi-bin/token')){tokens++;return tokenResponse();}
    queries++;bodies.push(options.body);if(queries===1)return response({errcode:42001,errmsg:'access token expired: secret-access-token'});
    return response({errcode:0,order:{order_id:payment.attemptId,status:1}});
  }});
  assert.equal((await provider.queryOrder({openid:payment.openid,orderId:payment.attemptId})).status,1);
  assert.equal(tokens,2);assert.equal(queries,2);assert.equal(bodies[0],bodies[1]);
});

test('query_order recognizes the observed never-created response without treating other parameter or upstream errors as absent',async()=>{
  for(const errmsg of ['数据不存在 rid: [redacted]','数据不存在 rid: diagnostic-request-001','数据不存在','order not exist']) {
    const provider=virtualPaymentProvider(configuration,{fetch:async(url)=>url.includes('/cgi-bin/token')?tokenResponse():response({errcode:268490002,errmsg})});
    await assert.rejects(provider.queryOrder({openid:payment.openid,orderId:payment.attemptId}),error=>error.status===404 && error.code==='WECHAT_VIRTUAL_ORDER_NOT_FOUND' && !error.message.includes('rid:'));
  }
  for(const [data,status] of [
    [{errcode:268490002,errmsg:'invalid parameters'},200],
    [{errcode:268490002,errmsg:'参数错误：数据不存在'},200],
    [{errcode:268490002,errmsg:'数据不存在，请检查商品配置'},200],
    [{errcode:268490003,errmsg:'数据不存在 rid: [redacted]'},200],
    [{errcode:-1,errmsg:'数据不存在 rid: [redacted]'},200],
    [{errcode:268490002,errmsg:'数据不存在 rid: [redacted]'},500],
  ]) {
    const provider=virtualPaymentProvider(configuration,{fetch:async(url)=>url.includes('/cgi-bin/token')?tokenResponse():response(data,status)});
    await assert.rejects(provider.queryOrder({openid:payment.openid,orderId:payment.attemptId}),error=>error.status===502 && error.code!=='WECHAT_VIRTUAL_ORDER_NOT_FOUND');
  }
});

test('never-created response recovery is restricted to query_order, excluding token and delivery APIs',async()=>{
  for(const errmsg of ['数据不存在 rid: [redacted]','order not exist']) {
    const absent={errcode:268490002,errmsg};
    const tokenFailure=virtualPaymentProvider(configuration,{fetch:async()=>response(absent)});
    await assert.rejects(tokenFailure.queryOrder({openid:payment.openid,orderId:payment.attemptId}),error=>error.status===502 && error.code!=='WECHAT_VIRTUAL_ORDER_NOT_FOUND');
    const deliveryFailure=virtualPaymentProvider(configuration,{fetch:async(url)=>url.includes('/cgi-bin/token')?tokenResponse():response(absent)});
    await assert.rejects(deliveryFailure.notifyDelivered({orderId:payment.attemptId}),error=>error.status===502 && error.code!=='WECHAT_VIRTUAL_ORDER_NOT_FOUND');
  }
});

test('delivery notification follows its documented no-openid, no-pay_sig API contract',async()=>{
  const calls=[];
  const provider=virtualPaymentProvider(configuration,{fetch:async(url,options)=>{
    calls.push({url,options});if(url.includes('/cgi-bin/token'))return tokenResponse();return new Response(null,{status:204});
  }});
  await provider.notifyDelivered({openid:payment.openid,orderId:payment.attemptId,wxOrderId:'wx-order-ignored'});
  await provider.notifyDelivered({wxOrderId:'wx-internal-order-001'});
  const requests=calls.filter(call=>call.url.includes('/xpay/notify_provide_goods'));
  assert.deepEqual(JSON.parse(requests[0].options.body),{env:0,order_id:payment.attemptId});
  assert.deepEqual(JSON.parse(requests[1].options.body),{env:0,wx_order_id:'wx-internal-order-001'});
  for(const request of requests)assert.equal(new URL(request.url).searchParams.has('pay_sig'),false);
});

test('upstream failures cannot expose app secrets, AppKey, token or raw request URLs',async()=>{
  const leaked=`${configuration.WECHAT_APP_SECRET}:${configuration.WECHAT_VIRTUAL_APP_KEY}:secret-access-token`;
  for(const upstream of [()=>response({errcode:268490003,errmsg:leaked}),()=>response({errcode:42001,errmsg:leaked}),()=>response({error:leaked},500),()=>new Response(leaked),()=>{throw new Error(leaked);}]) {
    const provider=virtualPaymentProvider(configuration,{fetch:async(url)=>url.includes('/cgi-bin/token')?tokenResponse():upstream()});
    await assert.rejects(provider.queryOrder({openid:payment.openid,orderId:payment.attemptId}),error=>error.status>=500 && !error.message.includes(leaked) && !error.stack.includes('secret-access-token'));
  }
});

test('plaintext message verification parses nested fields, CDATA and entities; verifies challenge',()=>{
  const provider=virtualPaymentProvider(configuration),query=querySignature();
  const xml='<xml><MsgType><![CDATA[event]]></MsgType><Event>xpay_goods_deliver_notify</Event><OpenId>student_openid_001</OpenId><GoodsInfo><ProductId>math_course</ProductId><Attach><![CDATA[{"name":"中文&说明"}]]></Attach><Quantity>1</Quantity></GoodsInfo><Escaped>&lt;a&gt;&amp;&#x4e2d;&#25991;</Escaped></xml>';
  assert.deepEqual(provider.verifyMessage(query,Buffer.from(xml)),{MsgType:'event',Event:'xpay_goods_deliver_notify',OpenId:'student_openid_001',GoodsInfo:{ProductId:'math_course',Attach:'{"name":"中文&说明"}',Quantity:'1'},Escaped:'<a>&中文'});
  assert.equal(provider.verifyChallenge({...query,echostr:'verification-challenge'}),'verification-challenge');
  assert.equal(provider.verifyMessage(query,'<xml><Attach><![CDATA[ value with spaces ]]></Attach></xml>').Attach,' value with spaces ');
  assert.throws(()=>provider.verifyMessage({...query,signature:'0'.repeat(40)},xml),error=>error.status===403);
  assert.throws(()=>provider.verifyMessage({...query,nonce:'tampered'},xml),error=>error.status===403);
  assert.throws(()=>provider.verifyMessage({...query,timestamp:'1000000000'},xml),error=>error.status===403);
});

test('AES message verification binds signature, validates AppID and decrypts handshake challenges',()=>{
  const provider=virtualPaymentProvider(configuration),xml='<xml><Event><![CDATA[xpay_goods_deliver_notify]]></Event><OutTradeNo>payment_attempt_0001</OutTradeNo><GoodsInfo><ActualPrice>29900</ActualPrice></GoodsInfo></xml>';
  const encrypted=encrypt(xml),query={...querySignature(encrypted),encrypt_type:'aes'};
  const envelope=`<xml><ToUserName>original-id</ToUserName><Encrypt><![CDATA[${encrypted}]]></Encrypt></xml>`;
  assert.deepEqual(provider.verifyMessage(query,envelope),{Event:'xpay_goods_deliver_notify',OutTradeNo:'payment_attempt_0001',GoodsInfo:{ActualPrice:'29900'}});
  const challenge=encrypt('safe-challenge');assert.equal(provider.verifyChallenge({...querySignature(challenge),encrypt_type:'aes',echostr:challenge}),'safe-challenge');
  assert.throws(()=>provider.verifyMessage({...query,msg_signature:'f'.repeat(40)},envelope),error=>error.status===403);
  for(const invalid of [encrypt(xml,{appId:'wx-incorrect-appid'}),encrypt(xml,{paddingByte:0}),'not-base64']) {
    assert.throws(()=>provider.verifyMessage({...querySignature(invalid),encrypt_type:'aes'},`<xml><Encrypt>${invalid}</Encrypt></xml>`),error=>error.status===403);
  }
});

test('message parser rejects malformed, ambiguous and entity-expanding XML',()=>{
  const provider=virtualPaymentProvider(configuration),query=querySignature();
  for(const xml of ['<!DOCTYPE xml [<!ENTITY attack SYSTEM "file:///private">]><xml><Event>&attack;</Event></xml>','<xml><Event>one</Event><Event>two</Event></xml>','<xml><Event attr="a">one</Event></xml>','<xml><Event>one</Wrong></xml>','<xml><Event>bad&invalid;</Event></xml>','<xml><Event>bad&unclosed</Event></xml>','<xml><constructor>danger</constructor></xml>','<xml><Event>text<Child>mixed</Child></Event></xml>','<xml><Event>one</Event></xml>trailing','<xml><Event><![CDATA[unclosed</Event></xml>','<xml>'+ '<A>'.repeat(18) +'value'+'</A>'.repeat(18)+'</xml>']) {
    assert.throws(()=>provider.verifyMessage(query,xml),error=>error.status===403,xml);
  }
  assert.throws(()=>virtualPaymentProvider({}).verifyChallenge({...query,echostr:'hello'}),error=>error.status===503);
  assert.throws(()=>provider.verifyMessage(query,Buffer.from([0xff,0xfe])),error=>error.status===403);
});
