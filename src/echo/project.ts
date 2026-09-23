import type { EchoModelId, EchoParameter, EchoProject, EchoSample } from './types'
import { parseEchoAssistance } from './ai'

const ids: EchoModelId[] = ['stationary', 'approaching', 'receding', 'descending', 'ascending', 'depth', 'moving-target', 'decelerating', 'two-receivers', 'parking']
const fields: EchoParameter[] = ['soundSpeed', 'sourceSpeed', 'targetSpeed', 'echoTime', 'initialDistance', 'finalSpeed', 'trainLength', 'tunnelLength', 'passTime', 'sourceTravel', 'carriageLength']
export const ECHO_DRAFT_KEY = 'echo-lab.draft.v1'
export function parseSamples(raw: unknown): EchoSample[] {
  if (!Array.isArray(raw) || raw.length > 1000) throw new Error('样本库应为数组，最多包含 1000 条样本。')
  const seen = new Set<string>()
  return raw.map(item => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id.trim() || item.id.length > 100 || seen.has(item.id)) throw new Error('样本编号无效或重复。')
    seen.add(item.id)
    if (typeof item.title !== 'string' || !item.title.trim() || item.title.length > 100 || typeof item.text !== 'string' || !item.text.trim() || item.text.length > 20000 || !ids.includes(item.modelId)) throw new Error('样本需要标题、题目文字和有效的模型编号。')
    if (!Array.isArray(item.keywords) || item.keywords.length > 30 || item.keywords.some((k: unknown) => typeof k !== 'string' || !k.trim() || k.length > 40)) throw new Error('样本关键词应为最多 30 个短语。')
    return { id: item.id, title: item.title, text: item.text, modelId: item.modelId, keywords: [...new Set<string>(item.keywords)] }
  })
}
export function parseProject(raw: unknown): EchoProject {
  if (!raw || typeof raw !== 'object') throw new Error('回声实验工程格式无效。')
  const p = raw as EchoProject
  if (p.kind !== 'echo-lab' || p.schemaVersion !== 1 || typeof p.text !== 'string' || p.text.length > 20000 || (p.modelId !== null && !ids.includes(p.modelId))) throw new Error('文件不是受支持的回声实验工程。')
  if (!p.overrides || typeof p.overrides !== 'object' || Array.isArray(p.overrides)) throw new Error('工程参数格式无效。')
  const overrides: EchoProject['overrides'] = {}
  for (const [key, value] of Object.entries(p.overrides)) {
    if (!fields.includes(key as EchoParameter) || typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e9) throw new Error('工程参数必须是有限数值且字段有效。')
    overrides[key as EchoParameter] = value
  }
  const assistance = p.assistance === undefined ? undefined : parseEchoAssistance(p.assistance, p.text)
  const sceneIndex = p.sceneIndex ?? 0
  if (!Number.isInteger(sceneIndex) || sceneIndex < 0 || (assistance && sceneIndex >= assistance.scenarios.length)) throw new Error('情境编号无效。')
  return { kind: 'echo-lab', schemaVersion: 1, text: p.text, modelId: p.modelId, overrides, samples: parseSamples(p.samples), ...(assistance ? { assistance, sceneIndex } : {}) }
}
export function mergeSamples(existing: EchoSample[], incoming: EchoSample[]) {
  return parseSamples([...existing.filter(s => !incoming.some(i => i.id === s.id)), ...incoming])
}
export function downloadEcho(name: string, content: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a'); a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
