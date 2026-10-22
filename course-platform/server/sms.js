export function smsProvider(config,{loadTencentSdk=()=>import('tencentcloud-sdk-nodejs-sms'),fetcher=(...args)=>fetch(...args)}={}){
  const tencent=Boolean(config.TENCENT_SMS_SECRET_ID&&config.TENCENT_SMS_SECRET_KEY&&config.TENCENT_SMS_APP_ID&&config.TENCENT_SMS_SIGN_NAME&&config.TENCENT_SMS_TEMPLATE_ID);
  const generic=Boolean(config.SMS_PROVIDER_URL&&config.SMS_PROVIDER_TOKEN);
  const provider=config.SMS_PROVIDER||'tencent';
  return {
    provider,
    configured:provider==='tencent'?tencent:provider==='http'?generic:false,
    async send(phone,code){
      if(provider==='tencent'){
        if(!tencent)throw new Error('腾讯云短信凭据未配置');
        const sdkModule=await loadTencentSdk();
        const sdk=sdkModule.default||sdkModule;
        const Client=sdk.sms.v20210111.Client;
        const client=new Client({credential:{secretId:config.TENCENT_SMS_SECRET_ID,secretKey:config.TENCENT_SMS_SECRET_KEY},region:config.TENCENT_SMS_REGION||'ap-guangzhou',profile:{httpProfile:{endpoint:'sms.tencentcloudapi.com'}}});
        const response=await client.SendSms({PhoneNumberSet:[`+86${phone}`],SmsSdkAppId:config.TENCENT_SMS_APP_ID,SignName:config.TENCENT_SMS_SIGN_NAME,TemplateId:config.TENCENT_SMS_TEMPLATE_ID,TemplateParamSet:[code]});
        const status=response.SendStatusSet?.[0];
        if(status?.Code!=='Ok')throw new Error(status?.Message||'腾讯云短信 API 拒绝发送');
        return {provider,serialNumber:status.SerialNo};
      }
      if(provider==='http'&&generic){
        const response=await fetcher(config.SMS_PROVIDER_URL,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.SMS_PROVIDER_TOKEN}`},body:JSON.stringify({phone,code,template:config.SMS_TEMPLATE||'login'}),signal:AbortSignal.timeout(12000)});
        if(!response.ok)throw new Error(`短信适配器返回 HTTP ${response.status}`);
        return {provider};
      }
      throw new Error('短信供应商配置不完整');
    }
  };
}
