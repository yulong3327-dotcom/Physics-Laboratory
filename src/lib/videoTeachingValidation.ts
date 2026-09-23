import type { CircuitAsset, TeachingQuantity, VideoProject } from '../../server/videoTypes'
import type { CircuitComponent, CircuitGraph } from '../types/circuit'
import { simulateIdealCircuit, type IdealCircuitSimulationResult, type IdealQuantity } from './idealCircuitSimulation'

type Metric = 'P' | 'U' | 'I' | 'R'
type BoundQuantity = TeachingQuantity & { componentId?: string }
const units: Record<Metric, ReadonlySet<string>> = {
  P: new Set(['W', '瓦', '瓦特']), U: new Set(['V', '伏', '伏特']),
  I: new Set(['A', '安', '安培']), R: new Set(['Ω', 'Ω', '欧', '欧姆']),
}
const statusNames: Record<string, string> = {
  reverse: '反接', overload: '超过量程', miswired: '接线错误', floating: '端口浮置或接线不完整',
  indeterminate: '读数不唯一', inconsistent: '理想约束冲突',
}
const nonLoads = new Set(['battery', 'switch', 'switch_spdt', 'ammeter', 'voltmeter', 'galvanometer'])
function defined(quantity?: IdealQuantity): number | undefined {
  return quantity?.status === 'defined' && Number.isFinite(quantity.value) ? quantity.value : undefined
}
function symbol(value: string): { metric: Metric; index?: string } | undefined {
  const normalized = value.trim().replace(/[₀₁₂₃₄₅₆₇₈₉]/g, digit => String('₀₁₂₃₄₅₆₇₈₉'.indexOf(digit)))
  const match = normalized.match(/^([PUIR])(?:(\d+)|_(\d+)|_\{(\d+)\})?$/)
  return match ? { metric: match[1] as Metric, index: match[2] || match[3] || match[4] } : undefined
}
function componentValue(component: CircuitComponent, metric: Metric, result: IdealCircuitSimulationResult) {
  const state = result.components[component.id]
  if (metric === 'R') return state?.effectiveResistance
  return defined(state?.[metric === 'P' ? 'power' : metric === 'U' ? 'voltage' : 'current'])
}

/** Check numeric teaching magnitudes without inferring a component from its display label. */
export function validateCircuitTeachingQuantities(asset: CircuitAsset, graph: CircuitGraph): string[] {
  if (asset.mode === 'symbolic') return []
  const errors: string[] = []
  const prefix = asset.name + '：'
  const result = simulateIdealCircuit(graph)
  if (result.status === 'inconsistent' || result.status === 'error') return [prefix + '理想电路没有有效解']
  const components = new Map(graph.components.map(c => [c.id, c]))
  const sources = graph.components.filter(c => c.type === 'battery')
  const loads = graph.components.filter(c => !nonLoads.has(c.type))
  for (const component of graph.components) {
    const status = result.components[component.id]?.meterStatus
    if (status && status !== 'ok') errors.push(prefix + (component.label || component.id) + '仪表' + (statusNames[status] || status) + '，请复核接法与量程。')
  }
  for (const q of asset.quantities as BoundQuantity[]) {
    const parsed = symbol(q.symbol)
    if (!parsed) {
      if (q.value !== undefined) errors.push(prefix + '无法校验物理量“' + q.symbol + '”，请使用 P/U/I/R 及数字下标，或将纯符号量标为符号推导。')
      continue
    }
    const { metric, index } = parsed
    if (!units[metric].has(q.unit.trim())) errors.push(prefix + q.symbol + ' 的单位“' + q.unit + '”不匹配，应为 ' + ({ P: 'W（瓦）', U: 'V（伏）', I: 'A（安）', R: 'Ω（欧姆）' }[metric]) + '。')
    if (q.componentId !== undefined && (!q.componentId || !components.has(q.componentId))) {
      errors.push(prefix + q.symbol + ' 引用的元件不存在：' + q.componentId); continue
    }
    if (q.value === undefined) continue
    if (!Number.isFinite(q.value)) { errors.push(prefix + q.symbol + ' 必须是有限数值'); continue }
    let actual: number | undefined
    const componentId = q.componentId || (index ? 'r' + index : undefined)
    if (componentId) {
      const component = components.get(componentId)
      if (!component) { errors.push(prefix + q.symbol + ' 引用的元件不存在：' + componentId + '，请指定 componentId。'); continue }
      actual = componentValue(component, metric, result)
    } else if ((metric === 'R' || metric === 'P') && loads.length === 1) {
      actual = componentValue(loads[0], metric, result)
    } else {
      if (sources.length !== 1) {
        errors.push(prefix + q.symbol + ' 无法唯一确定总量归属，请指定 componentId。'); continue
      }
      const source = result.components[sources[0].id]
      if (metric === 'I') actual = defined(source?.current)
      else if (metric === 'U') actual = defined(source?.voltage)
      else if (metric === 'R') {
        const voltage = defined(source?.voltage), current = defined(source?.current)
        if (voltage !== undefined && current !== undefined && Math.abs(current) > 1e-12) actual = Math.abs(voltage) / Math.abs(current)
      } else if (loads.length) {
        const powers = loads.map(c => defined(result.components[c.id]?.power))
        if (powers.every((p): p is number => p !== undefined)) actual = powers.reduce((total, p) => total + Math.max(0, p), 0)
      }
    }
    if (actual === undefined || !Number.isFinite(actual)) errors.push(prefix + q.symbol + ' 的数值无解或不能唯一确定，不能以零或猜测值代替。')
    else if (Math.abs(Math.abs(actual) - q.value) > 1e-7 * Math.max(1, Math.abs(q.value))) errors.push(prefix + q.symbol + ' 与当前电路计算不一致，请复核题设、公式及旁白。')
  }
  return [...new Set(errors)]
}


export interface ScriptTeachingReviewNote { noteId: string; utteranceId?: string; message: string }
type ScriptNumericQuantity = { metric: 'R' | 'P'; index: string; value: number }
const scriptNumber = '(?:\\d+(?:\\.\\d+)?|\\.\\d+)'
function normalizedScriptMath(text: string): string {
  return text.replace(/[₀₁₂₃₄₅₆₇₈₉]/g, digit => String('₀₁₂₃₄₅₆₇₈₉'.indexOf(digit)))
    .replace(/([RP])_\{?(\d+)\}?/g, '$1$2').replace(/Ω/g, 'Ω')
}
function scriptNumericQuantities(text: string): ScriptNumericQuantity[] {
  const normalized = normalizedScriptMath(text), found: ScriptNumericQuantity[] = []
  const put = (metric: 'R' | 'P', index: string, value: string) => found.push({ metric, index, value: Number(value) })
  // Require an explicit physical unit and numeric assignment; ratio subscripts are not quantities.
  for (const match of normalized.matchAll(new RegExp('([RP])(\\d+)\\s*(?:的(?:电阻|阻值|电功率|功率))?\\s*(?:就(?:应该)?|应当|应该)?(?:等于|就是|是|为|=)\\s*(' + scriptNumber + ')\\s*(欧姆|欧|Ω|瓦特|瓦|W)', 'g'))) {
    const metric = /^(?:欧|Ω)/.test(match[4]) ? 'R' : 'P'
    if (metric === match[1] || (match[1] === 'R' && metric === 'P' && /功率/.test(match[0]))) put(metric, match[2], match[3])
  }
  for (const match of normalized.matchAll(new RegExp('(' + scriptNumber + ')\\s*(?:欧姆|欧|Ω)\\s*的?\\s*R(\\d+)', 'g'))) put('R', match[2], match[1])
  return found
}
function sameScriptValue(a: number, b: number): boolean { return Math.abs(a - b) <= 1e-7 * Math.max(1, Math.abs(a), Math.abs(b)) }
function printScriptNumber(value: number): string { return Number(value.toPrecision(8)).toString() }
function printScriptRatio(values: number[]): string {
  const minimum = Math.min(...values), normalized = values.map(value => value / minimum)
  for (let factor = 1; factor <= 1000; factor++) {
    const ratio = normalized.map(value => value * factor)
    if (ratio.every(value => sameScriptValue(value, Math.round(value)))) return ratio.map(value => String(Math.round(value))).join(':')
  }
  return normalized.map(printScriptNumber).join(':')
}
/** Conservative text review: only explicit numeric resistor problems are evaluated, and speech is never rewritten. */
export function collectScriptTeachingReviewNotes(project: Pick<VideoProject, 'scriptNotes' | 'utterances' | 'shots'>): ScriptTeachingReviewNote[] {
  const notes: ScriptTeachingReviewNote[] = []
  const problems = (project.scriptNotes || []).filter(note => note.kind === 'problem')
  const positions = new Map(project.utterances.map((u, index) => [u.id, index]))
  for (const [problemIndex, problem] of problems.entries()) {
    const text = normalizedScriptMath(problem.text)
    const series = text.includes('串联'), parallel = text.includes('并联')
    if (series === parallel) continue
    const givens = scriptNumericQuantities(text)
    const resistances = new Map(givens.filter(q => q.metric === 'R').map(q => [q.index, q.value]))
    if (!resistances.size) {
      const ordered = text.match(/(?:阻值|电阻值)分别(?:为|是|等于|=)([^，。；]+)/)
      if (ordered) {
        const values = [...ordered[1].matchAll(new RegExp('(' + scriptNumber + ')\\s*(?:欧姆|欧|Ω)', 'g'))].map(match => Number(match[1]))
        // Explicit ordered values correspond to R1, R2, ...; no values are recovered from answers.
        if (values.length >= 2 && values.length <= 3) values.forEach((value, index) => resistances.set(String(index + 1), value))
      }
    }
    const indices = [...resistances.keys()].sort((a, b) => Number(a) - Number(b))
    const requestedCount = /(?:三个|三只|3个|3只)/.test(text) ? 3 : /(?:两个|两只|2个|2只)/.test(text) ? 2 : undefined
    if (indices.length < 2 || (requestedCount && indices.length !== requestedCount) || [...resistances.values()].some(value => !(value > 0))) continue
    // A third indexed resistor without a numeric resistance makes the problem incomplete.
    if ([...text.matchAll(/R(\d+)/g)].some(match => !resistances.has(match[1]))) continue
    const weights = indices.map(index => series ? resistances.get(index)! : 1 / resistances.get(index)!)
    const powers = givens.filter(q => q.metric === 'P' && resistances.has(q.index) && q.value >= 0)
    const base = powers[0]
    const expected = new Map<string, number>()
    if (base) {
      const baseWeight = weights[indices.indexOf(base.index)]
      indices.forEach((index, i) => expected.set(index, base.value * weights[i] / baseWeight))
    }
    const proof = indices.map(index => 'R' + index + '=' + printScriptNumber(resistances.get(index)!) + 'Ω').join('、')
      + (series ? '串联' : '并联') + '，' + indices.map(index => 'P' + index).join(':') + '=' + printScriptRatio(weights)
      + (base ? '；由P' + base.index + '=' + printScriptNumber(base.value) + 'W得' + indices.map(index => 'P' + index + '=' + printScriptNumber(expected.get(index)!) + 'W').join('、') : '')
    if (powers.some(q => !sameScriptValue(q.value, expected.get(q.index)!))) notes.push({ noteId: problem.id, utteranceId: problem.utteranceId, message: '题设核验：' + proof + '。题干中已知功率彼此冲突，请复核题设。' })
    const start = problem.utteranceId ? positions.get(problem.utteranceId) : undefined
    if (start === undefined || problem.placement === 'after') continue
    const nextProblem = problems[problemIndex + 1]
    let end = nextProblem?.utteranceId ? positions.get(nextProblem.utteranceId) ?? project.utterances.length : project.utterances.length
    const contextChapter = problem.chapter || 1
    for (const chapterNote of project.scriptNotes || []) {
      if (chapterNote.kind !== 'chapter' || (chapterNote.chapter || 0) <= contextChapter || !chapterNote.utteranceId) continue
      const boundary = positions.get(chapterNote.utteranceId)
      if (boundary !== undefined && boundary > start) end = Math.min(end, boundary)
    }
    for (const utterance of project.utterances.slice(start, end)) {
      const claims = scriptNumericQuantities(utterance.text).filter(q => q.metric === 'P' && expected.has(q.index))
      const mismatches = claims.filter(q => !sameScriptValue(q.value, expected.get(q.index)!)).map(q => 'P' + q.index + '=' + printScriptNumber(q.value) + 'W')
      const normalized = normalizedScriptMath(utterance.text)
      const ratioExpression = new RegExp('((?:P\\d+\\s*(?:比|[:：])\\s*)+P\\d+)\\s*(?:就(?:应该)?|应该|应当)?(?:等于|是|为|=)\\s*(' + scriptNumber + '(?:\\s*[:：比]\\s*' + scriptNumber + ')+)', 'g')
      for (const match of normalized.matchAll(ratioExpression)) {
        const order = [...match[1].matchAll(/P(\d+)/g)].map(item => item[1])
        const values = match[2].split(/\s*[:：比]\s*/).map(Number)
        if (order.length !== values.length || order.some(index => !resistances.has(index)) || values.some(value => !(value > 0))) continue
        const ratioWeights = order.map(index => series ? resistances.get(index)! : 1 / resistances.get(index)!)
        if (values.some((value, i) => !sameScriptValue(value / values[0], ratioWeights[i] / ratioWeights[0]))) mismatches.push(order.map(index => 'P' + index).join(':') + '=' + values.join(':'))
      }
      if (!mismatches.length) continue
      const markedGuess = project.shots.some(shot => shot.formulas.some(formula => formula.cue.utteranceId === utterance.id && formula.role === 'misconception' && formula.correctionStepId && project.shots.some(candidate => candidate.formulas.some(step => step.id === formula.correctionStepId))))
      notes.push({ noteId: problem.id, utteranceId: utterance.id, message: '题设核验：' + proof + '。原台词“' + [...new Set(mismatches)].join('、') + '”与题设冲突；保留原台词，列为审核问题。' + (markedGuess ? '该段已标记教学猜想并关联纠正步骤，画面结论仍须使用核验值。' : '如为教学猜想，应明确标注并关联纠正步骤，不得把原台词当作正确结论。') })
    }
  }
  return notes
}
