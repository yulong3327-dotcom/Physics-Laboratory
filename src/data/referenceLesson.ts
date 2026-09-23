import type { AnimationCue, CircuitAction, CircuitAsset, Shot, VideoProject } from '../../server/videoTypes'
import type { CircuitComponent, CircuitGraph, ComponentParameters, ComponentType } from '../types/circuit'
import { createProjectFromScript } from '../lib/videoProject'
import { componentLibrary } from './componentLibrary'

/** Authored capability example. The reference movies are analysis inputs, not bundled assets. */
export function createReferenceEffectsProject(): VideoProject {
  const source = [
    '方大招：先看通路。闭合开关后，灯泡发光，电路中有电流。',
    '金天练：打开开关，又会怎样？',
    '方大招：打开开关，电流停止，灯泡熄灭。这就是断路。',
    '方大招：再看用电器短路。闭合旁路开关，导线直接连通第一只灯泡的两端。',
    '方大招：第一只灯泡被短路，电压为零，不再发光。第二只灯泡仍在通路中。',
    '方大招：串联分压，先看电压范围。总电压等于两部分电压之和。',
    '方大招：串联电路中，电流处处相等。',
    '方大招：由欧姆定律，两部分电压分别等于电流乘各自的电阻。',
    '方大招：两式相比，约去相同的电流，就得到电压之比等于电阻之比。',
    '方大招：已知总电压六伏，两个串联电阻分别为三欧和六欧。第一部分分到几伏？',
    '金天练：电阻不同，也能各分三伏吗？',
    '方大招：不能平均分。电压按一比二分配，第一部分是二伏，第二部分是四伏。',
  ].join('\n')
  const project = createProjectFromScript(source, '电路状态与串联分压 · 目标效果示范')
  project.settings = { ...project.settings, fps: 30, defaultCircuitView: 'schematic', switchPolicy: 'preserve' }
  project.scriptNotes = [{ id: 'reference-demo', kind: 'visual', sourceLine: 1, text: '使用正式 Fish s1 双角色配音，展示可复用的知识卡片、排版与教学动效。参考视频仅用于分析视觉目标。' }]
  const cue = (index: number, phrase?: string): AnimationCue => ({ utteranceId: project.utterances[index - 1].id, ...(phrase ? { phrase } : {}) })
  const component = (id: string, type: ComponentType, x: number, y: number, label: string, parameters: ComponentParameters = {}): CircuitComponent => ({
    id, type, label, parameters, position: { x, y }, realPosition: { x, y }, orientation: 'horizontal', realOrientation: 'horizontal',
    terminals: structuredClone(componentLibrary[type].terminals),
  })
  const graph = (id: string, components: CircuitComponent[], pairs: [string, string][]): CircuitGraph => ({
    id, components, connections: pairs.map(([from, to], i) => ({ id: `w${i + 1}`, from, to })),
    warnings: [], meta: { inputType: 'manual', createdAt: project.createdAt },
  })
  const asset = (id: string, name: string, g: CircuitGraph, mode: 'numeric' | 'symbolic', real = false): CircuitAsset => ({
    id, name, graph: g, mode, viewMode: real ? 'real' : 'schematic', currentFlow: mode === 'numeric', layoutPrepared: true, revision: 1, quantities: [],
  })
  const sourcePart = () => component('source', 'battery', 480, 120, '', { voltage: 3, internalResistance: 0 })
  const lamp = (id: string, x: number, y: number, label: string) => component(id, 'lamp', x, y, label, { ratedVoltage: 3, ratedPower: 1.5 })
  const states = asset('states', '通路与断路 · 实物', graph('states', [
    component('s', 'switch', 180, 120, 'S', { switchClosed: false }), sourcePart(), lamp('l', 330, 330, 'L'),
  ], [['source.positive', 's.right'], ['s.left', 'l.left'], ['l.right', 'source.negative']]), 'numeric', true)
  const bypass = asset('bypass', '用电器短路 · 实物', graph('bypass', [
    component('s', 'switch', 180, 110, 'S', { switchClosed: true }), sourcePart(),
    lamp('l1', 180, 360, 'L₁'), lamp('l2', 480, 360, 'L₂'),
    component('bypass', 'switch', 180, 245, '旁路开关', { switchClosed: false }),
  ], [['source.positive', 's.right'], ['s.left', 'l1.left'], ['l1.right', 'l2.left'], ['l2.right', 'source.negative'], ['l1.left', 'bypass.left'], ['bypass.right', 'l1.right']]), 'numeric', true)
  const dividerGraph = graph('divider', [component('r1', 'resistor', 180, 210, 'R₁'), component('r2', 'resistor', 420, 210, 'R₂')], [['r1.right', 'r2.left']])
  const divider = asset('divider', '串联分压范围 · 符号', dividerGraph, 'symbolic')
  const questionGraph = structuredClone(dividerGraph)
  questionGraph.id = 'question'
  questionGraph.components[0].label = 'R₁ = 3 Ω'; questionGraph.components[1].label = 'R₂ = 6 Ω'
  questionGraph.components[0].parameters = { resistance: 3 }; questionGraph.components[1].parameters = { resistance: 6 }
  questionGraph.components.push(component('source', 'battery', 300, 410, '', { voltage: 6, internalResistance: 0 }))
  questionGraph.connections.push(
    { id: 'w2', from: 'source.positive', to: 'r1.left', routes: { schematic: { points: [{ x: 260, y: 410 }, { x: 90, y: 410 }, { x: 90, y: 210 }, { x: 140, y: 210 }] } } },
    { id: 'w3', from: 'r2.right', to: 'source.negative', routes: { schematic: { points: [{ x: 460, y: 210 }, { x: 520, y: 210 }, { x: 520, y: 410 }, { x: 340, y: 410 }] } } },
  )
  const question = asset('question', '串联分压练习', questionGraph, 'numeric')
  question.currentFlow = false
  project.circuits = [states, bypass, divider, question]
  const shot = (id: string, title: string, first: number, last: number, circuitAssetId: string): Shot => ({
    id, title, sectionTitle: title, chapter: 1, summary: title, utteranceIds: project.utterances.slice(first - 1, last).map(u => u.id),
    circuitAssetId, boardTexts: [], formulas: [], actions: [], highlights: [], reviewNotes: [], holdSeconds: 1,
    layout: { template: 'explain', elements: {} },
  })
  const state = (id: string, target: string, closed: boolean, at: AnimationCue): CircuitAction => ({
    id, type: 'state', targetIds: [target], state: { componentId: target, parameters: { switchClosed: closed } }, cue: at, durationSeconds: .35,
  })
  const voltage = (id: string, targets: string[], label: string, at: AnimationCue, offset = 42, color = '#4F80FF'): CircuitAction => ({
    id, type: 'annotation', targetIds: targets, annotation: { kind: 'voltage', label, side: 'below', offset, color }, cue: at, durationSeconds: .6,
  })
  const a = shot('states-demo', '电路状态：通路与断路', 1, 3, states.id)
  a.actions = [state('close', 's', true, cue(1, '闭合开关')), state('open', 's', false, cue(3, '打开开关'))]
  a.boardTexts = [
    { id: 'closed-law', card: { title: '通路' }, kind: 'law', text: '电路连通，持续有电流\n用电器正常工作', cue: cue(1, '闭合开关'), entrance: 'slide', durationSeconds: .6 },
    { id: 'open-law', card: { title: '断路' }, kind: 'law', text: '电路某处断开\n没有电流，灯泡熄灭', cue: cue(3, '打开开关'), entrance: 'settle', durationSeconds: .9 },
  ]
  a.highlights = [{ id: 'open-emphasis', targetType: 'board', targetId: 'open-law', phrase: '没有电流', color: '#FF6600', effect: 'underline', cue: cue(3, '电流停止'), durationSeconds: 3 }]
  const b = shot('bypass-demo', '电路状态：用电器短路', 4, 5, bypass.id)
  b.actions = [state('bypass-close', 'bypass', true, cue(4, '闭合旁路开关')), voltage('zero-voltage', ['l1'], 'U₁ = 0', cue(5, '电压为零'), 44, '#FF6600')]
  b.boardTexts = [
    { id: 'short-law', card: { title: '用电器短路' }, kind: 'law', text: '两端被导线直接连通', cue: cue(4, '闭合旁路开关'), entrance: 'slide', durationSeconds: .6 },
    { id: 'short-result', card: { title: '观察结果' }, kind: 'derivation', text: 'L₁ 两端电压为零，熄灭\nL₂ 仍在通路中', cue: cue(5, '第一只灯泡'), entrance: 'settle', durationSeconds: .9 },
  ]
  b.reviewNotes = ['这是用电器短路，不是电源短路。电源短路的温升、火焰和烧毁不是当前稳态仿真的结果。']
  const c = shot('divider-demo', '串联电路分压原理', 6, 9, divider.id)
  c.actions = [
    voltage('u1-range', ['r1'], 'U₁', cue(6, '电压范围'), 42), voltage('u2-range', ['r2'], 'U₂', cue(6, '电压范围'), 42, '#FF6600'),
    voltage('total-range', ['r1', 'r2'], 'U总', cue(6, '总电压'), 96, '#333333'),
    { id: 'current-direction', type: 'annotation', targetIds: ['w1'], annotation: { kind: 'current', label: 'I', side: 'above', offset: 38, direction: 'forward', color: '#333333' }, cue: cue(7, '电流处处相等'), durationSeconds: .6 },
  ]
  c.boardTexts = [
    { id: 'voltage-card', card: { title: '串联电路电压规律' }, kind: 'law', text: '', cue: cue(6, '电压范围'), entrance: 'slide', durationSeconds: .6 },
    { id: 'current-card', card: { title: '串联电路电流规律' }, kind: 'law', text: '', cue: cue(7), entrance: 'settle', durationSeconds: .8 },
    { id: 'ohm-card', card: { title: '欧姆定律与分压关系' }, kind: 'law', text: '', cue: cue(8), entrance: 'settle', durationSeconds: .8 },
  ]
  c.formulas = [
    { id: 'sum-law', cardId: 'voltage-card', latex: 'U=U_1+U_2', action: 'write', cue: cue(6, '总电压'), durationSeconds: .7 },
    { id: 'equal-current', cardId: 'current-card', latex: 'I_1=I_2=I', action: 'write', cue: cue(7, '电流处处相等'), durationSeconds: .7 },
    { id: 'ohm-law', cardId: 'ohm-card', latex: 'U_1=IR_1,\\quad U_2=IR_2', action: 'write', cue: cue(8, '由欧姆定律'), durationSeconds: .8 },
    { id: 'divider-ratio', cardId: 'ohm-card', latex: '\\frac{U_1}{U_2}=\\frac{R_1}{R_2}', action: 'ratio', cue: cue(9, '两式相比'), durationSeconds: 1.1 },
  ]
  c.highlights = [{ id: 'sum-revisit', targetType: 'formula', targetId: 'sum-law', phrase: 'U=U_1+U_2', effect: 'pointer', color: '#4F80FF', cue: cue(9, '就得到'), durationSeconds: 2.5 }]
  const d = shot('question-demo', '串联分压：先思考，再验证', 10, 12, question.id)
  d.boardTexts = [
    { id: 'question-known', kind: 'given', text: '已知：U = 6 V\nR₁ = 3 Ω，R₂ = 6 Ω\n求：U₁、U₂', entrance: 'appear' },
    { id: 'choice-a', kind: 'problem', text: 'A. U₁ = 2 V，U₂ = 4 V', entrance: 'appear' },
    { id: 'choice-b', kind: 'problem', text: 'B. U₁ = 3 V，U₂ = 3 V', entrance: 'appear' },
  ]
  d.actions = [voltage('known-total', ['r1', 'r2'], 'U = 6 V', cue(10, '总电压六伏'), 105, '#333333')]
  d.formulas = [
    { id: 'question-ratio', latex: 'U_1:U_2=R_1:R_2=1:2', action: 'ratio', cue: cue(12, '电压按一比二'), durationSeconds: .8 },
    { id: 'question-result', latex: 'U_1=2\\,\\mathrm{V},\\quad U_2=4\\,\\mathrm{V}', action: 'result', display: 'append', cue: cue(12, '第一部分是二伏'), durationSeconds: .8 },
  ]
  d.highlights = [
    { id: 'incorrect-answer', targetType: 'board', targetId: 'choice-b', phrase: 'B. U₁ = 3 V，U₂ = 3 V', effect: 'cross', color: '#FF4D4D', cue: cue(12, '不能平均分'), durationSeconds: 15 },
    { id: 'correct-answer', targetType: 'board', targetId: 'choice-a', phrase: 'A. U₁ = 2 V，U₂ = 4 V', effect: 'check', color: '#16C863', cue: cue(12, '第一部分是二伏'), durationSeconds: 5 },
  ]
  project.shots = [a, b, c, d]
  return project
}
