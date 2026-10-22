# 生产部署

用户当前服务器为 Windows Server，域名与配置参数见 [Windows Server 部署准备](deploy/windows/README.md)。以下 Docker Compose 方案适用于 Linux 服务器。

生产环境以 Docker Compose 运行 API、学生网页和管理后台。SQLite 数据库及上传文件共同保存在 `course-data` 卷中，容器端口只绑定到服务器本机，由 HTTPS 反向代理对外提供服务。

## 前置条件

- Linux 服务器安装 Docker Engine 和 Docker Compose 插件。
- 一个 DNS A/AAAA 记录指向服务器的公网地址，并能通过 80/443 端口完成 HTTPS 证书签发。
- 微信小程序账号已具备登录、手机号授权和支付所需资质，且课程业务类目已审核。
- 腾讯云短信应用、短信签名和验证码模板已审核；模板应包含一个验证码参数。
- 小程序虚拟支付需当前 AppID 已开通对应商品支付能力，并准备 OfferID、对应环境 AppKey。普通网页 Native / 小程序 JSAPI 支付另需微信支付商户、商户 API 私钥、平台证书和 32 字节 API V3 密钥。

## 配置

在服务器部署代码后，从 `.env.example` 创建 `.env`，设置以下项目。不要把 `.env`、私钥或腾讯云密钥提交到 GitHub。

```dotenv
NODE_ENV=production
DEMO_MODE=false
PORT=4310
TRUST_PROXY=1
ADMIN_USERNAME=your-admin-name
ADMIN_PASSWORD=replace-with-a-unique-password-of-at-least-12-characters
SESSION_SECRET=replace-with-a-random-secret-of-at-least-32-characters
PUBLIC_ORIGIN=https://你的域名
WECHAT_APP_ID=与根目录project.config.json相同的AppID
WECHAT_APP_SECRET=由小程序后台取得
TENCENT_SMS_SECRET_ID=由腾讯云生成
TENCENT_SMS_SECRET_KEY=由腾讯云生成
TENCENT_SMS_APP_ID=腾讯云短信应用ID
TENCENT_SMS_SIGN_NAME=已审核短信签名
TENCENT_SMS_TEMPLATE_ID=已审核验证码模板ID
# 小程序虚拟支付；首次内测使用沙箱环境及其 AppKey
WECHAT_VIRTUAL_OFFER_ID=当前小程序的OfferID
WECHAT_VIRTUAL_ENV=1
WECHAT_VIRTUAL_APP_KEY=与当前环境匹配的AppKey
WECHAT_MESSAGE_TOKEN=与微信消息推送设置一致的Token
WECHAT_MESSAGE_AES_KEY=微信消息推送的43位EncodingAESKey
# 以下普通商户支付仅在使用网页Native或小程序JSAPI时填写
WECHAT_MCH_ID=微信支付商户号
WECHAT_MCH_SERIAL_NO=商户API证书序列号
WECHAT_PRIVATE_KEY_PATH=/run/secrets/apiclient_key.pem
WECHAT_API_V3_KEY=微信支付APIv3密钥
WECHAT_PLATFORM_CERT_PATH=/run/secrets/wechatpay_platform.pem
WECHAT_PLATFORM_SERIAL_NO=微信支付平台证书序列号
WECHAT_PAY_NOTIFY_URL=https://你的域名/api/payments/wechat/notify
```

使用普通商户支付时，将商户私钥和微信支付平台证书放入服务器部署目录下的 `secrets/`，文件名与 `.env` 中的路径对应，并限制文件读取权限。虚拟支付使用服务端 AppKey，不依赖上述商户证书。绝不要将任何凭据写入镜像或提交到源码仓库。

配置域名的 HTTPS 反向代理，将流量转发到 `127.0.0.1:4310`，并保留 `Host`、`X-Forwarded-For`、`X-Forwarded-Proto` 请求头。此服务不自行签发 TLS 证书。

构建并启动：

```sh
docker compose up -d --build
docker compose ps
docker compose logs -f course-platform
```

健康检查地址为 `https://你的域名/api/health`。备份时同时保存 Docker 卷 `course-data`；卷内包含 SQLite 数据库和上传的课程文件。更新代码后再次运行 `docker compose up -d --build`。

## 微信小程序

开发者工具继续导入仓库根目录，保留根 `project.config.json` 的 AppID。将 `miniprogram/app.js` 的 `apiBaseUrl` 从本机地址改为 `https://你的域名`，然后在微信公众平台配置 request、downloadFile 和 uploadFile 合法域名。发布前在开发者工具编译并用真机分别验证微信登录、手机号授权、短信登录、课程购买、扫码支付和讲义下载。

小程序配置虚拟支付后调用 `wx.requestVirtualPayment`；普通商户模式调用 JSAPI，网页使用 Native 扫码。虚拟支付由服务端向微信查单，确认实际付款再开课；普通支付验证微信回调后开课。演示付款不用于生产验收。

发布前还需由运营方完成小程序隐私保护指引、服务类目、主体资质和用户协议。此仓库没有替运营方编写隐私政策，也没有包含任何真实平台凭据。

## 微信虚拟支付内测

当前虚拟支付适配器使用单次商品直购参数 `mode=short_series_goods`。先在当前 AppID 后台确认已开通此模式，商品规则、课程业务类目与所使用的支付能力一致。普通商户 JSAPI/Native 与此配置独立。

1. 在服务器现有 `.env` 中补齐 `WECHAT_VIRTUAL_OFFER_ID`、`WECHAT_VIRTUAL_ENV`、`WECHAT_VIRTUAL_APP_KEY`。`0` 为正式，`1` 为沙箱；AppKey 必须属于同一环境。密钥仅填在服务器，不能放进小程序源码或聊天记录。准备内测商品时先使用沙箱，真实小额支付另行用正式环境验收。
2. 在微信公众平台的消息推送设置填写 URL `https://course.yulongchemistry.cn/api/payments/wechat-virtual/notify`，并将同一 Token 和 EncodingAESKey 填入 `.env` 的 `WECHAT_MESSAGE_TOKEN`、`WECHAT_MESSAGE_AES_KEY`。配置安全模式时需要 43 位 EncodingAESKey；服务端同时支持明文和加密事件验签。该 URL 与普通支付的 `/api/payments/wechat/notify` 不同。
3. 重启服务；检查 `/api/config` 返回 `paymentMode: "wechat-virtual"`、`virtualPaymentConfigured: true`、`paymentEnabled: true`。这些字段仅说明配置完整，仍须真机付款验收。已有服务器的 `.env` 不会被安装脚本覆盖，升级时须自行补入新增变量。
4. 打开 `/admin`，以草稿新建课程，填写价格和对应的虚拟支付商品 ID，上传封面、商详图、真实视频及讲义。商品 ID、销售价格与微信商品配置保持一致；至少保留一节非试看课时用于验证，确认后发布。后台上传支持进度和取消，单文件上限 250 MB。付费视频优先直接上传；外部源只允许 `.env` 中 `VIDEO_REMOTE_HOSTS` 明确列出的 HTTPS 域名，并经服务端鉴权代理。
5. 用未购学生账号打开商详，确认非试看课时和讲义被锁定；直接请求播放接口、复制其他账号的媒体地址及发送 Range 请求均不得取得付费内容。试看课时仅限后台明确允许的内容。
6. 在真机用微信登录，创建订单并发起付款。取消支付后课程仍锁定；支付返回后小程序调用服务端查单，只有微信确认到账才开课。订单页面应变成“已支付”，随后可播放非试看课时、保存进度、下载讲义；换一个未购账号仍需保持锁定。正式扣款必须由付款人自行在微信确认。
7. 检查管理后台的订单详情、金额与课程权益；模拟关闭支付页面或重启后端，确认待处理记录会继续查单，已支付订单不会重复开通，微信发货通知失败会重试。微信全额退款状态同步后，若该学生没有其他有效购买记录，应收回课程权益。系统不提供主动退款申请界面。

沙箱和正式环境的支付尝试不能混用。修改环境后遇到旧待处理订单的环境冲突时，应先在原环境核对订单结果，不要通过修改数据库或后台强制“已支付”绕过付款验证。自动化测试覆盖本地签名、回调校验、权益与重启补偿；微信真机支付、平台商品配置和最终扣款结果需要上述联调确认。
