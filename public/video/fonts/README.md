# 内置视频字体

原包：`模版5最新字体包.rar`。原始 TTF/OTF 字节保持不变；WOFF2 从对应原文件转换。真实 family、PostScript 名称、字重、SHA-256 与嵌入标志见 `manifest.json`，字体自带版权/授权元数据保存在 `.metadata.txt`。

| 用途 | family | PostScript | 实际字重 |
|---|---|---|---|
| 中文正文 | FZLanTingYuanS-R-GB / 方正兰亭圆简体 | FZLANTY_JW--GB1-0 | 400 |
| 西文正文 | STIX Two Text | STIXTwoText | 400 |
| 西文斜体 | STIX Two Text | STIXTwoText-Italic | 400 Italic |
| 数学字符 | STIX Two Math | STIXTwoMath | 400 |

提供的字体包、本机系统/用户字体目录均没有“方正兰亭圆简体-中粗”。当前标题请求 600，使用常规字体合成，清单明确标记 `syntheticTitle: true`。并未将常规字体重命名为中粗。

浏览器：导入 `src/lib/videoFonts.ts`，拍摄/测量前 `await loadVideoFonts()`。CSS 使用本机 `/video/fonts/*.woff2`，不会加载 CDN。Latin family 排在中文 family 前面，中文字符落到方正字形。

Manim：将 `video-renderer/fonts.py` 和本目录一起复制到另一台电脑，导入 `register_video_fonts, mixed_text, glyphs_for_range`。注册仅作用于当前进程，不安装系统字体。默认字体目录相对模块解析为 `../public/video/fonts`；打包项目也支持 `../assets/fonts`，或环境变量 `VIDEO_FONT_DIR`。运行不依赖 fontTools/brotli，它们仅用于字体转换与验证。

`mixed_text('电功率 P=UI', design_px=42, color='#333333')` 返回单个共享基线的 MarkupText。按原文区间高亮使用 `glyphs_for_range(line, start, end)`，不要直接按原文索引 `line.chars`，因为 MarkupText 会省略空格。

统一排版规则：标题36设计像素；普通正文、知识卡正文、字幕和公式42设计像素；正文真实基线间距56像素；次级电路标注30设计像素。角色字号由 `fonts.py` 的常量集中管理。蓝卡标题与正文采用相同左边距，公式在卡内居中；超量内容换行或提示拆页，不单独缩小蓝卡正文。

英文字母统一斜体：板书、标题、字幕、电路标注使用 STIX Two Text Italic 的真实字形，中文、数字和运算符保持正体。公式使用 STIX Two Math；模板会让 `\mathrm{A}` 这类字母标签和 `\text{W}` 这类文字单位也按斜体显示，数字及 Ω 等符号保持正体。原始 LaTeX、配音文字与关键词索引均不改写。此为当前课件视觉规范，而非所有数学出版物的单位排版规范。

1920×1080、frame_height=8 时，每场景单位=135设计像素。Manim Text 字号 = 设计像素 ×72/135；42→22.4、36→19.2。Illustrator 的1920×1080画板坐标直接作为设计像素，不再乘CSS pt换算。固定56行距应独立排列每行基线，相差56/135场景单位；纯Text多行可用 `fixed_text_line_spacing(42,56)`（0.7777778），已实测基线56.0039px。混排请逐行创建，避免Pango自然行高改变固定行距。

验证：`.video-runtime/Scripts/python.exe -X utf8 scripts/verify-video-fonts.py`。基于字体outline测量36/42设计字号，验证56像素基线及含空格关键词索引。

公式：`MathTex(value, tex_template=stix_tex_template())` 使用 XeLaTeX + fontspec + unicode-math + xeCJK，按本目录绝对文件路径读取 STIX Two Text、STIX Two Math 与方正中文，不依赖操作系统字体安装。分式、上下标和 `\text{电功率}` 已通过真实 Manim 编译。验证脚本：`scripts/verify-video-formula-fonts.py`。

MathTex 与 Pango Text 的字号约定不同。使用本模板时请用 `font_size=design_math_font_size(42)`，42设计像素→29.9786667、36→25.696。模板固定10TeX pt；换算包含dvisvgm的72.27pt/in→72bp/in与Manim的1/960缩放。不要复用 `design_font_size`，否则公式约小25%。已用真实STIX字形大写H高度验证。
