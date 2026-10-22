# 腾讯云点播接入

管理员浏览器用 `vod-js-sdk-v6` 直传点播，API 只派发一次性上传签名及查询转码；学生播放器直接请求点播 CDN。原有本地视频课时保持兼容。

## 配置

在项目根 `.env` 设置以下变量，生产服务器需有同样配置。凭据不进入客户端、Git 或日志。

| 变量 | 含义 |
| --- | --- |
| `TENCENT_VOD_SECRET_ID`、`TENCENT_VOD_SECRET_KEY` | 专用 CAM API 凭据 |
| `TENCENT_VOD_SUB_APP_ID` | 点播应用 ID，非微信 AppID |
| `TENCENT_VOD_PLAYBACK_DOMAIN` | 已上线并有有效 HTTPS 证书的播放域名，仅主机名 |
| `TENCENT_VOD_URL_KEY` | 与播放域名 Key 防盗链一致的 8～40 位字母数字密钥 |
| `TENCENT_VOD_TRANSCODE_DEFINITION` | 推荐 `100230`，腾讯预置 H.264/AAC 720p HLS；`100220` 为 540p HLS |
| `TENCENT_VOD_URL_TTL_SECONDS` | 默认 3600 秒，限制 300～10800 秒，播放器在到期前刷新 |
| `TENCENT_VOD_REGION` | 默认 `ap-guangzhou` |
| `TENCENT_VOD_STORAGE_REGION` | 可选的点播存储区域，留空使用云端设置 |

CAM 凭据至少需要点播 `DescribeVodDomains`、`DescribeMediaInfos`、`ProcessMedia`、`DescribeTaskDetail` 及客户端上传相关权限。使用应用资源范围约束，勿用根账号密钥。

点播应用内**所有播放域名，包括默认域名**必须开启 Key 防盗链并部署完成，否则服务拒绝云上传/播放，以防替换域名绕过购买限制。播放域名签名密钥必须与 `.env` 一致。API 每分钟重新核验域名保护状态，媒体信息最多缓存 30 秒。腾讯文档注明防盗链部署约需 5 分钟，配置后仍需用实际媒体检查无签名链接、无签名 HLS 分片是否返回 403。

HLS 必须验收 CDN 返回的 m3u8 中子列表和分片具备有效签名，播放器直接请求 CDN。不可把一个仅保护 m3u8、公开 ts 的配置视为付费保护完成，也不可让 API 服务器代转发视频。签名 URL 为短期持有者凭证，限制最多 3 个 IP；课程退款或下架会阻止新签发，已签发 URL 在到期及腾讯额外的 300 秒容差之前仍可能有效。需要更强防复制时应另接 DRM。

## API 合同

以下 `/api/admin/` 接口全部要求管理员 Bearer token；学生不能请求上传签名。响应均不含私钥或原视频 URL。

- `GET /api/admin/vod/config`：配置状态、缺少的环境变量名称、应用 ID、播放域名、模板 ID。
- `POST /api/admin/vod/upload-signature`，JSON `{ "name": "课程.mp4" }`：返回 `{ uploadId, signature, expiresAt, subAppId, provider: "tencent-vod" }`。`expiresAt` 是毫秒时间戳，签名 15 分钟有效、仅可使用一次。
- `POST /api/admin/vod/media/confirm`，JSON `{ uploadId, fileId }`：查询腾讯的上传 `SourceContext`，与数据库上传随机凭证比较以确认归属；确认后发起指定模板转码。返回状态及 `videoUrl: "vod:<FileId>"`。上传成功不等于可播放。
- `GET /api/admin/vod/media/:fileId`：刷新上传/转码状态，返回 `{ uploadId, fileId, videoUrl, name, duration, size, status, ready, format, taskId, errorMessage }`。状态为 `processing`、`ready` 或 `failed`。
- `POST /api/admin/vod/media/:fileId/transcode`：仅失败的媒体可重试转码。

管理员保存课时仍使用原课时 API，`videoUrl` 填 `vod:<FileId>`。必须先通过本后台上传确认、属于当前点播应用、且指定模板转码就绪，保存才会成功。

学生 `GET /api/lessons/:id/play` 先校验课程发布/购买/试听权益，再返回：

```json
{
  "playbackProvider": "tencent-vod",
  "playbackAuth": "signed-url",
  "requiresAuthorizedDownload": false,
  "format": "hls",
  "url": "https://播放域名/视频路径/video.m3u8?t=...&rlimit=3&us=...&sign=...",
  "videoUrl": "与 url 相同",
  "expiresAt": 1790000000000,
  "refreshBeforeSeconds": 120,
  "progress": 0
}
```

无配置返回 503；未购买的学生返回 403，未登录返回 401；未转码完成返回 409。原有本地媒体路径继续按原鉴权协议运行。课程详情不会含学生可播放的 URL。

## 官方依据与验证

- [客户端上传签名](https://cloud.tencent.com/document/product/266/9221)：HMAC-SHA1 后拼接原文再 Base64，签名内指定点播应用、随机上传上下文、一次性开关。
- [Key 防盗链](https://cloud.tencent.com/document/product/266/14047)：`md5(KEY + Dir + t + exper + rlimit + us + whref + bkref + whreg + bkreg + uv)`。本实现不设置试看/地域/referer，保留到期时间、3 IP、随机标识；测试使用官方公布的固定签名向量，而非只与自身实现比较。
- [设置防盗链](https://cloud.tencent.com/document/product/266/33469)：控制台配置步骤及生效时间。
- [预置参数模板](https://cloud.tencent.com/document/product/266/33476)：100230 为 HLS 720p H.264/AAC。
- [官方 Node SDK](https://github.com/TencentCloud/tencentcloud-sdk-nodejs/tree/master/src/services/vod/v20180717)：查询媒体、域名配置及转码任务的参数和响应类型。服务端仅安装 `tencentcloud-sdk-nodejs-vod` 模块。

自动测试覆盖上传来源防伪、跨应用隔离、转码状态、未购买拦截、不泄露原地址、失效域名/证书/防盗链密钥拒绝播放及签名算法；真实云端鉴权、分片连播和 Android 仍需在配置好当前云账号后验收。
