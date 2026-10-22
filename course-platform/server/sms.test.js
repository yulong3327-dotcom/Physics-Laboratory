import test from 'node:test';
import assert from 'node:assert/strict';
import { smsProvider } from './sms.js';

const config={SMS_PROVIDER:'tencent',TENCENT_SMS_SECRET_ID:'secret-id',TENCENT_SMS_SECRET_KEY:'secret-key',TENCENT_SMS_APP_ID:'1400000000',TENCENT_SMS_SIGN_NAME:'知课',TENCENT_SMS_TEMPLATE_ID:'123456',TENCENT_SMS_REGION:'ap-guangzhou'};

test('Tencent SMS adapter sends mainland phone, configured signature and one-time code',async()=>{
  let clientOptions,request;
  const sdk={sms:{v20210111:{Client:class{
    constructor(options){clientOptions=options;}
    async SendSms(value){request=value;return {SendStatusSet:[{Code:'Ok',SerialNo:'serial-1'}]};}
  }}}};
  const provider=smsProvider(config,{loadTencentSdk:async()=>sdk});
  assert.equal(provider.configured,true);
  assert.deepEqual(await provider.send('13800138000','123456'),{provider:'tencent',serialNumber:'serial-1'});
  assert.equal(clientOptions.credential.secretId,config.TENCENT_SMS_SECRET_ID);
  assert.equal(clientOptions.region,'ap-guangzhou');
  assert.deepEqual(request,{PhoneNumberSet:['+8613800138000'],SmsSdkAppId:'1400000000',SignName:'知课',TemplateId:'123456',TemplateParamSet:['123456']});
});

test('Tencent SMS adapter rejects provider-level delivery errors',async()=>{
  const sdk={sms:{v20210111:{Client:class{async SendSms(){return {SendStatusSet:[{Code:'LimitExceeded.PhoneNumberDailyLimit',Message:'daily limit'}]};}}}}};
  const provider=smsProvider(config,{loadTencentSdk:async()=>sdk});
  await assert.rejects(provider.send('13800138000','123456'),/daily limit/);
});
