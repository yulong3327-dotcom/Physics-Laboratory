# 回声测距题干回归初始基线

记录日期：2026-09-21。使用本轮改进前保存的本地引擎快照；`src/echo/engine.ts` 的 SHA-256 为 `E47A98E436956245D5A9A3324C6EFBDD4E4924A9C38F6DD946EDCCE89D6304AA`。此文档保留初始结果，不随当前引擎修改覆写。

运行当前版本：`npx tsx scripts/echo-corpus-eval.ts`；需要完整逐项机器报告时加 `--json`。此评估没有网络调用，也没有将题库作为相似样本传入匹配器。

题库包含 17 道原题，拆出 19 个独立场景。输入只保留【解析】之前的题干，不把解析、答案、知识点或参考标签送入分析器。数值基准按物理关系独立校验；两个复合题只继承题干中共有的声速。

以下为已知回归题上的计数，不代表新题泛化准确率。参数、模型、数值结果分别报告；缺声速、缺图以及尚未实现的工人听笛题不进入完整数值结果分母。

| 维度 | 通过 / 总数 |
| --- | --- |
| 独立场景模型匹配 | 13 / 19 |
| 明确给定参数绑定 | 47 / 61 |
| 禁止补填参数保护 | 19 / 21 |
| 完整数值结果组 | 4 / 13 |
| 逐项数值结果 | 10 / 33 |
| 缺条件 / 未实现安全阻断 | 4 / 6 |
| 复合原题拆分提示 | 0 / 2 |

| 场景 | 模型（实际 → 预期） | 参数缺项 / 错绑 | 数值结果 / 限制 |
| --- | --- | --- | --- |
| q01 | ✗ 未确定 → approaching | 全部符合 | soundTravel: 未提取 → 680；sourceSpeed: 未提取 → 20；finalDistance: 未提取 → 320；extra:听到回声后到达目标还需时间: 未提取 → 16 |
| q02 | ✓ approaching → approaching | 全部符合 | missing-sound-speed；安全阻断 |
| q03 | ✓ receding → receding | sourceTravel: 未提取 → 200；echoTime: 未提取 → 8；passTime: 未提取 → 20；initialDistance: 200 → 应为空 | sourceSpeed: 未提取 → -25；initialDistance: 未提取 → 1260；extra:隧道 / 大桥长度: 未提取 → 100 |
| q04 | ✓ approaching → approaching | sourceSpeed: 未提取 → 20；soundSpeed: 未提取 → 340 | sourceTravel: 未提取 → 100；soundTravel: 未提取 → 1700；finalDistance: 未提取 → 800；extra:听到回声后到达目标还需时间: 未提取 → 40 |
| q05 | ✗ 未确定 → approaching | sourceTravel: 未提取 → 20 | sourceSpeed: 未提取 → 10；echoTime: 未提取 → 2；soundTravel: 未提取 → 680 |
| q06a | ✓ depth → depth | echoTime: 未提取 → 3 | initialDistance: 未提取 → 2250 |
| q06b | ✗ stationary → approaching | echoTime: 未提取 → 4 | sourceSpeed: 0 → 15 |
| q07 | ✓ approaching → approaching | echoTime: 8 → 0.8 | sourceTravel: 120 → 12；soundTravel: 2720 → 272；finalDistance: 1300 → 130 |
| q08 | ✓ approaching → approaching | tunnelLength: 未提取 → 2700 | sourceSpeed: 未提取 → 30；finalDistance: 未提取 → 620；extra:整列车完全在隧道内的时间: 未提取 → 80 |
| q09 | ✗ 未确定 → approaching | 全部符合 | missing-sound-speed；阻断失败 |
| q10 | ✓ approaching → approaching | 全部符合 | 全部符合 |
| q11 | ✓ approaching → approaching | 全部符合 | 全部符合 |
| q12a | ✓ approaching → approaching | 全部符合 | 全部符合 |
| q12b | ✓ two-receivers → two-receivers | 全部符合 | unsupported-model；安全阻断 |
| q13 | ✗ decelerating → moving-target | echoTime: 未提取 → 0.68；sourceSpeed: 8.333333333333334 → 应为空 | missing-diagram；安全阻断 |
| q14 | ✗ 未确定 → approaching | carriageLength: 未提取 → 25 | missing-sound-speed；阻断失败 |
| q15 | ✓ approaching → approaching | trainLength: 未提取 → 400 | extra:整列车完全在隧道内的时间: 未提取 → 50 |
| q16 | ✓ parking → parking | sourceSpeed: 2 → 1.2 | missing-diagram；安全阻断 |
| q17 | ✓ approaching → approaching | 全部符合 | 全部符合 |

## 条件和评分边界

- 第 2、9、14 题的题干没有声速；解析中的 340 m/s 不可回填。
- 第 13 题缺图 1 的时钟读数和图 2 的车距、方向；速度阈值不是实际车速。第 16 题缺扫描图中的时间区间和回波延迟。
- 第 6 题拆为静止测深、潜艇向暗礁航行；第 12 题拆为汽车回声、工人听连续鸣笛。各小问之间不混用速度或时间。
- 第 12(2) 题有完整文字条件，物理参考值为 6.4 s；当前尚未实现独立接收者求解，单列为功能覆盖限制。
- 第 3 题结果 sourceSpeed = −25 m/s 表示远离反射面的有符号速度；速率为 25 m/s。
- 完整数值组包含题目所问的剩余到达时间和隧道扩展结果；只识别模型而不能解出这些量，不算整组通过。
