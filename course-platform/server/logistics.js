import { createHash } from 'node:crypto';

// Codes use Kuaidi100's realtime-query API, not carrier display names.
export const supportedCarriers=Object.freeze([
  {code:'shunfeng',name:'顺丰速运'},
  {code:'jingdong',name:'京东物流'},
  {code:'zhongtong',name:'中通快递'},
  {code:'yuantong',name:'圆通速递'},
  {code:'shentong',name:'申通快递'},
  {code:'yunda',name:'韵达快递'},
  {code:'ems',name:'EMS'},
  {code:'youzhengguonei',name:'邮政快递包裹'},
  {code:'debangkuaidi',name:'德邦快递'},
  {code:'jtexpress',name:'极兔速递'}
].map(item=>Object.freeze(item)));
const codes=new Set(supportedCarriers.map(item=>item.code));
const endpoint='https://poll.kuaidi100.com/poll/query.do';
const maxResponseBytes=256*1024;
// The realtime API requires at least 30 minutes between queries for one waybill.
const cacheLifetime=30*60*1000;
const stateLabels={'0':'运输中','1':'已揽收','2':'物流异常','3':'已签收','4':'已退签','5':'派送中','6':'退回中','7':'转投中','8':'清关中','9':'拒签','10':'待清关','11':'清关中','12':'已清关','13':'清关异常','14':'收件人拒签'};

export class LogisticsError extends Error {
  constructor(status,code,message) {super(message);this.name='LogisticsError';this.status=status;this.code=code;}
}

async function readJson(response) {
  if(Number(response.headers?.get('content-length')||0)>maxResponseBytes)throw new LogisticsError(502,'LOGISTICS_RESPONSE_INVALID','物流服务返回的数据无效，请稍后重试');
  const chunks=[];let size=0;
  if(response.body?.getReader) {
    const reader=response.body.getReader();
    try {
      while(true) {
        const {done,value}=await reader.read();if(done)break;
        size+=value.byteLength;
        if(size>maxResponseBytes){await reader.cancel();throw new LogisticsError(502,'LOGISTICS_RESPONSE_INVALID','物流服务返回的数据无效，请稍后重试');}
        chunks.push(Buffer.from(value));
      }
    }finally{reader.releaseLock();}
  }else {
    const value=await response.text();size=Buffer.byteLength(value);
    if(size>maxResponseBytes)throw new LogisticsError(502,'LOGISTICS_RESPONSE_INVALID','物流服务返回的数据无效，请稍后重试');
    chunks.push(Buffer.from(value));
  }
  try {
    const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(!result || typeof result!=='object' || Array.isArray(result))throw new Error();
    return result;
  }catch{throw new LogisticsError(502,'LOGISTICS_RESPONSE_INVALID','物流服务返回的数据无效，请稍后重试');}
}

export function logisticsProvider(config,{fetcher=(...args)=>fetch(...args),clock=()=>Date.now(),timeoutMs=10000}={}) {
  const provider=config.LOGISTICS_PROVIDER||'kuaidi100';
  const missing=['KUAIDI100_CUSTOMER','KUAIDI100_KEY'].filter(name=>typeof config[name]!=='string' || !config[name].trim());
  if(provider!=='kuaidi100')missing.unshift('LOGISTICS_PROVIDER');
  const configured=missing.length===0;
  const cache=new Map(),inflight=new Map(),cooldowns=new Map();
  function safeText(value,max) {
    if(typeof value!=='string')return '';
    let result=value.replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,max);
    for(const secret of [config.KUAIDI100_KEY,config.KUAIDI100_CUSTOMER])if(secret)result=result.split(secret).join('[已隐藏]');
    return result;
  }
  async function queryRemote({courierCode,trackingNumber,phone}) {
    const param=JSON.stringify({com:courierCode,num:trackingNumber,phone,resultv2:'4',show:'0',order:'desc',lang:'zh'});
    const sign=createHash('md5').update(param+config.KUAIDI100_KEY+config.KUAIDI100_CUSTOMER,'utf8').digest('hex').toUpperCase();
    const controller=new AbortController();let timer;
    try {
      const result=await Promise.race([
        (async()=>{
          const response=await fetcher(endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({customer:config.KUAIDI100_CUSTOMER,sign,param}).toString(),signal:controller.signal,redirect:'error'});
          if(!response.ok)throw new LogisticsError(502,'LOGISTICS_UNAVAILABLE','物流查询服务暂时不可用，请稍后重试');
          return readJson(response);
        })(),
        new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new LogisticsError(504,'LOGISTICS_TIMEOUT','物流查询超时，请稍后重试'));},timeoutMs);})
      ]);
      const checkedAt=new Date(clock()).toISOString();
      if(String(result.status)==='200' && result.result!==false) {
        if(!Array.isArray(result.data) || result.data.length>500 || (result.com && result.com!==courierCode) || (result.nu && String(result.nu).toLowerCase()!==trackingNumber.toLowerCase()))throw new LogisticsError(502,'LOGISTICS_RESPONSE_INVALID','物流服务返回的数据与当前运单不匹配，请稍后重试');
        const events=result.data.map(item=>{
          if(!item || typeof item!=='object' || typeof item.context!=='string' || !(typeof item.ftime==='string' || typeof item.time==='string'))throw new LogisticsError(502,'LOGISTICS_RESPONSE_INVALID','物流服务返回的数据无效，请稍后重试');
          const location=safeText(item.areaName||item.location,200);
          return {time:safeText(item.ftime||item.time,50),context:safeText(item.context,1500),...(location?{location}:{})};
        });
        const status=/^\d{1,3}$/.test(String(result.state))?String(result.state):'unknown';
        return {configured:true,status,message:stateLabels[status]||'物流信息已更新',events,checkedAt,carrier:courierCode,trackingNumber};
      }
      const code=String(result.returnCode||result.status||'');
      if(code==='500')return {configured:true,status:'not_found',message:'快递公司暂未返回物流记录，请稍后查询',events:[],checkedAt,carrier:courierCode,trackingNumber};
      if(['400','503','600','601','700','701','702'].includes(code))throw new LogisticsError(503,'LOGISTICS_CONFIGURATION_INVALID','物流服务鉴权或查询额度异常，请联系管理员检查服务配置');
      if(['201','202'].includes(code))throw new LogisticsError(502,'LOGISTICS_WAYBILL_INVALID','快递公司暂不接受该运单，请联系管理员核对快递公司、单号及收件手机号');
      throw new LogisticsError(502,'LOGISTICS_UNAVAILABLE','物流查询服务暂时不可用，请稍后重试');
    }catch(error) {
      if(error instanceof LogisticsError)throw error;
      if(error?.name==='AbortError' || error?.name==='TimeoutError')throw new LogisticsError(504,'LOGISTICS_TIMEOUT','物流查询超时，请稍后重试');
      // Never expose upstream exception messages, signed form data or credentials.
      throw new LogisticsError(502,'LOGISTICS_UNAVAILABLE','物流查询服务暂时不可用，请稍后重试');
    }finally{clearTimeout(timer);}
  }
  return {
    provider,configured,
    supportedCarriers,
    validCarrier:code=>codes.has(code),
    publicConfig:()=>({provider,configured,missing:[...missing],supportedCarriers,cacheSeconds:cacheLifetime/1000}),
    async query({courierCode,trackingNumber,phone}) {
      if(!configured)throw new LogisticsError(503,'LOGISTICS_NOT_CONFIGURED','真实物流查询尚未配置，请联系管理员开通快递100并配置服务凭据');
      if(!codes.has(courierCode))throw new LogisticsError(400,'LOGISTICS_CARRIER_INVALID','请选择支持的快递公司');
      if(typeof trackingNumber!=='string' || !/^[a-zA-Z0-9-]{6,32}$/.test(trackingNumber))throw new LogisticsError(400,'LOGISTICS_WAYBILL_INVALID','快递单号须为 6 到 32 位字母、数字或减号');
      if(typeof phone!=='string' || !/^1[3-9]\d{9}$/.test(phone))throw new LogisticsError(400,'LOGISTICS_PHONE_INVALID','收件手机号无效，无法查询物流');
      const key=createHash('sha256').update(JSON.stringify([courierCode,trackingNumber.toUpperCase(),phone])).digest('hex');
      const cached=cache.get(key);
      if(cached && cached.expires>clock())return structuredClone(cached.value);
      if(inflight.has(key))return structuredClone(await inflight.get(key));
      // The upstream limit applies to the waybill, including failed queries and
      // retries with a changed recipient phone. Never share a phone-bound result.
      const waybillKey=createHash('sha256').update(JSON.stringify([courierCode,trackingNumber.toUpperCase()])).digest('hex');
      const nextQueryAt=cooldowns.get(waybillKey)||0;
      if(nextQueryAt>clock())throw new LogisticsError(429,'LOGISTICS_COOLDOWN',`该运单刚刚查询过，请约 ${Math.ceil((nextQueryAt-clock())/60000)} 分钟后重试`);
      for(const [item,expires] of cooldowns)if(expires<=clock())cooldowns.delete(item);
      if(cooldowns.size>=2000)throw new LogisticsError(429,'LOGISTICS_BUSY','物流查询繁忙，请稍后重试');
      cooldowns.set(waybillKey,clock()+cacheLifetime);
      const request=queryRemote({courierCode,trackingNumber,phone}).then(value=>{
        for(const [cacheKey,entry] of cache)if(entry.expires<=clock())cache.delete(cacheKey);
        if(cache.size>=2000)cache.delete(cache.keys().next().value);
        cache.set(key,{expires:clock()+cacheLifetime,value});return value;
      });
      inflight.set(key,request);
      try{return structuredClone(await request);}finally{inflight.delete(key);}
    }
  };
}
