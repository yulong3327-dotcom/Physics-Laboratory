import { createSign, createVerify, randomBytes, createDecipheriv } from 'node:crypto';
import { readFileSync } from 'node:fs';

export class WechatAuthError extends Error {
  constructor(status,message,code='WECHAT_UNAVAILABLE') {
    super(message);this.name='WechatAuthError';this.status=status;this.code=code;
  }
}

export const validWechatOpenid=value=>typeof value==='string' && /^[A-Za-z0-9_-]{6,128}$/.test(value);
const authError=(status,message,code)=>new WechatAuthError(status,message,code);

export function wechatProvider(config,{fetch:requestFetch=globalThis.fetch}={}) {
  let cachedToken, tokenExpires=0;
  const appConfigured=Boolean(config.WECHAT_APP_ID && config.WECHAT_APP_SECRET);
  const payConfigured=Boolean(appConfigured && config.WECHAT_MCH_ID && config.WECHAT_MCH_SERIAL_NO && config.WECHAT_PRIVATE_KEY_PATH && config.WECHAT_API_V3_KEY && config.WECHAT_PLATFORM_CERT_PATH && config.WECHAT_PLATFORM_SERIAL_NO && config.WECHAT_PAY_NOTIFY_URL);
  const jsonFetch=async (url,options={})=>{const response=await requestFetch(url,{...options,signal:AbortSignal.timeout(15000)});const data=await response.json();if(!response.ok || data.errcode) throw new Error(data.errmsg||data.message||'微信服务暂时不可用');return data;};
  // Never include WeChat's raw errmsg or request URL: both may contain credentials.
  const authFetch=async (url,options={})=>{
    let response,data;
    try {
      response=await requestFetch(url,{...options,signal:AbortSignal.timeout(15000)});
      data=await response.json();
    } catch(error) {
      if(error?.name==='TimeoutError' || error?.name==='AbortError') throw authError(504,'微信服务请求超时，请重新点击微信登录','WECHAT_TIMEOUT');
      throw authError(502,'无法连接微信服务，请检查服务器网络后重试','WECHAT_NETWORK');
    }
    if(!data || typeof data!=='object' || Array.isArray(data)) throw authError(502,'微信服务返回异常，请稍后重试');
    const code=Number(data.errcode||0);
    if(code===40029) throw authError(400,'微信授权凭证无效或已过期，请重新授权','WECHAT_CODE_INVALID');
    if(code===40163) throw authError(400,'微信授权凭证已使用，请重新授权','WECHAT_CODE_USED');
    if([40013,40001,40125,41002,41004].includes(code)) throw authError(503,'微信 AppID 或 AppSecret 无效，请管理员检查后端配置','WECHAT_CREDENTIALS_INVALID');
    if(code===40164) throw authError(503,'服务器公网 IP 未加入微信接口 IP 白名单，请管理员在微信后台配置','WECHAT_IP_NOT_ALLOWED');
    if([45009,45011].includes(code)) throw authError(429,'微信授权请求过于频繁，请稍后再试','WECHAT_RATE_LIMIT');
    if([40014,42001].includes(code)) throw authError(502,'微信接口访问凭证已过期，请重新授权','WECHAT_TOKEN_EXPIRED');
    if(!response.ok || code) throw authError(502,'微信服务暂时不可用，请稍后重试');
    return data;
  };
  const sign=text=>{const signer=createSign('RSA-SHA256');signer.update(text);return signer.sign(readFileSync(config.WECHAT_PRIVATE_KEY_PATH),'base64');};
  return {
    appConfigured,payConfigured,
    async login(code) {
      if(!appConfigured) throw authError(503,'尚未配置微信登录，请设置 WECHAT_APP_ID 和 WECHAT_APP_SECRET');
      if(typeof code!=='string' || !code.trim() || code.length>256 || /\s/.test(code)) throw authError(400,'微信登录凭证格式无效，请重新授权','WECHAT_CODE_INVALID');
      const query=new URLSearchParams({appid:config.WECHAT_APP_ID,secret:config.WECHAT_APP_SECRET,js_code:code,grant_type:'authorization_code'});
      const data=await authFetch(`https://api.weixin.qq.com/sns/jscode2session?${query}`);
      if(!validWechatOpenid(data.openid)) throw authError(502,'微信未返回有效的用户标识，请重新授权');
      return data;
    },
    async phone(phoneCode) {
      if(!appConfigured) throw authError(503,'尚未配置微信手机号授权');
      if(typeof phoneCode!=='string' || !phoneCode.trim() || phoneCode.length>512 || /\s/.test(phoneCode)) throw authError(400,'微信手机号授权凭证无效，请重新授权','WECHAT_CODE_INVALID');
      const getToken=async()=>{
        if(cachedToken && Date.now()<tokenExpires) return cachedToken;
        const query=new URLSearchParams({grant_type:'client_credential',appid:config.WECHAT_APP_ID,secret:config.WECHAT_APP_SECRET});
        const token=await authFetch(`https://api.weixin.qq.com/cgi-bin/token?${query}`);
        if(typeof token.access_token!=='string' || !token.access_token || !Number.isFinite(Number(token.expires_in)) || Number(token.expires_in)<=0) throw authError(502,'微信未返回有效的接口访问凭证，请稍后重试');
        cachedToken=token.access_token;tokenExpires=Date.now()+Math.max(0,Number(token.expires_in)-120)*1000;
        return cachedToken;
      };
      let data;
      for(let attempt=0;attempt<2;attempt++) {
        const token=await getToken();
        try {
          data=await authFetch(`https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${encodeURIComponent(token)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:phoneCode})});break;
        } catch(error) {
          if(error.code!=='WECHAT_TOKEN_EXPIRED' || attempt===1) throw error;
          cachedToken=undefined;tokenExpires=0;
        }
      }
      const phone=data.phone_info?.purePhoneNumber;
      if(typeof phone!=='string' || !/^1[3-9]\d{9}$/.test(phone) || (data.phone_info?.countryCode && String(data.phone_info.countryCode)!=='86') || (data.phone_info?.watermark?.appid && data.phone_info.watermark.appid!==config.WECHAT_APP_ID)) throw authError(502,'微信未返回有效的中国大陆手机号，请重新授权');
      return phone;
    },
    async createPayment(order,openid,title) {
      if(!payConfigured) throw new Error('微信支付尚未配置完整：需要商户号、商户证书序列号、私钥、API V3 密钥、平台证书及通知地址');
      if(!openid) throw new Error('请先使用微信登录后再使用微信支付');
      const path='/v3/pay/transactions/jsapi';
      const body=JSON.stringify({appid:config.WECHAT_APP_ID,mchid:config.WECHAT_MCH_ID,description:title.slice(0,120),out_trade_no:order.id,notify_url:config.WECHAT_PAY_NOTIFY_URL,amount:{total:order.amount,currency:'CNY'},payer:{openid}});
      const nonce=randomBytes(16).toString('hex'),timestamp=String(Math.floor(Date.now()/1000));
      const signature=sign(`POST\n${path}\n${timestamp}\n${nonce}\n${body}\n`);
      const authorization=`WECHATPAY2-SHA256-RSA2048 mchid="${config.WECHAT_MCH_ID}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${config.WECHAT_MCH_SERIAL_NO}",signature="${signature}"`;
      const data=await jsonFetch(`https://api.mch.weixin.qq.com${path}`,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json',Authorization:authorization},body});
      const payNonce=randomBytes(16).toString('hex'),timeStamp=String(Math.floor(Date.now()/1000)),pkg=`prepay_id=${data.prepay_id}`;
      return {timeStamp,nonceStr:payNonce,package:pkg,signType:'RSA',paySign:sign(`${config.WECHAT_APP_ID}\n${timeStamp}\n${payNonce}\n${pkg}\n`)};
    },
    async createNativePayment(order,title){
      if(!payConfigured)throw new Error('微信支付尚未配置完整：需要商户号、商户证书序列号、私钥、API V3 密钥、平台证书及通知地址');
      const path='/v3/pay/transactions/native';
      const body=JSON.stringify({appid:config.WECHAT_APP_ID,mchid:config.WECHAT_MCH_ID,description:title.slice(0,120),out_trade_no:order.id,notify_url:config.WECHAT_PAY_NOTIFY_URL,amount:{total:order.amount,currency:'CNY'}});
      const nonce=randomBytes(16).toString('hex'),timestamp=String(Math.floor(Date.now()/1000));
      const signature=sign(`POST\n${path}\n${timestamp}\n${nonce}\n${body}\n`);
      const authorization=`WECHATPAY2-SHA256-RSA2048 mchid="${config.WECHAT_MCH_ID}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${config.WECHAT_MCH_SERIAL_NO}",signature="${signature}"`;
      const data=await jsonFetch(`https://api.mch.weixin.qq.com${path}`,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json',Authorization:authorization},body});
      if(!data.code_url)throw new Error('微信支付未返回二维码链接');
      return {codeUrl:data.code_url};
    },
    async closePayment(order){
      if(!payConfigured)throw new Error('微信支付尚未配置完整');
      const path=`/v3/pay/transactions/out-trade-no/${encodeURIComponent(order.id)}/close`;
      const body=JSON.stringify({mchid:config.WECHAT_MCH_ID});
      const nonce=randomBytes(16).toString('hex'),timestamp=String(Math.floor(Date.now()/1000));
      const signature=sign(`POST\n${path}\n${timestamp}\n${nonce}\n${body}\n`);
      const authorization=`WECHATPAY2-SHA256-RSA2048 mchid="${config.WECHAT_MCH_ID}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${config.WECHAT_MCH_SERIAL_NO}",signature="${signature}"`;
      const response=await requestFetch(`https://api.mch.weixin.qq.com${path}`,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json',Authorization:authorization},body,signal:AbortSignal.timeout(15000)});
      if(response.status===204)return {closed:true};
      const data=await response.json().catch(()=>({}));
      if(['ORDER_NOT_EXIST','ORDER_CLOSED'].includes(data.code))return {closed:true};
      if(!response.ok)throw new Error(data.message||'微信支付订单关闭失败');
      return {closed:true};
    },
    verifyNotification(headers,rawBody) {
      if(!payConfigured) throw new Error('微信支付未配置');
      const timestamp=headers['wechatpay-timestamp'],nonce=headers['wechatpay-nonce'],signature=headers['wechatpay-signature'],serial=headers['wechatpay-serial'];
      if(!timestamp || !nonce || !signature || serial!==config.WECHAT_PLATFORM_SERIAL_NO || Math.abs(Date.now()/1000-Number(timestamp))>300) throw new Error('支付通知签名头无效');
      const verifier=createVerify('RSA-SHA256');verifier.update(`${timestamp}\n${nonce}\n${rawBody}\n`);
      if(!verifier.verify(readFileSync(config.WECHAT_PLATFORM_CERT_PATH),signature,'base64')) throw new Error('支付通知验签失败');
      const envelope=JSON.parse(rawBody);
      if(envelope.event_type!=='TRANSACTION.SUCCESS' || envelope.resource?.algorithm!=='AEAD_AES_256_GCM') throw new Error('不支持的支付通知');
      const resource=envelope.resource,ciphertext=Buffer.from(resource.ciphertext,'base64');
      const decipher=createDecipheriv('aes-256-gcm',Buffer.from(config.WECHAT_API_V3_KEY),Buffer.from(resource.nonce));
      decipher.setAuthTag(ciphertext.subarray(-16));decipher.setAAD(Buffer.from(resource.associated_data||''));
      const plaintext=Buffer.concat([decipher.update(ciphertext.subarray(0,-16)),decipher.final()]);
      return JSON.parse(plaintext.toString('utf8'));
    },
  };
}
