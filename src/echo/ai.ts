import { renderPrompt } from '../lib/promptCatalog'
import { analyzeEcho, echoTemplates, parameterLabels, solveEcho } from './engine'
import { questionOnly, splitEchoScenes } from './input'
import type { EchoModelId, EchoParameter, EchoQuantity } from './types'

export const ECHO_AI_MODEL = 'deepseek-v4-pro-zy'
export interface EchoAIScene { title: string; modelId: EchoModelId | null; parameters: Partial<Record<EchoParameter, EchoQuantity>>; warnings: string[] }
export interface EchoAssistance { model: typeof ECHO_AI_MODEL; scenarios: EchoAIScene[]; elapsedMs: number }
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
const canonical = (s: string) => s.normalize('NFKC').replace(/\s+/g, '')
function verifyQuotedValue(key: EchoParameter, value: number, source: string) {
  const s = canonical(source).replace(/(?<=\d)\.(?=\d)/g, '.')
  const speed = ['soundSpeed', 'sourceSpeed', 'targetSpeed', 'finalSpeed'].includes(key)
  const time = ['echoTime', 'passTime'].includes(key)
  const pattern = /([+-]?\d+(?:\.\d+)?)\s*(km\/h|千米每小时|公里每小时|m\/s|米每秒|ms|毫秒|s|秒|km|千米|m|米)/gi
  const values = [...s.matchAll(pattern)].flatMap(m => {
    const unit = m[2].toLowerCase(), num = Number(m[1])
    if (speed && /\/|每/.test(unit)) return [num * (/km|千米|公里/.test(unit) ? 1 / 3.6 : 1)]
    if (time && /^(s|秒|ms|毫秒)$/.test(unit)) return [num * (/^(ms|毫秒)$/.test(unit) ? .001 : 1)]
    if (!speed && !time && /^(m|米|km|千米)$/.test(unit)) return [num * (/^(km|千米)$/.test(unit) ? 1000 : 1)]
    return []
  })
  // Chinese numerals and less common unit spellings are checked by the local extractor when available.
  if (!values.length) { const q = analyzeEcho(source).quantities[key]; if (q) values.push(q.value) }
  if (!values.some(v => Math.abs(v - value) <= Math.max(1e-7, Math.abs(v) * 1e-6))) throw new Error(`${parameterLabels[key].label}与引用中的数字或单位不一致。`)
}
export function parseEchoAssistance(value: unknown, input: string): EchoAssistance {
  if (typeof value === 'string') {
    try { value = JSON.parse(value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) } catch { throw new Error('模型返回内容不是有效 JSON。') }
  }
  if (!record(value) || !Array.isArray(value.scenarios) || !value.scenarios.length || value.scenarios.length > 8) throw new Error('模型结果缺少有效的物理情境。')
  const text = canonical(questionOnly(input))
  const scenarios = value.scenarios.map((raw): EchoAIScene => {
    if (!record(raw) || typeof raw.title !== 'string' || !raw.title.trim() || raw.title.length > 120 || (raw.modelId !== null && !echoTemplates.some(t => t.id === raw.modelId)) || !record(raw.parameters)) throw new Error('模型返回了无效的情境或模型编号。')
    if (!Array.isArray(raw.warnings) || raw.warnings.length > 20 || raw.warnings.some(w => typeof w !== 'string' || w.length > 1000)) throw new Error('模型提示格式无效。')
    const warnings = raw.warnings as string[]
    const parameters: EchoAIScene['parameters'] = {}
    for (const [key, v] of Object.entries(raw.parameters)) {
      if (!Object.prototype.hasOwnProperty.call(parameterLabels, key) || !record(v) || typeof v.value !== 'number' || !Number.isFinite(v.value) || Math.abs(v.value) > 1e9 || typeof v.source !== 'string' || v.source.length < 2 || v.source.length > 2000) throw new Error('模型返回了无效的数值条件。')
      if (!text.includes(canonical(v.source))) throw new Error(`${parameterLabels[key as EchoParameter].label}的引用无法在题干中找到。`)
      verifyQuotedValue(key as EchoParameter, v.value, v.source)
      parameters[key as EchoParameter] = { value: v.value, source: v.source }
    }
    return { title: raw.title, modelId: raw.modelId as EchoModelId | null, parameters, warnings }
  })
  const local = analyzeEcho(questionOnly(input))
  if (local.modelId) {
    if (scenarios.length !== 1) throw new Error('模型把关联的回声与通行条件拆散，改用本地规则保留完整条件。')
    const scene = scenarios[0]
    if (scene.modelId !== local.modelId && (local.candidates[0]?.score || 0) >= 65) throw new Error('模型分类与明确的运动方向规则不一致。')
    for (const [key, q] of Object.entries(local.quantities)) {
      const p = scene.parameters[key as EchoParameter]
      if (!p || Math.abs(p.value - q!.value) > Math.max(1e-7, Math.abs(q!.value) * 1e-6)) throw new Error(`${parameterLabels[key as EchoParameter].label}与本地提取的明确条件不一致。`)
    }
  }
  for (const scene of scenarios) {
    const sceneEvidence = Object.values(scene.parameters).map(q => q!.source).join('。')
    if (scene.modelId === 'moving-target' && /暗礁|岛礁|山崖|高楼|地面/.test(sceneEvidence) && !/同向|前车|汽车[②2]|乙车|反射目标|移动反射/.test(sceneEvidence)) {
      if (/正前方|向前方/.test(sceneEvidence)) {
        scene.modelId = 'approaching'
        scene.warnings.push('DeepSeek 将固定反射面分为移动目标；已根据题干中的固定反射面和前方位置，由本地规则修正为匀速靠近。')
      } else throw new Error('模型把固定反射面识别成了移动目标，无法确认方向。')
    }
    if (!scene.modelId || !echoTemplates.find(t => t.id === scene.modelId)?.supported) continue
    const solution = solveEcho(scene.modelId, Object.fromEntries(Object.entries(scene.parameters).map(([k, q]) => [k, q!.value])))
    if (solution.errors.length) throw new Error(`模型条件未通过物理校验：${solution.errors[0]}`)
  }
  const localScenes = splitEchoScenes(input).map(s => analyzeEcho(s.text))
  if (localScenes.length) {
    if (scenarios.length !== localScenes.length) throw new Error('模型没有完整区分题目的独立物理情境。')
    localScenes.forEach((expected, i) => {
      if (expected.modelId !== scenarios[i].modelId) throw new Error('模型情境与题目中运动对象的顺序或方向不一致。')
      for (const [key, q] of Object.entries(expected.quantities)) {
        const actual = scenarios[i].parameters[key as EchoParameter]
        if (!actual || Math.abs(actual.value - q!.value) > Math.max(1e-7, Math.abs(q!.value) * 1e-6)) throw new Error(`${parameterLabels[key as EchoParameter].label}混用了其他小问的条件，或漏掉了本情境条件。`)
      }
    })
  }
  return { model: ECHO_AI_MODEL, scenarios, elapsedMs: typeof value.elapsedMs === 'number' && Number.isFinite(value.elapsedMs) && value.elapsedMs >= 0 ? value.elapsedMs : 0 }
}
export function echoMessages(text: string) {
  return [{ role: 'system', content: renderPrompt('echo/parse-system') }, { role: 'user', content: `请解析这道题，返回 JSON。只提取题干中的已知条件：\n${questionOnly(text)}` }]
}
export async function requestEchoAssistance(text: string, signal?: AbortSignal): Promise<EchoAssistance> {
  const started = performance.now()
  const response = await fetch('/api/ai/chat', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.any([AbortSignal.timeout(150000), ...(signal ? [signal] : [])]), body: JSON.stringify({ purpose: 'echo_parse', json: true, messages: echoMessages(text) }) })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(response.status === 401 ? '尚未连接 AI 服务；可在连接设置中填写 SK。' : typeof data.error === 'string' ? data.error : `模型服务返回 ${response.status}。`)
  const result = parseEchoAssistance(data.choices?.[0]?.message?.content, text)
  return { ...result, elapsedMs: Math.round(performance.now() - started) }
}
