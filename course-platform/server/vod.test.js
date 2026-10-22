import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createVodUploadSignature,signVodUrl,vodProvider,vodReference } from './vod.js';

const env={TENCENT_VOD_SECRET_ID:'fake-id',TENCENT_VOD_SECRET_KEY:'fake-api-secret',TENCENT_VOD_SUB_APP_ID:'1458910441',TENCENT_VOD_PLAYBACK_DOMAIN:'video.example.cn',TENCENT_VOD_URL_KEY:'testUrlKey123456',TENCENT_VOD_TRANSCODE_DEFINITION:'100230'};
const domain=()=>({Domain:'video.example.cn',DeployStatus:'Online',HTTPSConfig:{CertExpireTime:'2099-01-01T00:00:00Z'},UrlSignatureAuthPolicy:{Status:'Enabled',EncryptedKey:env.TENCENT_VOD_URL_KEY}});

test('VOD Key signature matches Tencent published example including IP limit and ordered parameters',()=>{
  const signed=signVodUrl({sourceUrl:'http://example.com/dir1/dir2/myVideo.mp4?old=discard',domain:'example.com',key:'24FEQmTzro4V5u3D5epW',expiresAt:1517400000000,nonce:'72d4cd1101',ipLimit:3});
  assert.equal(signed,'https://example.com/dir1/dir2/myVideo.mp4?t=5a71afc0&rlimit=3&us=72d4cd1101&sign=c5214f0d5961b13acd558b4957c4dfc5');
  assert.throws(()=>signVodUrl({sourceUrl:'https://example.com/video%2fother.mp4',domain:'example.com',key:'anything',expiresAt:Date.now()}));
});

test('administrator upload signature is scoped, single use and verifies the documented HMAC-SHA1 byte format',()=>{
  const output=createVodUploadSignature({secretId:'id',secretKey:'secret',subAppId:1458910441,sourceContext:'course-upload:nonce',nowSeconds:1000,random:123});
  const bytes=Buffer.from(output.signature,'base64'),original=bytes.subarray(20).toString(),params=new URLSearchParams(original);
  assert.deepEqual(bytes.subarray(0,20),createHmac('sha1','secret').update(original).digest());
  assert.equal(params.get('vodSubAppId'),'1458910441');assert.equal(params.get('sourceContext'),'course-upload:nonce');assert.equal(params.get('oneTimeValid'),'1');
  assert.equal(params.get('expireTime'),'1900');assert.equal(output.expiresAt,1900000);assert.equal(params.has('secretKey'),false);
});

test('missing VOD configuration fails closed and never calls cloud APIs',async()=>{
  const provider=vodProvider({}, {client:new Proxy({},{get(){throw Error('cloud API must not be reached');}})});
  assert.equal(provider.configured,false);assert.ok(provider.publicConfig.missing.includes('TENCENT_VOD_URL_KEY'));
  await assert.rejects(provider.uploadSignature('x'),{status:503});await assert.rejects(provider.describe('123'),{status:503});
  assert.equal(vodReference('vod:123'),'123');assert.equal(vodReference('vod:https://attacker.example'),null);
});

test('paid playback refuses unprotected aliases, mismatched signing keys, unready domains and expired HTTPS',async()=>{
  for(const domains of [[domain(),{Domain:'default.vod.example',DeployStatus:'Online',UrlSignatureAuthPolicy:{Status:'Disabled'}}],[{...domain(),UrlSignatureAuthPolicy:{Status:'Enabled',EncryptedKey:'other'}}],[{...domain(),DeployStatus:'Deploying'}],[{...domain(),HTTPSConfig:{CertExpireTime:'2020-01-01T00:00:00Z'}}]]) {
    const provider=vodProvider(env,{client:{async DescribeVodDomains(){return {DomainSet:domains,TotalCount:domains.length};}}});
    await assert.rejects(provider.playback({ready:true,sourceUrl:'https://video.example.cn/course/video.m3u8',format:'hls'}),{status:503});
  }
});

test('VOD ready requires the configured rendition and a normal video; direct signed playback never fetches video bytes',async()=>{
  const calls=[];let transcoded=false,forbidden=false;
  const provider=vodProvider(env,{client:{
    async DescribeMediaInfos(params){calls.push(['DescribeMediaInfos',params]);return {MediaInfoSet:[{FileId:'123',BasicInfo:{Status:forbidden?'Forbidden':'Normal',Category:'Video',Name:'课程',SourceInfo:{SourceContext:'owner'},MediaUrl:'https://video.example.cn/course/source.mp4'},MetaData:{Duration:60,Size:1000},TranscodeInfo:{TranscodeSet:transcoded?[{Definition:100230,Container:'hls',Url:'https://video.example.cn/course/video.m3u8'}]:[{Definition:100030,Container:'mp4',Url:'https://video.example.cn/course/other.mp4'}]}}]};},
    async DescribeVodDomains(params){calls.push(['DescribeVodDomains',params]);return {DomainSet:[domain()],TotalCount:1};},
    async ProcessMedia(params){calls.push(['ProcessMedia',params]);return {TaskId:'task-1'};},
    async DescribeTaskDetail(params){calls.push(['DescribeTaskDetail',params]);return {Status:'FINISH',ProcedureTask:{MediaProcessResultSet:[{Type:'Transcode',TranscodeTask:{Status:'FAIL',Input:{Definition:100230}}}]}};}
  }});
  assert.equal((await provider.describe('123')).ready,false);
  await assert.rejects(provider.playback(await provider.describe('123')),{status:409});
  assert.equal(await provider.transcode('123','upload-1'),'task-1');assert.equal((await provider.taskStatus('task-1')).status,'failed');
  transcoded=true;const media=await provider.describe('123');assert.equal(media.ready,true);assert.equal(media.format,'hls');
  const playback=await provider.playback(media,Date.now()+500000);
  assert.equal(playback.playbackProvider,'tencent-vod');assert.equal(playback.requiresAuthorizedDownload,false);assert.equal(playback.playbackAuth,'signed-url');assert.match(playback.url,/^https:\/\/video.example.cn\/course\/video.m3u8\?t=/);
  assert.ok(playback.expiresAt>Date.now()+490000);assert.ok(playback.expiresAt<Date.now()+501000);
  assert.ok(calls.every(([,params])=>params.SubAppId===1458910441));
  assert.equal(calls.find(([method])=>method==='ProcessMedia')[1].MediaProcessTask.TranscodeTaskSet[0].Definition,100230);
  forbidden=true;await assert.rejects(provider.describe('123'),{status:409});
});
