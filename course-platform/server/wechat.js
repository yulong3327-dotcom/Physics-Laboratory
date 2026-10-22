import { createSign, createVerify, randomBytes, createDecipheriv } from 'node:crypto';
import { readFileSync } from 'node:fs';

export function wechatProvider(config) {
  let cachedToken, tokenExpires=0;
  const appConfigured=Boolean(config.WECHAT_APP_ID && config.WECHAT_APP_SECRET);
  const payConfigured=Boolean(appConfigured && config.WECHAT_MCH_ID && config.WECHAT_MCH_SERIAL_NO && config.WECHAT_PRIVATE_KEY_PATH && config.WECHAT_API_V3_KEY && config.WECHAT_PLATFORM_CERT_PATH && config.WECHAT_PLATFORM_SERIAL_NO && config.WECHAT_PAY_NOTIFY_URL);
  const jsonFetch=async (url,options={})=>{const response=await fetch(url,{...options,signal:AbortSignal.timeout(15000)});const data=await response.json();if(!response.ok || data.errcode) throw new Error(data.errmsg||data.message||'微信服务暂时不可用');return data;};
  const sign=text=>{const signer=createSign('RSA-SHA256');signer.update(text);return signer.sign(readFileSync(config.WECHAT_PRIVATE_KEY_PATH),'base64');};
  return {
    appConfigured,payConfigured,
    async login(code) {
      if(!appConfigured) throw new Error('尚未配置微信登录，请设置 WECHAT_APP_ID 和 WECHAT_APP_SECRET');
      const query=new URLSearchParams({appid:config.WECHAT_APP_ID,secret:config.WECHAT_APP_SECRET,js_code:code,grant_type:'authorization_code'});
      const data=await jsonFetch(`https://api.weixin.qq.com/sns/jscode2session?${query}`);
      if(!data.openid) throw new Error('微信登录凭证无效');
      return data;
    },
    async phone(phoneCode) {
      if(!appConfigured) throw new Error('尚未配置微信手机号授权');
      if(!cachedToken || Date.now()>tokenExpires) {
        const query=new URLSearchParams({grant_type:'client_credential',appid:config.WECHAT_APP_ID,secret:config.WECHAT_APP_SECRET});
        const token=await jsonFetch(`https://api.weixin.qq.com/cgi-bin/token?${query}`);
        cachedToken=token.access_token;tokenExpires=Date.now()+(token.expires_in-120)*1000;
      }
      const data=await jsonFetch(`https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${encodeURIComponent(cachedToken)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:phoneCode})});
      return data.phone_info?.purePhoneNumber;
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
      const response=await fetch(`https://api.mch.weixin.qq.com${path}`,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json',Authorization:authorization},body,signal:AbortSignal.timeout(15000)});
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
