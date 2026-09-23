import type { EchoSample } from './types'

// Teaching examples deliberately use complete, synthetic data; they are not quoted exam answers.
export const echoExamples: EchoSample[] = [
  { id: 'demo-approach', title: '汽车驶向山崖', modelId: 'approaching', keywords: ['驶向', '山崖', '鸣笛'], text: '一辆汽车以72 km/h的速度匀速驶向山崖，司机鸣笛后2 s听到回声。声音在空气中的传播速度为340 m/s。求汽车在这段时间内行驶的路程、鸣笛时和听到回声时到山崖的距离。' },
  { id: 'demo-still', title: '静止回声测距', modelId: 'stationary', keywords: ['静止', '回声'], text: '一辆汽车静止在公路旁，司机向高山鸣笛，经过3 s听到回声。空气中声速为340 m/s。求汽车距离高山多远。' },
  { id: 'demo-away', title: '列车驶离山崖', modelId: 'receding', keywords: ['驶离', '山崖'], text: '一列火车以30 m/s的速度匀速驶离山崖，司机鸣笛后2 s听到山崖反射的回声。声音的传播速度为340 m/s。求发声时及听到回声时到山崖的距离。' },
  { id: 'demo-drone', title: '无人机下降测高', modelId: 'descending', keywords: ['无人机', '下降', '地面'], text: '某无人机以10 m/s的速度竖直匀速下降，向地面发射超声波，从发射到接收到回声用时0.2 s。已知声速为340 m/s。求接收到回声时离地面的高度。' },
  { id: 'demo-up', title: '无人机上升测高', modelId: 'ascending', keywords: ['无人机', '上升', '地面'], text: '无人机以5 m/s的速度竖直匀速上升，同时向地面发射超声波，经过0.4 s接收到回声。声速为340 m/s。求发声时和接收时离地面的高度。' },
  { id: 'demo-depth', title: '声呐测量水深', modelId: 'depth', keywords: ['声呐', '海底', '深度'], text: '一艘测量船静止在海面，利用声呐向海底发射超声波，经过0.8 s接收到回声。声音在海水中的传播速度为1500 m/s。求此处海水深度。' },
  { id: 'demo-tunnel', title: '回声与列车过隧道', modelId: 'approaching', keywords: ['隧道', '完全通过', '列车'], text: '一列长度为200 m的列车以20 m/s的速度匀速驶向隧道口。司机鸣笛后2 s听到回声，声音在空气中的传播速度为340 m/s。列车完全通过长1000 m的隧道。求鸣笛时和听到回声时离隧道口的距离、完全通过隧道的时间及整列车完全被遮住的时间。' },
  { id: 'demo-moving', title: '汽车追近无人机', modelId: 'moving-target', keywords: ['汽车', '无人机', '同向', '反射信号'], text: '一辆汽车以20 m/s的速度匀速行驶，在正前方300 m处，一架无人机以10 m/s的速度与汽车同向匀速飞行。汽车向无人机发出超声波信号，无人机收到后立即反射信号到汽车。声音传播速度为340 m/s。求信号往返时间和汽车接收时两者的距离。' },
  { id: 'demo-deceleration', title: '两次鸣笛与减速', modelId: 'decelerating', keywords: ['再次', '减速', '第二次'], text: '汽车向前方牌楼行驶，第一次鸣笛后立即减速，经过2 s听到回声，此时车速为10 m/s。司机紧接着再次鸣笛并保持匀速，1.8 s后再次听到回声。声速为340 m/s。求第一次鸣笛时的距离和减速过程的路程。' },
  { id: 'demo-two', title: '两车接收直达声与回声', modelId: 'two-receivers', keywords: ['甲车', '乙车', '两次声音'], text: '甲、乙两车正在匀速驶离隧道口。甲车距隧道口200 m时鸣笛，乙车在它后方100 m处，以10 m/s的速度行驶。声音速度为340 m/s。求乙车司机听到直达声和回声的时间间隔。' },
  { id: 'demo-parking', title: '超声波扫描车位', modelId: 'parking', keywords: ['车位', '侧方雷达', '图像'], text: '无人驾驶汽车以2 m/s的速度缓慢行驶，侧方雷达不断向左侧发出超声波。根据超声波往返时间与车辆运动时间的图像，计算车位的长与宽，并判断是否满足停车要求。' },
]
