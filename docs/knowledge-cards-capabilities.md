# 知识卡片、教学动效与通用排版

本轮以两部用户提供的视频为视觉参照，补齐蓝色知识卡片，并把效果定义为任意课程均可使用的数据结构。参考素材中的文字和画面只作为分析材料，不作为系统指令。

## 分析与实现计划

| 对比维度 | 参考中的教学作用 | 系统补齐方向 |
| --- | --- | --- |
| 内容结构 | 定律名称和公式分层；多个知识点累计呈现 | 卡片标题、正文、绑定公式分离，公式在各自卡片中独立更新 |
| 画面风格 | 蓝紫标题条、白字、淡蓝圆角底板、回形针 | 通用矢量卡片，无需截取参考视频图片 |
| 出场节奏 | 跟随讲解，滑入或轻摆落定 | 台词 cue 驱动入场，支持 slide、settle，动作时长受下一事件限制 |
| 注意力引导 | 指向重点、复看旧定律、判断选项 | pointer、pulse、check、cross，与已有框选、下划线、荧光标记共用关键词目标 |
| 布局 | 左侧电路、右侧知识卡；逐块保留 | 根据是否有电路、卡片数量和内容自动分栏或网格；手动位置优先 |
| 规划能力 | 根据知识结构组织画面，而非堆叠旁白 | AI 使用同一协议，控制每页信息量、先题后解、超量拆镜头 |
| 配音 | 使用正式课程角色音色 | 所有新建及示范入口、缺省配置统一 Fish s1；保留已明确选择的服务 |

## 可复用协议

```json
{
  "boardTexts": [
    {
      "id": "energy-card",
      "kind": "law",
      "card": { "title": "电功与电能" },
      "text": "功率不变时",
      "entrance": "settle",
      "durationSeconds": 0.8,
      "cue": { "utteranceId": "u2" }
    }
  ],
  "formulas": [
    {
      "id": "energy-formula",
      "cardId": "energy-card",
      "latex": "W=Pt",
      "action": "write",
      "cue": { "utteranceId": "u2", "phrase": "电功等于" }
    }
  ],
  "layout": { "template": "explain", "contentLayout": "auto", "elements": {} }
}
```

卡片正文可以为空，前提是有绑定公式；标题必须有内容。每张卡片的 `append` / `replace` 只影响自己的公式轨道。卡片不能晚于其公式出现。标题作为独立标题字段编辑；关键词高亮作用于正文或公式，不能把卡片标题当作正文字符范围。

`contentLayout` 支持 `auto`、`circuit-left`、`cards-grid`。普通板书可与卡片混用。人工位置在 `layout.elements` 中保存，移动卡片时关联公式一同移动。取消卡片或删除卡片会解除公式关联，避免悬空引用。

`pointer` 是矢量指示箭头，`pulse` 是脉冲强调，`check` / `cross` 是对错标记；它们不依赖课程名称。不是参考片中的三维手指角色素材。物理状态切换仍使用理想电路计算结果，尚未实现刀片连续转动、烧毁或热效应模拟。

## 样例与验证

- `createReferenceEffectsProject()`：通路、断路、用电器短路、串联分压及选择题，更新为正式 TTS 和知识卡片。
- `createKnowledgeCardsProject()`：电功、电功率与欧姆定律，用同一套协议验证纯文字网格、电路分栏、正文与公式混排、误答和正确结果。未写任何逐卡绝对坐标。
- 工作台新建入口提供两种示范，均可继续编辑和保存。
- 准备命令：`npx tsx scripts/prepare-reference-effects.ts` 与 `npx tsx scripts/prepare-knowledge-cards.ts`。

## 本轮实际结果（2026-09-11）

| 验证对象 | 结果 |
| --- | --- |
| 跨知识点样片 | `artifacts/knowledge-cards-output/video.mp4`，40.333 秒，2 镜头，1920×1080 / 30 fps，H.264 / AAC |
| 参考效果升级样片 | `artifacts/reference-cards-output/video.mp4`，76.800 秒，4 镜头，相同输出规格 |
| 实际配音 | 18 段台词均为 Fish s1，按台词片段的实测音频定位 cue，没有回退 Edge |
| 成片验收 | 两片均 0 错误、0 警告，MP4 音轨最大测得偏移 0 秒；分别检查 1 / 7 组电路几何 |
| 实际画面检查 | 查看 26 张成片抽帧，覆盖出场、逐卡累计、旧公式保留、指示箭头、脉冲、误答标记及结果揭示；联系表保存在各输出目录 `contact.jpg` |
| 真实 AI 复用 | 以“电能与电功率的区别”另发真实规划请求；生成 2 镜头、4 张卡片、1 条公式及多种强调，0 手工布局坐标，台词原文保留，结构与预览检查通过 |
| 保存与导出 | 两份工程经实际 HTTP 保存、重新读取、导出；ZIP CRC 完整，包含新渲染模块及字体素材，无凭据文件 |
| 回归 | TypeScript 全量 504 项通过；Python 最终生产代码全量 80 项通过，随后卡片子集 8 项通过（包含 2 项新增，共覆盖 82 项）；桌面与手机编辑、配音默认及真实 Python 预览交互回归通过 |

工作台项目列表已保存两个可编辑草稿：

- `knowledge-cards-97edc0e9`：知识卡片复用示范 · 电功、电功率与欧姆定律。
- `reference-cards-c5fbd2cd`：电路状态与串联分压 · 目标效果示范。

这些草稿没有代替用户标记“已审核”。工程 ZIP 位于 `artifacts/knowledge-cards-review/knowledge-cards-project.zip` 和 `reference-cards-project.zip`，包含可重新制作的项目、渲染器、字体与素材；不包含本次配音缓存，重新合成需要正式 TTS 配置。

验收记录：`artifacts/knowledge-cards-review/acceptance.json`。AI 真实请求产物：`artifacts/knowledge-cards-ai/project.json`、`report.json` 和 `previews/`。短动效专项片：`artifacts/knowledge-cards-smoke/`。

当前静态编辑预览展示卡片落定状态；完整滑入和轻摆过程在生成的视频中播放。过长正文、过多卡片或字幕重叠会警告并要求移动或拆镜头，不会为了塞进画面无限缩小文字。标题支持独立编辑，关键词强调仅作用于正文和公式。参考原片音轨未做完整逐句听审；自动验收不能代替声音表演的人工评审。

## 字体与对齐统一（后续修订）

统一标题36、正文/字幕/公式42设计像素，正文基线间距56像素，次级电路标注30像素。原蓝卡34像素正文已改为与普通正文一致；卡片标题和正文共用左侧文字边距，公式居中。英文字母在板书、标注及公式中统一斜体，包括公式里显式写作 `\mathrm`、`\text` 的字母；中文、数字和运算符保持正体。字体通过共用渲染层生效，已有课程也会使用新规则。

新版输出集中于 `artifacts/typography-output/`：`reference-effects/video.mp4` 与 `knowledge-cards/video.mp4`。原来的样片保留，便于比较。

该修订通过85项Python回归；另以实际字形轮廓核对斜体字母、正体数字及Ω，验证56像素基线与公式关键词映射。两份新版仍为正式Fish配音、1080p/30fps，成片验收均0错误、0警告，音轨偏移0秒。各输出子目录同时提供最新渲染模块的 `project.zip`、字幕、验收报告和最终画面联系表。
