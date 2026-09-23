import { renderPrompt } from './promptCatalog'
import type { CircuitAsset, Shot, VideoProject } from '../../server/videoTypes'
import { componentLibrary } from '../data/componentLibrary'
import { POWER_LESSON_LINES, POWER_LESSON_SOURCE, powerLessonShots } from '../data/powerLesson'
import type { CircuitComponent, CircuitGraph } from '../types/circuit'
import { isComponentType, parseCircuitGraph } from './graphSchema'
import { layoutCircuitGraph } from './autoLayout'
import { isVideoProjectShape } from './videoClient'
import { canonicalVideoSpeakers, normalizeVideoProjectRoles, validateVideoProjectRoles, VIDEO_ROLE_VOICES, VIDEO_STORYBOARD_ROLE_PROMPT, DEFAULT_VIDEO_SPEECH } from './videoRoles'
export { migrateVideoProjectRoles, normalizeVideoProjectRoles, reviewVideoProjectRoles, inspectVideoProjectRoles, validateVideoProjectRoles } from './videoRoles'
import { prepareCircuitGeometry, prepareCircuitStateGeometry } from './videoGeometry'
import { collectScriptTeachingReviewNotes, validateCircuitTeachingQuantities } from './videoTeachingValidation'
import { VIDEO_PAGE_BACKGROUND, VIDEO_TITLE_PIN, VIDEO_HIGHLIGHT_COLORS } from '../data/videoTheme'
export { createProjectFromProblem, generateProblemNarration } from './videoProblem'
export { setProjectCircuitView, setProjectSwitchPolicy } from './videoProjectSettings'
import { generateStoryboardInBatches, type StoryboardGenerationOptions } from './videoStoryboardBatch'
import { cleanVideoScriptFormatting, parseVideoScript } from './videoScript'
import { getVideoStoryboardReadiness } from '../../server/videoStoryboardReadiness'
import { normalizeVideoStoryboardActions, validateVideoShotActions, validVideoAnimationDuration } from '../../server/videoActionTargets'
import { alignGeneratedCardFormulaCues, alignGeneratedHighlightCues, storyboardTimingIssues } from './videoStoryboardTiming'
import { normalizeGeneratedShotLayout } from './videoStoryboardLayout'
import { expandStoryboardCircuitTemplate } from './videoStoryboardCircuitTemplate'
import { validateVideoShotLayout, validateVideoShotPresentation } from '../../server/videoPresentation'
import { isVideoSummaryHeading, normalizeVideoSummaryLayouts } from './videoSummary'
export { normalizeVideoStoryboardActions } from '../../server/videoActionTargets'

export const cleanVideoScript = cleanVideoScriptFormatting

const now = () => new Date().toISOString()
const makeId = () => 'video-' + crypto.randomUUID()
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const COMPACT_STORYBOARD_OUTPUT = [
  '本次使用精简分镜输出协议：仅返回紧凑JSON。允许省略以下默认值字段：镜头summary=""、chapter=1、reviewNotes=[]、holdSeconds=1.5，以及空数组formulas/actions/boardTexts/highlights；公式action="write"；板书kind="keyword"；高亮effect="box"。chapter有适用的实际章节时必须保留；非默认值必须明确输出。',
  '程序只补齐上述默认字段；其他字段沿用原有必填/可选规则，不得省略必要的id、title、utteranceIds、latex、板书text、cue、目标或电路引用，不得为精简省略教学主体画面。高亮默认使用box；有明确教学需要时仍可使用其他受支持效果。',
  'scriptNotes和lessonNotes是非口播教学上下文，不能作为同步词来源；cue.phrase必须逐字取自所引用utterances.text的原文，不能取自标题、备注或概述。',
  'reviewNotes只保留简短的实际矛盾与待审核问题；没有问题时省略，不要解释批次边界，不要输出冻结输入的角色警告。',
  '优先把本批1至2句相关台词组织为一页，仅教学目标或总结边界改变时拆页。每页保留必要公式、题设和电路，避免板书重复公式。高亮只选择最关键的一处，不逐项重复所有公式和板书；省略caption、summary、默认动画时长和默认布局。单纯符号拓扑且不需要额外物理量标签时使用quantities:[]；若提供物理量则每项必须包含unit，R用Ω、I用A、U用V、P用W，不可省略。',
  '新建标准纯电阻串联或并联图优先选紧凑电路模板，系统生成真实连线。例如circuits:[{"id":"c1","name":"两电阻串联示意","mode":"symbolic","template":"series","resistors":[{"id":"r1","label":"R₁"},{"id":"r2","label":"R₂"}],"quantities":[]}]。template只能series或parallel，必须准确匹配当前题设；不要同时输出graph。电源ID固定source；需要主开关时switch:true，开关ID固定switch。numeric模式必须逐电阻给resistance和source:{voltage:数值}，未知数值用symbolic，不猜参数。原题图、已有电路和复杂接法仍使用已有素材或完整graph，不能改成标准模板。',
].join('\n')

function expandCompactStoryboardDefaults(shot: Record<string, unknown>): void {
  const defaults: Record<string, unknown> = { summary: '', chapter: 1, reviewNotes: [], holdSeconds: 1.5, formulas: [], actions: [], boardTexts: [], highlights: [] }
  for (const [key, value] of Object.entries(defaults)) if (shot[key] === undefined) shot[key] = value
  for (const [collection, key, value] of [['formulas', 'action', 'write'], ['boardTexts', 'kind', 'keyword'], ['highlights', 'effect', 'box']]) {
    const items = shot[collection]
    if (Array.isArray(items)) for (const item of items) if (record(item) && item[key] === undefined) item[key] = value
  }
}

function storyboardIdErrors(shots: Shot[], circuits: CircuitAsset[]): string[] {
  const errors: string[] = []
  const check = (items: { id: string }[], label: string) => {
    const ids = new Set<string>()
    for (const item of items) {
      if (typeof item.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(item.id) || ids.has(item.id)) errors.push('分镜结构不完整：' + label + '标识无效或重复：' + String(item.id))
      ids.add(item.id)
    }
  }
  check(shots, '镜头'); check(shots.flatMap(shot => shot.formulas), '公式'); check(circuits, '电路')
  for (const shot of shots) { check(shot.actions, shot.title + '的动作'); check(shot.boardTexts || [], shot.title + '的板书'); check(shot.highlights || [], shot.title + '的高亮') }
  for (const asset of circuits) check(asset.quantities, asset.name + '的物理量')
  return errors
}
export const FISH_VIDEO_VOICES = {
  '方大招': VIDEO_ROLE_VOICES.fish.teacher,
  '金天练': VIDEO_ROLE_VOICES.fish.student,
}
export const DEFAULT_VIDEO_SPEAKERS = canonicalVideoSpeakers('fish')

function circuit(id: string, resistors: number[], parallel: boolean, voltage: number, symbolic = false): CircuitAsset {
  const component = (id: string, type: 'battery' | 'resistor', x: number, y: number, value: number): CircuitComponent => ({
    id, type, label: type === 'battery' ? '电源' : id.toUpperCase().replace(/(\d)/g, d => '₀₁₂₃₄₅₆₇₈₉'[Number(d)]) + (symbolic ? '' : ' · ' + value + ' Ω'),
    position: { x, y }, orientation: 'horizontal', terminals: structuredClone(componentLibrary[type].terminals),
    parameters: type === 'battery' ? { voltage, internalResistance: 0 } : { resistance: value },
  })
  const width = parallel ? 300 : Math.max(300, resistors.length * 140)
  const source = component('source', 'battery', width / 2, 100 + (parallel ? resistors.length * 100 : 130), voltage)
  const loads = resistors.map((value, i) => component('r' + (i + 1), 'resistor', parallel ? width / 2 : 90 + i * 140, parallel ? 80 + i * 100 : 80, value))
  const connections: CircuitGraph['connections'] = []
  const wire = (from: string, to: string, points: { x: number; y: number }[]) => connections.push({ id: 'w' + (connections.length + 1), from, to, routes: { schematic: { points } } })
  const left = (c: CircuitComponent) => ({ x: c.position.x - 40, y: c.position.y })
  const right = (c: CircuitComponent) => ({ x: c.position.x + 40, y: c.position.y })
  wire('source.positive', 'r1.left', [left(source), { x: 15, y: source.position.y }, { x: 15, y: loads[0].position.y }, left(loads[0])])
  if (parallel) {
    for (let i = 1; i < loads.length; i++) {
      wire('r' + i + '.left', 'r' + (i + 1) + '.left', [left(loads[i - 1]), { x: 15, y: loads[i - 1].position.y }, { x: 15, y: loads[i].position.y }, left(loads[i])])
      wire('r' + i + '.right', 'r' + (i + 1) + '.right', [right(loads[i - 1]), { x: width - 15, y: loads[i - 1].position.y }, { x: width - 15, y: loads[i].position.y }, right(loads[i])])
    }
    wire('r' + loads.length + '.right', 'source.negative', [right(loads.at(-1)!), { x: width - 15, y: loads.at(-1)!.position.y }, { x: width - 15, y: source.position.y }, right(source)])
  } else {
    for (let i = 1; i < loads.length; i++) wire('r' + i + '.right', 'r' + (i + 1) + '.left', [right(loads[i - 1]), left(loads[i])])
    wire('r' + loads.length + '.right', 'source.negative', [right(loads.at(-1)!), { x: width - 5, y: loads.at(-1)!.position.y }, { x: width - 5, y: source.position.y }, right(source)])
  }
  return { id, name: (loads.length === 1 ? '单电阻' : loads.length + ' 电阻' + (parallel ? '并联' : '串联')) + (symbolic ? ' · 符号推导' : ' · 例题'),
    revision: 1, mode: symbolic ? 'symbolic' : 'numeric', graph: { id: 'circuit-' + id, components: [source, ...loads], connections, warnings: [],
      meta: { inputType: 'manual', createdAt: now() } } satisfies CircuitGraph,
    quantities: resistors.map((r, i) => ({ id: 'R' + (i + 1), symbol: 'R' + (i + 1), unit: 'Ω', ...(symbolic ? { expression: 'R_' + (i + 1) } : { value: r }), provenance: symbolic ? 'symbolic' as const : 'given' as const })),
  }
}
export function createPowerLessonProject(): VideoProject {
  const circuits = [
    circuit('single', [8], false, 16), circuit('series2', [4, 12], false, 32),
    circuit('parallel2-symbolic', [10, 15], true, 1, true), circuit('parallel2', [10, 15], true, Math.sqrt(90)),
    circuit('series3-symbolic', [4, 10, 20], false, 1, true), circuit('parallel3-symbolic', [4, 10, 20], true, 1, true),
    circuit('parallel3', [4, 10, 20], true, 10),
  ]
  const add = (id: string, quantities: CircuitAsset['quantities']) => circuits.find(c => c.id === id)!.quantities.push(...quantities)
  add('single', [{ id: 'I', symbol: 'I', value: 2, unit: 'A', provenance: 'given' },
    { id: 'U', symbol: 'U', value: 16, unit: 'V', provenance: 'derived', revealStepId: 's2-voltage' },
    { id: 'P', symbol: 'P', value: 32, unit: 'W', provenance: 'derived', revealStepId: 's2-power' }])
  add('series2', [{ id: 'P1', symbol: 'P1', value: 16, unit: 'W', provenance: 'given' },
    { id: 'I', symbol: 'I', value: 2, unit: 'A', provenance: 'derived', revealStepId: 's4-current' },
    { id: 'P2', symbol: 'P2', value: 48, unit: 'W', provenance: 'derived', revealStepId: 's4-result' },
    { id: 'U', symbol: 'U', value: 32, unit: 'V', provenance: 'derived', expression: '内部验证用总电压，不作为题设展示' }])
  add('parallel2', [{ id: 'P1', symbol: 'P1', value: 9, unit: 'W', provenance: 'given' },
    { id: 'P2', symbol: 'P2', value: 6, unit: 'W', provenance: 'derived', revealStepId: 's7-result' },
    { id: 'U', symbol: 'U', value: Math.sqrt(90), unit: 'V', provenance: 'derived', expression: '3√10；内部验证用，不作为题设展示' }])
  add('parallel3', [{ id: 'P2', symbol: 'P2', value: 10, unit: 'W', provenance: 'given' },
    { id: 'P1', symbol: 'P1', value: 25, unit: 'W', provenance: 'derived', revealStepId: 's11-result' },
    { id: 'P3', symbol: 'P3', value: 5, unit: 'W', provenance: 'derived', revealStepId: 's11-result' },
    { id: 'U', symbol: 'U', value: 10, unit: 'V', provenance: 'derived', expression: '内部验证用总电压，不作为题设展示' }])
  return normalizeVideoProjectRoles({ schemaVersion: 1, id: makeId(), title: '电功率：三个公式，两个比例', revision: 1, createdAt: now(), updatedAt: now(),
    sourceScript: POWER_LESSON_SOURCE, cleanedScript: cleanVideoScript(POWER_LESSON_SOURCE), physicsModel: 'ideal_textbook',
    speakers: structuredClone(DEFAULT_VIDEO_SPEAKERS),
    speech: { ...DEFAULT_VIDEO_SPEECH },
    utterances: POWER_LESSON_LINES.map(([speaker, text], i) => ({ id: 'u' + (i + 1), speakerId: speaker === '方大招' ? 'teacher' : 'student', text })),
    shots: powerLessonShots(), circuits, settings: { width: 1920, height: 1080, fps: 24, font: 'Microsoft YaHei', background: '#ffffff', backgroundImage: VIDEO_PAGE_BACKGROUND, titlePinImage: VIDEO_TITLE_PIN, defaultCircuitView: 'schematic', switchPolicy: 'contextual', showFormulaCaptions: false } })
}
function attachScriptTeachingReviews(project: VideoProject): VideoProject {
  for (const review of collectScriptTeachingReviewNotes(project)) {
    const shot = project.shots.find(shot => !!review.utteranceId && shot.utteranceIds.includes(review.utteranceId)) || project.shots[0]
    if (shot && !shot.reviewNotes.includes(review.message)) shot.reviewNotes.push(review.message)
  }
  return project
}
export function createProjectFromScript(script: string, title = '新的教学视频'): VideoProject {
  const base = createPowerLessonProject()
  const { cleanedScript, utterances, speakers: parsedSpeakers, scriptNotes } = parseVideoScript(script)
  const speakers = new Map(parsedSpeakers.map(({ id, name }) => [name, id]))
  if (!utterances.length) throw new Error('文稿中没有可配音的台词')
  const shots: Shot[] = utterances.map((u, i) => ({ id: 'shot-' + (i + 1), title: '段落 ' + (i + 1), chapter: 1,
    summary: '待规划画面与公式', utteranceIds: [u.id], formulas: [], actions: [], reviewNotes: ['请生成分镜或补充画面、公式及电路后确认。'], holdSeconds: 1.5 }))
  return attachScriptTeachingReviews(normalizeVideoSummaryLayouts(normalizeVideoProjectRoles({ ...base, title, sourceScript: script, cleanedScript, utterances, shots, circuits: [], scriptNotes,
    speakers: [...speakers].map(([name, id], i) => ({ id, name, voice: (DEFAULT_VIDEO_SPEAKERS.find(s => s.name === name) || DEFAULT_VIDEO_SPEAKERS[i % 2]).voice, color: (DEFAULT_VIDEO_SPEAKERS.find(s => s.name === name) || DEFAULT_VIDEO_SPEAKERS[i % 2]).color })) })))
}
export function validateTeachingProject(project: VideoProject): string[] {
  const errors: string[] = [...validateVideoProjectRoles(project), ...storyboardIdErrors(project.shots, project.circuits)]
  const utterances = new Map(project.utterances.map(u => [u.id, u]))
  const steps = new Map(project.shots.flatMap(s => s.formulas).map(s => [s.id, s]))
  const visited: string[] = []
  for (const shot of project.shots) {
    errors.push(...validateVideoShotActions(shot, project.circuits))
    errors.push(...storyboardTimingIssues(project, shot))
    errors.push(...validateVideoShotPresentation(shot))
    visited.push(...shot.utteranceIds)
    for (const event of [...shot.formulas, ...shot.actions, ...(shot.boardTexts || []).filter(b => b.cue).map(b => ({ ...b, cue: b.cue! })), ...(shot.highlights || [])]) {
      const u = utterances.get(event.cue.utteranceId)
      if (!u || !shot.utteranceIds.includes(event.cue.utteranceId)) errors.push(shot.title + '：动作引用了本镜头以外的旁白')
      else if (event.cue.phrase && !u.text.includes(event.cue.phrase)) errors.push(shot.title + '：找不到同步词“' + event.cue.phrase + '”')
    }
    const boardIds = new Set((shot.boardTexts || []).map(b => b.id))
    if (boardIds.size !== (shot.boardTexts || []).length) errors.push(shot.title + '：板书标识重复')
    for (const board of shot.boardTexts || []) if (!['keyword', 'law', 'problem', 'given', 'derivation'].includes(board.kind)) errors.push(shot.title + '：板书只允许关键词、定律、题干、已知条件或推导')
    for (const board of shot.boardTexts || []) if (!validVideoAnimationDuration(board.durationSeconds)) errors.push(shot.title + '：板书动画时长无效')
    for (const formula of shot.formulas) if ((formula.display !== undefined && !['replace', 'append'].includes(formula.display)) || !validVideoAnimationDuration(formula.durationSeconds)) errors.push(shot.title + '：公式保留方式或动画时长无效')
    for (const highlight of shot.highlights || []) {
      const target = highlight.targetType === 'board' ? shot.boardTexts?.find(b => b.id === highlight.targetId) : shot.formulas.find(f => f.id === highlight.targetId)
      const targetText = target && ('text' in target ? target.text : target.latex)
      const occurrence = highlight.occurrence ?? 1
      if (!targetText || !highlight.phrase || targetText.split(highlight.phrase).length - 1 < occurrence || !Number.isInteger(occurrence) || occurrence < 1) errors.push(shot.title + '：高亮目标关键词不存在：' + highlight.phrase + '（目标 ' + highlight.targetId + ' 原文：' + (targetText || '') + '）')
      if (highlight.color && !(VIDEO_HIGHLIGHT_COLORS as readonly string[]).includes(highlight.color.toUpperCase())) errors.push(shot.title + '：高亮颜色不符合课件规范')
    }
    for (const f of shot.formulas) if (f.role === 'misconception' && (!f.correctionStepId || !steps.has(f.correctionStepId))) errors.push(shot.title + '：教学猜想缺少纠正步骤')
    if (shot.circuitAssetId && !project.circuits.some(c => c.id === shot.circuitAssetId)) errors.push(shot.title + '：电路素材不存在')
  }
  if (JSON.stringify(visited) !== JSON.stringify(project.utterances.map(u => u.id))) errors.push('分镜必须按顺序覆盖每段旁白一次，避免漏句或重复。')
  for (const c of project.circuits) {
    const graph = parseCircuitGraph(c.graph)
    if (!graph) { errors.push(c.name + '：电路工程无效'); continue }
    for (const q of c.quantities) if (q.revealStepId && !steps.has(q.revealStepId)) errors.push(c.name + '：物理量的显示步骤不存在')
    errors.push(...validateCircuitTeachingQuantities(c, graph))
  }
  return [...new Set(errors)]
}
export async function prepareVideoProject(project: VideoProject, options: { signal?: AbortSignal; resolveImage?: (source: string) => Promise<string>; allowTimingIssues?: boolean; baseline?: VideoProject; pendingFormulaReferences?: boolean } = {}): Promise<VideoProject> {
  const copy = normalizeVideoSummaryLayouts(normalizeVideoStoryboardActions(normalizeVideoProjectRoles(project)))
  copy.settings.backgroundImage ??= VIDEO_PAGE_BACKGROUND
  copy.settings.titlePinImage ??= VIDEO_TITLE_PIN
  copy.settings.showFormulaCaptions ??= false
  const draftTimingIssues = options.allowTimingIssues ? new Set(copy.shots.flatMap(shot => storyboardTimingIssues(copy, shot))) : new Set<string>()
  // A read-only generation preview may precede the later shot that reveals a
  // quantity or corrects a misconception. Production preparation stays strict.
  const pendingReferences = new Set<string>()
  if (options.pendingFormulaReferences) {
    const steps = new Set(copy.shots.flatMap(shot => shot.formulas.map(formula => formula.id)))
    const validId = (id?: string) => !!id && /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(id)
    for (const asset of copy.circuits) {
      const missing = asset.quantities.filter(quantity => quantity.revealStepId && !steps.has(quantity.revealStepId))
      if (missing.length && missing.every(quantity => validId(quantity.revealStepId))) pendingReferences.add(asset.name + '：物理量的显示步骤不存在')
    }
    for (const shot of copy.shots) {
      const missing = shot.formulas.filter(formula => formula.role === 'misconception' && (!formula.correctionStepId || !steps.has(formula.correctionStepId)))
      if (missing.length && missing.every(formula => validId(formula.correctionStepId))) pendingReferences.add(shot.title + '：教学猜想缺少纠正步骤')
    }
  }
  const errors = validateTeachingProject(copy).filter(issue => !draftTimingIssues.has(issue) && !pendingReferences.has(issue))
  if (errors.length) throw new Error(errors.join('\n'))
  const reusedAssets = new Set<string>()
  const geometryInputs = (asset: CircuitAsset) => JSON.stringify({ graph: asset.graph, geometry: asset.geometry, mode: asset.mode, viewMode: asset.viewMode, currentFlow: asset.currentFlow, layoutPrepared: asset.layoutPrepared })
  for (const asset of copy.circuits) {
    options.signal?.throwIfAborted()
    asset.viewMode ??= copy.settings.defaultCircuitView || 'schematic'
    if (asset.mode === 'symbolic') asset.currentFlow = false
    const previous = options.baseline?.circuits.find(p => p.id === asset.id)
    if (asset.geometry && asset.layoutPrepared && previous && geometryInputs(asset) === geometryInputs(previous)) { reusedAssets.add(asset.id); continue }
    let graph = parseCircuitGraph(asset.graph)!
    if (!asset.geometry && !asset.layoutPrepared) graph = await layoutCircuitGraph(graph, asset.viewMode || copy.settings.defaultCircuitView || 'schematic')
    const prepared = await prepareCircuitGeometry(graph, { ...options, viewMode: asset.viewMode || 'schematic', currentFlow: asset.currentFlow ?? asset.viewMode === 'real', mode: asset.mode, physicsModel: 'ideal_textbook' })
    asset.graph = prepared.graph; asset.geometry = prepared.geometry; asset.layoutPrepared = true
  }
  for (const shot of copy.shots) {
    const asset = copy.circuits.find(item => item.id === shot.circuitAssetId)
    const previous = options.baseline?.shots.find(p => p.id === shot.id)
    // State order depends on spoken cues as well as switch parameters.
    const stateInputs = (p: VideoProject, s: Shot) => JSON.stringify({ asset: s.circuitAssetId, utterances: s.utteranceIds.map(id => p.utterances.find(u => u.id === id)), states: s.actions.filter(a => a.type === 'state') })
    if (asset && reusedAssets.has(asset.id) && previous && stateInputs(copy, shot) === stateInputs(options.baseline!, previous)) continue
    if (asset) await prepareCircuitStateGeometry(copy, shot, asset, options)
  }
  return copy
}

/** note-N is reserved for parser output; custom notes use their own stable IDs. */
export function refreshVideoScriptNotes(previous: Pick<VideoProject, 'scriptNotes' | 'utterances'>, parsed: Pick<VideoProject, 'scriptNotes' | 'utterances'>): NonNullable<VideoProject['scriptNotes']> {
  const sourceNotes = structuredClone(parsed.scriptNotes || [])
  const sameSequence = JSON.stringify(previous.utterances) === JSON.stringify(parsed.utterances)
  const customNotes = (previous.scriptNotes || []).filter(note => !/^note-\d+$/.test(note.id)).map(note => {
    const copy = structuredClone(note)
    if (!copy.utteranceId) return copy
    const old = previous.utterances.find(utterance => utterance.id === copy.utteranceId)
    if (sameSequence && old) return copy
    const matching = old ? parsed.utterances.filter(utterance => utterance.text === old.text && utterance.speakerId === old.speakerId) : []
    if (matching.length === 1) copy.utteranceId = matching[0].id
    else {
      // Keep the author's note when its spoken anchor was deleted or became ambiguous.
      delete copy.utteranceId
      delete copy.placement
    }
    return copy
  })
  return [...sourceNotes, ...customNotes]
}

/** AI returns declarative circuits and shots; the user's utterances are never rewritten. */
export async function generateVideoStoryboard(project: VideoProject, options: StoryboardGenerationOptions = {}): Promise<VideoProject> {
  project = normalizeVideoProjectRoles(project)
  if (project.problem && !project.problem.reviewed) throw new Error('请先审核题目解析与讲稿，再生成分镜')
  const parsed = createProjectFromScript(project.sourceScript, project.title)
  const unchanged = parsed.utterances.length === project.utterances.length && parsed.utterances.every((line, i) =>
    line.text === project.utterances[i].text && line.speakerId === project.utterances[i].speakerId)
  if (unchanged) {
    // Imported projects can have stable IDs other than u1, u2, ... . Parser notes
    // must follow the preserved utterances instead of referring to recycled IDs.
    const ids = new Map(parsed.utterances.map((line, i) => [line.id, project.utterances[i].id]))
    parsed.utterances = parsed.utterances.map(line => ({ ...line, id: ids.get(line.id)! }))
    parsed.scriptNotes = parsed.scriptNotes?.map(note => ({ ...note, ...(note.utteranceId ? { utteranceId: ids.get(note.utteranceId) } : {}) }))
  }
  const scriptNotes = refreshVideoScriptNotes(project, parsed)
  if (!unchanged) project = { ...project, cleanedScript: parsed.cleanedScript, utterances: parsed.utterances,
    speakers: parsed.speakers.map(s => ({ ...s, voice: project.speakers.find(old => old.name === s.name)?.voice || s.voice })) }
  project = { ...project, cleanedScript: parsed.cleanedScript, scriptNotes }
  project = normalizeVideoProjectRoles(project)
  const result = normalizeVideoSummaryLayouts(normalizeVideoProjectRoles(await generateStoryboardInBatches(project, options, requestStoryboardBatch, validateTeachingProject)))
  if (result.problem) result.problem = { ...result.problem, storyboardReady: true }
  return attachScriptTeachingReviews(result)
}

export async function requestStoryboardBatch(project: VideoProject, options: StoryboardGenerationOptions = {}, context = ''): Promise<VideoProject> {
  const terminalReference = Object.values(componentLibrary).map(c => c.type + ': ' + c.terminals.map(t => t.id).join(',')).join('; ')
  const prompt = renderPrompt('video/knowledge/storyboard-system', { rolePrompt: VIDEO_STORYBOARD_ROLE_PROMPT, terminalReference, switchPolicy: project.settings.switchPolicy || 'contextual' })
  const utteranceIds = new Set(project.utterances.map(line => line.id))
  const sections = options.outline?.sections.filter(item => item.utteranceIds.some(id => utteranceIds.has(id)))
  // Send only assets owned by this teaching section. The complete snapshot is
  // still retained below when merging the response and validating references.
  const circuitIds = sections?.length && sections.every(section => section.circuitIds)
    ? new Set(sections.flatMap(section => section.circuitIds!)) : undefined
  const requestCircuits = circuitIds ? project.circuits.filter(circuit => circuitIds.has(circuit.id)) : project.circuits
  const existingCircuitIds = new Set(project.circuits.map(circuit => circuit.id))
  const plannedNewCircuits = circuitIds ? [...circuitIds].filter(id => !existingCircuitIds.has(id)).length : undefined
  const sourceCharacters = project.utterances.reduce((count, line) => count + [...line.text].length, 0)
  // Keep headroom for long utterances and new graphs, without reserving the
  // whole-course minimum for a short batch that only references existing assets.
  const maxOutputTokens = Math.min(16000, Math.max(plannedNewCircuits === undefined ? 7000 : 4000,
    project.utterances.length * 1800, 1800 + sourceCharacters * 4) + (plannedNewCircuits || 0) * 2400)
  const requestText = renderPrompt('video/knowledge/storyboard-user', { projectJson: JSON.stringify({ title: project.title, scriptNotes: project.scriptNotes, problem: project.problem ? { text: project.problem.text, analysis: project.problem.analysis, answer: project.problem.answer, preserveTopology: true } : undefined, defaultCircuitView: project.settings.defaultCircuitView, speakers: project.speakers.map(({ id, name }) => ({ id, name })), utterances: project.utterances, circuits: requestCircuits.map(c => ({ id: c.id, name: c.name, mode: c.mode, components: (c.graph as CircuitGraph).components.map(({ id, type, label, parameters }) => ({ id, type, label, parameters })), connections: (c.graph as CircuitGraph).connections, quantities: c.quantities })) }) })
  // A known topology does not prove that all labels/conditions were transcribed.
  const requestContent = project.problem?.imageDataUrl ? [{ type: 'text', text: requestText }, { type: 'image_url', image_url: { url: project.problem.imageDataUrl, detail: 'high' } }] : requestText
  const response = await (options.fetcher || fetch)('/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    json: true, purpose: 'video_storyboard',
    ...(options.serverManagedRetries ? { maxOutputTokens } : {}),
    messages: [{ role: 'system', content: prompt + (context ? '\n' + context : '') + (options.compactOutput ? '\n' + COMPACT_STORYBOARD_OUTPUT : '') }, { role: 'user', content: requestContent }],
  }), signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(105_000)]) : AbortSignal.timeout(105_000) })
  const data: unknown = await response.json().catch((error: unknown) => {
    options.signal?.throwIfAborted()
    if (!(error instanceof SyntaxError)) throw error
    return { error: 'AI 服务未返回 JSON，请检查服务连接后重试' }
  })
  if (!response.ok) {
    const error = record(data) ? data : {}
    const retryHeader = response.headers.get('Retry-After')
    const retrySeconds = retryHeader === null ? 0 : Number(retryHeader)
    const retryAfterMs = typeof error.retryAfterMs === 'number' && Number.isFinite(error.retryAfterMs) && error.retryAfterMs >= 0 ? error.retryAfterMs
      : Number.isFinite(retrySeconds) ? Math.max(0, retrySeconds * 1000) : Math.max(0, Date.parse(retryHeader!) - Date.now()) || 0
    throw Object.assign(new Error(typeof error.error === 'string' ? error.error : 'AI 分镜生成失败'), {
      status: response.status, code: error.code, retryable: typeof error.retryable === 'boolean' ? error.retryable : undefined,
      retryAfter: retryAfterMs / 1000, retryAfterMs,
    })
  }
  // Classify explicit model-output checks only. Transport, cancellation and
  // internal processing errors keep their original identity and retry policy.
  const invalidModelOutput = (message: string) => Object.assign(new Error(message), {
    code: 'storyboard_content_invalid', ...(options.serverManagedRetries ? { retryable: false } : {}),
  })
  const choice = record(data) && Array.isArray(data.choices) ? data.choices[0] : undefined
  if (record(choice) && choice.finish_reason === 'length') throw Object.assign(new Error('AI 分镜输出达到长度上限，内容未完整返回；请减少本批台词或电路数量后重试。'), { code: 'ai_output_limit', retryable: true })
  const text = record(choice) && record(choice.message) ? choice.message.content : undefined
  if (typeof text !== 'string') throw invalidModelOutput('AI 没有返回分镜')
  let result: { shots?: Shot[]; circuits?: Record<string, unknown>[] }
  try { result = JSON.parse(text.replace(/^\x60\x60\x60(?:json)?\s*|\s*\x60\x60\x60$/g, '')) } catch { throw invalidModelOutput('AI 分镜不是有效 JSON') }
  if (!record(result) || !Array.isArray(result.shots) || !result.shots.length || result.shots.length > 100) throw invalidModelOutput('AI 分镜数量无效：应返回包含 shots 数组的 JSON 对象')
  if (options.compactOutput) for (const shot of result.shots) {
    if (!record(shot)) continue
    expandCompactStoryboardDefaults(shot)
    // Explicit invalid values must not be hidden by the legacy formatting normalizers.
    if (typeof shot.summary !== 'string' || !Number.isInteger(shot.chapter) || shot.chapter < 1
      || !Array.isArray(shot.reviewNotes) || !shot.reviewNotes.every(note => typeof note === 'string')
      || typeof shot.holdSeconds !== 'number' || !Number.isFinite(shot.holdSeconds) || shot.holdSeconds < 0 || shot.holdSeconds > 10
      || !Array.isArray(shot.boardTexts) || !Array.isArray(shot.highlights)
      || shot.highlights.some(highlight => record(highlight) && highlight.effect === null)) throw invalidModelOutput('AI 精简分镜含无效的显式字段值')
  }
  // Reject malformed shots before cross-shot reference work can touch their arrays.
  // Never infer a shot or silently remove an unsupported response object.
  for (const shot of result.shots) {
    if (!record(shot) || typeof shot.id !== 'string' || typeof shot.title !== 'string' || !Array.isArray(shot.utteranceIds) || !Array.isArray(shot.formulas) || !Array.isArray(shot.actions)
      || !shot.formulas.every(record)
      || !shot.actions.every(a => record(a) && Array.isArray(a.targetIds))
      || (shot.boardTexts != null && (!Array.isArray(shot.boardTexts) || !shot.boardTexts.every(record)))
      || (shot.highlights != null && (!Array.isArray(shot.highlights) || !shot.highlights.every(record)))) {
      throw invalidModelOutput('AI 分镜结构不完整：shots仅包含镜头，每镜头必须含有效的utteranceIds、formulas、actions数组；电路对象请放circuits数组')
    }
  }
  const idErrors = storyboardIdErrors(result.shots, [])
  if (idErrors.length) throw invalidModelOutput(idErrors.join('\n'))
  const circuits = structuredClone(project.circuits)
  if (result.circuits !== undefined && (!Array.isArray(result.circuits) || result.circuits.length > 30)) throw invalidModelOutput('AI 电路素材数量无效')
  for (const value of result.circuits || []) {
    const raw = options.compactOutput ? expandStoryboardCircuitTemplate(value) : value
    if (!record(raw) || typeof raw.id !== 'string' || typeof raw.name !== 'string' || !['numeric', 'symbolic'].includes(String(raw.mode)) || !Array.isArray(raw.quantities)
      || !raw.quantities.every(q => record(q) && [q.id, q.symbol, q.unit].every(value => typeof value === 'string')
        && ['given', 'derived', 'symbolic'].includes(String(q.provenance))
        && (q.value === undefined || typeof q.value === 'number' && Number.isFinite(q.value))
        && [q.expression, q.componentId, q.revealStepId].every(value => value === undefined || typeof value === 'string'))) throw invalidModelOutput('AI 电路素材结构不完整')
    const graphData = raw.graph as { components?: Record<string, unknown>[]; connections?: unknown[] }
    if (!graphData || !Array.isArray(graphData.components) || !Array.isArray(graphData.connections)) throw invalidModelOutput('AI 电路缺少元件或导线')
    const components = graphData.components.map((c, i) => {
      if (!record(c)) throw invalidModelOutput('AI 电路元件结构不完整：components 每项须为元件对象')
      if (!isComponentType(c.type)) throw invalidModelOutput('AI 电路含不支持的元件类型：' + String(c.type) + '。components只允许：' + Object.keys(componentLibrary).join(',') + '；导线只放connections，并使用connections.id作为动画目标，不得用type:wire。')
      const def = componentLibrary[c.type]
      const orientation = c.orientation === 0 || c.orientation === undefined ? 'horizontal' : c.orientation === 90 ? 'vertical' : c.orientation
      return { ...c, id: c.id || 'element-' + i, terminals: structuredClone(def.terminals), position: c.position || { x: 100 + i * 140, y: 100 }, orientation }
    })
    const graph = parseCircuitGraph({ ...graphData, id: 'circuit-' + raw.id, components, warnings: [], meta: { inputType: 'text', createdAt: now() } })
    if (!graph) throw invalidModelOutput('AI 电路的参数、标识或连接端口无效，请重试并复核')
    const next: CircuitAsset = { id: raw.id, name: raw.name, revision: 1, mode: raw.mode as CircuitAsset['mode'], viewMode: project.settings.defaultCircuitView || 'schematic', currentFlow: project.settings.defaultCircuitView === 'real' && raw.mode === 'numeric', graph: await layoutCircuitGraph(graph, 'schematic'), quantities: (raw.quantities as CircuitAsset['quantities']).map(q => q.provenance === 'given' || q.provenance === 'symbolic' ? { ...q, revealStepId: undefined } : q) }
    const index = circuits.findIndex(c => c.id === raw.id)
    if (index >= 0) { next.revision = circuits[index].revision + 1; circuits[index] = next } else circuits.push(next)
  }
  for (const shot of result.shots) {
    // A single review note is a harmless provider formatting variant, not missing storyboard content.
    const reviewNotes: unknown = shot?.reviewNotes
    if (shot && typeof reviewNotes === 'string') shot.reviewNotes = reviewNotes.trim() ? [reviewNotes] : []
    if (!shot || typeof shot.id !== 'string' || typeof shot.title !== 'string' || !Array.isArray(shot.utteranceIds) || !Array.isArray(shot.formulas) || !Array.isArray(shot.actions) || !Array.isArray(shot.reviewNotes) || typeof shot.summary !== 'string') throw invalidModelOutput('AI 分镜结构不完整')
    for (const note of project.scriptNotes || []) {
      if (note.kind !== 'summary' && !(note.kind === 'chapter' && isVideoSummaryHeading(note.text))) continue
      const anchor = project.utterances.findIndex(line => line.id === note.utteranceId)
      if (anchor < 0) continue
      const firstSummary = project.utterances[anchor + (note.placement === 'after' ? 1 : 0)]?.id
      if (firstSummary && shot.utteranceIds.indexOf(firstSummary) > 0) throw invalidModelOutput('AI 总结分镜不能与前一教学段合并台词：' + shot.id + '；请从 ' + firstSummary + ' 独立开始总结页。')
    }
    shot.boardTexts ??= []
    shot.highlights ??= []
    if (!Array.isArray(shot.boardTexts) || !Array.isArray(shot.highlights)) throw invalidModelOutput('AI 板书结构不完整')
    shot.chapter = Number.isInteger(shot.chapter) && shot.chapter > 0 ? shot.chapter : 1
    for (const f of shot.formulas) {
      // Some JSON services double-escape TeX commands after parsing; this is a formatting correction.
      if (typeof f.latex !== 'string') throw invalidModelOutput('AI 公式结构不完整')
      if (f.cardId !== undefined) {
        const board = shot.boardTexts.find(item => item.id === f.cardId)
        if (!board?.card) throw invalidModelOutput(`AI 公式 ${f.id} 的 cardId=${f.cardId} ${board ? `指向板书 ${board.id}，但该板书没有 card 定义` : '未引用本镜头的知识卡'}；cardId 必须引用同镜头含有效 card 定义的知识卡。`)
      }
      if (!/\\begin\{/.test(f.latex)) f.latex = f.latex.replace(/\\{2,}(?=(?:frac|dfrac|tfrac|sqrt|times|cdot|div|Omega|mathrm|text|quad|qquad|Rightarrow|rightarrow|uparrow|downarrow|left|right)(?![A-Za-z])|[,;:! ])/g, '\\')
    }
    // Keep malformed/empty actions visible to the validator so a provider response
    // cannot silently lose a storyboard event. The batch retry can then ask for a
    // corrected action with the original ID and cue.
    for (const action of shot.actions) {
      if (typeof action.id !== 'string' || typeof action.type !== 'string' || !Array.isArray(action.targetIds)) throw invalidModelOutput('AI 电路动作结构不完整')
      if (!action.targetIds.length) throw invalidModelOutput('AI 电路动作 ' + action.id + ' 缺少目标')
      // Geometry is always recomputed from the validated initial graph and state parameters.
      delete action.geometry
      if (action.text !== undefined && typeof action.text !== 'string' || action.type === 'label' && !action.text?.trim()) throw invalidModelOutput('AI 电路动作 ' + action.id + ' 缺少有效标注文字')
    }
    for (const event of [...shot.formulas, ...shot.actions, ...shot.boardTexts.filter(b => b.cue), ...shot.highlights]) {
      if (typeof event.cue === 'string') {
        const phrase = event.cue as string
        const exactId = project.utterances.find(u => shot.utteranceIds.includes(u.id) && u.id === phrase)
        if (exactId) { event.cue = { utteranceId: exactId.id }; continue }
        const candidates = project.utterances.filter(u => shot.utteranceIds.includes(u.id) && u.text.includes(phrase))
        if (!phrase.trim() || candidates.length !== 1) throw invalidModelOutput('AI 动作没有有效旁白同步点：' + phrase)
        event.cue = { utteranceId: candidates[0].id, phrase }
      }
      if (!record(event.cue) || typeof event.cue.utteranceId !== 'string'
        || (event.cue.phrase !== undefined && (typeof event.cue.phrase !== 'string' || !event.cue.phrase.trim()))
        || (event.cue.offset !== undefined && (typeof event.cue.offset !== 'number' || !Number.isFinite(event.cue.offset) || event.cue.offset < 0 || event.cue.offset > 120))) throw invalidModelOutput('AI 动作没有有效旁白同步点')
    }
    for (const highlight of shot.highlights) {
      highlight.effect ??= 'box'
      if (highlight.color !== undefined && typeof highlight.color !== 'string'
        || highlight.durationSeconds !== undefined && (typeof highlight.durationSeconds !== 'number' || !Number.isFinite(highlight.durationSeconds) || highlight.durationSeconds < .5 || highlight.durationSeconds > 15)) throw invalidModelOutput('AI 高亮结构不完整')
    }
    const hold = Number(shot.holdSeconds)
    shot.holdSeconds = shot.holdSeconds == null || !Number.isFinite(hold) ? 1.5 : Math.max(0, Math.min(10, hold))
    normalizeGeneratedShotLayout(shot)
    const layoutErrors = validateVideoShotLayout(shot)
    if (layoutErrors.length) throw invalidModelOutput(layoutErrors.join('\n'))
    // Validate before target migration calls string methods or dereferences cues.
    if (!isVideoProjectShape({ ...project, circuits, shots: [shot] })) throw invalidModelOutput('AI 分镜结构不完整，请按指定字段类型返回')
    // Migrate exact text-target highlights before formula IDs merge, retaining the original phrase.
    const textActions = normalizeVideoStoryboardActions({ ...project, circuits, shots: [shot] }).shots[0]
    shot.actions = textActions.actions; shot.highlights = textActions.highlights || []; shot.reviewNotes = textActions.reviewNotes
    const sameTime = new Map<string, typeof shot.formulas>()
    for (const formula of shot.formulas) {
      const key = JSON.stringify([formula.cue.utteranceId, formula.cue.phrase, formula.cue.occurrence ?? 1, formula.cue.offset ?? 0, formula.cardId || '', formula.display === 'append' ? formula.id : 'replace'])
      const group = sameTime.get(key) || []; group.push(formula); sameTime.set(key, group)
    }
    const aliases = new Map<string, string>()
    shot.formulas = [...sameTime.values()].map(group => {
      if (group.length === 1) return group[0]
      if (group.some(f => f.role === 'misconception')) throw invalidModelOutput('AI 同步点重叠了猜想与纠正，请为不同公式使用不同原文关键词')
      const last = group[group.length - 1]
      group.forEach(f => aliases.set(f.id, last.id))
      shot.reviewNotes.push('同一旁白关键词的公式已合并显示，请确认推导节奏。')
      return { ...last, latex: '\\begin{gathered}' + [...new Set(group.map(f => f.latex))].join('\\\\') + '\\end{gathered}', parts: undefined }
    })
    for (const h of shot.highlights) if (h.targetType === 'formula') h.targetId = aliases.get(h.targetId) || h.targetId
    for (const asset of circuits) for (const q of asset.quantities) if (q.revealStepId) q.revealStepId = aliases.get(q.revealStepId) || q.revealStepId
    for (const s of result.shots) for (const f of s.formulas) if (f.correctionStepId) f.correctionStepId = aliases.get(f.correctionStepId) || f.correctionStepId
    alignGeneratedHighlightCues(project, shot)
    alignGeneratedCardFormulaCues(project, shot)
    for (const event of [...shot.formulas, ...shot.actions, ...shot.boardTexts.filter(b => b.cue), ...shot.highlights]) if (!event.cue || typeof event.cue.utteranceId !== 'string') throw invalidModelOutput('AI 动作没有旁白同步点')
  }
  const next = normalizeVideoSummaryLayouts(normalizeVideoStoryboardActions({ ...project, circuits, shots: result.shots, approvedRevision: undefined, updatedAt: now() }))
  if (!isVideoProjectShape(next)) throw invalidModelOutput('AI 分镜结构不完整，请按指定字段类型返回')
  // Cross-batch reveal/correction references are checked after all batches have been assembled.
  const errors = [...validateTeachingProject(next).filter(message => !message.includes('显示步骤不存在') && !message.includes('教学猜想缺少纠正步骤')).map(message => {
    if (message.endsWith('电路素材不存在') && project.circuits.length) return message + '；请使用已声明的电路素材 ID：' + project.circuits.map(asset => asset.id).join('、')
    return message
  }), ...getVideoStoryboardReadiness(next).issues]
  if (errors.length) throw Object.defineProperty(Object.assign(new Error(errors.join('\n')), { code: 'storyboard_content_invalid', ...(options.serverManagedRetries ? { retryable: false } : {}),
    issues: errors.map(message => {
      const shot = next.shots.find(item => message.startsWith(item.title + '：'))
      const objectId = message.match(/（目标 ([A-Za-z0-9_-]+)/)?.[1] || message.match(/（([A-Za-z0-9_-]+)）$/)?.[1]
      return { code: 'storyboard_content_invalid', stage: 'storyboard', message, severity: 'error', retryable: false,
        ...(shot ? { shotId: shot.id } : {}), ...(objectId ? { objectId } : {}) }
    }) }), 'candidateProject', { value: structuredClone(next), enumerable: false })
  return next
}
