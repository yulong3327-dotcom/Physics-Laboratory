import {existsSync,mkdtempSync,readdirSync,unlinkSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const project=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source=join(project,'miniprogram');
const installations=[
  process.env.WECHAT_DEVTOOLS_PATH,
  process.env['ProgramFiles(x86)']&&join(process.env['ProgramFiles(x86)'],'Tencent','微信web开发者工具'),
  process.env.ProgramFiles&&join(process.env.ProgramFiles,'Tencent','微信web开发者工具')
].filter(Boolean);
const compilerDir=installations.map(path=>join(path,'code','package.nw','node_modules','wcc-exec')).find(path=>existsSync(join(path,'wcc.exe'))&&existsSync(join(path,'wcsc.exe')));
if(!compilerDir){
  console.error('未找到微信开发者工具的 WCC/WCSC。请安装 Windows 版工具，或将 WECHAT_DEVTOOLS_PATH 设为工具安装目录。');
  process.exit(1);
}
const files=[];
function visit(path){for(const entry of readdirSync(path,{withFileTypes:true})){const child=join(path,entry.name);if(entry.isDirectory())visit(child);else files.push(child);}}
visit(source);
const output=mkdtempSync(join(tmpdir(),'zhike-wcc-'));
try{
  for(const [extension,executable] of [['wxml','wcc.exe'],['wxss','wcsc.exe']]){
    const inputs=files.filter(path=>path.endsWith('.'+extension)).map(path=>'./'+relative(source,path).replaceAll('\\','/'));
    if(!inputs.length)throw new Error(`没有找到 ${extension} 文件`);
    const result=spawnSync(join(compilerDir,executable),['-o',join(output,extension+'.js'),...inputs],{cwd:source,encoding:'utf8',timeout:60000,maxBuffer:2*1024*1024,windowsHide:true});
    if(result.error||result.status!==0)throw new Error(`${executable} 编译失败：${result.error?.message||result.stderr||result.stdout||'未知错误'}`);
    console.log(`微信 ${executable} 编译通过：${inputs.length} 个 ${extension.toUpperCase()} 文件。`);
  }
}catch(error){console.error(error.message);process.exitCode=1;}
finally{
  // This directory was created by this invocation and contains only compiler outputs.
  for(const name of ['wxml.js','wxss.js']){const file=join(output,name);if(existsSync(file))unlinkSync(file);}
  rmdirSync(output);
}
