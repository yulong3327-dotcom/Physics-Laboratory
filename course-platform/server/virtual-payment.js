import {createHash,createHmac,createDecipheriv,timingSafeEqual} from 'node:crypto';

// Official contracts (checked 2026-10-22):
// https://developers.weixin.qq.com/miniprogram/dev/api/payment/wx.requestVirtualPayment.html
// https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment.html
// https://developers.weixin.qq.com/miniprogram/dev/server/API/VirtualPayment/api_query_order.html
// https://developers.weixin.qq.com/miniprogram/dev/server/API/VirtualPayment/api_notify_provide_goods.html
export class VirtualPaymentError extends Error {
  constructor(status,message,code='WECHAT_VIRTUAL_UNAVAILABLE') {super(message);this.name='VirtualPaymentError';this.status=status;this.code=code;}
}
const fail=(status,message,code)=>new VirtualPaymentError(status,message,code);
const hmac=(key,value)=>createHmac('sha256',key).update(value,'utf8').digest('hex');
const safeEqual=(left,right)=>{
  if(typeof left!=='string' || typeof right!=='string')return false;
  const a=Buffer.from(left),b=Buffer.from(right);return a.length===b.length && timingSafeEqual(a,b);
};
const isObject=value=>value!==null && typeof value==='object' && !Array.isArray(value);
const validOrder=value=>typeof value==='string' && /^(?!_)[A-Za-z0-9_|*@-]{8,32}$/.test(value);
const validOpenid=value=>typeof value==='string' && /^[A-Za-z0-9_-]{6,128}$/.test(value);
const signatureError=()=>fail(403,'微信消息校验失败','WECHAT_MESSAGE_INVALID');

// A deliberately small XML grammar: nested elements and CDATA are supported,
// while DTDs, attributes, duplicate fields and mixed content are rejected.
// It never resolves external entities or builds objects from unchecked names.
function parseMessageXml(source) {
  if(typeof source!=='string' || Buffer.byteLength(source)>1024*1024)throw signatureError();
  let xml=source.trim().replace(/^<\?xml\s+[^?]*\?>\s*/,'');
  if(!xml || /<!DOCTYPE|<!ENTITY|<\?/i.test(xml))throw signatureError();
  let position=0,nodes=0;
  const decode=value=>value.replace(/&([^;\s]+);/g,(_,entity)=>{
    const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
    if(Object.hasOwn(named,entity))return named[entity];
    const match=entity.match(/^#(x[0-9a-f]+|[0-9]+)$/i);
    if(!match)throw signatureError();
    const point=match[1][0].toLowerCase()==='x'?parseInt(match[1].slice(1),16):Number(match[1]);
    if(!Number.isInteger(point) || point<=0 || point>0x10ffff || (point<32&&![9,10,13].includes(point)) || (point>=0xd800&&point<=0xdfff) || [0xfffe,0xffff].includes(point))throw signatureError();
    return String.fromCodePoint(point);
  });
  const skipSpace=()=>{while(/\s/.test(xml[position]||'') && position<xml.length)position++;};
  function element(depth) {
    if(depth>16 || ++nodes>512)throw signatureError();
    const opening=xml.slice(position).match(/^<([A-Za-z][A-Za-z0-9_]*)\s*(\/?)>/);
    if(!opening || ['__proto__','constructor','prototype'].includes(opening[1]))throw signatureError();
    const name=opening[1];position+=opening[0].length;
    if(opening[2])return {name,value:''};
    const children={};let text='',hasChildren=false;
    while(position<xml.length) {
      if(xml.startsWith('</',position)) {
        const closing=xml.slice(position).match(/^<\/([A-Za-z][A-Za-z0-9_]*)\s*>/);
        if(!closing || closing[1]!==name || (hasChildren&&text.trim()))throw signatureError();
        position+=closing[0].length;return {name,value:hasChildren?children:text};
      }
      if(xml.startsWith('<![CDATA[',position)) {
        const end=xml.indexOf(']]>',position+9);if(end===-1)throw signatureError();
        text+=xml.slice(position+9,end);position=end+3;continue;
      }
      if(xml[position]==='<') {
        const child=element(depth+1);if(Object.hasOwn(children,child.name))throw signatureError();
        children[child.name]=child.value;hasChildren=true;continue;
      }
      const end=xml.indexOf('<',position);if(end===-1)throw signatureError();
      const chunk=xml.slice(position,end);if(/&(?![^;\s]+;)/.test(chunk))throw signatureError();
      text+=decode(chunk);position=end;
    }
    throw signatureError();
  }
  skipSpace();const root=element(0);skipSpace();
  if(position!==xml.length || root.name!=='xml' || !isObject(root.value))throw signatureError();
  return root.value;
}

export function virtualPaymentProvider(config,{fetch:requestFetch=globalThis.fetch}={}) {
  const offerId=String(config.WECHAT_VIRTUAL_OFFER_ID||'').trim();
  const envText=String(config.WECHAT_VIRTUAL_ENV??'0').trim(),envNumber=/^[01]$/.test(envText)?Number(envText):null;
  const appKey=typeof config.WECHAT_VIRTUAL_APP_KEY==='string'?config.WECHAT_VIRTUAL_APP_KEY.trim():'';
  const configured=Boolean(config.WECHAT_APP_ID && config.WECHAT_APP_SECRET && /^\d+$/.test(offerId) && appKey && envNumber!==null);
  const messageToken=String(config.WECHAT_MESSAGE_TOKEN||'');
  let accessToken,tokenExpires=0,tokenPromise;
  const requireConfigured=()=>{if(!configured)throw fail(503,'微信虚拟支付尚未配置完整，请配置 OfferID、对应环境 AppKey、AppID 和 AppSecret','WECHAT_VIRTUAL_NOT_CONFIGURED');};

  async function requestJson(url,options={},allowEmpty=false,apiPath='') {
    let response,text,data;
    try {
      response=await requestFetch(url,{...options,signal:AbortSignal.timeout(15000)});
      text=await response.text();
      if(!text.trim() && allowEmpty && response.ok)return {};
      data=JSON.parse(text);
    }catch(error) {
      if(error?.name==='TimeoutError' || error?.name==='AbortError')throw fail(504,'微信虚拟支付服务请求超时，请稍后重试','WECHAT_VIRTUAL_TIMEOUT');
      throw fail(502,'微信虚拟支付服务暂时无法连接，请稍后重试','WECHAT_VIRTUAL_NETWORK');
    }
    if(!isObject(data))throw fail(502,'微信虚拟支付返回异常，请稍后重试');
    const code=Number(data.errcode??0);
    if(!Number.isSafeInteger(code))throw fail(502,'微信虚拟支付返回异常，请稍后重试');
    if([40001,40014,42001].includes(code))throw fail(502,'微信接口凭证已过期，请稍后重试','WECHAT_VIRTUAL_TOKEN_EXPIRED');
    if(code===268490009)throw fail(401,'微信登录态已过期，请重新使用微信登录','WECHAT_SESSION_EXPIRED');
    if(code===268490015 || code===45009)throw fail(429,'微信虚拟支付请求过于频繁，请稍后重试','WECHAT_VIRTUAL_RATE_LIMIT');
    // query_order uses the generic parameter code for a never-created order.
    // Match its observed absence message (with an optional diagnostic rid) only
    // on this API; the same code also covers real parameter errors.
    const message=String(data.errmsg||'').trim().toLowerCase();
    const missingOrder=/^(?:order(?:_not_exist|_not_found)|order (?:does not exist|not exist|not found)|订单不存在)[.!。]?$/.test(message) || /^数据不存在(?: rid: [^\r\n]+)?$/.test(message);
    if(apiPath==='/xpay/query_order' && response.ok && code===268490002 && missingOrder)throw fail(404,'微信支付订单尚未创建','WECHAT_VIRTUAL_ORDER_NOT_FOUND');
    // Upstream URLs/errmsg can contain credentials. Never expose either.
    if(!response.ok || code)throw fail(502,'微信虚拟支付服务返回错误，请稍后重试');
    return data;
  }
  async function getAccessToken() {
    if(accessToken && Date.now()<tokenExpires)return accessToken;
    if(tokenPromise)return tokenPromise;
    tokenPromise=(async()=>{
      const query=new URLSearchParams({grant_type:'client_credential',appid:config.WECHAT_APP_ID,secret:config.WECHAT_APP_SECRET});
      const data=await requestJson(`https://api.weixin.qq.com/cgi-bin/token?${query}`);
      const seconds=Number(data.expires_in);
      if(typeof data.access_token!=='string' || !data.access_token || !Number.isFinite(seconds) || seconds<=0)throw fail(502,'微信未返回有效的接口凭证，请稍后重试');
      accessToken=data.access_token;tokenExpires=Date.now()+(seconds>120?seconds-120:Math.max(1,seconds/2))*1000;
      return accessToken;
    })();
    try{return await tokenPromise;}finally{tokenPromise=undefined;}
  }
  async function callApi(path,payload,{paymentSignature=true,allowEmpty=false}={}) {
    requireConfigured();const body=JSON.stringify(payload);
    for(let attempt=0;attempt<2;attempt++) {
      const token=await getAccessToken();
      const query=new URLSearchParams({access_token:token});
      if(paymentSignature)query.set('pay_sig',hmac(appKey,`${path}&${body}`));
      try {
        return await requestJson(`https://api.weixin.qq.com${path}?${query}`,{method:'POST',headers:{'Content-Type':'application/json'},body},allowEmpty,path);
      }catch(error) {
        if(error.code!=='WECHAT_VIRTUAL_TOKEN_EXPIRED' || attempt===1)throw error;
        if(accessToken===token){accessToken=undefined;tokenExpires=0;}
      }
    }
  }
  function checkOrder(orderId,openid) {
    if(!validOrder(orderId))throw fail(400,'支付订单号格式无效','WECHAT_VIRTUAL_INPUT');
    if(openid!==undefined && !validOpenid(openid))throw fail(400,'请先使用微信登录','WECHAT_VIRTUAL_OPENID');
  }
  function verifySignature(query,encrypted) {
    if(!messageToken)throw fail(503,'微信消息接收尚未配置','WECHAT_MESSAGE_NOT_CONFIGURED');
    const {timestamp,nonce}=query||{},signature=encrypted===undefined?query?.signature:query?.msg_signature;
    if(typeof timestamp!=='string' || !/^\d{10}$/.test(timestamp) || Math.abs(Date.now()/1000-Number(timestamp))>600 || typeof nonce!=='string' || !nonce || nonce.length>256 || typeof signature!=='string' || !/^[a-f0-9]{40}$/i.test(signature))throw signatureError();
    const values=[messageToken,timestamp,nonce];if(encrypted!==undefined)values.push(encrypted);
    const expected=createHash('sha1').update(values.sort().join(''),'utf8').digest('hex');
    if(!safeEqual(signature.toLowerCase(),expected))throw signatureError();
  }
  function decryptMessage(ciphertext) {
    const encodingKey=String(config.WECHAT_MESSAGE_AES_KEY||'');
    if(!/^[A-Za-z0-9+/]{43}$/.test(encodingKey) || !config.WECHAT_APP_ID)throw fail(503,'微信安全消息接收尚未配置完整','WECHAT_MESSAGE_NOT_CONFIGURED');
    if(typeof ciphertext!=='string' || ciphertext.length>1500000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(ciphertext))throw signatureError();
    try {
      const key=Buffer.from(`${encodingKey}=`,'base64'),encrypted=Buffer.from(ciphertext,'base64');
      if(key.length!==32 || encrypted.length<32 || encrypted.length%16)throw signatureError();
      const decipher=createDecipheriv('aes-256-cbc',key,key.subarray(0,16));decipher.setAutoPadding(false);
      const padded=Buffer.concat([decipher.update(encrypted),decipher.final()]);
      const padding=padded.at(-1);
      if(!padding || padding>32 || padded.length<=padding || !padded.subarray(-padding).every(byte=>byte===padding))throw signatureError();
      const clear=padded.subarray(0,-padding);if(clear.length<21)throw signatureError();
      const length=clear.readUInt32BE(16);if(!length || length>clear.length-20)throw signatureError();
      const appId=clear.subarray(20+length).toString('utf8');
      if(!safeEqual(appId,String(config.WECHAT_APP_ID)))throw signatureError();
      return new TextDecoder('utf-8',{fatal:true}).decode(clear.subarray(20,20+length));
    }catch(error){if(error instanceof VirtualPaymentError)throw error;throw signatureError();}
  }
  return {
    configured,offerId,envNumber,messageConfigured:Boolean(messageToken),
    createPayment({attemptId,productId,amount,openid,sessionKey,attach=''}) {
      requireConfigured();checkOrder(attemptId,openid);
      if(typeof productId!=='string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(productId) || !Number.isSafeInteger(amount) || amount<=0 || amount>2147483647 || typeof attach!=='string' || Buffer.byteLength(attach)>1024)throw fail(400,'虚拟支付商品参数无效','WECHAT_VIRTUAL_INPUT');
      if(typeof sessionKey!=='string' || !sessionKey || sessionKey.length>512 || /\s/.test(sessionKey))throw fail(401,'微信登录态已过期，请重新使用微信登录','WECHAT_SESSION_EXPIRED');
      const signData=JSON.stringify({offerId,buyQuantity:1,env:envNumber,currencyType:'CNY',productId,goodsPrice:amount,outTradeNo:attemptId,attach});
      return {mode:'short_series_goods',signData,paySig:hmac(appKey,`requestVirtualPayment&${signData}`),signature:hmac(sessionKey,signData)};
    },
    async queryOrder({openid,orderId,wxOrderId}) {
      if(orderId!==undefined)checkOrder(orderId,openid);
      else if(typeof wxOrderId!=='string' || !/^[A-Za-z0-9_-]{1,128}$/.test(wxOrderId))throw fail(400,'支付订单号格式无效','WECHAT_VIRTUAL_INPUT');
      if(!validOpenid(openid))throw fail(400,'请先使用微信登录','WECHAT_VIRTUAL_OPENID');
      const data=await callApi('/xpay/query_order',{openid,env:envNumber,...(orderId!==undefined?{order_id:orderId}:{wx_order_id:wxOrderId})});
      if(!isObject(data.order))throw fail(502,'微信未返回有效的支付订单，请稍后重试');
      return data.order;
    },
    async notifyDelivered({orderId,wxOrderId}) {
      // Official API has no openid or pay_sig. order_id/wx_order_id are alternatives.
      const payload={env:envNumber};
      if(orderId!==undefined){checkOrder(orderId);payload.order_id=orderId;}
      else if(typeof wxOrderId==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(wxOrderId))payload.wx_order_id=wxOrderId;
      else throw fail(400,'缺少有效的支付订单号','WECHAT_VIRTUAL_INPUT');
      return callApi('/xpay/notify_provide_goods',payload,{paymentSignature:false,allowEmpty:true});
    },
    verifyMessage(query,rawBody) {
      let xml;
      try{xml=Buffer.isBuffer(rawBody)?new TextDecoder('utf-8',{fatal:true}).decode(rawBody):rawBody;}catch{throw signatureError();}
      const envelope=parseMessageXml(xml);
      if(Object.hasOwn(envelope,'Encrypt') || query?.encrypt_type==='aes') {
        if(typeof envelope.Encrypt!=='string' || !envelope.Encrypt)throw signatureError();
        verifySignature(query,envelope.Encrypt);const message=parseMessageXml(decryptMessage(envelope.Encrypt));Object.defineProperty(message,'bodyAuthenticated',{value:true});return message;
      }
      // Plain protocol does not bind the body. Always query the order before
      // granting access, even after this protocol signature is verified.
      if(query?.encrypt_type && query.encrypt_type!=='raw')throw signatureError();
      verifySignature(query);return envelope;
    },
    verifyChallenge(query) {
      if(typeof query?.echostr!=='string' || !query.echostr || query.echostr.length>1500000)throw signatureError();
      if(query.encrypt_type==='aes' || query.msg_signature) {verifySignature(query,query.echostr);return decryptMessage(query.echostr);}
      if(query.encrypt_type && query.encrypt_type!=='raw')throw signatureError();
      verifySignature(query);return query.echostr;
    },
  };
}
