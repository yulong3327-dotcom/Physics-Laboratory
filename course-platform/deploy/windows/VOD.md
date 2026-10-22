# 腾讯云点播与 CDN 部署

本方案让管理后台把视频直接上传至腾讯云点播，服务器负责课程、购买权限与短期播放签名。视频播放流量由点播分发域名承担，不再占用课程服务器的公网出口。已有服务器视频继续兼容，不会自动迁移或自动回退。

## CAM 服务子用户的最小权限

为后端创建专用的编程访问子用户，只绑定下列自定义策略，不授予 `AdministratorAccess`、`QcloudVODFullAccess` 或通用 COS/CDN 管理权限。该用户不需要控制台登录。

当前点播应用为 `1458910441`，主账号 UIN 为 `100051068356`。策略限定该点播应用内的六个 API：

```json
{
  "version": "2.0",
  "statement": [
    {
      "effect": "allow",
      "action": [
        "name/vod:ApplyUpload",
        "name/vod:CommitUpload",
        "name/vod:DescribeMediaInfos",
        "name/vod:ProcessMedia",
        "name/vod:DescribeTaskDetail",
        "name/vod:DescribeVodDomains"
      ],
      "resource": [
        "qcs::vod::uin/100051068356:subAppId/1458910441"
      ]
    }
  ]
}
```

| API | 用途 |
| --- | --- |
| ApplyUpload、CommitUpload | 官方 Web SDK 申请及确认直传上传，授权由服务器签发的短期上传签名携带 |
| DescribeMediaInfos | 确认上传来源、视频元信息与转码产物 |
| ProcessMedia | 发起指定模板转码，以及管理员主动重试 |
| DescribeTaskDetail | 查询转码进度与失败状态 |
| DescribeVodDomains | 检查播放域名、HTTPS、Key 防盗链是否就绪 |

点播 CAM 的资源粒度是应用（subAppId），不支持进一步限制到某个视频 FileId 或域名。六个 API 均可按应用授权，不需要将资源写为 `*`。点播文档列出的资源级授权例外只有 `DescribeSubAppIds` 与 `ModifySubAppIdStatus`；本服务不调用二者。

`ProcessMedia` 在 CAM 的这一粒度下可以处理该应用内的媒体，无法在上述策略内按课时、特定转码模板或 FileId 进一步收窄。本平台另外在管理 API 中校验上传租约与视频归属。云控制台的建应用、建模板、配置域名、部署证书等操作由管理人员完成，服务子用户没有这些修改权限。

官方依据：

- [VOD CAM Overview](https://www.tencentcloud.com/document/product/266/33970)：明确资源粒度为 subapplication，列出两个例外 API，并规定资源格式 `qcs::vod::uin/$uin:subAppId/$subAppId`。该页 2026-05-19 更新。
- [VOD Custom Policy](https://www.tencentcloud.com/document/product/266/33972)：给出单应用资源、`name/vod:API名称`、版本 `2.0` 和 `statement` 的完整策略示例。
- [Web 端上传 SDK](https://cloud.tencent.com/document/product/266/9239)：官方 SDK、直传进度/取消，以及 ApplyUpload / CommitUpload 错误说明。

此处是按官方授权模型编写的最小权限策略；在当前账号实际创建与 API 授权联调完成前，不代表现网权限已经验证。

## 云点播控制台配置

1. 开通云点播并确认计费说明，进入应用 `1458910441`。确认该应用类型与 FileId 模式满足本平台上传/媒体查询需求。
2. 选择上传存储地域。创建 H.264/AAC、HLS（m3u8）转码模板；可先以 720p、约 1.5～2Mbps 作为课程内测规格，记下模板 ID。代码显式发起转码，不要求自动任务流。
3. 添加独立的视频播放自定义域名。例如可另选 `video.yulongchemistry.cn`，但本文件不代表此域名已经添加。按点播控制台给出的目标添加 CNAME，完成所属权/备案等云平台实际要求。
4. 为播放域名配置有效 HTTPS 证书，等待域名状态变为 Online。视频域名不要解析到课程服务器 IP。
5. 在该应用的**全部可播放域名**（包括默认分发域名和其他别名）启用点播 **Key 防盗链**。使用相同 KEY，避免替换主机名绕过购买权限。KEY 由控制台生成，保存到服务器私有 `.env`，不写入源码。
6. 配置 HLS 跨域响应，使网页课程播放器所在的域名能加载 m3u8 与分片；同时把实际播放域名按微信平台要求加入小程序合法域名。真机验证以微信后台最终校验结果为准。

点播 CDN 是点播播放域名的分发能力，本平台不需要再把课程服务器作为一个普通 CDN 回源站。存储、转码、分发流量按云点播实际计费；服务器升级不包含这些费用。

## Windows 服务器私有配置

仅修改服务器项目目录的 `.env`，并按现有服务部署方式重新启动 `ZhikeCourse`。保留数据库、上传文件、微信支付配置及已有密钥。

```dotenv
TENCENT_VOD_SECRET_ID=服务子用户SecretId
TENCENT_VOD_SECRET_KEY=服务子用户SecretKey
TENCENT_VOD_SUB_APP_ID=1458910441
TENCENT_VOD_REGION=ap-guangzhou
TENCENT_VOD_STORAGE_REGION=ap-guangzhou
TENCENT_VOD_TRANSCODE_DEFINITION=实际HLS转码模板ID
TENCENT_VOD_PLAYBACK_DOMAIN=实际视频播放域名
TENCENT_VOD_URL_KEY=与点播域名配置一致的KEY
TENCENT_VOD_URL_TTL_SECONDS=3600
```

`PLAYBACK_DOMAIN` 只填写域名，不带 `https://`、路径或端口。`TRANSCODE_DEFINITION` 填正整数模板 ID。签名 KEY 使用大小写字母与数字；建议采用 20 位，以同时符合官方文档参数表和注意事项中的长度范围。

不得把 SecretKey、KEY、上传签名、播放签名或管理员令牌写入公开日志、GitHub 或客户端配置。

## 上传与播放行为

- 后台「视频课时 → 添加课时」默认选择云点播直传。配置未完整时显示未就绪并阻止上传，不会悄悄改走服务器。
- 官方 `vod-js-sdk-v6` 从 API 领取一次性短期上传签名，浏览器文件直接进入点播存储；上传完成后由管理 API 确认媒体及归属。
- 后端按配置的模板发起转码；后台展示上传百分比、云端处理中/已就绪/失败。未就绪的视频不能保存到课时，失败可重试处理。
- 课时只保存 `vod:FileId` 引用，不把原始播放 URL 暴露给学生课程列表。
- 学生请求播放时，服务器先校验登录、课程购买状态或整节试看权限，再检查云端媒体与域名防护状态，最后签发短期 URL。
- VOD HLS 按分片边加载边播放，不经过旧的整段服务器视频下载流程。
- 点播签名按官方 `KEY + Dir + t + exper + rlimit + us + …` 规则计算；当前使用 `t`、`rlimit=3`、随机 `us`，覆盖媒体所在目录。不能用通用 CDN A/B/C/D 鉴权算法替代。
- 默认播放链接有效期一小时，限制在 5 分钟至 3 小时范围内，并受学生登录会话剩余有效时间限制。点播官方注明过期校验存在约 300 秒容差。
- 私有媒体、播放域名或配置检查失败时返回明确错误，不提供无签名播放地址。Key 防盗链是短期访问控制，并非 DRM，不能保证防录屏或撤销已缓冲的视频。

官方签名说明：[客户端上传签名](https://cloud.tencent.com/document/product/266/9221)、[点播 Key 防盗链](https://cloud.tencent.com/document/product/266/14047)。

## 未配置时的关闭行为

`GET /api/admin/vod/config` 仍返回配置状态及缺失项，便于管理员定位。VOD 签名、查询、转码、播放等能力在配置不完整时返回 `503`。即使静态字段已填写，上传/播放前还会核验域名 Online、HTTPS 证书有效及同应用全部分发域名启用 Key 防盗链；不符合即关闭相关能力。已有本地课时继续使用原有购买鉴权。

## 现网验证清单（待实际完成）

下列项目必须在云账号开通、CAM 密钥与域名配置完成、代码部署之后实际验证，不能用构建通过或模拟测试代替：

1. 最小策略子用户成功调用六个所需 API，且不能删除媒体、修改域名、访问其他应用。
2. 后台上传内测视频，浏览器网络确认视频内容直达云端；取消、断网重试、失败转码重试可用。
3. 云端 HLS 转码 ready 后才可保存课时，视频时长正确。
4. 未登录/未购买用户无法取得该收费课时的播放签名。
5. 已有授权的内测用户可在 Android 小程序与网页持续播放、拖动和续播，加载 m3u8 与分片，无整段视频等待。
6. 无签名、错误签名、过期签名，以及替换成默认分发域名访问均不能绕过校验；HTTPS/CORS 和小程序域名校验通过。
7. 长视频跨签名刷新时间点继续播放；退出登录、到期、退课等情况下新播放请求按权限处理。
8. 并发与流量测试确认视频出口来自点播分发，课程 API 在目标访问人数下响应正常。真实购买后解锁需另外完成微信实际支付验收。

此文档不声明云点播、CDN、真实支付或并发验收已上线通过；现网结果应补记到 `DEPLOYED.md`。
