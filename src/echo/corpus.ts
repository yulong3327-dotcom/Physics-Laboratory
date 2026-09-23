import type { EchoModelId } from './types'

export interface EchoCorpusCase {
  id: string
  title: string
  text: string
  expectedModelId: EchoModelId | null
  /** Explicit givens only, converted to SI; derived answers are kept separately. */
  expectedParameters?: Record<string, number>
  /** Fields that must not be invented or taken from a different subquestion. */
  absentParameters?: string[]
  /** Reference targets: result field names or `extra:<label>` for extensions. */
  expectedResults?: Record<string, number>
  requiredMissing?: string[]
  blocker?: 'missing-sound-speed' | 'missing-diagram' | 'unsupported-model'
  notes?: string[]
  /** Independent scenarios assembled from the same source stem, without solutions. */
  cases?: EchoCorpusCase[]
}

/** Source text is cut before 【解析】. Reference answers never enter parser inputs. */
const stems: Record<number, string> = {
  "1": "一辆沿平直公路匀速行驶的汽车 ，在距前面山脚隧道口360m的A处鸣笛 ，经过2s后在B处听到回声。若汽车长度忽略不计 ，已知空气中声音的传播速度为340m/s ，求：\n(1)鸣笛声从发出到反射传回驾驶员耳中通过的路程。\n(2)汽车行驶的速度。\n(3)听到回声后 ，汽车行驶到隧道口还需要多长时间。",
  "2": "一辆汽车以10m/s的速度向山崖匀速行驶 ，在某处鸣笛后 ，经5s听到了回声 ，求鸣笛处距离山崖有多远？",
  "3": "长度为400m的火车在笔直的轨道上匀速行驶 ，如图所⽰ ，在从山崖驶向大桥的过程中 ，司机在火车头距离桥头\n200m处鸣笛 ，鸣笛8s后 ，火车头到达桥头 ，此时车头的司机听到来自山崖的回声；听到回声20s后 ，火车尾驶过桥尾。（ 已知声音在空气中的传播速度为v声  = 340m/s)\n\n求：\n(1)火车的速度；\n(2)大桥的长度；\n(3)鸣笛时 ，火车车头到山崖的距离。",
  "4": "在小明一家乘车前行的路上 ，正前方有一座山 ，汽车以20m/s的速度匀速向山靠近 ，在某一位置处汽车鸣笛 ，经过5秒后小明听到回声。 (v声  = 340m/s)求：\n(1)汽车鸣笛到小明听到回声 ，汽车行驶的路程车？\n(2)汽车鸣笛到小明听到回声 ，声音传播的路程声？\n(3)听到回声时开始计时 ，汽车还要多久到达山脚？",
  "5": "一辆匀速行驶的汽车在离高楼350m处鸣笛 ，汽车直线向前行驶20m后 ，司机刚好听到鸣笛的回声 ，求汽车的速度(声音在空气中的传播速度是340m/s)",
  "6": "一潜艇静止在海面下 ，潜艇通过声呐系统竖直向下发射超声波 ，经过3s接收到了海底反射回来的超声波信号。超声波在海水中传播的速度取1500m/s ，求：\n(1)静止在海面下的潜艇距海底的距离；\n(2)当潜艇在水面下水平匀速直线航行时 ，向其正前方3030m处的暗礁发射超声波 ，经过4s接收到了暗礁反射回来的超声波信号，此时潜艇匀速直线航行的速度。",
  "7": "一辆汽车向着山崖以15m/s的速度匀速行驶 ，在距离山崖一定距离的地方鸣笛 ，经过0 . 8s后司机听到了回声。（ 已知声音在空气中的传播速度为340m/s)求：\n(1)汽车行驶的距离；\n(2)声音传播的距离；\n(3)听到回声时汽车距山崖多远。",
  "8": "如图所⽰ ，一列火车长为300m ，匀速通过一条长为2700m的隧道。测得火车完全通过隧道用时100s。通过隧道后 ，火车继续前进。前进途中司机按下汽笛向着对面的山崖鸣笛一声 ，4s后他听到回声。声音在空气中的传播速度取340m/s。 求：\n(1)火车全部在隧道内运行的时间为多少？\n(2)司机听到回声时火车到山崖的距离为多少？",
  "9": "一辆汽车以40m/s的速度朝山崖匀速行驶 ，在距山崖不远处鸣笛 ，经过4s后便听到了从山崖反射回来的回声。求：\n(1)4s内汽车通过的路程。\n(2)听见回声时到山崖的距离。",
  "10": "一辆汽车以20m/s的速度沿水平方匀速行驶 ，行驶至某处时向正前方的山崖鸣笛。若声音在空气中的传播速度为340m/s ，司机在鸣笛后3s听到回声 ，求：\n(1)司机鸣笛时到山崖的距离；\n(2)司机听到回声时到山崖的距离。",
  "11": "有一辆汽车以36km/h的速度匀速向山崖开过来 ，司机按了一声喇叭 ，经4s后听到回声 ，(声音在15  C空气中的传播速度是340m/s)问：\n(1)4s内汽车的路程是多少？\n(2)听到回声处离山崖有多远？\n(3)鸣笛处离山崖有多远？",
  "12": "一辆汽车在匀速行驶 ，道路前方有一座高山 。（ 空气中声速为340m/s)\n(1)司机鸣笛并在6s后听到回声 ，若汽车行驶速度为20m/s ，求司机听到回声时到高山的距离是多少m？\n(2)与此同时 ，一辆复兴号列车 ，车身长428m ，正以68m/s的速度驶入长2000m的平直隧道 ，复兴号列车在进入隧道时鸣笛8s，求在隧道另一端口的护路工人听到鸣笛的持续时间为多少？",
  "13": "某厂家在一平直公路上对汽车的自动刹车功能进行测试。该功能在速度v ≥ 30km/h被激活 ，当\n60km/h ≥ v ≥ 30km/h时 ，距离前方物体10m自动刹车； 当80km/h ≥ v > 60km/h时 ，距离前方物体15m自动刹车。\n(1)汽车①匀速通过相距18km的两点 ，时钟显⽰如图1所⽰ 。则通过这两点的时间为           h ，汽车①的速度为多少km/h。\n(2)汽车①和②同时匀速通过图2所⽰的两个标志点（汽车①保持(1)中的速度） 开始计时 ，同时汽车①向前发出一束超声波 ，再经过0 . 68s接收到返回的超声波 ，则从计时开始算起 ，多少秒后自动刹车功能启动。（ 空气中超声波的速度取340m/s)",
  "14": "我国现已成为高铁通车里程最长的国家。高铁是由多节车厢编组而成的 ，一节车厢的长度是25m。 国庆节妈妈带小红从遂宁站乘高铁去北京旅游。 当高铁以60m/s的速度匀速直线行驶 ，在距离隧道1000米处鸣笛 ，经过           s司机可听到回\n\n\n声；随后穿过一条长1600m的隧道 ，需要30s ，则该高铁是由           节车厢编组而成。",
  "15": "无人机在空中巡逻时发现有一列长度为400m ，运行速度为108km/h的列车要通过一条隧道。列车在进入隧道前向前方鸣笛 ，2s后司机听到隧道口处峭壁反射的回声。（声音在空气中的速度为340m/s)\n\n(1)从司机鸣笛到听到回声 ，列车行驶了多远？\n(2)列车听到回声时离隧道口有多远？\n(3)若隧道长1900m ，则无人机有多长时间完全拍不到列车？",
  "16": "随着芯片算力的提升 ，无人驾驶技术也逐渐成熟。某台无人驾驶汽车 ，车长5m ，宽2m ，能够自动驾驶到指定位置 ，还能利用超声波自动寻找车位停入。\n\n(1)超声波的频率范围为          。\n(2)在平直路段上 ，该无人驾驶汽车由第一根路灯杆行驶到第五根路灯杆用时10s。 已知相邻路灯杆间的距离为25m ，则这段时间内汽车的平均速度为多少？\n(3)图甲为“车辆自动检测停车位” 的简化原理图 ，当车辆缓慢行驶时 ，其侧方雷达向左侧不断地发出超声波信号 ，超声波遇到障碍物立即原路返回并被车辆接收 ，车辆根据超声波往返所用时间、超声波的传播速度以及车辆的行驶速度 ，可计算出车位的大小。图乙为该车从A处以1 . 2m/s的速度匀速行驶到B处时 ，车辆发出的超声波往返所用时间to与车辆运动时间t的图像。请计算此车位的长与宽 ，并判断该车位是否满足该车停放。（超声波的速度为340m/s)",
  "17": "一辆汽车以72km/h的速度匀速行驶向山崖 ，司机在距山崖一定距离处鸣笛 ，2s后听到回声。 已知声音在空气中的传播速度为340m/s ，求：\n(1)汽车在2s内行驶的路程；\n(2)鸣笛时汽车距山崖的距离。"
}

const part = (number: number, index: number) => stems[number].split(new RegExp(`\\(${index}\\)`))[1].split(/\(\d+\)/)[0].trim()

/** 17 original problems, including two compound problems with independent cases. */
export const echoCorpus: EchoCorpusCase[] = [
  {
    id: 'q01', title: '01 · 隧道口回声反求车速', text: stems[1], expectedModelId: 'approaching',
    expectedParameters: { initialDistance: 360, echoTime: 2, soundSpeed: 340 },
    absentParameters: ['sourceSpeed'],
    expectedResults: { soundTravel: 680, sourceSpeed: 20, finalDistance: 320, 'extra:听到回声后到达目标还需时间': 16 },
  },
  {
    id: 'q02', title: '02 · 汽车靠近山崖（题干未给声速）', text: stems[2], expectedModelId: 'approaching',
    expectedParameters: { sourceSpeed: 10, echoTime: 5 }, absentParameters: ['soundSpeed'],
    requiredMissing: ['soundSpeed'], blocker: 'missing-sound-speed',
    notes: ['题干没有声速；参考解析自行采用 340 m/s，该假设不能作为题干输入。'],
  },
  {
    id: 'q03', title: '03 · 列车远离山崖与过桥', text: stems[3], expectedModelId: 'receding',
    expectedParameters: { trainLength: 400, sourceTravel: 200, echoTime: 8, passTime: 20, soundSpeed: 340 },
    absentParameters: ['initialDistance', 'sourceSpeed'],
    expectedResults: { sourceSpeed: -25, initialDistance: 1260, 'extra:隧道 / 大桥长度': 100 },
    notes: ['200 m 是鸣笛至接收期间列车的位移，不是列车到山崖的距离。sourceSpeed 结果采用朝向反射面的有符号速度。'],
  },
  {
    id: 'q04', title: '04 · 汽车接收回声后到达山脚', text: stems[4], expectedModelId: 'approaching',
    expectedParameters: { sourceSpeed: 20, echoTime: 5, soundSpeed: 340 },
    expectedResults: { sourceTravel: 100, soundTravel: 1700, finalDistance: 800, 'extra:听到回声后到达目标还需时间': 40 },
  },
  {
    id: 'q05', title: '05 · 已知鸣笛距离和汽车位移', text: stems[5], expectedModelId: 'approaching',
    expectedParameters: { initialDistance: 350, sourceTravel: 20, soundSpeed: 340 },
    absentParameters: ['sourceSpeed', 'echoTime'],
    expectedResults: { sourceSpeed: 10, echoTime: 2, soundTravel: 680 },
  },
  {
    id: 'q06', title: '06 · 潜艇测深与向暗礁航行', text: stems[6], expectedModelId: null,
    notes: ['静止测深与水平航行是两个独立场景；先分题，再分别匹配。'],
    cases: [
      {
        id: 'q06a', title: '06(1) · 潜艇静止测深', text: `${stems[6].split('(1)')[0].trim()}\n(1)${part(6, 1)}`, expectedModelId: 'depth',
        expectedParameters: { echoTime: 3, soundSpeed: 1500 }, absentParameters: ['sourceSpeed'],
        expectedResults: { initialDistance: 2250 },
      },
      {
        id: 'q06b', title: '06(2) · 潜艇靠近暗礁', text: `超声波在海水中传播的速度取1500m/s。\n(2)${part(6, 2)}`, expectedModelId: 'approaching',
        expectedParameters: { initialDistance: 3030, echoTime: 4, soundSpeed: 1500 }, absentParameters: ['sourceSpeed'],
        expectedResults: { sourceSpeed: 15 },
        notes: ['只复用题干中两小问共有的海水声速，没有从解析补充数值。'],
      },
    ],
  },
  {
    id: 'q07', title: '07 · 小数时间 0 . 8 s 的回声', text: stems[7], expectedModelId: 'approaching',
    expectedParameters: { sourceSpeed: 15, echoTime: 0.8, soundSpeed: 340 },
    expectedResults: { sourceTravel: 12, soundTravel: 272, finalDistance: 130 },
  },
  {
    id: 'q08', title: '08 · 由过隧道条件求车速后测距', text: stems[8], expectedModelId: 'approaching',
    expectedParameters: { trainLength: 300, tunnelLength: 2700, passTime: 100, echoTime: 4, soundSpeed: 340 },
    absentParameters: ['sourceSpeed'],
    expectedResults: { sourceSpeed: 30, finalDistance: 620, 'extra:整列车完全在隧道内的时间': 80 },
  },
  {
    id: 'q09', title: '09 · 汽车 40 m/s（题干未给声速）', text: stems[9], expectedModelId: 'approaching',
    expectedParameters: { sourceSpeed: 40, echoTime: 4 }, absentParameters: ['soundSpeed'],
    requiredMissing: ['soundSpeed'], blocker: 'missing-sound-speed',
    notes: ['题干未给声速。汽车路程 160 m 可独立计算，但回声距离缺少声速。'],
  },
  {
    id: 'q10', title: '10 · 日照汽车鸣笛与接收距离', text: stems[10], expectedModelId: 'approaching',
    expectedParameters: { sourceSpeed: 20, echoTime: 3, soundSpeed: 340 },
    expectedResults: { initialDistance: 540, finalDistance: 480 },
  },
  {
    id: 'q11', title: '11 · 36 km/h 单位换算', text: stems[11], expectedModelId: 'approaching',
    expectedParameters: { sourceSpeed: 10, echoTime: 4, soundSpeed: 340 },
    expectedResults: { sourceTravel: 40, initialDistance: 700, finalDistance: 660 },
  },
  {
    id: 'q12', title: '12 · 汽车回声与工人听笛时长', text: stems[12], expectedModelId: null,
    notes: ['汽车接收自身回声、工人接收列车直达声，必须拆成两个模型。'],
    cases: [
      {
        id: 'q12a', title: '12(1) · 汽车靠近高山', text: `${stems[12].split('(1)')[0].trim()}\n(1)${part(12, 1)}`, expectedModelId: 'approaching',
        expectedParameters: { sourceSpeed: 20, echoTime: 6, soundSpeed: 340 },
        absentParameters: ['trainLength', 'tunnelLength'], expectedResults: { finalDistance: 960 },
      },
      {
        id: 'q12b', title: '12(2) · 工人听到连续鸣笛', text: `空气中声速为340m/s。\n(2)${part(12, 2)}`, expectedModelId: 'two-receivers',
        expectedParameters: { sourceSpeed: 68, trainLength: 428, tunnelLength: 2000, soundSpeed: 340 },
        absentParameters: ['echoTime'], blocker: 'unsupported-model',
        expectedResults: { 'extra:听到鸣笛的持续时间': 6.4 },
        notes: ['8 s 是发声持续时间，不是回声往返时间；独立结果为 8 × (1 − 68 / 340) = 6.4 s。当前模型仅识别。'],
      },
    ],
  },
  {
    id: 'q13', title: '13 · 自动刹车（需图 1、图 2）', text: stems[13], expectedModelId: 'moving-target',
    expectedParameters: { echoTime: 0.68, soundSpeed: 340 },
    absentParameters: ['sourceSpeed', 'targetSpeed', 'initialDistance'], blocker: 'missing-diagram',
    notes: ['阈值 30/60/80 km/h 不等于汽车实际速度。时钟读数、初始车距及方向来自未附的图，不能从解析补齐。'],
  },
  {
    id: 'q14', title: '14 · 高铁回声与车厢节数（未给声速）', text: stems[14], expectedModelId: 'approaching',
    expectedParameters: { sourceSpeed: 60, initialDistance: 1000, tunnelLength: 1600, passTime: 30, carriageLength: 25 },
    absentParameters: ['soundSpeed', 'echoTime', 'trainLength'], requiredMissing: ['soundSpeed'], blocker: 'missing-sound-speed',
    notes: ['25 m 是一节车厢长度，不是全列车长度。由通行条件可得车长 200 m、8 节；回声时间仍缺声速。'],
  },
  {
    id: 'q15', title: '15 · 无人机观察列车被隧道遮挡', text: stems[15], expectedModelId: 'approaching',
    expectedParameters: { trainLength: 400, sourceSpeed: 30, echoTime: 2, soundSpeed: 340, tunnelLength: 1900 },
    expectedResults: { sourceTravel: 60, finalDistance: 310, 'extra:整列车完全在隧道内的时间': 50 },
  },
  {
    id: 'q16', title: '16 · 超声波寻找车位（需扫描图）', text: stems[16], expectedModelId: 'parking',
    expectedParameters: { sourceSpeed: 1.2, soundSpeed: 340 },
    absentParameters: ['echoTime', 'initialDistance'], blocker: 'missing-diagram',
    notes: ['图像未附，无法得出扫描起止时刻及两档回波延迟。10 s 属于路灯平均速度小问；5 m / 2 m 是车身尺寸。'],
  },
  {
    id: 'q17', title: '17 · 72 km/h 汽车向山崖鸣笛', text: stems[17], expectedModelId: 'approaching',
    expectedParameters: { sourceSpeed: 20, echoTime: 2, soundSpeed: 340 },
    expectedResults: { sourceTravel: 40, initialDistance: 360 },
  },
]

/** 19 independent evaluation inputs; compound parents are not silently scored as one. */
export const echoCorpusCases: EchoCorpusCase[] = echoCorpus.flatMap(item => item.cases ?? [item])
