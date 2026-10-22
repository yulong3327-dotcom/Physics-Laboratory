import 'dotenv/config';
import { createApp } from './app.js';

const {app,close,config}=createApp();
const port=Number(process.env.PORT||4310);
const server=app.listen(port,'0.0.0.0',()=>{
  console.log(`知课服务已启动：http://localhost:${port}`);
  console.log(config.demo?'当前为演示环境，登录、短信和付款演示均有明确标识。':'当前为生产环境，演示入口已禁用。');
});
function shutdown() {server.close(()=>{close();process.exit(0);});}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
