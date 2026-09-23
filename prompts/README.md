# 提示词维护入口

本目录是网站全部模型提示词的源文件，共 40 份 UTF-8 Markdown。只修改这里的正文即可迭代；业务代码保留输入组装、模型调用、结果校验与任务恢复。工程文稿、教师修改要求、场景信息和校验错误属于运行时数据，不是提示词文件。

## 常用文件

| 能力 | 文件 |
| --- | --- |
| 知识点分镜 | `video/knowledge/storyboard-system.md` |
| 固定角色约束 | `video/roles/base.md`、`video/roles/preserve-dialogue.md` |
| 题目讲稿 | `video/problem/system.md` |
| 全课编排 | `video/course-outline.md` |
| 分批上下文及纠错 | `video/batch/`、`video/storyboard-section-context.md` |
| 局部分镜修改 | `video/storyboard-patch-rules.md` |
| 剧情拆镜参考 | `video/story/v1/P_PARSE.md` |
| 剧情平台输出约束 | `video/story/v1/split_contract.md`、`planner_contract.md` |
| 背景、插画及动效参考 | `video/story/v1/P_SCENE_SPEC.md`、`P_SCENE_BASE.md`、`P_IMG.md`、`P_ANIM.md` |
| 电路识别、复核、描述与诊断 | `circuit/` |

完整文件、版本和变量清单在 `manifest.json`。生成器计算每份正文的 SHA-256，不需手工修改哈希。

## 迭代步骤

1. 修改对应 `.md`，保留协议字段和 `{{变量名}}`。保存为无 BOM 的 UTF-8；空白、换行均属于发送给模型的正文，生成器不会自动 trim。
2. 修改该文件在 `manifest.json` 的 `version`，例如 `1.0.1`。如果新增文件或变量，同步登记文件 ID 和 `variables`。
3. 执行 `npm run prompts:generate`。缺失文件、未登记文件、变量不一致或无效文本会报错；变量值只替换一次，不会再次解释其中的模板标记。
4. 执行 `npm test` 和 `npm run build`。两者会自动重新生成提示词目录；`npm run prompts:check` 可仅检查源文件与生成目录是否一致。
5. 本地开发服务通过 `npm run dev` 或“启动视频工作台.cmd”启动，启动时自动生成目录。运行中修改正文后先执行 `npm run prompts:generate`；Vite 检测生成目录变更后重新加载，必要时用停止/启动脚本重启并重新登录。部署版本需重新构建并重启服务。

`server/promptCatalog.generated.ts` 是编译产物，不能手工修改。浏览器、服务端、共享生成模块都使用这份目录；生产运行不依赖当前工作目录来读取 Markdown。发布包同时包含源文件和生成器，便于后续迭代。

## 现有内容与能力边界

知识点正文及各拼接片段在本次抽取时保持原内容。小程序五份 `P_*` 文件保留原始字节和基线哈希；建议保留 `v1` 作为参考，重大优化新建版本目录，并同步调用 ID 和回归测试。平台差异优先修改独立的 `*_contract.md`。

`P_PARSE` 已用于剧情候选规划。目前背景和镜头插画采用本地导入、人工确认后合成；其他剧情参考已有消息构建器，尚未连接自动生图服务。`gpt-image-2` 是已保存的默认图片模型配置。
