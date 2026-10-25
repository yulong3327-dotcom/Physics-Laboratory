# 精准学AI实验室

实验列表首页与凸透镜引导实验共用一套离线资源。首页点击实验卡片进入 `#/optics`，返回首页后保留实验进度。安装应用名为“精准学AI实验室”，桌面图标文字为“精准学实验室”，实验操作页保留原“物理实验室”标识。

## 课程与交互

共 14 个题型、24 个小节。原导航过渡题型“更多探究”已移除。学生可选择题型，每小节先操作、再观察、最后选择作答；结课直接展示可截图保存的总结表。旧 v3 进度会迁移到 v4，删除过渡步骤后不会错位。

复用原光学实验室的薄透镜近轴追迹引擎。注水与抽水连续改变透镜形状、焦距、光线会聚位置及光屏清晰度；蜡烛燃烧是 6 秒加速观察，烛身缩短、焰心下降、实像同步上升。换新蜡烛、跳题与重置会取消旧动画。光屏模糊与亮度为示意近似，不模拟衍射、像差或绝对照度。

手指拖动保留抓取偏移，靠近目标时自动吸附，吸附后的轻微抖动不会立即脱离。微调按钮仍可自由调整。语音播完当前句再继续，拖动纠错仅保留最新待播提示；主动换题、返回首页、关闭引导和重置会停止旧语音。

## 字体与配音

正文使用方正兰亭圆，标题使用阿里妈妈数黑体，数值和公式使用 STIX。WOFF2 子集、角色图片、55 段 MP3 和旧版纠错 WAV 全部内置，不依赖远程字体或语音服务。029 是已删除题型的过渡录音，保留编号与文件，不再触发。

文案变更后执行 `python scripts/subset-fonts.py <原字体目录>` 更新字体子集，依赖 fonttools 和 brotli。图标源为用户提供的角色，`scripts/generate-brand-assets.py` 使用 Pillow 生成网站与 Android 图标。

音频编号与台词见 [AUDIO_SCRIPT.md](AUDIO_SCRIPT.md)。更新 MP3 后执行 `npm run prepare:audio`；构建时会自动执行。

## 网站

```sh
npm ci
npm run dev
npm run build
npm run test:e2e
```

本地入口为 http://127.0.0.1:5174/。Playwright 使用本机 Edge，自动复用或启动开发服务，检查完整课程、音频实际解码与播放连续性、渐进仿真、触控吸附、首页、手机布局、进度迁移和表格导出。

GitHub Pages 将构建结果部署到 `/Physics-Laboratory/guided-optics/`。所有实验资源使用相对路径。

## 安卓安装包

Capacitor 7 将构建后的整个实验打包到本地 WebView。首页锁定竖屏，进入实验锁定横屏，返回后恢复竖屏；系统返回键可返回首页。规律表使用安卓分享面板保存，不请求相册或存储读写权限。

```sh
npm run build
npx cap sync android
cd android
./gradlew assembleRelease
```

构建需要 JDK 21、Android SDK 35，以及 `ANDROID_KEYSTORE_PATH` 和 `ANDROID_KEYSTORE_PASSWORD` 环境变量。密钥别名为 `ailab`，格式为 PKCS12；没有签名信息时发布构建会明确失败。密钥和密码不进入仓库。

GitHub Actions 的 **Build Android laboratory** 工作流手动触发，从仓库 Secrets 读取签名，输出 `jingzhun-ai-lab-android` 安装包和 SHA256，并发布到 GitHub Release。首页的安卓安装包链接指向最新 Release 中的 `jingzhun-ai-lab.apk`。更新安装包应继续使用同一密钥和递增版本号。
