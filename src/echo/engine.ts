import type { EchoAnalysis, EchoMatch, EchoModelId, EchoParameter, EchoQuantity, EchoSample, EchoSolution, EchoTemplate } from './types'

export const parameterLabels: Record<EchoParameter, { label: string; unit: string }> = {
  soundSpeed: { label: '声音传播速度', unit: 'm/s' }, sourceSpeed: { label: '发射者速度', unit: 'm/s' },
  targetSpeed: { label: '反射目标速度', unit: 'm/s' }, echoTime: { label: '回声往返时间', unit: 's' },
  initialDistance: { label: '发射时的距离', unit: 'm' }, finalSpeed: { label: '接收时的速度', unit: 'm/s' },
  trainLength: { label: '列车长度', unit: 'm' }, tunnelLength: { label: '隧道 / 大桥长度', unit: 'm' },
  passTime: { label: '完全通过所用时间', unit: 's' },
  sourceTravel: { label: '回声期间运动的路程', unit: 'm' }, carriageLength: { label: '每节车厢长度', unit: 'm' },
}

export const echoTemplates: EchoTemplate[] = [
  { id: 'stationary', name: '静止回声测距', description: '发射和接收时位置不变，声音往返固定反射面。', keywords: ['静止', '停在', '站在', '停靠', '回声'], fields: ['soundSpeed', 'echoTime', 'initialDistance'], supported: true, formula: 'd = cT / 2' },
  { id: 'approaching', name: '匀速靠近反射面', description: '汽车、列车或船匀速靠近山崖、隧道口或岛礁。', keywords: ['驶向', '向着', '开过来', '正前方', '前方', '进入隧道前', '鸣笛'], fields: ['soundSpeed', 'sourceSpeed', 'echoTime', 'initialDistance'], supported: true, formula: 'd₀ = (c + v)T / 2；d₁ = (c − v)T / 2' },
  { id: 'receding', name: '匀速远离反射面', description: '发射者远离反射面，返程声音追上接收者。', keywords: ['驶离', '远离', '背向', '从山崖驶向大桥'], fields: ['soundSpeed', 'sourceSpeed', 'echoTime', 'initialDistance'], supported: true, formula: 'd₀ = (c − v)T / 2；d₁ = (c + v)T / 2' },
  { id: 'descending', name: '无人机下降测高', description: '无人机匀速下降，以地面为反射面。', keywords: ['无人机', '下降', '着陆', '地面', '高度'], fields: ['soundSpeed', 'sourceSpeed', 'echoTime', 'initialDistance'], supported: true, formula: 'h₀ = (c + v)T / 2；h₁ = (c − v)T / 2' },
  { id: 'ascending', name: '无人机上升测高', description: '无人机匀速上升，接收地面反射的超声波。', keywords: ['无人机', '上升', '升高', '地面', '高度'], fields: ['soundSpeed', 'sourceSpeed', 'echoTime', 'initialDistance'], supported: true, formula: 'h₀ = (c − v)T / 2；h₁ = (c + v)T / 2' },
  { id: 'depth', name: '声呐测深', description: '测量船静止或忽略测量期间位移，向海底发射声波。', keywords: ['海底', '海水深度', '测深', '水深', '湖底', '声呐'], fields: ['soundSpeed', 'echoTime', 'initialDistance'], supported: true, formula: 'h = cT / 2' },
  { id: 'moving-target', name: '同向移动目标反射', description: '后方发射者和前方反射目标同向匀速运动，信号反射回原发射者。', keywords: ['汽车与无人机', '同向', '反射信号', '反射回来的信号', '无人机反射', '两车'], fields: ['soundSpeed', 'sourceSpeed', 'targetSpeed', 'echoTime', 'initialDistance'], supported: true, formula: 'T = 2cd₀ / [(c − v目标)(c + v发射)]' },
  { id: 'decelerating', name: '减速与多次回声', description: '已匹配减速场景；需标注各段运动和每次鸣笛条件后扩展求解。', keywords: ['减速', '再次鸣', '第二次鸣', '两次鸣', '刹车'], fields: ['soundSpeed', 'sourceSpeed', 'finalSpeed', 'echoTime', 'initialDistance'], supported: false, formula: 'cT + x(T) = 2d₀；仅明确匀减速时 x(T) = (v₀ + v₁)T / 2' },
  { id: 'two-receivers', name: '不同接收者与两次声音', description: '区分声源、接收者和直达声 / 回声，需补充对象之间的位置关系。', keywords: ['乙车司机', '车尾', '工作人员', '第一次汽笛声', '两次声音', '听到两次', '护路工人'], fields: ['soundSpeed', 'sourceSpeed', 'targetSpeed', 'initialDistance'], supported: false, formula: '直达声与反射声分别求传播和接收位置的交点' },
  { id: 'parking', name: '超声波侧向扫描车位', description: '根据侧向回波图像和行驶区间计算车位，需要图像上的读数。', keywords: ['车位', '侧方雷达', '侧方', '停车位', '长与宽'], fields: ['soundSpeed', 'sourceSpeed'], supported: false, formula: '车位长度 = vΔt；深度差 = c(τ远 − τ近) / 2' },
]

const echoModelIds = new Set(echoTemplates.map(template => template.id))
for (const template of echoTemplates) {
  if (['approaching', 'receding', 'descending', 'ascending'].includes(template.id)) template.fields.push('sourceTravel')
}
const vehicle = /汽车|轿车|车辆|列车|火车|动车|高铁|洒水车|测量船|轮船|小船|潜艇|无人机|运载车|甲车|乙车|车甲|车乙/
const sound = /回声|回波|鸣笛|鸣喇叭|鸣笛声|汽笛|声呐|超声波|反射.{0,8}(?:声音|声波|信号)|听到.{0,8}声音/

function normalizeText(text: string): string {
  return text.slice(0, 100000).normalize('NFKC')
    .replace(/&#(?:x20|32);|&nbsp;/gi, ' ').replace(/<[^>]*>/g, ' ')
    // Reference exports contain worked answers. Only the statement may provide conditions.
    .replace(/【(?:解析|答案|参考答案|分析|知识点|难度|省份|来源|年份)】[\s\S]*?(?=【(?:主观题|单选题|多选题|填空题)】|$)/g, '')
    .replace(/【(?:主观题|单选题|多选题|填空题)】\s*\d+[.、]?/g, '')
    .replace(/(?:纠错\s*下载\s*修改记录|试题篮|拼题池|作业帮|精品\s*Lv\d+)/g, '')
    .replace(/\(?Tid\s*[:：]\s*\d+[^\n]*/gi, '')
    .replace(/20\d{2}(?:-20\d{2})?学年[^\n]*(?:试卷|练习试卷)[^\n]*/g, '')
    .replace(/20\d{2}\s*[·•][^\n]*/g, '')
    .replace(/(\d)\s*\.\s*(?=\d)/g, '$1.')
    .replace(/回\s*声/g, '回声')
    .replace(/\\_/g, '_').replace(/[\t\r ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

function ngrams(text: string): Set<string> {
  const compact = normalizeText(text).toLowerCase().replace(/[\d\s\p{P}\p{S}a-z]+/gu, '')
  const result = new Set<string>()
  for (let index = 0; index < compact.length - 1; index++) result.add(compact.slice(index, index + 2))
  return result
}

function similarity(first: Set<string>, second: Set<string>): number {
  if (!first.size || !second.size) return 0
  let common = 0
  first.forEach(item => { if (second.has(item)) common++ })
  return 2 * common / (first.size + second.size)
}

interface MeasuredToken { value: number; kind: 'speed' | 'time' | 'length'; raw: string; start: number; end: number }

function chineseNumber(input: string): number {
  if (/^[\d.+\-eE]+$/.test(input)) return Number(input)
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  if (input.includes('点')) {
    const [whole, fraction] = input.split('点')
    return chineseNumber(whole) + Number(`0.${Array.from(fraction).map(character => digits[character] ?? '').join('')}`)
  }
  let section = 0, digit = 0, total = 0
  for (const character of input) {
    if (character in digits) digit = digits[character]
    else if (character === '万') { total += (section + digit) * 10000; section = 0; digit = 0 }
    else { const factor = ({ 十: 10, 百: 100, 千: 1000 } as Record<string, number>)[character]; section += (digit || 1) * factor; digit = 0 }
  }
  return total + section + digit
}

function tokenizeQuantities(text: string): MeasuredToken[] {
  const quantity = /([+-]?(?:\d+(?:\.\d+)?(?:e[+-]?\d+)?|[零〇一二两三四五六七八九十百千万点]+?))\s*((?:千米|公里|米)\s*(?:\/|每)\s*(?:小时|时|秒)|(?:km|m)\s*\/\s*(?:h|s)|(?:km|m)\s*[·⋅*]?\s*(?:h|s)\s*\^?\s*\{?[-−]\s*1\}?|毫秒|微秒|分钟|小时|千米|公里|厘米|毫米|米|秒|km|cm|mm|ms|[μµu]s|min|m(?![a-z])|s(?![a-z])|h(?![a-z]))/gi
  const result: MeasuredToken[] = []
  for (const match of text.matchAll(quantity)) {
    const number = chineseNumber(match[1])
    const unit = match[2].replace(/\s+/g, '').toLowerCase()
    let kind: MeasuredToken['kind'] = 'length', scale = 1
    if (/\/|每|[-−]1/.test(unit)) {
      kind = 'speed'
      scale = /^(?:km|千米|公里)/.test(unit) ? 1000 : 1
      if (/(?:h|时)/.test(unit)) scale /= 3600
    } else if (/^(?:毫秒|微秒|分钟|小时|秒|ms|[μµu]s|min|s|h)$/.test(unit)) {
      kind = 'time'
      scale = /^(?:毫秒|ms)$/.test(unit) ? 0.001 : /^(?:微秒|[μµu]s)$/.test(unit) ? 0.000001 : /^(?:分钟|min)$/.test(unit) ? 60 : /^(?:小时|h)$/.test(unit) ? 3600 : 1
    } else scale = /^(?:千米|公里|km)$/.test(unit) ? 1000 : /^(?:厘米|cm)$/.test(unit) ? 0.01 : /^(?:毫米|mm)$/.test(unit) ? 0.001 : 1
    if (Number.isFinite(number * scale)) result.push({ value: number * scale, kind, raw: match[0], start: match.index!, end: match.index! + match[0].length })
  }
  return result
}

function extractQuantities(text: string, modelId: EchoModelId | null, warnings: string[]): Partial<Record<EchoParameter, EchoQuantity>> {
  const proposed = new Map<EchoParameter, EchoQuantity[]>()
  const add = (parameter: EchoParameter, token: MeasuredToken) => {
    const values = proposed.get(parameter) ?? []
    if (!values.some(value => Math.abs(value.value - token.value) < 1e-9)) values.push({ value: token.value, source: text.slice(Math.max(0, token.start - 18), Math.min(text.length, token.end + 18)).trim() })
    proposed.set(parameter, values)
  }
  // A choice is a proposed answer, not a given condition. Keep it out of parameter inference.
  const choicesAt = text.search(/(?:^|\n|。)\s*[A-D][.、:：]\s*/)
  const conditionText = choicesAt >= 0 ? text.slice(0, choicesAt) : text
  const tokens = tokenizeQuantities(conditionText)
  const allSpeedTokens = tokens.filter(token => token.kind === 'speed')
  for (const token of tokens) {
    const before = conditionText.slice(Math.max(0, token.start - 65), token.start)
    const after = conditionText.slice(token.end, Math.min(conditionText.length, token.end + 55))
    const beforeClause = (before.split(/[，,。；;！!？?\n]/).pop() ?? '').trim()
    const afterClause = after.split(/[，,。；;！!？?\n]/)[0].trim()
    if (token.kind === 'speed') {
      if (/[<>≤≥]\s*$/.test(beforeClause) || /^\s*[<>≤≥]/.test(afterClause)) continue
      if (/(?:声速|声音|声波|超声波|声音传播速度|c\s*[=＝]|v\s*(?:声|_\{?声\}?)\s*[=＝])[^，,。；;\n]{0,30}$/i.test(beforeClause)) { add('soundSpeed', token); continue }
      if (/^(?:为|是)?(?:声音|声波|超声波)(?:的)?(?:传播)?速度/.test(afterClause) || /^(?:的)?声速/.test(afterClause)) { add('soundSpeed', token); continue }
      if (/(?:减速至|减为|降为|末速度|最终速度|接收时速度|速度仪表盘|仪表盘)[^，,。；;\n]{0,15}$/.test(beforeClause)) { add('finalSpeed', token); continue }
      if (modelId === 'moving-target') {
        const local = beforeClause.slice(-40)
        const emitterName = conditionText.match(/(甲车|乙车|车甲|车乙|汽车[12]|[12]号车)(?:的)?[^，,。；;\n]{0,8}(?:发出|发射)/)?.[1]
        const pairedEntity = [...local.matchAll(/甲车|乙车|车甲|车乙|汽车[12]|[12]号车/g)].pop()?.[0]
        if (pairedEntity) {
          if (emitterName) add(pairedEntity === emitterName ? 'sourceSpeed' : 'targetSpeed', token)
          else warnings.push('已识别两辆车的速度，但尚未确定哪辆车发射并接收信号，请分别填写发射者和目标速度。')
          continue
        }
        if (/无人机[^。；;\n]{0,30}$/.test(local) || /(?:反射目标|目标)[^。；;\n]{0,20}$/.test(local)) { add('targetSpeed', token); continue }
      }
      if (/(?:工人|工作人员|养护车|同学|小超)[^。；;\n]{0,20}$/.test(beforeClause)) continue
      if (vehicle.test(before.slice(-35)) || /(?:行驶速度|运行速度|飞行速度|下降速度|上升速度|车速|船速|速度(?:为|是|取)?|v\s*[=＝])[^，,。；;\n]{0,8}$/i.test(beforeClause) || /^的速度/.test(afterClause)) { add('sourceSpeed', token); continue }
      if (allSpeedTokens.length === 1 && /(?:空气|海水|水中).{0,12}(?:声速|声音)/.test(text)) warnings.push(`“${token.raw}”无法确定属于声速还是运动速度，请在参数中填写。`)
    } else if (token.kind === 'time') {
      const otherReceiver = /车尾|工作人员|护路工人|小超|养护人员/.test(beforeClause + afterClause)
      const afterSentence = conditionText.slice(token.end, token.end + 100).split(/[。；;！!？?]/)[0]
      const receptionContext = `${beforeClause}${token.raw}${afterClause}`
      const echoReception = /回声|返回(?:来)?的?(?:声音|(?:超)?声波|信号)|反射(?:回)?(?:来)?的?(?:声音|(?:超)?声波|信号)|往返|发射到接收/.test(receptionContext)
      const sinceReception = /(?:听到|听见|接收(?:到)?|收到)[^，,。；;\n]{0,20}(?:回声|回波)\s*(?:后|以后)?$/.test(beforeClause)
      const emissionToLandmark = /鸣笛\s*(?:后)?$/.test(beforeClause) && /到达桥头[^。；;]{0,30}(?:此时|恰好)[^。；;]{0,25}(?:听到|听见)[^。；;]{0,15}回声/.test(afterSentence)
      if (!otherReceiver && !sinceReception && (emissionToLandmark || echoReception && (/^(?:之?后|内|时|左右|钟)?[^，,。；;\n]{0,25}(?:听到|听见|接收到|接收|收到|返回|回声)/.test(afterClause) || /(?:回声(?:往返)?(?:时间|用时)|往返(?:所用)?(?:时间|用时)|发射到接收(?:到)?(?:回声)?(?:的)?(?:时间|用时)|鸣笛后|echoTime\s*[=＝])[^，,。；;\n]{0,12}$/i.test(beforeClause)))) {
        add('echoTime', token)
        if (/再次|第二次/.test(beforeClause + afterClause)) warnings.push('检测到多次信号或分段时间，需分别标注每次发射与接收；不同时间将作为冲突条件保留提示。')
        continue
      }
      const bridgePassage = sinceReception && /(?:火车尾|车尾)[^。；;]{0,10}(?:驶过|离开)桥尾/.test(afterSentence) && /(?:车头|火车头)到达桥头[^。；;]{0,45}(?:听到|听见)[^。；;]{0,15}回声/.test(conditionText.slice(0, token.start))
      if (bridgePassage || /(?:完全通过|穿过|通过|车尾.{0,10}离开)[^。；;\n]{0,45}(?:耗时|需要|用时|时间|用去|历时)?[^，,。；;\n]{0,8}$/.test(before) || /^(?:之?后|内)?[^，,。；;\n]{0,15}(?:完全通过|完全穿过|车尾.{0,6}离开)/.test(afterClause)) { add('passTime', token); continue }
    } else {
      if (/(?:一节|每节)(?:车厢)[^，,。；;\n]{0,12}(?:长|长度)(?:度)?(?:为|是)?\s*$/.test(beforeClause)) { add('carriageLength', token); continue }
      if (/(?:一列)(?:长度|长)(?:为|是)?\s*$/.test(beforeClause)) { add('trainLength', token); continue }
      if (/(?:车身长|车长|列车全长|列车长|火车长|动车长|列车长度|车身长度)[^，,。；;\n]{0,8}$/.test(beforeClause) || /(?:长|长度)(?:度)?(?:为|是)?\s*$/.test(beforeClause) && /(?:列车|火车|动车|高铁)/.test(beforeClause) && !/(?:隧道|大桥)/.test(beforeClause) && !/^的(?:平直)?(?:隧道|大桥|铁路桥)/.test(afterClause) || /^(?:的)?(?:列车|火车|动车)/.test(afterClause) && /长(?:度为)?$/.test(beforeClause)) { add('trainLength', token); continue }
      if (/(?:隧道|大桥|铁路桥|桥梁|山隧道)[^，,。；;\n]{0,12}(?:长|全长|长度)(?:度)?(?:为|是)?\s*$/.test(beforeClause) || /^的(?:平直)?(?:隧道|大桥|铁路桥)/.test(afterClause) && /长(?:度)?(?:为|是)?$/.test(beforeClause)) { add('tunnelLength', token); continue }
      const echoMotion = /(?:汽车|列车|火车|动车|高铁|潜艇|发射者)[^。；;\n]{0,20}(?:行驶|前进|移动|行进|航行)(?:了)?\s*$/.test(beforeClause) && /^后[^。；;]{0,25}(?:听到|听见|收到|接收到)[^。；;]{0,15}回声/.test(conditionText.slice(token.end, token.end + 80))
      const bridgeMotion = /(?:距|距离)桥头\s*$/.test(before.replace(/\s+/g, '')) && /鸣笛[^。；;]{0,65}到达桥头[^。；;]{0,35}(?:听到|听见)[^。；;]{0,15}回声/.test(conditionText.slice(token.end, token.end + 130))
      if (echoMotion || bridgeMotion || /(?:回声期间运动的路程|回声期间行驶路程)(?:为|是)?\s*$/.test(beforeClause)) { add('sourceTravel', token); continue }
      const emissionNearby = /鸣笛|拉响|发出|发射/.test(beforeClause + after.slice(0, 30))
      const invalidDistanceContext = /听到|听见|接收|收到|小超|养护人员|工人|桥头|桥尾|(?:接收|收到|听到|听见).{0,8}(?:时|后)/.test(beforeClause)
      const explicitDistance = /(?:初始距离|发射时(?:的)?距离|初始高度|水深|海水深度)(?:为|是|取)?\s*$/.test(beforeClause)
      const reflectorDistance = /(?:距|距离|离)[^，,。；;\n]{0,22}$/.test(beforeClause) && /山崖|高山|山体|隧道|地面|岛礁|暗礁|高楼|反射面|障碍物/.test(beforeClause)
      if (!invalidDistanceContext && (explicitDistance || emissionNearby && (reflectorDistance || /^(?:处|的地方|时)?[^，,。；;\n]{0,8}(?:鸣笛|拉响|发出|发射)/.test(afterClause)))) { add('initialDistance', token); continue }
      if (modelId === 'moving-target' && /(?:正前方|前方|相距)[^，,。；;\n]{0,8}$/.test(beforeClause)) { add('initialDistance', token); continue }
    }
  }
  const result: Partial<Record<EchoParameter, EchoQuantity>> = {}
  proposed.forEach((values, parameter) => {
    if (values.length === 1) result[parameter] = values[0]
    else warnings.push(`${parameterLabels[parameter].label}识别到多个不同数值（${values.map(value => value.value).join('、')} ${parameterLabels[parameter].unit}），请先选定一题 / 一次回声，或手动填写。`)
  })
  return result
}

export function analyzeEcho(text: string, samples: EchoSample[] = []): EchoAnalysis {
  const cleanedText = normalizeText(text)
  const warnings: string[] = [], extensions: string[] = []
  const scores = new Map<EchoModelId, EchoMatch>()
  const tailVoice = /车尾[^。；;\n]{0,50}(?:听到|听见|听见第一次|第一次汽笛)/.test(cleanedText)
  const sourceReceivesEcho = /(?:司机|车头)[^。；;\n]{0,80}(?:听到|听见|接收到)[^。；;\n]{0,30}回声/.test(cleanedText)
  const auxiliaryTailVoice = tailVoice && sourceReceivesEcho
  const brakingRangeMeasurement = /自动刹车/.test(cleanedText) && /汽车\s*[1①][^。；;]{0,8}[和与、]\s*(?:汽车)?\s*[2②]/.test(cleanedText) && /同时匀速/.test(cleanedText) && /向前发出[^。；;]{0,10}超声波/.test(cleanedText) && /返回的超声波/.test(cleanedText)
  const targetReflection = /(?:同向|同一方向)/.test(cleanedText) && /(?:反射[^。；;\n]{0,20}(?:信号|声波|超声波|回波)|(?:乙车|甲车|无人机|目标)[^。；;\n]{0,18}反射|(?:超声波|信号)[^。；;\n]{0,20}(?:遇到|到达|碰到)[^。；;\n]{0,15}(?:乙车|甲车|前车)[^。；;\n]{0,10}反射)/.test(cleanedText)
  const towardReflector = /(?:驶向|向着|驶近|靠近|朝|向)[^，,。；;\n]{0,18}(?:山崖|高山|山体|山|隧道|岛礁|暗礁|高楼|障碍物|墙|反射面)|(?:山崖|高山|山体|隧道口)[^，,。；;\n]{0,12}开过来|正前方|前(?:方|面)[^，,。；;\n]{0,15}(?:山|隧道|岛礁|暗礁|高楼|障碍物|墙)|进入[^，,。；;\n]{0,8}隧道前|进入隧道[^，,。；;\n]{0,8}鸣笛|距离隧道[^，,。；;\n]{0,20}处鸣笛/.test(cleanedText)
    || /(?:离|距)(?:高楼|山崖)[^。；;]{0,25}鸣笛[^。；;]{0,25}直线向前行驶/.test(cleanedText)
  const boost = (id: EchoModelId, score: number, evidence: string) => {
    const existing = scores.get(id) ?? { modelId: id, score: 0, evidence: [] }
    existing.score += score
    if (!existing.evidence.includes(evidence)) existing.evidence.push(evidence)
    scores.set(id, existing)
  }
  const keywords = [...new Set(echoTemplates.flatMap(template => template.keywords).filter(keyword => cleanedText.includes(keyword)))]
  if (cleanedText) {
    for (const template of echoTemplates) {
      const matched = template.keywords.filter(keyword => cleanedText.includes(keyword))
      if (matched.length) boost(template.id, Math.min(18, matched.length * 3), `关键词：${matched.join('、')}`)
    }
    if (sound.test(cleanedText)) boost('stationary', 12, '识别到声音发射、反射或回声')
    if (/静止|停在|停靠|站在|停着|停泊/.test(cleanedText)) boost('stationary', 70, '发射 / 接收者静止')
    if (vehicle.test(cleanedText) && sound.test(cleanedText) && towardReflector) boost('approaching', 65, '运动者向前方固定反射面发声')
    if (/驶离|远离|背向|从.{0,6}山崖驶向.{0,6}(?:大桥|桥)/.test(cleanedText)) boost('receding', 90, '运动方向远离反射面')
    if (/无人机/.test(cleanedText) && /下降|着陆|降落/.test(cleanedText)) boost('descending', 110, '无人机向地面下降')
    if (/无人机/.test(cleanedText) && /上升|升高|升空/.test(cleanedText)) boost('ascending', 110, '无人机远离地面上升')
    if (/海底|湖底|海水深度|水深|测深/.test(cleanedText) && /声呐|超声波|声波|回声/.test(cleanedText)) boost('depth', 105, '声波向水底传播并反射')
    if (/侧方雷达|停车位|车位/.test(cleanedText) && /超声波|往返|雷达/.test(cleanedText)) boost('parking', 190, '侧向扫描与车位几何')
    if (!targetReflection && !auxiliaryTailVoice && /(?:乙车[^。；;\n]{0,15}(?:听|接收)|车尾.{0,8}工作人员|护路工人|两次声音|听到两次|听见两次|第一次汽笛声)/.test(cleanedText) && /听|接收/.test(cleanedText)) boost('two-receivers', 160, '发射者与接收者不同，或需区分直达声与回声')
    if (!brakingRangeMeasurement && /(?:减速|刹车)/.test(cleanedText) && sound.test(cleanedText)) boost('decelerating', 150, '速度随时间变化或多次测量')
    if (targetReflection || /移动反射(?:目标|体)/.test(cleanedText)) boost('moving-target', 220, '前方目标移动且将信号反射回发射者')
    if (brakingRangeMeasurement) boost('moving-target', 200, '两车匀速阶段进行超声波测距，刹车尚未启动；方向需从图中补充')
    const inputGrams = ngrams(cleanedText)
    const bestSample = new Map<EchoModelId, { score: number; evidence: string }>()
    for (const sample of samples.slice(0, 2000)) {
      if (!sample || !echoModelIds.has(sample.modelId) || typeof sample.text !== 'string') continue
      const lexical = similarity(inputGrams, ngrams(sample.text))
      const sampleKeywords = Array.isArray(sample.keywords) ? sample.keywords.filter(keyword => typeof keyword === 'string' && keyword.trim() && cleanedText.includes(keyword.trim())) : []
      if (lexical < 0.2 && sampleKeywords.length === 0) continue
      const score = Math.min(42, lexical * 35 + Math.min(12, sampleKeywords.length * 4))
      if (score > (bestSample.get(sample.modelId)?.score ?? 0)) bestSample.set(sample.modelId, { score, evidence: `本地样本“${sample.title || '未命名'}”：文字相似度 ${Math.round(lexical * 100)}${sampleKeywords.length ? `；命中 ${sampleKeywords.join('、')}` : ''}` })
    }
    bestSample.forEach((match, id) => boost(id, match.score, match.evidence))
  }
  const candidates = [...scores.values()].sort((first, second) => second.score - first.score).map(match => ({ ...match, score: Math.round(match.score * 10) / 10 }))
  const enoughEvidence = sound.test(cleanedText) || candidates.some(candidate => candidate.evidence.some(item => item.startsWith('本地样本')) && candidate.score >= 30)
  let modelId: EchoModelId | null = enoughEvidence ? candidates[0]?.modelId ?? null : null
  if (!cleanedText) warnings.push('请输入一道回声测距题目。')
  else if (!modelId) warnings.push('暂未找到足够的回声测距特征；请补充题意，或保存一条已标注的本地样本。')
  if (modelId === 'stationary' && /行驶|运行|运动|飞行|航行|速度|驶向|驶离/.test(cleanedText) && !/静止|停在|停靠|站在|停着|停泊/.test(cleanedText) && vehicle.test(cleanedText)) {
    warnings.push('题目出现运动者，但未说明相对反射面的运动方向；请补充驶向 / 驶离等条件，不能按静止测距计算。')
    modelId = null
  }
  const explicitModes = [
    /(?:若|如果).{0,12}(?:停在|静止)/.test(cleanedText),
    /(?:若|如果).{0,30}(?:驶向|向着)/.test(cleanedText),
  ].filter(Boolean).length
  const questionCount = (text.match(/Tid\s*[:：]/gi) ?? []).length
  if (questionCount > 1 || explicitModes > 1) {
    warnings.push('输入包含多道题或多种运动情形，请一次选择一道题 / 一种情形后生成数值仿真。')
    modelId = null
  }
  if (/(?:与此同时|另一辆)/.test(cleanedText) && /护路工人/.test(cleanedText) && sourceReceivesEcho) {
    warnings.push('本题包含汽车接收自身回声和工人接收列车直达声，请分别选择小问后生成仿真。')
    modelId = null
  }
  if (/海底|测深|海水深度/.test(cleanedText) && /岛礁|暗礁|前方.{0,8}回声/.test(cleanedText)) {
    warnings.push('本题同时包含航行测距与垂直测深，请分别输入对应小问和条件。')
    modelId = null
  }
  const quantities = extractQuantities(cleanedText, modelId, warnings)
  if (questionCount > 1 || explicitModes > 1 || (modelId === null && warnings.some(w => /分别选择小问|分别输入对应小问/.test(w)))) Object.keys(quantities).forEach(key => delete quantities[key as EchoParameter])
  if (/隧道|大桥|桥梁/.test(cleanedText) && /完全通过|完全穿过|车尾|穿过|通过该隧道|隧道长/.test(cleanedText)) extensions.push('列车通过隧道 / 大桥：v t = L车 + L隧道，可由其中三个量求第四个量。')
  if (/拍不到|完全进入|完全在隧道|全部在隧道/.test(cleanedText)) extensions.push('整列车被隧道遮住的时间：max(0, L隧道 − L车) / v。')
  if (/车厢/.test(cleanedText) && /(?:一节|每节)/.test(cleanedText)) extensions.push('车厢节数：先由 L车 = v t通过 − L隧道 求列车长度，再除以每节车厢长度。')
  if (auxiliaryTailVoice) extensions.push('车头发声、同列车车尾首次收到直达声：t = L车 / (c + v)。此小问不改变司机接收主回声的模型。')
  if (/图像|图象|如图|图所示|表格|时刻表/.test(cleanedText)) warnings.push('文字中的图表不会自动读取；若所需条件在图表中，请补充数字。')
  if (modelId && echoTemplates.find(template => template.id === modelId)!.supported && !quantities.soundSpeed) warnings.push('题干未给出声速；请确认并填写介质中的声速，系统不会从参考答案或常用值自动补入。')
  if (/以的速度|为[，,。；;）)]|经过(?:后|听)|后听到回声/.test(cleanedText) && !quantities.echoTime) warnings.push('题目可能在复制时丢失公式或数值；已保留模型匹配，缺失参数请手动补充。')
  if (modelId && !echoTemplates.find(template => template.id === modelId)!.supported) warnings.push(modelId === 'decelerating' ? '减速 / 多次鸣笛已专门识别。当前尚未建立分段求解器，不会把它当作匀速题求解；仅写“减速”也不能假定匀减速。' : modelId === 'parking' ? '侧方停车模型需填写扫描图像的时间区间、两档回波时间及车辆尺寸；当前只完成识别。' : '不同接收者模型需分别给出发射者、接收者与反射面的初始位置和运动方向；当前只完成识别。')
  if (modelId === 'moving-target' && !/同向|移动反射/.test(cleanedText)) warnings.push('当前移动目标求解器适用于同向运动，请确认方向条件。')
  if (modelId === 'depth' && /航行|匀速行驶|行进/.test(cleanedText)) warnings.push('测深模型按测量时船的位置不变计算；若题目要求计入横向位移，需要另建二维传播模型。')
  return { cleanedText, modelId, candidates, quantities, warnings: [...new Set(warnings)], extensions, keywords }
}

export function solveEcho(modelId: EchoModelId, params: Partial<Record<EchoParameter, number>>): EchoSolution {
  const errors: string[] = [], missing: EchoParameter[] = []
  const template = echoTemplates.find(item => item.id === modelId)
  if (!template) return { result: null, missing: [], errors: ['未知的回声模型。'] }
  if (!template.supported) return { result: null, missing: [], errors: [modelId === 'decelerating' ? '减速和多次鸣笛模型尚需分段条件标注，当前不进行匀速近似计算。' : modelId === 'parking' ? '此模板需扫描图像和车位几何数据，目前支持识别，暂未实现求解。' : '此模板需分别标注声源与接收者的位置、方向和速度，目前支持识别，暂未实现求解。'] }
  const positive: EchoParameter[] = ['soundSpeed', 'echoTime', 'initialDistance', 'trainLength', 'tunnelLength', 'passTime', 'carriageLength']
  for (const [key, value] of Object.entries(params) as [EchoParameter, number][]) {
    if (!parameterLabels[key]) continue
    if (!Number.isFinite(value)) errors.push(`${parameterLabels[key].label}必须为有限数值。`)
    else if (positive.includes(key) && value <= 0 || !positive.includes(key) && value < 0) errors.push(`${parameterLabels[key].label}${positive.includes(key) ? '必须大于零' : '不能为负数，方向由模板确定'}。`)
  }
  if (errors.length) return { result: null, missing, errors }
  const stationary = modelId === 'stationary' || modelId === 'depth'
  const extras: { label: string; value: number; unit: string; formula: string }[] = []
  const direction = modelId === 'receding' || modelId === 'ascending' ? -1 : 1
  const c = params.soundSpeed
  let measuredEchoTime = params.echoTime
  if (!stationary && modelId !== 'moving-target' && measuredEchoTime === undefined && c !== undefined && params.initialDistance !== undefined && params.sourceTravel !== undefined) {
    measuredEchoTime = (2 * params.initialDistance - direction * params.sourceTravel) / c
    if (measuredEchoTime <= 0) return { result: null, missing, errors: ['给定发射距离和运动路程无法形成有效回声，请检查数据和运动方向。'] }
    extras.push({ label: '由声程求得的回声时间', value: measuredEchoTime, unit: 's', formula: 'T = (2d₀ − uT) / c' })
  }
  let speed = stationary ? 0 : params.sourceSpeed
  if (speed === undefined && params.sourceTravel !== undefined && measuredEchoTime !== undefined) {
    speed = params.sourceTravel / measuredEchoTime
    extras.push({ label: '由运动路程求得的速度', value: speed, unit: 'm/s', formula: 'v = s运动 / T' })
  }
  if (speed === undefined && params.trainLength !== undefined && params.tunnelLength !== undefined && params.passTime !== undefined) {
    speed = (params.trainLength + params.tunnelLength) / params.passTime
    extras.push({ label: '由完全通过时间求得的列车速度', value: speed, unit: 'm/s', formula: 'v = (L车 + L隧道) / t通过' })
  }
  if (speed === undefined && modelId !== 'moving-target' && c !== undefined && params.initialDistance !== undefined && measuredEchoTime !== undefined) {
    speed = direction * (2 * params.initialDistance / measuredEchoTime - c)
    if (speed < 0) return { result: null, missing, errors: ['给定距离和回声时间推导出的运动方向与所选模型不一致，请检查驶向 / 驶离条件。'] }
    extras.push({ label: '由回声关系求得的速度', value: speed, unit: 'm/s', formula: direction === 1 ? 'v = 2d₀ / T − c' : 'v = c − 2d₀ / T' })
  }
  if (c === undefined) missing.push('soundSpeed')
  if (speed === undefined) missing.push('sourceSpeed')
  const targetSpeed = modelId === 'moving-target' ? params.targetSpeed : 0
  if (targetSpeed === undefined) missing.push('targetSpeed')
  if (measuredEchoTime === undefined && params.initialDistance === undefined) missing.push('echoTime', 'initialDistance')
  if (missing.length) return { result: null, missing, errors }
  if (speed! >= c!) errors.push('发射者速度必须小于声速，当前模型只处理亚声速运动。')
  if (targetSpeed! >= c!) errors.push('前方反射目标的速度必须小于声速，否则信号无法按此模型追上目标。')
  if (errors.length) return { result: null, missing, errors }
  const u = direction * speed!
  const w = targetSpeed!
  const factor = modelId === 'moving-target' ? (c! - w) * (c! + u) / (2 * c!) : (c! + u) / 2
  const echoTime = measuredEchoTime ?? params.initialDistance! / factor
  const initialDistance = params.initialDistance ?? factor * echoTime
  if (measuredEchoTime !== undefined && params.initialDistance !== undefined) {
    const expected = factor * echoTime
    if (Math.abs(initialDistance - expected) > Math.max(1e-6, Math.abs(expected) * 0.001)) errors.push(`给定距离和回声时间不一致：按当前速度与时间应为 ${Number(expected.toFixed(6))} m。请更正其中一个条件。`)
  }
  if (params.sourceTravel !== undefined && Math.abs(speed! * echoTime - params.sourceTravel) > Math.max(1e-6, params.sourceTravel * 0.001)) errors.push('给定运动路程与速度、回声时间相互矛盾。')
  const finalDistance = initialDistance + (w - u) * echoTime
  const reflectionTime = initialDistance / (c! - w)
  if (finalDistance <= 0 || reflectionTime >= echoTime || reflectionTime <= 0) errors.push('当前条件下接收回声前已经到达目标，或无法形成有效的往返回声。')
  if (errors.length) return { result: null, missing, errors }
  if (!stationary && u > w) extras.push({ label: '听到回声后到达目标还需时间', value: finalDistance / (u - w), unit: 's', formula: modelId === 'moving-target' ? 't剩余 = d₁ / (v发射 − v目标)' : 't剩余 = d₁ / v' })
  const trainSpeed = stationary ? params.sourceSpeed : speed
  let trainLength = params.trainLength, tunnelLength = params.tunnelLength
  if (trainSpeed !== undefined && trainSpeed > 0) {
    if (trainLength !== undefined && tunnelLength !== undefined) {
      const passage = (trainLength + tunnelLength) / trainSpeed
      if (params.passTime !== undefined && Math.abs(passage - params.passTime) > Math.max(1e-6, passage * 0.001)) errors.push('列车长度、隧道长度、速度与完全通过时间相互矛盾。')
      extras.push({ label: '完全通过所需时间', value: passage, unit: 's', formula: 't通过 = (L车 + L隧道) / v' })
    } else if (params.passTime !== undefined && trainLength !== undefined) {
      tunnelLength = trainSpeed * params.passTime - trainLength
      if (tunnelLength <= 0) errors.push('由完全通过时间求得的隧道长度不大于零，请检查列车长度、速度和通过时间。')
      else extras.push({ label: '隧道 / 大桥长度', value: tunnelLength, unit: 'm', formula: 'L隧道 = v t通过 − L车' })
    } else if (params.passTime !== undefined && tunnelLength !== undefined) {
      trainLength = trainSpeed * params.passTime - tunnelLength
      if (trainLength <= 0) errors.push('由完全通过时间求得的列车长度不大于零，请检查条件。')
      else extras.push({ label: '列车长度', value: trainLength, unit: 'm', formula: 'L车 = v t通过 − L隧道' })
    }
    if (trainLength !== undefined && tunnelLength !== undefined && trainLength > 0 && tunnelLength > 0) extras.push({ label: '整列车完全在隧道内的时间', value: Math.max(0, tunnelLength - trainLength) / trainSpeed, unit: 's', formula: 't遮挡 = max(0, L隧道 − L车) / v' })
    if (trainLength !== undefined && params.carriageLength !== undefined) {
      const count = trainLength / params.carriageLength
      if (Math.abs(count - Math.round(count)) > 1e-6) errors.push('由列车长度与每节车厢长度求得的节数不是整数，请检查条件。')
      else extras.push({ label: '车厢节数', value: Math.round(count), unit: '节', formula: 'n = L车 / L每节' })
    }
    if (trainLength !== undefined && trainLength > 0) extras.push({ label: '车头发声后车尾首次听到直达声', value: trainLength / (c! + trainSpeed), unit: 's', formula: 't直达 = L车 / (c + v)' })
  }
  if (errors.length) return { result: null, missing, errors }
  const format = (value: number) => Number(value.toFixed(6)).toString()
  const steps = modelId === 'moving-target'
    ? [`去程声波追上前方目标：t反射 = d₀ / (c − v目标) = ${format(reflectionTime)} s。`, `反射后声波与接收者相遇：T = 2cd₀ / [(c − v目标)(c + v发射)] = ${format(echoTime)} s。`, `接收时距离 = d₀ + (v目标 − v发射)T = ${format(finalDistance)} m。`]
    : [`声波传播总路程 cT = ${format(c! * echoTime)} m。`, `发射者沿朝向反射面的方向位移 uT = ${format(u * echoTime)} m。`, `发射时距离 d₀ = (cT + uT) / 2 = ${format(initialDistance)} m。`, `接收时距离 d₁ = d₀ − uT = ${format(finalDistance)} m。`]
  return { result: { initialDistance, finalDistance, echoTime, reflectionTime, sourceTravel: speed! * echoTime, soundTravel: c! * echoTime, sourceSpeed: u, targetSpeed: w, acceleration: 0, soundSpeed: c!, extras, steps }, missing, errors }
}
