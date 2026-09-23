import type { FormulaStep, Shot } from '../../server/videoTypes'

/** The user's source is retained verbatim; editorial warnings never rewrite narration. */
export const POWER_LESSON_SOURCE = "**方大招：** 咱们已经学过，电功是电能转化的量度，也就是消耗的电能，而电功率是表示电流做功快慢的物理量。电功率的基本公式是P等于U乘I，也就是电压乘电流。那如果题目没给电压，还能不能算呢？比如一只8欧的电阻，通过它的电流是2安，求它的电功率。\n**金天练：** 可这题没给电压啊，还都用不上原来的公式。\n**方大招：** 电流可以直接用，电压需要多算一步。这是纯电阻，可以用欧姆定律。电压等于电流乘电阻，2乘8，得到16伏。再乘上2安的电流，电功率就是32瓦。\n**方大招：** 其实不用每次都分两步算。刚才我们先用I乘R求电压，再乘一次I，把这两步合起来，就是P等于I的平方乘R。回到这道题，直接用2的平方乘8，也能得到32瓦。\n**方大招：** 如果给的是电压和电阻，也可以这样处理。根据欧姆定律，I等于U除以R，把它代入P等于U乘I，就得到P等于U的平方除以R。\n**方大招：** 这样，对于纯电阻电路，除了P等于U乘I，咱们又有了两个公式：P等于I的平方乘R，P等于U的平方除以R。\n**方大招：** 接下来，咱们用这两个公式算一道串联题。R1是4欧，R2是12欧，两个电阻串联。已知R1的功率是16瓦，求R2的功率。\n**金天练：** 方大招，这是不是得先求电流，再算R2的功率？\n**方大招：** 可以。根据P1等于I的平方乘R1，I的平方就是16除以4，等于4，所以电流是2安。再算P2，2的平方乘12，得到48瓦。\n**方大招：** 这样能算出来。不过，题目已经给了一个功率，咱们能不能直接求另一个，省掉中间算电流这一步呢？两个电阻串联，用的是同一个电流，可以把两个功率相除试试。\n**方大招：** P1除以P2，等于I的平方乘R1，再除以I的平方乘R2。上下相同的I的平方一约，就剩下R1除以R2。也就是说，串联电路中，功率比等于电阻比，功率与电阻成正比。\n**方大招：** 再看刚才那道题，R1比R2是4比12，也就是1比3，那么P1比P2也是1比3。P2是P1的3倍，直接用16乘3，得到48瓦。电流不用求了，计算就简单多了。\n**方大招：** 那并联时，能不能也用比例呢？\n**方大招：** 再来看到并联的情况。两个电阻并联，则两端电压相同，这次就用P等于U的平方除以R。P1等于U的平方除以R1，P2等于U的平方除以R2。把它们相除，相同的U的平方约掉，剩下的是R1的倒数除以R2的倒数，整理后，就是R2除以R1。\n**方大招：** 所以，对于并联来说，各部分电功率大小等于电阻的倒数比，这和串联不同，电阻越大，反而功率越小。总结起来，就是串联成正比，并联成反比。一定要记住啦！\n**方大招：** 我们来练习一下这个电路中，由10欧的R1和15欧的R2并联，已知P1是9瓦，求P2。电阻比是10比15，等于2比3；功率比与它相反，是3比2。P1对应3份，3份是9瓦，一份就是3瓦。P2对应2份，所以是6瓦。\n**金天练：** 两个电阻的情况我学会了。那要是三个电阻，也能这么比吗？\n**方大招：** 当然可以呀。在计算纯电阻的串并联电路电功率时，我们也可以灵活应用这两个电功率的计算公式。串联时选这个，并联时选这个。\n**方大招：** &#x90A3;么对于三个电阻串联，电流还是相同的。三个功率分别是I的平方乘R1、I的平方乘R2、I的平方乘R3。写成比以后，把共同的I的平方消去，功率比就是R1比R2比R3，仍然与电阻成正比。\n**方大招：** 三电阻并联也是完全一样的推导，电压相同。三个功率分别用U的平方除以各自的电阻，把共同的U的平方消去，就得到R1的倒数、R2的倒数、R3的倒数之比。\n**方大招：** &#x6240;以三个并联，也是功率与电阻成反比，不过计算时，注意需要把每一项分别取倒数。\n**方大招：** 来，咱们练一道。三个电阻并联，R1是4欧，R2是10欧，R3是20欧。已知P2是10瓦，求P1、P3。我们可以先算算它们的功率之比。\n**金天练：** 电阻比是2比5比10。那功率比简单！我直接反过来写，也就是成10比5比2吗？\n**方大招：** &#x91D1;天练，又“拍脑袋”了，注意啦！不能直接调换顺序。需要对每个阻值取倒数，是把2变成二分之一，5变成五分之一，10变成十分之一。所以功率比是二分之一比五分之一比十分之一。来化简一下，三项同时乘10，得到电功率之比为5比2比1。\n**方大招：** 接着看题目给的P2，代入公式里，它对应中间的2份，2份是10瓦，所以一份是5瓦。P1占5份，就是25瓦；P3占1份，就是5瓦。\n**方大招：** 算完再核对一下：三个电阻并联，4欧的电阻最小，功率最大，是25瓦；20欧的电阻最大，功率最小，是5瓦，完全符合反比关系！\n**金天练：** 我学会啦，这俩结论可太好用了。\n**方大招：** 来，简单回顾一下，这节课，你就记住三个公式、两个比例关系就行。对于纯电阻电路的电功率，有三个计算公式。P等于UI，还等于I方R、U方除以R。而对于电功率的比例关系：串联成正比，并联成反比。遇到三个电阻的情况，也是完全一样的。注意并联电阻，每一项分别取倒数，再化简成整数比。\n**方大招：** 赶紧收藏笔记，练起来吧\\~"
export const POWER_LESSON_LINES: [string, string][] = [
  [
    "方大招",
    "咱们已经学过，电功是电能转化的量度，也就是消耗的电能，而电功率是表示电流做功快慢的物理量。电功率的基本公式是P等于U乘I，也就是电压乘电流。那如果题目没给电压，还能不能算呢？比如一只8欧的电阻，通过它的电流是2安，求它的电功率。"
  ],
  [
    "金天练",
    "可这题没给电压啊，还都用不上原来的公式。"
  ],
  [
    "方大招",
    "电流可以直接用，电压需要多算一步。这是纯电阻，可以用欧姆定律。电压等于电流乘电阻，2乘8，得到16伏。再乘上2安的电流，电功率就是32瓦。"
  ],
  [
    "方大招",
    "其实不用每次都分两步算。刚才我们先用I乘R求电压，再乘一次I，把这两步合起来，就是P等于I的平方乘R。回到这道题，直接用2的平方乘8，也能得到32瓦。"
  ],
  [
    "方大招",
    "如果给的是电压和电阻，也可以这样处理。根据欧姆定律，I等于U除以R，把它代入P等于U乘I，就得到P等于U的平方除以R。"
  ],
  [
    "方大招",
    "这样，对于纯电阻电路，除了P等于U乘I，咱们又有了两个公式：P等于I的平方乘R，P等于U的平方除以R。"
  ],
  [
    "方大招",
    "接下来，咱们用这两个公式算一道串联题。R1是4欧，R2是12欧，两个电阻串联。已知R1的功率是16瓦，求R2的功率。"
  ],
  [
    "金天练",
    "方大招，这是不是得先求电流，再算R2的功率？"
  ],
  [
    "方大招",
    "可以。根据P1等于I的平方乘R1，I的平方就是16除以4，等于4，所以电流是2安。再算P2，2的平方乘12，得到48瓦。"
  ],
  [
    "方大招",
    "这样能算出来。不过，题目已经给了一个功率，咱们能不能直接求另一个，省掉中间算电流这一步呢？两个电阻串联，用的是同一个电流，可以把两个功率相除试试。"
  ],
  [
    "方大招",
    "P1除以P2，等于I的平方乘R1，再除以I的平方乘R2。上下相同的I的平方一约，就剩下R1除以R2。也就是说，串联电路中，功率比等于电阻比，功率与电阻成正比。"
  ],
  [
    "方大招",
    "再看刚才那道题，R1比R2是4比12，也就是1比3，那么P1比P2也是1比3。P2是P1的3倍，直接用16乘3，得到48瓦。电流不用求了，计算就简单多了。"
  ],
  [
    "方大招",
    "那并联时，能不能也用比例呢？"
  ],
  [
    "方大招",
    "再来看到并联的情况。两个电阻并联，则两端电压相同，这次就用P等于U的平方除以R。P1等于U的平方除以R1，P2等于U的平方除以R2。把它们相除，相同的U的平方约掉，剩下的是R1的倒数除以R2的倒数，整理后，就是R2除以R1。"
  ],
  [
    "方大招",
    "所以，对于并联来说，各部分电功率大小等于电阻的倒数比，这和串联不同，电阻越大，反而功率越小。总结起来，就是串联成正比，并联成反比。一定要记住啦！"
  ],
  [
    "方大招",
    "我们来练习一下这个电路中，由10欧的R1和15欧的R2并联，已知P1是9瓦，求P2。电阻比是10比15，等于2比3；功率比与它相反，是3比2。P1对应3份，3份是9瓦，一份就是3瓦。P2对应2份，所以是6瓦。"
  ],
  [
    "金天练",
    "两个电阻的情况我学会了。那要是三个电阻，也能这么比吗？"
  ],
  [
    "方大招",
    "当然可以呀。在计算纯电阻的串并联电路电功率时，我们也可以灵活应用这两个电功率的计算公式。串联时选这个，并联时选这个。"
  ],
  [
    "方大招",
    "那么对于三个电阻串联，电流还是相同的。三个功率分别是I的平方乘R1、I的平方乘R2、I的平方乘R3。写成比以后，把共同的I的平方消去，功率比就是R1比R2比R3，仍然与电阻成正比。"
  ],
  [
    "方大招",
    "三电阻并联也是完全一样的推导，电压相同。三个功率分别用U的平方除以各自的电阻，把共同的U的平方消去，就得到R1的倒数、R2的倒数、R3的倒数之比。"
  ],
  [
    "方大招",
    "所以三个并联，也是功率与电阻成反比，不过计算时，注意需要把每一项分别取倒数。"
  ],
  [
    "方大招",
    "来，咱们练一道。三个电阻并联，R1是4欧，R2是10欧，R3是20欧。已知P2是10瓦，求P1、P3。我们可以先算算它们的功率之比。"
  ],
  [
    "金天练",
    "电阻比是2比5比10。那功率比简单！我直接反过来写，也就是成10比5比2吗？"
  ],
  [
    "方大招",
    "金天练，又“拍脑袋”了，注意啦！不能直接调换顺序。需要对每个阻值取倒数，是把2变成二分之一，5变成五分之一，10变成十分之一。所以功率比是二分之一比五分之一比十分之一。来化简一下，三项同时乘10，得到电功率之比为5比2比1。"
  ],
  [
    "方大招",
    "接着看题目给的P2，代入公式里，它对应中间的2份，2份是10瓦，所以一份是5瓦。P1占5份，就是25瓦；P3占1份，就是5瓦。"
  ],
  [
    "方大招",
    "算完再核对一下：三个电阻并联，4欧的电阻最小，功率最大，是25瓦；20欧的电阻最大，功率最小，是5瓦，完全符合反比关系！"
  ],
  [
    "金天练",
    "我学会啦，这俩结论可太好用了。"
  ],
  [
    "方大招",
    "来，简单回顾一下，这节课，你就记住三个公式、两个比例关系就行。对于纯电阻电路的电功率，有三个计算公式。P等于UI，还等于I方R、U方除以R。而对于电功率的比例关系：串联成正比，并联成反比。遇到三个电阻的情况，也是完全一样的。注意并联电阻，每一项分别取倒数，再化简成整数比。"
  ],
  [
    "方大招",
    "赶紧收藏笔记，练起来吧~"
  ]
]



const cue = (line: number, phrase?: string) => ({ utteranceId: 'u' + (line + 1), ...(phrase ? { phrase } : {}) })
const step = (id: string, latex: string, line: number, phrase?: string, action: FormulaStep['action'] = 'write', caption?: string): FormulaStep =>
  ({ id, latex, cue: cue(line, phrase), action, caption })
const shot = (number: number, chapter: number, title: string, summary: string, lines: number[], circuitAssetId: string | undefined, formulas: FormulaStep[], notes: string[] = []): Shot => ({
  id: 'shot-' + number, chapter, title, summary, utteranceIds: lines.map(i => 'u' + (i + 1)), circuitAssetId, formulas,
  actions: circuitAssetId ? [{ id: 'draw-' + number, type: 'draw', targetIds: ['r1', ...(number > 3 ? ['r2'] : []), ...(number >= 8 && number <= 11 ? ['r3'] : [])], cue: cue(lines[0]) }] : [],
  reviewNotes: notes, holdSeconds: 1.5,
})

export function powerLessonShots(): Shot[] {
  const shots = [
    shot(1, 1, '没给电压，怎样求功率？', '回顾电功率，呈现单电阻题设；先保留未知电压。', [0, 1], 'single', [
      step('s1-power', 'P=UI', 0, '基本公式'),
      step('s1-given', 'R=8\\,\\Omega,\\quad I=2\\,\\mathrm A,\\quad P=?', 0, '比如'),
    ], ['原稿“基本公式”保留。画面呈现计算式 P=UI，不把它标为定义式。']),
    shot(2, 1, '从两步计算到一个公式', '求电压、求功率，再把两步合并；电路布局保持稳定。', [2, 3], 'single', [
      step('s2-voltage', 'U=IR=2\\times8=16\\,\\mathrm V', 2, '电压等于', 'substitute'),
      step('s2-power', 'P=UI=16\\times2=32\\,\\mathrm W', 2, '再乘上', 'result'),
      step('s2-combine', 'P=UI=(IR)I=I^2R', 3, '把这两步合起来', 'transform'),
      step('s2-direct', 'P=2^2\\times8=32\\,\\mathrm W', 3, '回到这道题', 'result'),
    ]),
    shot(3, 1, '三个公式，同一个功率', '用欧姆定律代入，建立三个公式卡片，明确纯电阻条件。', [4, 5], undefined, [
      step('s3-ohm', 'I=\\frac{U}{R}', 4, '根据欧姆定律'),
      step('s3-substitute', 'P=UI=U\\frac{U}{R}=\\frac{U^2}{R}', 4, '把它代入', 'substitute'),
      step('s3-summary', 'P=UI=I^2R=\\frac{U^2}{R}', 5, undefined, 'result', '适用于本课的纯电阻电路'),
    ]),
    shot(4, 2, '串联例题：先求电流', '4 Ω 与 12 Ω 串联，展示常规计算路径。', [6, 7, 8], 'series2', [
      step('s4-given', 'R_1=4\\,\\Omega,\\quad R_2=12\\,\\Omega', 6, 'R1是'),
      step('s4-known', 'P_1=16\\,\\mathrm W,\\quad P_2=?', 6, '已知'),
      step('s4-current', 'I^2=\\frac{P_1}{R_1}=\\frac{16}{4}=4,\\quad I=2\\,\\mathrm A', 8, '根据', 'substitute'),
      step('s4-result', 'P_2=I^2R_2=2^2\\times12=48\\,\\mathrm W', 8, '再算', 'result'),
    ]),
    shot(5, 2, '串联：功率与电阻成正比', '强调同一电流，约去 I²；用比例再次解题。', [9, 10, 11], 'series2', [
      step('s5-same', 'I_1=I_2=I', 9, '同一个电流', 'write', '串联电路：电流相同'),
      step('s5-ratio', '\\frac{P_1}{P_2}=\\frac{I^2R_1}{I^2R_2}', 10, 'P1除以P2'),
      step('s5-cancel', '\\frac{P_1}{P_2}=\\frac{R_1}{R_2}', 10, '平方一约', 'cancel', '共同的 I² 约去'),
      step('s5-values', 'P_1:P_2=R_1:R_2=4:12=1:3', 11, 'R1比R2', 'ratio'),
      step('s5-result', 'P_2=3P_1=16\\times3=48\\,\\mathrm W', 11, 'P2是', 'result'),
    ]),
    shot(6, 2, '并联：功率与电阻成反比', '突出两端共同节点与相同电压，推导倒数比。', [12, 13, 14], 'parallel2-symbolic', [
      step('s6-same', 'U_1=U_2=U', 13, '电压相同', 'write', '并联电路：电压相同'),
      step('s6-each', 'P_1=\\frac{U^2}{R_1},\\quad P_2=\\frac{U^2}{R_2}', 13, 'P1等于'),
      step('s6-ratio', '\\frac{P_1}{P_2}=\\frac{U^2/R_1}{U^2/R_2}', 13, '把它们相除'),
      step('s6-cancel', '\\frac{P_1}{P_2}=\\frac{1/R_1}{1/R_2}=\\frac{R_2}{R_1}', 13, '相同的U', 'cancel'),
      step('s6-rule', 'P_1:P_2=\\frac{1}{R_1}:\\frac{1}{R_2}', 14, undefined, 'result', '相同电压下，功率之比等于电阻倒数之比'),
    ], ['原稿“各部分电功率大小等于电阻的倒数比”措辞待审核；保持旁白原文，画面明确表达功率之比。']),
    shot(7, 2, '并联例题：按份数计算', '10 Ω、15 Ω 并联；已知 9 W，求出另一支路 6 W。', [15], 'parallel2', [
      step('s7-given', 'R_1=10\\,\\Omega,\\ R_2=15\\,\\Omega,\\ P_1=9\\,\\mathrm W', 15),
      step('s7-ratio', 'R_1:R_2=2:3\\quad\\Longrightarrow\\quad P_1:P_2=3:2', 15, '电阻比', 'ratio'),
      step('s7-unit', '\\frac{P_1}{3}=\\frac{9}{3}=3\\,\\mathrm W', 15, '一份', 'substitute', '每份 3 W'),
      step('s7-result', 'P_2=2\\times3=6\\,\\mathrm W', 15, 'P2对应', 'result'),
    ]),
    shot(8, 3, '三个电阻串联，也成正比', '先选择公式，再展示三项共同因子的消去。', [16, 17, 18], 'series3-symbolic', [
      step('s8-series-choice', 'P=I^2R', 17, '串联时选这个', 'write', '串联：电流相同'),
      step('s8-parallel-choice', 'P=\\frac{U^2}{R}', 17, '并联时选这个', 'transform', '并联：电压相同'),
      step('s8-each', 'P_1:P_2:P_3=I^2R_1:I^2R_2:I^2R_3', 18, '三个功率'),
      step('s8-cancel', 'P_1:P_2:P_3=R_1:R_2:R_3', 18, '共同的', 'cancel', '三个电阻串联：功率与电阻成正比'),
    ]),
    shot(9, 3, '三个电阻并联，逐项取倒数', '强调共同电压，三个功率逐项写成 U²/R。', [19, 20], 'parallel3-symbolic', [
      step('s9-each', 'P_1:P_2:P_3=\\frac{U^2}{R_1}:\\frac{U^2}{R_2}:\\frac{U^2}{R_3}', 19, '三个功率'),
      step('s9-cancel', 'P_1:P_2:P_3=\\frac1{R_1}:\\frac1{R_2}:\\frac1{R_3}', 19, '共同的', 'cancel'),
      step('s9-reciprocal', '\\frac1{R_1}:\\frac1{R_2}:\\frac1{R_3}', 20, '每一项', 'reciprocal', '分别取倒数，再化简'),
    ]),
    shot(10, 3, '三个电阻并联：倒序就行吗？', '显示题设，让学生的错误猜想完整出现。', [21, 22], 'parallel3', [
      step('s10-given', 'R_1=4\\,\\Omega,\\ R_2=10\\,\\Omega,\\ R_3=20\\,\\Omega', 21),
      step('s10-known', 'P_2=10\\,\\mathrm W,\\quad P_1=?,\\quad P_3=?', 21, '已知'),
      step('s10-r', 'R_1:R_2:R_3=2:5:10', 22, '电阻比', 'ratio'),
      { ...step('s10-wrong', 'P_1:P_2:P_3\\stackrel{?}{=}10:5:2', 22, '直接反过来', 'ratio', '金天练的猜想 · 下一段检验'), role: 'misconception' as const, correctionStepId: 's11-reciprocal' },
    ], ['保留金天练的故意错误；不可把猜想当成已确认结论。']),
    shot(11, 3, '纠错：倒数不是倒序', '逐项取倒数、同时乘 10，再按份数求解和核对大小。', [23, 24, 25], 'parallel3', [
      { ...step('s11-recap', '10:5:2\\quad\\text{?}', 23, undefined, 'write', '不能直接调换顺序'), role: 'misconception' as const, correctionStepId: 's11-reciprocal' },
      step('s11-start', 'R_1:R_2:R_3=2:5:10', 23, '需要对每个', 'write', '分别取倒数，保持对应顺序'),
      step('s11-first', '2:5:10\\quad\\longrightarrow\\quad\\frac12:?:?', 23, '是把2', 'reciprocal'),
      step('s11-second', '2:5:10\\quad\\longrightarrow\\quad\\frac12:\\frac15:?', 23, '5变成', 'reciprocal'),
      step('s11-reciprocal', '2:5:10\\quad\\longrightarrow\\quad\\frac12:\\frac15:\\frac1{10}', 23, '10变成', 'reciprocal'),
      step('s11-ratio', 'P_1:P_2:P_3={5}:{2}:{1}', 23, '三项同时乘10', 'ratio', '逐项乘 10，得到整数比'),
      step('s11-unit', '\\frac{P_2}{2}=\\frac{10}{2}=5\\,\\mathrm W', 24, '一份', 'substitute', '中间两份是 10 W，每份 5 W'),
      step('s11-result', 'P_1=5\\times5=25\\,\\mathrm W,\\quad P_3=1\\times5=5\\,\\mathrm W', 24, 'P1占', 'result'),
      step('s11-check', '4<10<20\\quad\\Longrightarrow\\quad25>10>5', 25, '4欧', 'result', '相同电压：电阻最小，功率最大'),
    ]),
    shot(12, 3, '三个公式，两个比例关系', '师生总结；把纯电阻条件和逐项取倒数留在笔记卡上。', [26, 27, 28], undefined, [
      step('s12-formulas', 'P=UI=I^2R=\\frac{U^2}{R}', 27, '三个计算公式', 'result', '纯电阻电路的电功率'),
      step('s12-series', 'P_1:P_2:P_3=R_1:R_2:R_3', 27, '串联成正比', 'ratio', '串联：电流相同'),
      step('s12-parallel', 'P_1:P_2:P_3=\\frac1{R_1}:\\frac1{R_2}:\\frac1{R_3}', 27, '并联成反比', 'ratio', '并联：电压相同'),
      step('s12-note', '2:5:10\\quad\\longrightarrow\\quad\\frac12:\\frac15:\\frac1{10}=5:2:1', 27, '每一项分别取倒数', 'reciprocal', '每项取倒数，再化简成整数比'),
    ]),
  ]
  // Semantic IDs persist across steps; every isolated fragment is valid TeX.
  const namedTerms = [
    ['current-squared', 'I^2'], ['voltage-squared', 'U^2'],
    ['resistance-1', 'R_1'], ['resistance-2', 'R_2'], ['resistance-3', 'R_3'],
    ['power-1', 'P_1'], ['power-2', 'P_2'], ['power-3', 'P_3'],
  ]
  for (const s of shots) for (const f of s.formulas) {
    f.parts = namedTerms.filter(([, latex]) => f.latex.includes(latex)).map(([id, latex]) => ({ id, latex }))
    const reciprocals = ['\\frac12', '\\frac15', '\\frac1{10}']
    if (reciprocals.some(latex => f.latex.includes(latex))) {
      f.parts = reciprocals.flatMap((latex, i) => f.latex.includes(latex) ? [{ id: 'ratio-term-' + (i + 1), latex }] : [])
    }
    if (f.id === 's11-ratio') f.parts = ['{5}', '{2}', '{1}'].map((latex, i) => ({ id: 'ratio-term-' + (i + 1), latex }))
  }
  for (const [index, targets, line, phrase] of [
    [4, ['r1', 'r2'], 9, '同一个电流'], [5, ['r1', 'r2'], 13, '电压相同'],
    [8, ['r1', 'r2', 'r3'], 19, '电压相同'], [10, ['r1'], 25, '4欧'], [10, ['r3'], 25, '20欧'],
  ] as [number, string[], number, string][]) shots[index].actions.push({ id: 'emphasis-' + index + '-' + targets[0], type: 'highlight', targetIds: targets, cue: cue(line, phrase) })
  // The generic formula choice must not show a series diagram while discussing parallel voltage.
  shots[7].actions = [{ id: 'draw-series3', type: 'draw', targetIds: ['circuit'], cue: cue(18, '那么对于三个电阻串联') }]
  shots[11].layout = { template: 'summary', elements: {} }
  return shots
}

