import {cpSync,existsSync,mkdirSync,mkdtempSync,readdirSync,readFileSync,writeFileSync,statSync} from 'node:fs';
import {dirname,join,resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
if(!existsSync(join(root,'web/dist/index.html')))throw new Error('先运行 npm run build，或直接运行 npm run package:windows。');
const releaseDir=join(root,'.tmp','releases');mkdirSync(releaseDir,{recursive:true});
const stage=mkdtempSync(join(releaseDir,'stage-'));
const app=join(stage,'course-platform');mkdirSync(app);
const allowlist=['package.json','package-lock.json','README.md','DEPLOYMENT.md','server/app.js','server/database.js','server/index.js','server/package.json','server/sms.js','server/wechat.js','server/virtual-payment.js','server/vod.js','scripts/check-wechat-login.mjs','project.config.json','deploy/windows','web/dist'];
for(const name of allowlist){const target=join(app,name);mkdirSync(dirname(target),{recursive:true});cpSync(join(root,name),target,{recursive:true});}
cpSync(join(root,'deploy/windows/.env.example'),join(app,'.env.example'));
const entries=[];
function inspect(path){
  for(const item of readdirSync(path,{withFileTypes:true})){
    const child=join(path,item.name),name=relative(app,child).replaceAll('\\','/');
    if(item.isSymbolicLink())throw new Error('发布包不允许符号链接：'+name);
    if(item.isDirectory()){
      if(['node_modules','secrets','data','uploads','.git','.tmp'].includes(item.name))throw new Error('发布包包含非源码目录：'+name);
      inspect(child);
    }else{
      if(item.name==='.env'||(item.name.startsWith('.env.')&&item.name!=='.env.example')||/\.(pem|key|sqlite|db|log)$/i.test(item.name)||item.name==='project.private.config.json')throw new Error('发布包包含私有文件：'+name);
      entries.push(name);
    }
  }
}
inspect(app);
// Reject incomplete releases when a runtime module gains a new local dependency.
const checkedModules=new Set();
function inspectRuntimeModule(path){
  if(checkedModules.has(path))return;
  checkedModules.add(path);
  const source=readFileSync(path,'utf8');
  const localImports=/(?:\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?|\b(?:import|require)\s*\(\s*)(['"])(\.{1,2}\/[^'"]+)\1/g;
  for(const match of source.matchAll(localImports)){
    const target=resolve(dirname(path),match[2]),name=relative(app,target).replaceAll('\\','/');
    if(name.startsWith('../')||!existsSync(target)||!statSync(target).isFile())throw new Error('发布包缺少运行时模块：'+name+'（由 '+relative(app,path).replaceAll('\\','/')+' 引用，请更新 allowlist）');
    if(/\.(?:c?js|mjs)$/.test(target))inspectRuntimeModule(target);
  }
}
inspectRuntimeModule(join(app,'server/index.js'));
const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+Z$/,'Z');
const zip=join(releaseDir,`zhike-windows-${stamp}.zip`);
const result=spawnSync('tar.exe',['-a','-cf',zip,'-C',stage,'course-platform'],{encoding:'utf8',windowsHide:true});
if(result.error||result.status!==0)throw new Error('创建 ZIP 失败：'+(result.error?.message||result.stderr));
const checksum=createHash('sha256').update(readFileSync(zip)).digest('hex');
writeFileSync(zip+'.sha256',checksum+'  '+zip.split(/[\\/]/).at(-1)+'\n');
writeFileSync(zip+'.manifest.json',JSON.stringify({sha256:checksum,files:entries.sort()},null,2)+'\n');
console.log(`Windows 发布包：${zip}`);
console.log(`文件数：${entries.length}，压缩大小：${Math.ceil(statSync(zip).size/1024)} KB。已排除密钥、数据库和本机配置。`);
