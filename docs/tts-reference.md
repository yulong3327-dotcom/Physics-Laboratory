# 配音参考配置

网站在“视频制作 → 文稿 → 配音服务与角色”中使用 Fish.audio 配音，按角色逐句生成视频旁白。新建课程、文稿和题目项目默认使用 Fish.audio；已保存项目保留原配音服务、模型及节奏设置。

## 角色与默认参数

| 角色 | Fish Reference ID |
|---|---|
| 方大招 | 4f6e2feedf794916879cc41cb577de56 |
| 金天练 | ba0fa9dc2da541e0a565533ce6949795 |

两种角色音色与用户本次提供的 AudioScriptTool 角色配置一致。角色 ID、角色名和音色在前后端共享同一份配置。加载旧 Fish 项目时会对齐这两个固定角色音色，并要求重新保存和确认受影响的分镜。

Fish 模型默认 s1，工作台也可选择 s2-pro；chunk_length 默认 200，可设为 100–300。请求使用 normalize: true、latency: 'normal'。段间气口默认 0.5 秒，可在工作台调整。

## 服务端配置

开发环境在项目根目录 .env.local 配置；生产服务使用 .env 或系统环境变量，修改后重启服务：

~~~dotenv
FISH_API_KEY=你的FishAudio密钥
~~~

同时兼容 FISH_AUDIO_API_KEY。密钥只由服务端读取，不写入网页、视频项目、工程 ZIP 或浏览器存储。

工作台保留 Fish.audio、Edge 和 Azure，支持以下接入配置：

- Fish.audio 直连：调用 https://api.fish.audio/v1/tts，API Key 使用 Bearer 认证。请求体传递 text、reference_id、format、chunk_length、normalize 和 latency，model 通过请求头传递。
- 已有配音平台：通过 FISH_TTS_BASE_URL 指定站点根地址，调用 /api/tts/generate，兼容二进制音频和 JSON {url} 响应；平台如需要登录，须提供相应服务端认证配置。
- Edge 免费验证：无需 API Key，需联网并安装 edge-tts；优先使用服务返回的实际词时间事件。连接遵循 EDGE_TTS_PROXY，未设置时读取本机系统 HTTPS 代理；暂态网络错误最多尝试三次。
- Azure Speech：通过 AZURE_SPEECH_KEY、AZURE_SPEECH_REGION 配置，方大招使用 zh-CN-YunyangNeural，金天练使用 zh-CN-YunxiNeural。

可从 Edge 或 Azure 切换到 Fish.audio，默认选中 s1 与上述角色音色；修改分段长度、气口或模型后保存项目。选择的服务未配置时仍可编辑和保存分镜。

## 音频与时间轴

已有平台参考代码没有词时间戳。Fish 路径按标点和动画同步点拆分配音，使用每个实际音频片段的时长建立时间轴；元数据标记为音频片段对齐。自然度与停顿需要听取生成结果复核。

解析器支持 Markdown 角色标签、角色名加冒号和【角色】格式；标签单独成行时，后续台词继承该角色。原稿和显示字幕保持内容不变，发音词典单独保存。

参考 AudioClipper 中的气口插入、裁剪和变速会改变时间轴，不能沿用处理前的同步数据。本版采用项目气口与按镜头重做进行节奏调整；没有直接移植整个波形剪辑界面。接入手工剪辑音频时须同时重建字幕及动作时间。
