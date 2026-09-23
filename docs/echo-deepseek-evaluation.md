# DeepSeek 与本地规则对照

模型：deepseek-v4-pro-zy；17 道原题，19 个独立场景。通过核验并保留模型结果 11/17；其余按产品行为回退本地规则。

本轮 17 次接口调用均返回内容。模型首轮流程（仅检查格式和引用）完整数值组为 9/13；补充单位、规则一致性和物理校验后，混合流程为 13/13，与改进后的本地规则相同。本批题没有观察到数值准确率提升，DeepSeek 的主要可用能力是复合题的情境拆分。

固定暗礁被模型误标为移动目标时，根据题干的固定反射面与正前方条件修正为匀速靠近，并向用户显示修正说明。拆散同一列车的回声与通行条件、漏掉明确已知量、伪造声速引用、单位不一致等输出触发回退。首轮报告保留在 echo-deepseek-first-pass.md。

输入只含题干，原题答案用于独立评分；未把答案或期望标签提供给模型。复合题以原题整体调用，再按返回情境的顺序比较独立小问。报告使用同一批真实响应缓存重新执行核验，没有为提高分数重抽模型回答。结果来自这批回归题，不能视为新题准确率。

| 指标 | 本地规则 | DeepSeek 优先 + 校验 + 回退 |
| --- | --- | --- |
| classification | 19/19 | 19/19 |
| parameterBindings | 61/61 | 61/61 |
| absentParameterGuards | 21/21 | 21/21 |
| numericalCases | 13/13 | 13/13 |
| numericalTargets | 33/33 | 33/33 |
| blockedCases | 6/6 | 6/6 |
| compoundGuards | 2/2 | 2/2 |

## 条件核验与回退

- q03: 回声期间运动的路程与本地提取的明确条件不一致。
- q08: 模型把关联的回声与通行条件拆散，改用本地规则保留完整条件。
- q13: 发射时的距离与引用中的数字或单位不一致。
- q14: 声音传播速度的引用无法在题干中找到。
- q15: 模型把关联的回声与通行条件拆散，改用本地规则保留完整条件。
- q16: 回声期间运动的路程的引用无法在题干中找到。

# DeepSeek 优先详细结果

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
| 复合原题拆分提示 | 2 / 2 |

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
| 复合原题拆分提示 | 2 / 2 |

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
