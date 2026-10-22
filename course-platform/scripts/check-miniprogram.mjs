import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=resolve('miniprogram');
const files=[];const visit=dir=>{for(const entry of readdirSync(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())visit(path);else files.push(path)}};visit(root);
let errors=0;const error=message=>{console.error(message);errors++};
for(const path of files){
 if(path.endsWith('.json')){try{const config=JSON.parse(readFileSync(path,'utf8'));for(const component of Object.values(config.usingComponents||{})){const base=component.startsWith('/')?join(root,component):resolve(dirname(path),component);if(!existsSync(base+'.js'))error(`组件不存在：${base}`)}}catch(e){error(`${path}: ${e.message}`)}}
 if(path.endsWith('.js')){const result=spawnSync(process.execPath,['--check',path],{encoding:'utf8'});if(result.status)error(result.stderr)}
}
const app=JSON.parse(readFileSync(join(root,'app.json'),'utf8'));
for(const page of app.pages){for(const extension of ['js','json','wxml','wxss'])if(!existsSync(join(root,`${page}.${extension}`)))error(`页面文件缺失：${page}.${extension}`)}
if(errors)process.exitCode=1;else console.log(`小程序静态检查通过：${app.pages.length} 个页面，JS 语法、JSON、组件及页面引用完整。此检查不替代微信开发者工具和真机编译。`);
