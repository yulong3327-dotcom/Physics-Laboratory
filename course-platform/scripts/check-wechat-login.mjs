import {existsSync,readFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'dotenv';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const envFile=join(root,'.env');
const env={...(existsSync(envFile)?parse(readFileSync(envFile)):{}),...process.env};
const expected=JSON.parse(readFileSync(join(root,'project.config.json'),'utf8')).appid;
const fail=message=>{console.error(message);process.exitCode=1;};
let ready=true;
for(const [valid,message] of [
  [env.WECHAT_APP_ID===expected,`WECHAT_APP_ID 必须与小程序项目一致：${expected}`],
  [Boolean(env.WECHAT_APP_SECRET&&!/replace|填写|your[-_]/i.test(env.WECHAT_APP_SECRET)),'请在项目根 .env 填写 WECHAT_APP_SECRET 并保存；密钥无需发送到聊天。'],
  [env.DEMO_MODE==='false','真实服务配置请设置 DEMO_MODE=false。'],
  [Boolean(env.ADMIN_PASSWORD?.length>=12&&env.ADMIN_PASSWORD!=='admin123456'&&!/replace/i.test(env.ADMIN_PASSWORD)),'ADMIN_PASSWORD 需要独立设置，至少 12 位。'],
  [Boolean(env.SESSION_SECRET?.length>=32&&!env.SESSION_SECRET.startsWith('replace-')),'SESSION_SECRET 需要随机生成，至少 32 位。']
])if(!valid){fail(message);ready=false;}
if(ready)console.log('本地微信登录配置检查通过；AppID 匹配，演示模式关闭，凭据内容不会输出。');

if(ready&&process.argv.includes('--verify')){
  try{
    const response=await fetch('https://api.weixin.qq.com/cgi-bin/stable_token',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({grant_type:'client_credential',appid:env.WECHAT_APP_ID,secret:env.WECHAT_APP_SECRET,force_refresh:false}),
      signal:AbortSignal.timeout(15000)
    });
    const result=await response.json();
    const code=Number(result.errcode||0);
    if(response.ok&&!code&&typeof result.access_token==='string'&&result.access_token){
      console.log('微信官方凭据验证通过：AppID/AppSecret 可用。验证响应中的 access_token 不显示、不写入文件。');
      console.log('下一步：重启后端，在微信开发者工具点击微信认证登录，验证实际身份和登录状态。');
    }else{
      const hints={40013:'AppID 无效，请核对公众平台的小程序 AppID。',40125:'AppSecret 不正确，请在本机重新填写。',40001:'凭据无效，请核对 AppID/AppSecret 是否属于同一小程序。',40164:'当前后端出口 IP 未加入微信 IP 白名单，请到公众平台开发设置添加。',45009:'微信接口调用频率已达限制，请稍后重试。',89503:'微信接口需要管理员确认，请登录公众平台处理。'};
      let hint=hints[code]||'微信未通过凭据验证，请在公众平台检查账号状态、接口权限与 IP 白名单。';
      if(code===40164){const ip=String(result.errmsg||'').match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);if(ip)hint+=' 当前出口 IPv4：'+ip[0];}
      fail(`微信凭据验证失败（错误码 ${code||response.status}）：${hint}`);
    }
  }catch{fail('无法完成微信官方验证：网络连接超时或响应异常，请检查本机能否访问 api.weixin.qq.com。');}
}else if(ready){console.log('运行 npm run check:wechat -- --verify 可向微信验证凭据；此操作不发送短信、不发起付款。');}
