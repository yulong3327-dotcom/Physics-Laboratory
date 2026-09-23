import type { AnimationCue, Shot, VideoProject } from '../../server/videoTypes'
import { createProjectFromScript } from '../lib/videoProject'
import { componentLibrary } from './componentLibrary'

/** A different lesson using the same card, layout, cue and emphasis contract. */
export function createKnowledgeCardsProject(): VideoProject {
  const project = createProjectFromScript([
    '方大招：电功率表示电流做功的快慢，等于电压乘电流。',
    '方大招：电功表示消耗的电能。功率不变时，电功等于功率乘时间。',
    '方大招：计算前统一单位：功率用瓦，时间用秒，电功用焦耳。',
    '方大招：再看这个定值电阻。两端电压六伏，电阻三欧，用欧姆定律求电流。',
    '金天练：我猜电流是三安，对吗？',
    '方大招：代入六除以三，电流是二安。核对数值、单位和适用条件，才能确认结果。',
  ].join('\n'), '知识卡片复用示范 · 电功、电功率与欧姆定律')
  project.settings = { ...project.settings, fps: 30, defaultCircuitView: 'schematic', switchPolicy: 'preserve' }
  project.scriptNotes = [{ id: 'reusable-cards', kind: 'visual', sourceLine: 1, text: '同一套声明式知识卡片用于电功、电功率和欧姆定律。无手工坐标；网格与电路分栏自动规划；采用正式 Fish s1 双角色配音。' }]
  const cue = (index: number, phrase?: string): AnimationCue => ({ utteranceId: project.utterances[index - 1].id, ...(phrase ? { phrase } : {}) })
  const shot = (id: string, title: string, from: number, to: number): Shot => ({
    id, title, sectionTitle: title, chapter: 1, summary: title, utteranceIds: project.utterances.slice(from - 1, to).map(u => u.id),
    boardTexts: [], formulas: [], actions: [], highlights: [], reviewNotes: [], holdSeconds: 1,
    layout: { template: 'explain', contentLayout: 'auto', elements: {} },
  })
  const power = shot('power-cards', '电功与电功率', 1, 3)
  power.boardTexts = [
    { id: 'power', kind: 'law', card: { title: '电功率' }, text: '电流做功的快慢', entrance: 'slide', durationSeconds: .7, cue: cue(1) },
    { id: 'energy', kind: 'law', card: { title: '电功与电能' }, text: '功率不变时', entrance: 'settle', durationSeconds: .8, cue: cue(2) },
    { id: 'units', kind: 'given', card: { title: '计算前统一单位' }, text: '功率：瓦（W）\n时间：秒（s）\n电功：焦耳（J）', entrance: 'slide', durationSeconds: .7, cue: cue(3) },
  ]
  power.formulas = [
    { id: 'power-law', cardId: 'power', latex: 'P=UI', action: 'write', durationSeconds: .8, cue: cue(1, '等于电压') },
    { id: 'energy-law', cardId: 'energy', latex: 'W=Pt', action: 'write', durationSeconds: .8, cue: cue(2, '电功等于') },
  ]
  power.highlights = [
    { id: 'power-pointer', targetType: 'formula', targetId: 'power-law', phrase: 'P=UI', effect: 'pointer', color: '#4F80FF', durationSeconds: 2, cue: cue(2, '功率不变') },
    { id: 'unit-pulse', targetType: 'board', targetId: 'units', phrase: '焦耳', effect: 'pulse', color: '#FF6600', durationSeconds: 1.5, cue: cue(3, '焦耳') },
  ]
  const ohm = shot('ohm-cards', '欧姆定律：条件与计算', 4, 6)
  const terminals = (type: 'resistor' | 'battery') => structuredClone(componentLibrary[type].terminals)
  project.circuits = [{ id: 'ohm', name: '定值电阻', revision: 1, mode: 'numeric', currentFlow: false, viewMode: 'schematic', layoutPrepared: true, quantities: [],
    graph: { id: 'ohm', components: [
      { id: 'r', type: 'resistor', label: 'R = 3 Ω', position: { x: 300, y: 200 }, orientation: 'horizontal', parameters: { resistance: 3 }, terminals: terminals('resistor') },
      { id: 'source', type: 'battery', label: '', position: { x: 300, y: 400 }, orientation: 'horizontal', parameters: { voltage: 6, internalResistance: 0 }, terminals: terminals('battery') },
    ], connections: [
      { id: 'w1', from: 'source.positive', to: 'r.left', routes: { schematic: { points: [{ x: 260, y: 400 }, { x: 150, y: 400 }, { x: 150, y: 200 }, { x: 260, y: 200 }] } } },
      { id: 'w2', from: 'r.right', to: 'source.negative', routes: { schematic: { points: [{ x: 340, y: 200 }, { x: 450, y: 200 }, { x: 450, y: 400 }, { x: 340, y: 400 }] } } },
    ], warnings: [], meta: { inputType: 'manual', createdAt: project.createdAt } },
  }]
  ohm.circuitAssetId = 'ohm'
  ohm.boardTexts = [
    { id: 'condition', kind: 'law', card: { title: '欧姆定律的适用条件' }, text: '同一导体，温度等条件不变', entrance: 'slide', durationSeconds: .7, cue: cue(4) },
    { id: 'calculation', kind: 'derivation', card: { title: '代入与核验' }, text: 'U = 6 V，R = 3 Ω', entrance: 'settle', durationSeconds: .8, cue: cue(4, '两端电压') },
    { id: 'guess', kind: 'problem', text: '猜想：I = 3 A', entrance: 'fade', durationSeconds: .5, cue: cue(5) },
  ]
  ohm.formulas = [
    { id: 'ohm-law', cardId: 'condition', latex: 'I=\\frac{U}{R}', action: 'write', durationSeconds: .8, cue: cue(4, '欧姆定律') },
    { id: 'ohm-substitution', cardId: 'calculation', latex: 'I=\\frac{6}{3}\\,\\mathrm{A}', action: 'substitute', durationSeconds: .7, cue: cue(6, '代入') },
    { id: 'ohm-result', cardId: 'calculation', latex: 'I=2\\,\\mathrm{A}', action: 'result', durationSeconds: .7, cue: cue(6, '电流是二安') },
  ]
  ohm.actions = [{ id: 'known-voltage', type: 'annotation', targetIds: ['r'], annotation: { kind: 'voltage', label: 'U = 6 V', side: 'below', offset: 42, color: '#4F80FF' }, durationSeconds: .6, cue: cue(4, '两端电压') }]
  ohm.highlights = [
    { id: 'guess-cross', targetType: 'board', targetId: 'guess', phrase: 'I = 3 A', effect: 'cross', color: '#FF4D4D', durationSeconds: 15, cue: cue(6) },
    { id: 'result-check', targetType: 'formula', targetId: 'ohm-result', phrase: 'I=2\\,\\mathrm{A}', effect: 'check', color: '#16C863', durationSeconds: 4, cue: cue(6, '核对') },
  ]
  project.shots = [power, ohm]
  return project
}
