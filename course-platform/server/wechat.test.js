import test from 'node:test';
import assert from 'node:assert/strict';
import { wechatProvider, WechatAuthError } from './wechat.js';

const config={WECHAT_APP_ID:'wx943a02ab275a1cbe',WECHAT_APP_SECRET:'test-secret-stays-on-server'};
const json=(data,status=200)=>({ok:status>=200 && status<300,status,async json(){return data;}});

test('WeChat login exchanges a fresh code on the official endpoint with a bounded request',async()=>{
  let request;
  const provider=wechatProvider(config,{fetch:async(url,options)=>{request={url:new URL(url),options};return json({openid:'official-openid',session_key:'server-only-session'});}});
  const identity=await provider.login('fresh-code');
  assert.equal(provider.appConfigured,true);assert.equal(identity.openid,'official-openid');
  assert.equal(request.url.origin,'https://api.weixin.qq.com');assert.equal(request.url.pathname,'/sns/jscode2session');
  assert.equal(request.url.searchParams.get('appid'),config.WECHAT_APP_ID);
  assert.equal(request.url.searchParams.get('secret'),config.WECHAT_APP_SECRET);
  assert.equal(request.url.searchParams.get('js_code'),'fresh-code');
  assert.equal(request.url.searchParams.get('grant_type'),'authorization_code');
  assert.ok(request.options.signal instanceof AbortSignal);
});

test('WeChat authorization maps actionable errors without echoing raw upstream secrets',async()=>{
  for(const [errcode,status,code] of [[40029,400,'WECHAT_CODE_INVALID'],[40163,400,'WECHAT_CODE_USED'],[40013,503,'WECHAT_CREDENTIALS_INVALID'],[40125,503,'WECHAT_CREDENTIALS_INVALID'],[40164,503,'WECHAT_IP_NOT_ALLOWED'],[45011,429,'WECHAT_RATE_LIMIT'],[-1,502,'WECHAT_UNAVAILABLE']]) {
    const provider=wechatProvider(config,{fetch:async()=>json({errcode,errmsg:`sensitive-secret=${config.WECHAT_APP_SECRET}`})});
    await assert.rejects(provider.login('fresh-code'),error=>{
      assert.ok(error instanceof WechatAuthError);assert.equal(error.status,status);assert.equal(error.code,code);
      assert.doesNotMatch(error.message,/test-secret|sensitive-secret|https/);return true;
    });
  }
});

test('WeChat authorization handles network, timeout, invalid JSON and malformed identities',async()=>{
  for(const name of ['TimeoutError','AbortError','TypeError']) {
    const provider=wechatProvider(config,{fetch:async()=>{throw Object.assign(new Error('secret request URL'),{name});}});
    await assert.rejects(provider.login('fresh-code'),error=>error.status===(name==='TypeError'?502:504) && !error.message.includes('secret'));
  }
  for(const result of [null,[],{}, {openid:{}},{openid:' space '},{openid:'x'.repeat(129)}]) {
    const provider=wechatProvider(config,{fetch:async()=>json(result)});
    await assert.rejects(provider.login('fresh-code'),error=>error.status===502);
  }
  const invalidJson=wechatProvider(config,{fetch:async()=>({ok:true,async json(){throw new SyntaxError('upstream response');}})});
  await assert.rejects(invalidJson.login('fresh-code'),error=>error.status===502);
  const notConfigured=wechatProvider({}, {fetch:async()=>assert.fail('unconfigured requests must not leave the server')});
  await assert.rejects(notConfigured.login('fresh-code'),error=>error.status===503);
});

test('WeChat phone authorization reuses access tokens and validates the returned phone and AppID',async()=>{
  const calls=[];
  const provider=wechatProvider(config,{fetch:async(url,options)=>{
    const parsed=new URL(url);calls.push({url:parsed,options});
    return parsed.pathname==='/cgi-bin/token'?json({access_token:'private-access-token',expires_in:7200}):json({errcode:0,phone_info:{purePhoneNumber:'13800138000',countryCode:'86',watermark:{appid:config.WECHAT_APP_ID}}});
  }});
  assert.equal(await provider.phone('phone-code-one'),'13800138000');
  assert.equal(await provider.phone('phone-code-two'),'13800138000');
  assert.equal(calls.filter(call=>call.url.pathname==='/cgi-bin/token').length,1);
  const firstPhone=calls[1];assert.equal(firstPhone.options.method,'POST');
  assert.equal(firstPhone.options.body,JSON.stringify({code:'phone-code-one'}));
  assert.equal(firstPhone.url.searchParams.get('access_token'),'private-access-token');
  for(const phone_info of [{purePhoneNumber:'not-a-phone'},{purePhoneNumber:13800138000},{purePhoneNumber:'13800138000',countryCode:'1'},{purePhoneNumber:'13800138000',watermark:{appid:'different-app'}},{}]) {
    const malformed=wechatProvider(config,{fetch:async url=>json(new URL(url).pathname==='/cgi-bin/token'?{access_token:'private-token',expires_in:7200}:{phone_info})});
    await assert.rejects(malformed.phone('phone-code'),error=>error.status===502);
  }
});

test('WeChat phone authorization refreshes an expired access token once without retrying consumed phone codes',async()=>{
  let tokens=0,phoneCalls=0;
  const provider=wechatProvider(config,{fetch:async url=>{
    if(new URL(url).pathname==='/cgi-bin/token') return json({access_token:`token-${++tokens}`,expires_in:7200});
    phoneCalls++;return phoneCalls===1?json({errcode:42001,errmsg:'access token expired'}):json({phone_info:{purePhoneNumber:'13800138000'}});
  }});
  assert.equal(await provider.phone('phone-code'),'13800138000');assert.equal(tokens,2);assert.equal(phoneCalls,2);
  let requests=0;
  const consumed=wechatProvider(config,{fetch:async url=>{requests++;return json(new URL(url).pathname==='/cgi-bin/token'?{access_token:'token',expires_in:7200}:{errcode:40163,errmsg:'code used'});}});
  await assert.rejects(consumed.phone('consumed-code'),error=>error.code==='WECHAT_CODE_USED');assert.equal(requests,2);
});
