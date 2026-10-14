export type RecordRow = { v: string; orientation: string; size: string; nature: string }
export type Phase = 'adjust' | 'observe' | 'answer' | 'done'
export type LessonState = {
  version: 2; step: number; phase: Phase; equipment: number; height: number;
  u: number; screen: number; objectLocked: boolean; scanned: [number, number];
  throughLens: boolean; records: RecordRow[];
}
export const STORAGE_KEY = 'guided-optics.imaging.v2'
export const trials = [
  { u: 30, condition: 'u > 2f', title: '物距大于二倍焦距', v: '15', range: 'f < v < 2f', orientation: '倒立', size: '缩小', nature: '实像', question: '光屏上的烛焰像，与原来的烛焰相比有什么特点？', choices: ['倒立、缩小的实像', '倒立、放大的实像', '正立、放大的虚像'], answer: 0 },
  { u: 20, condition: 'u = 2f', title: '物距等于二倍焦距', v: '20', range: 'v = 2f', orientation: '倒立', size: '等大', nature: '实像', question: '比较烛焰与光屏上的像，它们的大小和方向如何？', choices: ['倒立、缩小的实像', '倒立、等大的实像', '正立、等大的虚像'], answer: 1 },
  { u: 15, condition: 'f < u < 2f', title: '物距在一倍与二倍焦距之间', v: '30', range: 'v > 2f', orientation: '倒立', size: '放大', nature: '实像', question: '这一次的像能被光屏承接吗？它比烛焰更大还是更小？', choices: ['倒立、放大的实像', '倒立、缩小的实像', '正立、放大的虚像'], answer: 0 },
  { u: 10, condition: 'u = f', title: '物体位于焦点', v: '∞', range: '不成有限远像', orientation: '—', size: '—', nature: '不成有限远像', question: '移动光屏后，你观察到了什么？', choices: ['在 v = 10 cm 处得到清晰的像', '没有清晰的像，折射光近似平行', '光屏上出现正立的虚像'], answer: 1 },
  { u: 6, condition: 'u < f', title: '物体位于焦点以内', v: '15', range: '与物同侧', orientation: '正立', size: '放大', nature: '虚像', question: '从透镜右侧观察到的像，具有什么特点？', choices: ['光屏上的倒立实像', '正立、放大，不能被光屏承接的虚像', '没有任何像'], answer: 1 },
] as const
export const titles = ['摆放实验器材', '调节三心同高', '测量透镜焦距', ...trials.map(t => t.title), '归纳成像规律', '实验完成']
export const emptyRow = (): RecordRow => ({ v: '', orientation: '', size: '', nature: '' })
export const fresh = (): LessonState => ({ version: 2, step: 0, phase: 'adjust', equipment: 0, height: -2, u: 30, screen: 24, objectLocked: false, scanned: [24, 24], throughLens: false, records: trials.map(emptyRow) })

export function load(): LessonState {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    if (!v || v.version !== 2 || !Number.isInteger(v.step) || v.step < 0 || v.step > 9 || !['adjust', 'observe', 'answer', 'done'].includes(v.phase)) return fresh()
    if (![v.u, v.screen, v.height, v.equipment].every(Number.isFinite) || v.u < 5 || v.u > 35 || v.screen < 5 || v.screen > 38 || Math.abs(v.height) > 3 || v.equipment < 0 || v.equipment > 3) return fresh()
    if (!Array.isArray(v.scanned) || v.scanned.length !== 2 || !v.scanned.every(Number.isFinite) || !Array.isArray(v.records) || v.records.length !== 5 || !v.records.every((r: RecordRow) => r && ['v', 'orientation', 'size', 'nature'].every(key => typeof r[key as keyof RecordRow] === 'string'))) return fresh()
    return { ...fresh(), ...v }
  } catch { return fresh() }
}

export function nextState(s: LessonState): LessonState {
  const step = Math.min(s.step + 1, 9)
  return { ...s, step, phase: 'adjust', u: step >= 8 ? 30 : step === 7 ? 8 : 26, screen: step >= 8 ? 15 : 24, objectLocked: false, scanned: [24, 24], throughLens: false }
}

export function taskText(step: number) {
  if (step === 0) return '按蜡烛、凸透镜、光屏的顺序摆放器材。'
  if (step === 1) return '调节高度，使烛焰中心、透镜中心、光屏中心大致在同一高度。'
  if (step === 2) return '用平行光照射凸透镜，移动光屏，找出最小、最亮的光斑。'
  if (step >= 3 && step <= 7) return `将物距调至 ${trials[step - 3].u} cm，再移动光屏观察成像。`
  if (step === 8) return '根据五组观察记录，填写像距、正倒、大小和虚实。'
  return '完成五组物距探究，整理出凸透镜成像的规律。'
}

export function wrongCells(records: RecordRow[]): string[] {
  return records.flatMap((row, i) => (['v', 'orientation', 'size', 'nature'] as const).filter(key => {
    if (key !== 'v') return row[key] !== trials[i][key]
    const text = row.v.trim()
    return i === 3 ? !['∞', '无穷大', '无限远'].includes(text) : text === '' || !Number.isFinite(Number(text)) || Math.abs(Number(text) - Number(trials[i].v)) > 0.1
  }).map(key => `${i}-${key}`))
}

export function downloadRecords() {
  const lines = ['物距条件,物距(cm),像距绝对值(cm),像的位置,正倒,大小,虚实', ...trials.map(t => [t.condition, t.u, t.v, t.range, t.orientation, t.size, t.nature].join(','))]
  const url = URL.createObjectURL(new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url; a.download = '凸透镜成像规律实验记录.csv'; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
