import type { AnimationCue, CircuitAction, CircuitAsset, KeywordHighlight, Shot, VideoProject } from './videoTypes.js'
import { VIDEO_HIGHLIGHT_EFFECTS } from './videoPresentation.js'

export const VIDEO_CIRCUIT_ACTION_TYPES = ['draw', 'highlight', 'label', 'show', 'hide', 'annotation', 'state'] as const
export function validVideoAnimationDuration(value: unknown): boolean {
  return value === undefined || typeof value === 'number' && Number.isFinite(value) && value >= .1 && value <= 3
}
export function validVideoStateParameters(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length) return false
  return Object.entries(value).every(([key, item]) => {
    if (['voltage', 'internalResistance', 'resistance', 'maxResistance'].includes(key)) return typeof item === 'number' && Number.isFinite(item) && item >= 0 && item <= 1e9
    if (['ratedVoltage', 'ratedPower', 'meterRange'].includes(key)) return typeof item === 'number' && Number.isFinite(item) && item > 0 && item <= 1e9
    if (key === 'sliderPosition') return typeof item === 'number' && Number.isFinite(item) && item >= 0 && item <= 1
    if (key === 'manualReading') return typeof item === 'number' && Number.isFinite(item) && Math.abs(item) <= 1e9
    if (key === 'switchClosed') return typeof item === 'boolean'
    if (key === 'switchPosition') return ['left', 'right', 'open'].includes(item)
    return key === 'meterMode' && ['auto', 'manual'].includes(item)
  })
}
const stateParametersByType: Record<string, readonly string[]> = {
  battery: ['voltage', 'internalResistance'], switch: ['switchClosed'], switch_spdt: ['switchPosition'],
  resistor: ['resistance'], rheostat: ['resistance', 'maxResistance', 'sliderPosition'], potentiometer: ['resistance', 'maxResistance', 'sliderPosition'],
  lamp: ['resistance', 'ratedVoltage', 'ratedPower'], motor: ['resistance', 'ratedVoltage', 'ratedPower'], bell: ['resistance', 'ratedVoltage', 'ratedPower'], buzzer: ['resistance', 'ratedVoltage', 'ratedPower'],
  ammeter: ['meterRange', 'meterMode', 'manualReading'], voltmeter: ['meterRange', 'meterMode', 'manualReading'], galvanometer: ['meterRange', 'meterMode', 'manualReading'],
}

function inventory(asset?: CircuitAsset) {
  const graph = asset?.graph as { id?: string; components?: { id: string; terminals?: { id: string }[] }[]; connections?: { id: string }[] } | undefined
  const components = asset?.geometry?.components.map(component => component.id) || graph?.components?.map(component => component.id) || []
  const wires = asset?.geometry?.wires.map(wire => wire.id) || graph?.connections?.map(wire => wire.id) || []
  const ports = asset?.geometry
    ? asset.geometry.components.flatMap(component => Object.keys(component.terminals).map(port => component.id + ':' + port))
    : graph?.components?.flatMap(component => (component.terminals || []).map(port => component.id + ':' + port.id)) || []
  return { components, wires, ports, graphId: graph?.id, valid: new Set(asset ? ['circuit', ...components, ...wires, ...ports] : []) }
}

export function validateVideoShotCircuitCount(shot: Shot, circuits: readonly CircuitAsset[]): string[] {
  const asset = circuits.find(circuit => circuit.id === shot.circuitAssetId)
  if (!asset) return []
  const subjectTexts = [shot.title, ...(shot.boardTexts || []).filter(board => board.kind === 'problem').map(board => board.text)]
  const numbers: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, '1': 1, '2': 2, '3': 3 }
  const expected = new Set(subjectTexts.flatMap(text => [...text.matchAll(/(?<![\d.])([一二两三123])(?:个|只)?电阻/g)].map(match => numbers[match[1]])))
  // Comparison pages can refer to several distinct circuit sizes without depicting all of them.
  if (expected.size !== 1) return []
  const graph = asset.graph as { components?: { type: string }[] }
  if (!Array.isArray(graph.components)) return []
  const actual = graph.components.filter(component => ['resistor', 'rheostat'].includes(component.type)).length
  const count = [...expected][0]
  return count === actual ? [] : [(shot.title || shot.id) + '：电路元件数量与当前题意不符，画面要求 ' + count + ' 个电阻，引用素材 ' + asset.id + ' 只有 ' + actual + ' 个；请新建匹配电路，不能用审核备注代替正确画面。']
}

export function validateVideoShotActions(shot: Shot, circuits: readonly CircuitAsset[]): string[] {
  const asset = circuits.find(circuit => circuit.id === shot.circuitAssetId)
  const { valid } = inventory(asset)
  const errors: string[] = validateVideoShotCircuitCount(shot, circuits)
  for (const action of shot.actions || []) {
    const prefix = (shot.title || shot.id) + '：电路动作 ' + action.id
    if (!(VIDEO_CIRCUIT_ACTION_TYPES as readonly string[]).includes(action.type)) errors.push(prefix + ' 的类型无效：' + action.type)
    if (!validVideoAnimationDuration(action.durationSeconds)) errors.push(prefix + ' 的动画时长须在 0.1–3 秒')
    if (!Array.isArray(action.targetIds) || !action.targetIds.length) errors.push(prefix + ' 缺少目标')
    else {
      const missing = action.targetIds.filter(id => !valid.has(id))
      for (const id of missing) {
        const textual = textTargets(shot, id)
        if (textual.length > 1) errors.push(prefix + ' 的目标 ' + id + ' 同时属于公式和板书，请用 highlights.targetType 明确指定')
        else if (textual.length === 1) errors.push(prefix + ' 的目标 ' + id + ' 是' + (textual[0].targetType === 'formula' ? '公式' : '板书') + '，不能作为电路执行 ' + action.type + '；请用 highlights 配置有效关键词强调，或用目标自身的 cue 配置出现时机')
        else errors.push(prefix + ' 的目标不存在：' + id + '；请使用当前电路元件、导线或端口 ID' + (asset ? '（整图使用 circuit）' : '，本镜头尚未引用电路素材'))
      }
    }
    if (action.type === 'label' && (typeof action.text !== 'string' || !action.text.trim())) errors.push(prefix + ' 缺少标注文字')
    if (action.type === 'annotation') {
      const mark = action.annotation
      if (!mark || !['voltage', 'current'].includes(mark.kind) || typeof mark.label !== 'string' || !mark.label.trim() || mark.label.length > 100
        || mark.color !== undefined && !/^#[0-9a-f]{6}$/i.test(mark.color)
        || mark.side !== undefined && !['above', 'below'].includes(mark.side)
        || mark.direction !== undefined && !['forward', 'reverse'].includes(mark.direction)
        || mark.offset !== undefined && (typeof mark.offset !== 'number' || !Number.isFinite(mark.offset) || mark.offset < 0 || mark.offset > 240)) errors.push(prefix + ' 的电压/电流标注无效（间距须在 0–240 像素）')
    }
    if (action.type === 'state') {
      const state = action.state
      const graph = asset?.graph as { components?: { id: string; type: string }[] } | undefined
      const component = graph?.components?.find(item => item.id === state?.componentId)
      if (!state || !component || action.targetIds?.length !== 1 || action.targetIds[0] !== state.componentId) errors.push(prefix + ' 的状态须指向当前电路单个真实元件，并与 targetIds 一致')
      else if (!validVideoStateParameters(state.parameters) || Object.keys(state.parameters).some(key => !stateParametersByType[component.type]?.includes(key))) errors.push(prefix + ' 的状态参数与元件类型不符或数值超出范围')
    }
  }
  return errors
}


interface TextTarget { id: string; targetType: 'formula' | 'board'; text: string; cue?: AnimationCue }
const highlightColors = ['#4F80FF', '#FF6600', '#16C863', '#FF4D4D']
function textTargets(shot: Shot, id: string): TextTarget[] {
  return [...shot.formulas.filter(formula => formula.id === id).map(formula => ({ id, targetType: 'formula' as const, text: formula.latex, cue: formula.cue })),
    ...(shot.boardTexts || []).filter(board => board.id === id).map(board => ({ id, targetType: 'board' as const, text: board.text, cue: board.cue }))]
}
function balancedTex(text: string): boolean {
  let depth = 0
  for (const character of text) {
    if (character === '{') depth++
    if (character === '}' && --depth < 0) return false
  }
  return depth === 0
}
function migratedHighlight(action: CircuitAction, target: TextTarget, index: number, occupied: Set<string>): KeywordHighlight | undefined {
  const style = action as CircuitAction & Partial<KeywordHighlight>
  const phrase = typeof style.phrase === 'string' && style.phrase.trim() ? style.phrase : target.text
  const occurrences = target.text.split(phrase).length - 1
  const occurrence = style.occurrence ?? 1
  if (!phrase.trim() || phrase.length > 1000 || !Number.isInteger(occurrence) || occurrence < 1 || occurrence > occurrences || (target.targetType === 'formula' && !balancedTex(phrase))) return undefined
  let id = action.id, suffix = 1
  while (occupied.has(id)) { const ending = '-highlight-' + suffix++; id = action.id.slice(0, 95 - ending.length) + ending }
  occupied.add(id)
  const color = typeof style.color === 'string' && highlightColors.includes(style.color.toUpperCase()) ? style.color.toUpperCase() : highlightColors[index % highlightColors.length]
  const durationSeconds = typeof style.durationSeconds === 'number' && Number.isFinite(style.durationSeconds) ? Math.max(.5, Math.min(15, style.durationSeconds)) : 3
  return { id, targetType: target.targetType, targetId: target.id, phrase, occurrence, color,
    effect: (VIDEO_HIGHLIGHT_EFFECTS as readonly string[]).includes(style.effect || '') ? style.effect! : 'box', durationSeconds, cue: structuredClone(action.cue) }
}
/** Normalize unambiguous provider aliases while leaving uncertain targets for explicit validation. */
export function normalizeVideoStoryboardActions(project: VideoProject): VideoProject {
  const copy = structuredClone(project)
  for (const shot of copy.shots) {
    if (shot.circuitAssetId === null) delete shot.circuitAssetId
    const asset = copy.circuits.find(circuit => circuit.id === shot.circuitAssetId)
    const { valid, components, wires, graphId } = inventory(asset)
    const drawable = [...components, ...wires]
    const highlights = [...(shot.highlights || [])]
    const occupied = new Set([...highlights.map(highlight => highlight.id), ...shot.actions.map(action => action.id)])
    const actions: CircuitAction[] = []
    for (const action of shot.actions || []) {
      if (!Array.isArray(action.targetIds)) { actions.push(action); continue }
      const normalized = action.targetIds.flatMap(id => {
        if (valid.has(id)) return [id]
        const port = typeof id === 'string' ? id.replace('.', ':') : id
        if (valid.has(port)) return [port]
        // Exact local text IDs take precedence over shorthand aliases, never over real circuit IDs.
        if (textTargets(shot, id).length) return [id]
        if (asset && (id === asset.id || id === graphId || ['all', 'whole-circuit', 'circuit-group'].includes(id))) return ['circuit']
        if (asset && ['components', 'all-components'].includes(id)) return components
        if (asset && ['wires', 'all-wires'].includes(id)) return wires
        return [id]
      })
      let targetIds = [...new Set(normalized)]
      if (['draw', 'show'].includes(action.type)) targetIds = targetIds.filter(id => {
        if (valid.has(id)) return true
        const targets = textTargets(shot, id)
        const cue = targets.length === 1 ? targets[0].cue : undefined
        // The text object's own appearance event already performs this exact action.
        return !cue || cue.utteranceId !== action.cue.utteranceId || cue.phrase !== action.cue.phrase || (cue.offset ?? 0) !== (action.cue.offset ?? 0)
      })
      if (action.type === 'highlight') {
        const candidates = targetIds.map(id => ({ id, targets: valid.has(id) ? [] : textTargets(shot, id) }))
        const fullyMigrated = candidates.every(candidate => candidate.targets.length === 1)
        if (fullyMigrated && !highlights.some(highlight => highlight.id === action.id)) occupied.delete(action.id)
        const migrated = new Set<string>()
        for (const candidate of candidates) if (candidate.targets.length === 1) {
          const highlight = migratedHighlight(action, candidate.targets[0], highlights.length, occupied)
          if (highlight) { highlights.push(highlight); migrated.add(candidate.id) }
        }
        // Legacy text-emphasis aliases used this field as a highlight hold, not
        // as the new circuit transition duration. The migrated highlight owns it.
        if (migrated.size && action.durationSeconds !== undefined && action.durationSeconds > 3) delete action.durationSeconds
        targetIds = targetIds.filter(id => !migrated.has(id))
      }
      const missing = targetIds.filter(id => !valid.has(id))
      // Preserve known text targets for a precise unsupported-operation error. A full
      // circuit draw can only discard surplus objects when they are not text objects.
      if (missing.length && !missing.some(id => textTargets(shot, id).length) && ['draw', 'show'].includes(action.type) && drawable.length && (targetIds.includes('circuit') || drawable.every(id => targetIds.includes(id)))) {
        targetIds = targetIds.filter(id => valid.has(id))
        const note = '电路动作 ' + action.id + ' 已按完整电路保留全部真实元件和导线，移除不存在的冗余目标：' + missing.join('、') + '。'
        if (!shot.reviewNotes.includes(note)) shot.reviewNotes.push(note)
      }
      if (targetIds.includes('circuit')) targetIds = ['circuit', ...targetIds.filter(id => !valid.has(id))]
      if (targetIds.length || !action.targetIds.length) { action.targetIds = targetIds; actions.push(action) }
    }
    shot.actions = actions
    if (highlights.length || shot.highlights !== undefined) shot.highlights = highlights
  }
  if (JSON.stringify(copy.shots) !== JSON.stringify(project.shots)) delete copy.approvedRevision
  return copy
}
