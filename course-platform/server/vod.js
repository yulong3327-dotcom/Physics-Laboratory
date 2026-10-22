import { createHash, createHmac, randomBytes } from 'node:crypto';
import tencentcloud from 'tencentcloud-sdk-nodejs-vod';

// Tencent's documented VOD signatures (not the generic CDN A/B/C/D algorithms):
// https://cloud.tencent.com/document/product/266/9221
// https://cloud.tencent.com/document/product/266/14047
// API field definitions: TencentCloud/tencentcloud-sdk-nodejs, vod/v20180717.
export class VodError extends Error {
  constructor(status,message) {super(message);this.name='VodError';this.status=status;}
}
const positiveInteger=value=>/^\d+$/.test(String(value||'')) && Number.isSafeInteger(Number(value)) && Number(value)>0?Number(value):null;
export const vodFileId=value=>typeof value==='string' && /^\d{1,40}$/.test(value)?value:null;
export const vodReference=value=>typeof value==='string' && /^vod:\d{1,40}$/.test(value)?value.slice(4):null;

export function createVodUploadSignature({secretId,secretKey,subAppId,sourceContext,expiresSeconds=900,nowSeconds=Math.floor(Date.now()/1000),random=randomBytes(4).readUInt32BE(),storageRegion=''}) {
  const params={secretId,currentTimeStamp:nowSeconds,expireTime:nowSeconds+expiresSeconds,random,vodSubAppId:subAppId,sourceContext,oneTimeValid:1};
  if(storageRegion)params.storageRegion=storageRegion;
  const original=new URLSearchParams(Object.entries(params).map(([key,value])=>[key,String(value)])).toString();
  const signature=Buffer.concat([createHmac('sha1',secretKey).update(original).digest(),Buffer.from(original)]).toString('base64');
  return {signature,expiresAt:(nowSeconds+expiresSeconds)*1000};
}

export function signVodUrl({sourceUrl,domain,key,expiresAt,nonce=randomBytes(12).toString('hex'),ipLimit=3}) {
  let source;try{source=new URL(sourceUrl);}catch{throw new VodError(502,'云点播返回的视频地址无效');}
  if(!['https:','http:'].includes(source.protocol) || source.username || source.password || !/\.(?:m3u8|mp4)$/i.test(source.pathname) || /%(?:2f|5c)|\\/i.test(source.pathname))throw new VodError(502,'云点播视频格式或路径不受支持');
  const dir=source.pathname.slice(0,source.pathname.lastIndexOf('/')+1),t=Math.floor(expiresAt/1000).toString(16),rlimit=String(ipLimit),us=nonce;
  const sign=createHash('md5').update(key+dir+t+rlimit+us).digest('hex');
  return `https://${domain}${source.pathname}?${new URLSearchParams({t,rlimit,us,sign})}`;
}

export function vodProvider(env={},options={}) {
  const secretId=env.TENCENT_VOD_SECRET_ID||'',secretKey=env.TENCENT_VOD_SECRET_KEY||'',subAppId=positiveInteger(env.TENCENT_VOD_SUB_APP_ID);
  const domain=String(env.TENCENT_VOD_PLAYBACK_DOMAIN||'').toLowerCase().trim(),urlKey=env.TENCENT_VOD_URL_KEY||'';
  const definition=positiveInteger(env.TENCENT_VOD_TRANSCODE_DEFINITION);
  const validDomain=/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain);
  const validUrlKey=/^[a-zA-Z0-9]{8,40}$/.test(urlKey);
  const missing=[];
  if(!secretId)missing.push('TENCENT_VOD_SECRET_ID');if(!secretKey)missing.push('TENCENT_VOD_SECRET_KEY');
  if(!subAppId)missing.push('TENCENT_VOD_SUB_APP_ID');if(!definition)missing.push('TENCENT_VOD_TRANSCODE_DEFINITION');
  if(!validDomain)missing.push('TENCENT_VOD_PLAYBACK_DOMAIN');if(!validUrlKey)missing.push('TENCENT_VOD_URL_KEY');
  const configured=missing.length===0;
  const publicConfig={provider:'tencent-vod',configured,uploadConfigured:configured,playbackConfigured:configured,subAppId,playbackDomain:validDomain?domain:'',transcodeDefinition:definition,missing,uploadSignatureExpiresSeconds:900};
  const client=options.client||(secretId&&secretKey?new tencentcloud.vod.v20180717.Client({credential:{secretId,secretKey},region:env.TENCENT_VOD_REGION||'ap-guangzhou',profile:{httpProfile:{reqTimeout:15}}}):null);
  const ttl=positiveInteger(env.TENCENT_VOD_URL_TTL_SECONDS)||3600;
  const urlTtlSeconds=Math.min(10800,Math.max(300,ttl));
  const requireConfigured=()=>{if(!configured)throw new VodError(503,'腾讯云点播尚未配置完整，请联系管理员完成点播配置');};
  async function call(method,params) {
    requireConfigured();
    try{return await client[method]({...params,SubAppId:subAppId});}
    catch(error){if(error instanceof VodError)throw error;throw new VodError(502,'腾讯云点播服务暂时不可用，请稍后重试或检查云服务配置');}
  }
  let protectionExpires=0,protectionPromise;
  async function ensureProtection() {
    requireConfigured();if(Date.now()<protectionExpires)return;
    if(protectionPromise)return protectionPromise;
    protectionPromise=(async()=>{
      let offset=0,domains=[];
      do {
        const response=await call('DescribeVodDomains',{Limit:20,Offset:offset});
        if(!Array.isArray(response.DomainSet))throw new VodError(503,'无法验证云点播播放域名保护状态');
        domains.push(...response.DomainSet);offset+=response.DomainSet.length;
        if(offset>200 || (offset<Number(response.TotalCount)&&!response.DomainSet.length))throw new VodError(503,'云点播域名列表异常，请联系管理员');
        if(offset>=Number(response.TotalCount||0))break;
      }while(true);
      const selected=domains.find(item=>item.Domain?.toLowerCase()===domain);
      if(!selected || selected.DeployStatus!=='Online' || !selected.HTTPSConfig?.CertExpireTime || Date.parse(selected.HTTPSConfig.CertExpireTime)<=Date.now())throw new VodError(503,'云点播播放域名尚未就绪，需完成 HTTPS 和域名部署');
      // Every alias must require a signature. Otherwise changing the hostname of
      // a paid URL would bypass entitlement checks through a default VOD domain.
      if(domains.some(item=>item.UrlSignatureAuthPolicy?.Status!=='Enabled' || item.DeployStatus!=='Online'))throw new VodError(503,'云点播存在未启用 Key 防盗链或尚未部署的域名，暂不开放云视频上传和播放');
      if(selected.UrlSignatureAuthPolicy.EncryptedKey && selected.UrlSignatureAuthPolicy.EncryptedKey!==urlKey)throw new VodError(503,'云点播播放签名密钥与域名配置不一致');
      protectionExpires=Date.now()+60000;
    })();
    try{return await protectionPromise;}finally{protectionPromise=null;}
  }
  return {
    configured,subAppId,definition,publicConfig,ensureProtection,
    async uploadSignature(sourceContext) {await ensureProtection();return createVodUploadSignature({secretId,secretKey,subAppId,sourceContext,storageRegion:env.TENCENT_VOD_STORAGE_REGION||''});},
    async describe(fileId) {
      if(!vodFileId(fileId))throw new VodError(400,'云点播 FileId 无效');
      const result=await call('DescribeMediaInfos',{FileIds:[fileId],Filters:['basicInfo','metaData','transcodeInfo']});
      const media=result.MediaInfoSet?.find(item=>item.FileId===fileId);
      if(!media)throw new VodError(404,'云点播中尚未查到该视频，请稍后刷新');
      const basic=media.BasicInfo||{},meta=media.MetaData||{};
      if(basic.Category && basic.Category!=='Video')throw new VodError(400,'此云点播媒体不是视频文件');
      if(basic.Status!=='Normal')throw new VodError(409,'此云点播视频暂不可用或已被封禁');
      const rendition=media.TranscodeInfo?.TranscodeSet?.find(item=>item.Definition===definition && /^(?:hls|mp4)$/i.test(item.Container||'') && /\.(?:m3u8|mp4)(?:\?|$)/i.test(item.Url||''));
      return {fileId,sourceContext:basic.SourceInfo?.SourceContext||'',name:basic.Name||'课程视频',duration:Number(meta.Duration)||0,size:Number(meta.Size)||0,ready:Boolean(rendition),status:rendition?'ready':'processing',format:rendition?(rendition.Container.toLowerCase()==='hls'?'hls':'mp4'):null,sourceUrl:rendition?.Url||'',definition};
    },
    async transcode(fileId,uploadId) {
      const result=await call('ProcessMedia',{FileId:fileId,MediaProcessTask:{TranscodeTaskSet:[{Definition:definition}]},TasksNotifyMode:'None',SessionId:`course-${uploadId}`,SessionContext:uploadId});
      if(!result.TaskId)throw new VodError(502,'云点播未返回转码任务编号');return result.TaskId;
    },
    async taskStatus(taskId) {
      const result=await call('DescribeTaskDetail',{TaskId:taskId});
      const task=result.ProcedureTask?.MediaProcessResultSet?.find(item=>item.Type==='Transcode' && item.TranscodeTask?.Input?.Definition===definition)?.TranscodeTask;
      if(task?.Status==='FAIL' || result.Status==='ABORTED')return {status:'failed',message:'云点播转码失败，请检查原视频后重试'};
      if(result.Status==='FINISH' && task?.Status!=='SUCCESS')return {status:'failed',message:'云点播转码任务结束但未生成可播放视频，请重试'};
      return {status:'processing',progress:Number(task?.Progress)||0};
    },
    async playback(media,sessionExpires=Infinity) {
      await ensureProtection();if(!media.ready || !media.sourceUrl)throw new VodError(409,'视频正在云端转码，请稍后再试');
      const expiresAt=Math.min(Date.now()+urlTtlSeconds*1000,sessionExpires);
      if(expiresAt<=Date.now())throw new VodError(401,'登录已过期，请重新登录');
      return {url:signVodUrl({sourceUrl:media.sourceUrl,domain,key:urlKey,expiresAt}),expiresAt,format:media.format,playbackProvider:'tencent-vod',requiresAuthorizedDownload:false,playbackAuth:'signed-url',refreshBeforeSeconds:120};
    }
  };
}
