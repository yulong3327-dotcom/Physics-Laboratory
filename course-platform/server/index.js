import {config as loadEnv} from 'dotenv';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import { createApp } from './app.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
loadEnv({path:join(root,'.env'),quiet:true});
const env={...process.env};
for(const key of ['DATABASE_PATH','UPLOAD_DIR','WECHAT_PRIVATE_KEY_PATH','WECHAT_PLATFORM_CERT_PATH'])if(env[key])env[key]=resolve(root,env[key]);
const {app,close,config}=createApp({env});
const port=Number(env.PORT||4310);
const host=env.HOST||'0.0.0.0';
const server=app.listen(port,host,()=>{
  console.log(`玉龙AI优课服务已启动：http://${host==='0.0.0.0'?'localhost':host}:${port}`);
  console.log(config.demo?'当前为演示环境，登录、短信和付款演示均有明确标识。':'当前为真实服务模式，演示入口已禁用。');
  console.log(env.WECHAT_APP_ID&&env.WECHAT_APP_SECRET?'微信登录凭据已填写，实际有效性需通过微信联调确认。':'微信登录待配置：请在根 .env 填写 WECHAT_APP_ID 和 WECHAT_APP_SECRET。');
});
function shutdown() {server.close(()=>{close();process.exit(0);});}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
