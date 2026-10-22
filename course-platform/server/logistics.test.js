import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { logisticsProvider, LogisticsError } from './logistics.js';

const config={LOGISTICS_PROVIDER:'kuaidi100',KUAIDI100_CUSTOMER:'test-customer',KUAIDI100_KEY:'test-server-key'};
const query={courierCode:'shunfeng',trackingNumber:'SF1234567890',phone:'13800138001'};
const result={status:'200',state:'3',com:'shunfeng',nu:'SF1234567890',data:[{ftime:'2026-10-23 12:00:00',context:'已签收',areaName:'广州市'}]};
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});

test('Kuaidi100 signs the actual form payload and sends recipient phone over the official HTTPS endpoint',async()=>{
  let request;
  const provider=logisticsProvider(config,{fetcher:async(url,options)=>{request={url,options};return json(result);}});
  const answer=await provider.query(query);
  assert.equal(request.url,'https://poll.kuaidi100.com/poll/query.do');assert.equal(request.options.method,'POST');assert.equal(request.options.redirect,'error');assert.ok(request.options.signal instanceof AbortSignal);
  const form=new URLSearchParams(request.options.body),param=form.get('param');
  assert.equal(form.get('customer'),config.KUAIDI100_CUSTOMER);assert.equal(form.get('sign'),createHash('md5').update(param+config.KUAIDI100_KEY+config.KUAIDI100_CUSTOMER).digest('hex').toUpperCase());
  assert.deepEqual(JSON.parse(param),{com:'shunfeng',num:'SF1234567890',phone:'13800138001',resultv2:'4',show:'0',order:'desc',lang:'zh'});
  assert.equal(answer.status,'3');assert.deepEqual(answer.events,[{time:'2026-10-23 12:00:00',context:'已签收',location:'广州市'}]);
  assert.doesNotMatch(JSON.stringify(answer),/test-customer|test-server-key|13800138001/);
  assert.deepEqual(provider.publicConfig().missing,[]);assert.doesNotMatch(JSON.stringify(provider.publicConfig()),/test-customer|test-server-key/);
});

test('Kuaidi100 cache coalesces concurrent queries and keys carrier, number and recipient phone independently',async()=>{
  let calls=0,timestamp=Date.parse('2026-10-23T00:00:00Z');
  const provider=logisticsProvider(config,{clock:()=>timestamp,fetcher:async(url,options)=>{calls++;await new Promise(resolve=>setTimeout(resolve,5));const param=JSON.parse(new URLSearchParams(options.body).get('param'));return json({...result,com:param.com,nu:param.num});}});
  const [first,second]=await Promise.all([provider.query(query),provider.query(query)]);assert.equal(calls,1);assert.deepEqual(first,second);
  first.events[0].context='client mutation';assert.equal((await provider.query(query)).events[0].context,'已签收');assert.equal(calls,1);
  await assert.rejects(provider.query({...query,phone:'13800138002'}),error=>error.status===429);assert.equal(calls,1);
  await provider.query({...query,trackingNumber:'SF1234567891'});await provider.query({...query,courierCode:'yuantong'});assert.equal(calls,3);
  timestamp+=5*60*1000;await provider.query(query);assert.equal(calls,3);
  timestamp+=25*60*1000;await provider.query({...query,phone:'13800138002'});assert.equal(calls,4);
  await assert.rejects(provider.query(query),error=>error.status===429);assert.equal(calls,4);
});

test('Kuaidi100 configuration, carrier and input errors fail before networking',async()=>{
  const fetcher=async()=>assert.fail('invalid or unconfigured queries cannot reach the network');
  const unconfigured=logisticsProvider({}, {fetcher});assert.equal(unconfigured.configured,false);assert.deepEqual(unconfigured.publicConfig().missing,['KUAIDI100_CUSTOMER','KUAIDI100_KEY']);
  await assert.rejects(unconfigured.query(query),error=>error.status===503&&error.code==='LOGISTICS_NOT_CONFIGURED');
  const provider=logisticsProvider(config,{fetcher});
  for(const input of [{...query,courierCode:'sf'},{...query,trackingNumber:'../../private'},{...query,phone:'123'}])await assert.rejects(provider.query(input),error=>error.status===400);
});

test('Kuaidi100 remote errors, malformed/bounded data and network failures never expose service secrets',async()=>{
  const sensitive=`${config.KUAIDI100_KEY} ${config.KUAIDI100_CUSTOMER} ${query.phone}`;
  for(const [payload,status] of [[{result:false,returnCode:'400',message:sensitive},503],[{status:'201',message:sensitive},502],[{status:'404',message:sensitive},502],[{...result,nu:'another-number'},502],[{...result,data:{}},502],[{...result,data:[{context:'missing timestamp'}]},502]]) {
    const provider=logisticsProvider(config,{fetcher:async()=>json(payload)});
    await assert.rejects(provider.query(query),error=>error instanceof LogisticsError&&error.status===status&&!error.message.includes(config.KUAIDI100_KEY)&&!error.message.includes(query.phone));
  }
  for(const fetcher of [async()=>{throw new Error(sensitive);},async()=>new Response('not-json'),async()=>new Response('x'.repeat(256*1024+1)),async()=>new Response('error',{status:500}),async()=>new Response('{}',{headers:{'content-length':String(256*1024+1)}})]) {
    const provider=logisticsProvider(config,{fetcher});await assert.rejects(provider.query(query),error=>error.status===502&&!error.message.includes(sensitive));
  }
  const reflected=logisticsProvider(config,{fetcher:async()=>json({...result,data:[{time:'2026-10-23',context:`example ${config.KUAIDI100_KEY} ${config.KUAIDI100_CUSTOMER}`}]})});
  assert.doesNotMatch(JSON.stringify(await reflected.query(query)),/test-customer|test-server-key/);
});

test('Kuaidi100 not-found is explicit, timeout is bounded, and failed queries retain the waybill cooldown',async()=>{
  const none=logisticsProvider(config,{fetcher:async()=>json({returnCode:'500',message:'upstream private text'})});
  const absent=await none.query(query);assert.equal(absent.status,'not_found');assert.deepEqual(absent.events,[]);assert.doesNotMatch(absent.message,/upstream/);
  const timed=logisticsProvider(config,{timeoutMs:10,fetcher:async()=>new Promise(()=>{})});await assert.rejects(timed.query(query),error=>error.status===504&&error.code==='LOGISTICS_TIMEOUT');
  let calls=0,timestamp=Date.parse('2026-10-23T00:00:00Z');const retry=logisticsProvider(config,{clock:()=>timestamp,fetcher:async()=>{calls++;if(calls===1)throw new Error('temporary');return json(result);}});
  await assert.rejects(retry.query(query));
  await assert.rejects(retry.query(query),error=>error.status===429);assert.equal(calls,1);
  await assert.rejects(retry.query({...query,phone:'13800138002'}),error=>error.status===429);assert.equal(calls,1);
  timestamp+=30*60*1000;assert.equal((await retry.query(query)).status,'3');assert.equal(calls,2);
});
