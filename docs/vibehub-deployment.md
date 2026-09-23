# Vibe Hub 部署与更新

提交页面：http://vibehub.yukework.com/#/new

平台规则：http://vibehub.yukework.com/docs/devtoolrule.md （2026-06-12 更新版）

## 首次发布

1. 在项目目录执行 `npm run package:vibehub`。
2. 名称填“物理仿真AI实验室”，简介填“初中物理实物图与电路图互转，支持 AI 识别、直流实验和图片视频导出”。
3. 类型选择 **H5 Node**，分类选择“生产力”。AI 需要服务端 `/api/ai/`，不能选择 H5 静态。
4. 上传 `release/circuit-converter-vibehub.zip`，点击“立即发布”。ZIP 根目录直接包含 `package.json`，没有外层项目文件夹；应用的 `dist/`、`server-dist/` 等目录保持原结构。
5. 若平台要求启动命令，填 `npm start`。ZIP 已含构建产物；若要求构建命令，填 `npm run build`，并安装开发依赖 `npm ci --include=dev`。运行时为 Node 24。
6. 在平台的服务器环境配置处注入以下 AI 配置。若没有自定义环境变量入口，需要平台管理员注入；不要把真实 `.env.local` 放进 ZIP。
7. 部署成功后检查画布、实物素材及“AI 导入”。`/api/health` 应返回健康状态，`/api/ai/status` 的 `configured` 应为 `true`。

| 环境变量 | 值或用途 |
| --- | --- |
| `PORT` | 平台注入，默认 8888；不要在平台上覆盖为 80。 |
| `AI_BASE_URL` | 与本机 `.env.local` 中的服务地址一致。 |
| `AI_API_KEY` | 与本机相同的密钥，只配置在服务器。 |
| `AI_MODEL` | 与本机一致，示例为 `gpt-5.5`。 |
| `PUBLIC_ORIGIN` | 可选，实际网站协议、域名及非默认端口，不含路径。 |
| `AI_RATE_LIMIT_PER_MINUTE` | 可选，默认每实例每分钟 30 次，图片识别通常需要 2 次。 |
| `AI_MAX_CONCURRENT_REQUESTS` | 可选，默认每实例同时处理 4 次 AI 请求。 |

生产入口加载服务器 `.env`，已有进程环境变量优先。未配置 AI 时，手动画布与实验仍可用。

## 版本更新

本地源代码不会自动同步到网站。修改后运行 `npm run package:vibehub`，到已发布工具的“版本管理”上传新 ZIP，并填写更新说明，不需要新建工具。电脑浏览器刷新同一个网站地址即可使用新版；HTML 不长期缓存，构建脚本带内容哈希。页面未刷新前仍运行旧代码。

本机 `localhost` 页面仍由本机代码及启动的服务决定；修改 `.env.local` 后需重启开发服务。本项目没有独立 Windows 安装程序，未来桌面安装包需要单独配置更新机制。平台显示“Git 集成”不代表本机已绑定自动发布；当前目录没有 Git 仓库，也没有配置自动部署。

## 草稿与存储

草稿保存在当前浏览器、当前站点的 `localStorage`，本机、网站、不同电脑及浏览器互不共享。迁移时先在原站导出 JSON，再在网站导入；浏览器清理数据会删除草稿。同域名重新部署通常保留草稿。

服务器只读取部署资源并转发 AI 请求，不往容器本地文件保存电路、上传或导出结果。目前不需要 PostgreSQL、MinIO。未来新增云端保存或跨设备同步时，持久数据必须使用平台的 PostgreSQL/MinIO，通过 `VIBE_DB_URL`、`VIBE_OSS_*` 读取凭证；对象存储公共入口按平台规则的域名族对应表确定。

平台当前链接使用 HTTP。HTTPS 或本机 localhost 优先使用 WebCodecs 导出视频；HTTP 网站在浏览器支持时自动使用 MediaRecorder 实时录制画布。兼容导出的 MP4 需要浏览器 MediaRecorder 支持 H.264，WebM 需要 VP9 或 VP8；某格式不可用时可尝试另一种格式。HTTPS 仍可获得优先编码方式，但并非视频导出的必要条件。

MediaRecorder 兼容导出约需视频本身的时长，期间请保持页面在前台。导出仅录制应用生成的画布，不调用摄像头或麦克风；视频及相关数据留在浏览器内，不上传服务器。JSON、PNG、SVG、Manim 工程导出不依赖视频编码器。

## 本机验收

```sh
npm run build
npm test
npm start
```

打开 `http://localhost:8888`。生产服务只加载 `.env` 和进程环境，不自动加载开发用的 `.env.local`。本机需要带 AI 验证时，可执行 `node --env-file=.env.local server-dist/index.js`。生产服务与开发服务可使用不同端口运行。
