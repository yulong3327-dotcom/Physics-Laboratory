const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function harness(){
  const app={globalData:{apiBaseUrl:'https://course.example.cn',token:'account-a'}},transfers=[],removed=[];
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(__dirname+'/../../miniprogram/utils/api.js','utf8'),{module,getApp:()=>app,wx:{downloadFile(options){const task={options,aborted:false,abort(){this.aborted=true;},onProgressUpdate(callback){this.progress=callback;}};transfers.push(task);return task;},getFileSystemManager:()=>({unlink:options=>removed.push(options.filePath)})}});
  return {api:module.exports,app,transfers,removed};
}

test('protected media sends the captured token only to the configured origin and exposes transfer progress',async()=>{
  const h=harness(),progress=[];const transfer=h.api.downloadVideo('/api/media/video?signed=1',{token:'account-a',onProgress:value=>progress.push(value.progress)});
  assert.equal(h.transfers[0].options.url,'https://course.example.cn/api/media/video?signed=1');assert.equal(h.transfers[0].options.header.Authorization,'Bearer account-a');
  h.transfers[0].progress({progress:21});assert.deepEqual(progress,[21]);h.transfers[0].options.success({statusCode:200,tempFilePath:'wxfile://temporary'});
  assert.equal(await transfer.promise,'wxfile://temporary');
  const untrusted=h.api.downloadVideo('https://course.example.cn.attacker.test/private',{token:'account-a'});await assert.rejects(untrusted.promise,/地址未通过验证/);assert.equal(h.transfers.length,1);
});

test('rejected authorization and account changes discard the downloaded file',async()=>{
  for(const status of [401,403,200]){
    const h=harness(),transfer=h.api.downloadVideo('/api/media/video',{token:'account-a'});
    if(status===200)h.app.globalData.token='account-b';
    h.transfers[0].options.success({statusCode:status,tempFilePath:'wxfile://discarded'});
    await assert.rejects(transfer.promise,status===401?/登录已过期/:status===403?/购买课程/:/身份已变化/);assert.deepEqual(h.removed,['wxfile://discarded']);
  }
});

test('aborted media transfers reject once, abort the SDK task and remove a late file',async()=>{
  const h=harness(),progress=[],transfer=h.api.downloadVideo('/api/media/video',{token:'account-a',onProgress:value=>progress.push(value.progress)});
  const rejected=assert.rejects(transfer.promise,error=>error.cancelled===true);transfer.abort();transfer.abort();await rejected;
  h.transfers[0].progress({progress:100});h.transfers[0].options.success({statusCode:200,tempFilePath:'wxfile://late'});
  assert.equal(h.transfers[0].aborted,true);assert.deepEqual(progress,[]);assert.deepEqual(h.removed,['wxfile://late']);
});

test('media timeout leaves an actionable retry message',async()=>{
  const h=harness(),transfer=h.api.downloadVideo('/api/media/video',{token:'account-a'});h.transfers[0].options.fail({errMsg:'downloadFile:fail timeout'});await assert.rejects(transfer.promise,/加载超时/);
});
