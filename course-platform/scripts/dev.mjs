import {spawn} from 'node:child_process';
const processes=[spawn(process.execPath,['server/index.js'],{stdio:'inherit',env:process.env}),spawn(process.execPath,['node_modules/vite/bin/vite.js','--config','web/vite.config.js'],{stdio:'inherit'})];
const stop=()=>{for(const p of processes)p.kill()};
process.on('SIGINT',stop);process.on('SIGTERM',stop);
for(const p of processes)p.on('exit',code=>{if(code){stop();process.exitCode=code}});
