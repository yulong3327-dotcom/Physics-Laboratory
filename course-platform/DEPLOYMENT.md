# 生产部署

生产环境以 Docker Compose 运行 API、学生网页和管理后台。SQLite 数据库及上传文件共同保存在 `course-data` 卷中，容器端口只绑定到服务器本机，由 HTTPS 反向代理对外提供服务。

## 前置条件

- Linux 服务器安装 Docker Engine 和 Docker Compose 插件。
- 一个 DNS A/AAAA 记录指向服务器的公网地址，并能通过 80/443 端口完成 HTTPS 证书签发。
- 微信小程序账号已具备登录、手机号授权和支付所需资质，且课程业务类目已审核。
- 腾讯云短信应用、短信签名和验证码模板已审核；模板应包含一个验证码参数。
- 微信支付商户号已开通 Native 和 JSAPI 支付，准备商户 API 私钥、平台证书和 32 字节 API V3 密钥。

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
WECHAT_MCH_ID=微信支付商户号
WECHAT_MCH_SERIAL_NO=商户API证书序列号
WECHAT_PRIVATE_KEY_PATH=/run/secrets/apiclient_key.pem
WECHAT_API_V3_KEY=微信支付APIv3密钥
WECHAT_PLATFORM_CERT_PATH=/run/secrets/wechatpay_platform.pem
WECHAT_PLATFORM_SERIAL_NO=微信支付平台证书序列号
WECHAT_PAY_NOTIFY_URL=https://你的域名/api/payments/wechat/notify
```

将商户私钥和微信支付平台证书放入服务器部署目录下的 `secrets/`，文件名与 `.env` 中的路径对应，并限制文件读取权限。绝不要将其写入镜像或提交到源码仓库。

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

真实支付只会在微信支付回调验签、解密并核对商户、交易类型、币种和金额后开通课程。浏览器学生端使用微信 Native 二维码支付；小程序使用 JSAPI 支付。请使用微信支付沙箱/测试商户或小额测试订单完成联调，不要使用演示付款判断生产可用。

发布前还需由运营方完成小程序隐私保护指引、服务类目、主体资质和用户协议。此仓库没有替运营方编写隐私政策，也没有包含任何真实平台凭据。
