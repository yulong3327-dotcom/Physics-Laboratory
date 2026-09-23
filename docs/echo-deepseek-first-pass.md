# DeepSeek 与本地规则对照

模型：deepseek-v4-pro-zy；17 道原题，19 个独立场景。成功解析 15/17；其余按产品行为回退本地规则。

输入只含题干，原题答案用于独立评分；未把答案或期望标签提供给模型。复合题以原题整体调用，再按返回情境的顺序比较独立小问。结果来自这批回归题，不能视为新题准确率。

| 指标 | 本地规则 | DeepSeek 优先 + 回退 |
| --- | --- | --- |
| classification | 19/19 | 16/19 |
| parameterBindings | 61/61 | 54/61 |
| absentParameterGuards | 21/21 | 19/21 |
| numericalCases | 13/13 | 9/13 |
| numericalTargets | 33/33 | 25/33 |
| blockedCases | 6/6 | 6/6 |
| compoundGuards | 0/2 | 2/2 |

## 接口与解析失败

- q14: 声音传播速度的引用无法在题干中找到。
- q16: 回声期间运动的路程的引用无法在题干中找到。

# DeepSeek 优先详细结果

题库包含 17 道原题，拆出 19 个独立场景。输入只保留【解析】之前的题干，不把解析、答案、知识点或参考标签送入分析器。数值基准按物理关系独立校验；两个复合题只继承题干中共有的声速。

以下为已知回归题上的计数，不代表新题泛化准确率。参数、模型、数值结果分别报告；缺声速、缺图以及尚未实现的工人听笛题不进入完整数值结果分母。

| 维度 | 通过 / 总数 |
| --- | --- |
| 独立场景模型匹配 | 16 / 19 |
| 明确给定参数绑定 | 54 / 61 |
| 禁止补填参数保护 | 19 / 21 |
| 完整数值结果组 | 9 / 13 |
| 逐项数值结果 | 25 / 33 |
| 缺条件 / 未实现安全阻断 | 6 / 6 |
| 复合原题拆分提示 | 2 / 2 |

| 场景 | 模型（实际 → 预期） | 参数缺项 / 错绑 | 数值结果 / 限制 |
| --- | --- | --- | --- |
| q01 | ✓ approaching → approaching | 全部符合 | 全部符合 |
| q02 | ✓ approaching → approaching | 全部符合 | missing-sound-speed；安全阻断 |
| q03 | ✓ receding → receding | sourceTravel: 未提取 → 200；initialDistance: 200 → 应为空 | sourceSpeed: -290 → -25；initialDistance: 200 → 1260；extra:隧道 / 大桥长度: 5400 → 100 |
| q04 | ✓ approaching → approaching | 全部符合 | 全部符合 |
| q05 | ✓ approaching → approaching | 全部符合 | 全部符合 |
| q06a | ✓ depth → depth | 全部符合 | 全部符合 |
| q06b | ✗ moving-target → approaching | 全部符合 | sourceSpeed: 未提取 → 15 |
| q07 | ✓ approaching → approaching | 全部符合 | 全部符合 |
| q08 | ✗ 未确定 → approaching | echoTime: 未提取 → 4；soundSpeed: 未提取 → 340 | sourceSpeed: 未提取 → 30；finalDistance: 未提取 → 620；extra:整列车完全在隧道内的时间: 未提取 → 80 |
| q09 | ✓ approaching → approaching | 全部符合 | missing-sound-speed；安全阻断 |
| q10 | ✓ approaching → approaching | 全部符合 | 全部符合 |
| q11 | ✓ approaching → approaching | 全部符合 | 全部符合 |
| q12a | ✓ approaching → approaching | 全部符合 | 全部符合 |
| q12b | ✓ two-receivers → two-receivers | 全部符合 | unsupported-model；安全阻断 |
| q13 | ✗ 未确定 → moving-target | echoTime: 未提取 → 0.68；soundSpeed: 未提取 → 340；initialDistance: 18 → 应为空 | missing-diagram；安全阻断 |
| q14 | ✓ approaching → approaching | 全部符合 | missing-sound-speed；安全阻断 |
| q15 | ✓ approaching → approaching | trainLength: 未提取 → 400；tunnelLength: 未提取 → 1900 | extra:整列车完全在隧道内的时间: 未提取 → 50 |
| q16 | ✓ parking → parking | 全部符合 | missing-diagram；安全阻断 |
| q17 | ✓ approaching → approaching | 全部符合 | 全部符合 |

## 条件和评分边界

- 第 2、9、14 题的题干没有声速；解析中的 340 m/s 不可回填。
- 第 13 题缺图 1 的时钟读数和图 2 的车距、方向；速度阈值不是实际车速。第 16 题缺扫描图中的时间区间和回波延迟。
- 第 6 题拆为静止测深、潜艇向暗礁航行；第 12 题拆为汽车回声、工人听连续鸣笛。各小问之间不混用速度或时间。
- 第 12(2) 题有完整文字条件，物理参考值为 6.4 s；当前尚未实现独立接收者求解，单列为功能覆盖限制。
- 第 3 题结果 sourceSpeed = −25 m/s 表示远离反射面的有符号速度；速率为 25 m/s。
- 完整数值组包含题目所问的剩余到达时间和隧道扩展结果；只识别模型而不能解出这些量，不算整组通过。


# 本地规则详细结果

题库包含 17 道原题，拆出 19 个独立场景。输入只保留【解析】之前的题干，不把解析、答案、知识点或参考标签送入分析器。数值基准按物理关系独立校验；两个复合题只继承题干中共有的声速。

以下为已知回归题上的计数，不代表新题泛化准确率。参数、模型、数值结果分别报告；缺声速、缺图以及尚未实现的工人听笛题不进入完整数值结果分母。

| 维度 | 通过 / 总数 |
| --- | --- |
| 独立场景模型匹配 | 19 / 19 |
| 明确给定参数绑定 | 61 / 61 |
| 禁止补填参数保护 | 21 / 21 |
| 完整数值结果组 | 13 / 13 |
| 逐项数值结果 | 33 / 33 |
| 缺条件 / 未实现安全阻断 | 6 / 6 |
| 复合原题拆分提示 | 0 / 2 |

| 场景 | 模型（实际 → 预期） | 参数缺项 / 错绑 | 数值结果 / 限制 |
| --- | --- | --- | --- |
| q01 | ✓ approaching → approaching | 全部符合 | 全部符合 |
| q02 | ✓ approaching → approaching | 全部符合 | missing-sound-speed；安全阻断 |
| q03 | ✓ receding → receding | 全部符合 | 全部符合 |
| q04 | ✓ approaching → approaching | 全部符合 | 全部符合 |
| q05 | ✓ approaching → approaching | 全部符合 | 全部符合 |
| q06a | ✓ depth → depth | 全部符合 | 全部符合 |
| q06b | ✓ approaching → approaching | 全部符合 | 全部符合 |
| q07 | ✓ approaching → approaching | 全部符合 | 全部符合 |
| q08 | ✓ approaching → approaching | 全部符合 | 全部符合 |
| q09 | ✓ approaching → approaching | 全部符合 | missing-sound-speed；安全阻断 |
| q10 | ✓ approaching → approaching | 全部符合 | 全部符合 |
| q11 | ✓ approaching → approaching | 全部符合 | 全部符合 |
| q12a | ✓ approaching → approaching | 全部符合 | 全部符合 |
| q12b | ✓ two-receivers → two-receivers | 全部符合 | unsupported-model；安全阻断 |
| q13 | ✓ moving-target → moving-target | 全部符合 | missing-diagram；安全阻断 |
| q14 | ✓ approaching → approaching | 全部符合 | missing-sound-speed；安全阻断 |
| q15 | ✓ approaching → approaching | 全部符合 | 全部符合 |
| q16 | ✓ parking → parking | 全部符合 | missing-diagram；安全阻断 |
| q17 | ✓ approaching → approaching | 全部符合 | 全部符合 |

## 条件和评分边界

- 第 2、9、14 题的题干没有声速；解析中的 340 m/s 不可回填。
- 第 13 题缺图 1 的时钟读数和图 2 的车距、方向；速度阈值不是实际车速。第 16 题缺扫描图中的时间区间和回波延迟。
- 第 6 题拆为静止测深、潜艇向暗礁航行；第 12 题拆为汽车回声、工人听连续鸣笛。各小问之间不混用速度或时间。
- 第 12(2) 题有完整文字条件，物理参考值为 6.4 s；当前尚未实现独立接收者求解，单列为功能覆盖限制。
- 第 3 题结果 sourceSpeed = −25 m/s 表示远离反射面的有符号速度；速率为 25 m/s。
- 完整数值组包含题目所问的剩余到达时间和隧道扩展结果；只识别模型而不能解出这些量，不算整组通过。
