import { renderPrompt } from './promptCatalog.js'
import type { VideoProject, VideoSpeaker } from './videoTypes.js'

export type VideoRoleId = 'teacher' | 'student'
export const DEFAULT_VIDEO_SPEECH: NonNullable<VideoProject['speech']> = { provider: 'fish', model: 's1', chunkLength: 200, pauseSeconds: .5 }
export const VIDEO_ROLE_NAMES = { teacher: '方大招', student: '金天练' } as const
export const VIDEO_ROLE_VOICES = {
  edge: { teacher: 'zh-CN-YunyangNeural', student: 'zh-CN-YunxiNeural' },
  azure: { teacher: 'zh-CN-YunyangNeural', student: 'zh-CN-YunxiNeural' },
  fish: { teacher: '4f6e2feedf794916879cc41cb577de56', student: 'ba0fa9dc2da541e0a565533ce6949795' },
} as const
export const VIDEO_ROLE_PROMPT = renderPrompt('video/roles/base')
export const VIDEO_STORYBOARD_ROLE_PROMPT = VIDEO_ROLE_PROMPT + renderPrompt('video/roles/preserve-dialogue')

const hostAliases = new Set(['方大招', '方', '方老师', '老师', '教师', '男一', '男1', '主讲', '讲解', '讲解者', '旁白', 'teacher', 'instructor', 'narrator', 'host', 'speaker1'])
const studentAliases = new Set(['金天练', '今天练', '金', '小金', '学生', '同学', '男二', '男2', '提问', '学员', '小明', 'student', 'learner', 'speaker2'])
function roleToken(name: string): string { return name.trim().toLowerCase().replace(/[\s*_：【】\[\]()（）/\\-]/g, '') }
/** Name aliases take precedence over legacy IDs; unknown names remain reviewable. */
export function resolveVideoRole(name: string, id = ''): VideoRoleId | undefined {
  const token = roleToken(name)
  if (studentAliases.has(token)) return 'student'
  if (hostAliases.has(token)) return 'teacher'
  const identity = roleToken(id)
  if (identity === 'teacher' || identity === 'student') return identity
  return undefined
}
export function canonicalVideoSpeakers(provider: 'edge' | 'azure' | 'fish' = 'fish'): VideoSpeaker[] {
  return (['teacher', 'student'] as const).map(id => ({ id, name: VIDEO_ROLE_NAMES[id], voice: VIDEO_ROLE_VOICES[provider][id], color: id === 'teacher' ? '#0c8175' : '#b16b22' }))
}
// Keep the source-role audit aligned with videoScript's structural/prose labels.
// This server-only module cannot import the browser parser (server rootDir).
const scriptStructureLabels = new Set(['题目', '题干', '例题', '画面', '板书', '动画', '分镜', '章节', '章节标题', '标题', '总结', '总结页', '回顾页', '审核', '审核提示', '待确认', '审稿'])
const scriptProseLabels = new Set(['注意', '注意啦', '例如', '比如', '已知', '求', '解', '答', '所以', '结论', '公式', '提示', '计算', '答案', '解析', '说明', '回顾', '总结', '题目', '题干', '画面', '板书', '步骤', '首先', '然后', '接着'])
const sourceRoleAuditPrefix = '角色/IP审核：原稿角色称谓含“'
function sourceRoleNames(script: string): string[] {
  const names: string[] = []
  for (const line of script.split(/\r?\n/)) {
    const value = line.trim().replace(/^\*\*([^*]+)\*\*\s*/, '$1 ').trim()
    const bracket = value.match(/^【([^】]{1,16})】/)
    if (bracket) {
      const name = bracket[1].trim()
      if (!scriptStructureLabels.has(name)) names.push(name)
      continue
    }
    const colon = value.match(/^([^：:]{1,16})[：:]/)
    if (!colon) continue
    const name = colon[1].trim()
    if (scriptProseLabels.has(name) || /[\d=+*/^_{}ΩΩ]|[，。！？；、]/.test(name) || /^[PUIR]$/i.test(name) || !/^[\p{L}][\p{L}\s·.-]*$/u.test(name)) continue
    names.push(name)
  }
  return [...new Set(names)]
}
export interface VideoRoleReviewIssue { code: string; message: string; utteranceId?: string }
export interface KnowledgeDialogueShare { studentCharacters: number; totalCharacters: number; ratio: number; studentUtteranceIds: string[] }
function knowledgeCharacters(text: string): number {
  return (text.match(/[^。！？!?]+[。！？!?]?/g) || []).reduce((total, part) => {
    const clause = part.trim()
    if (!clause || /[？?]$/.test(clause) || /^(?:已知|题目(?:告诉|给出|已知)|所求|要求|我猜|我试试|我直接|我是不是|是不是|能不能|可不可以|那我|我不懂|好难|不会|明白了|我学会)/.test(clause)) return total
    const numericalAnswer = /\d(?:\.\d+)?\s*(?:[AVWΩ]|安(?:培)?|伏(?:特)?|瓦(?:特)?|欧(?:姆)?)(?=[，。；、\s]|$)/.test(clause)
    const content = numericalAnswer || /(?:[PIURWQt]\s*[=＝]|定律|公式|电流|电压|电阻|电功|功率|电能|热量|串联|并联|正比|反比|倒数|安培|瓦特|量纲|欧姆)/i.test(clause)
    const assertion = numericalAnswer || /[=＝]|等于|得到|代入|根据|相同|成正比|成反比|之比|取倒数|约去|约掉|消去|表示|转化|除以|乘以|平方|是|为|用|所以|因此|应当/.test(clause)
    return total + (content && assertion ? [...clause.replace(/[\s\p{P}\p{S}]/gu, '')].length : 0)
  }, 0)
}
/** A deterministic review heuristic, not a semantic proof of who teaches each idea. */
export function measureKnowledgeDialogue(project: Pick<VideoProject, 'speakers' | 'utterances' | 'shots'>): KnowledgeDialogueShare {
  const identities = new Map(project.speakers.map(s => [s.id, resolveVideoRole(s.name, s.id) || 'teacher']))
  const guesses = new Set(project.shots.flatMap(s => s.formulas.filter(f => f.role === 'misconception').map(f => f.cue.utteranceId)))
  let studentCharacters = 0, totalCharacters = 0
  const studentUtteranceIds: string[] = []
  for (const line of project.utterances) {
    if (identities.get(line.speakerId) === 'student' && guesses.has(line.id)) continue
    const count = knowledgeCharacters(line.text)
    totalCharacters += count
    if (identities.get(line.speakerId) === 'student' && count) { studentCharacters += count; studentUtteranceIds.push(line.id) }
  }
  return { studentCharacters, totalCharacters, ratio: totalCharacters ? studentCharacters / totalCharacters : 0, studentUtteranceIds }
}
export function inspectVideoProjectRoles(project: VideoProject): { issues: VideoRoleReviewIssue[]; knowledge: KnowledgeDialogueShare } {
  const issues: VideoRoleReviewIssue[] = []
  const legacyNames = sourceRoleNames(project.sourceScript).filter(name => name !== '方大招' && name !== '金天练')
  if (legacyNames.length) issues.push({ code: 'legacy-source-roles', message: '原稿角色称谓含“' + legacyNames.join('、') + '”，实际角色统一为方大招／金天练；原始文稿和台词正文保留，请审核称谓。' })
  for (const line of project.utterances) {
    if (/今天练|(?:方|金)老师|老师[，,！!？?：:]|教师[，,：:]|小金|小方|大招[，,！!？?]/.test(line.text.replace(/方大招/g, ''))) issues.push({ code: 'addressing', utteranceId: line.id, message: '台词含非规范称谓，互称应使用全名方大招／金天练；正文未改，请审核：“' + line.text.slice(0, 65) + '”' })
    if (/(?:单位|安培|瓦特|量纲)/.test(line.text) && /(?:所以|因此|证明|说明).{0,8}(?:答案|计算结果).{0,4}正确/.test(line.text)) issues.push({ code: 'unit-proof', utteranceId: line.id, message: '单位正确只能辅助核验，不能单凭量纲证明答案正确；需同时核对数值、公式条件与电路接法。' })
    if (/电功率大小等于.{0,16}(?:倒数比|电阻比)/.test(line.text)) issues.push({ code: 'power-ratio-wording', utteranceId: line.id, message: '比例措辞应为“功率之比等于电阻比／电阻的倒数比”，不是“功率大小等于比”；原台词保留供审核。' })
    if (/(?:只有|仅适用|仅在|只能).{0,14}纯电阻/.test(line.text) && /P\s*=\s*UI|P等于U(?:乘)?I/.test(line.text)) issues.push({ code: 'power-formula-condition', utteranceId: line.id, message: 'P=UI 是电功率基本公式；纯电阻限制适用于进一步替换为 I²R 或 U²/R。' })
  }
  const knowledge = measureKnowledgeDialogue(project)
  if (knowledge.ratio > .2 + 1e-10) issues.push({ code: 'student-knowledge-share', utteranceId: knowledge.studentUtteranceIds[0], message: '按讲解字符规则估算，金天练承担知识讲解约 ' + Math.round(knowledge.ratio * 100) + '%（' + knowledge.studentCharacters + '/' + knowledge.totalCharacters + '），超过20%；请人工复核并让方大招承担主要推导。提问、读题与明确猜想不计入。' })
  return { issues, knowledge }
}
export function reviewVideoProjectRoles(project: VideoProject): string[] { return inspectVideoProjectRoles(project).issues.map(issue => issue.message) }

export interface VideoRoleMigration { project: VideoProject; changed: boolean; reviewNotes: string[] }
/** Pure migration: never changes sourceScript, cleanedScript, utterance text, IDs or order. */
export function migrateVideoProjectRoles(input: VideoProject): VideoRoleMigration {
  const project = structuredClone(input), provider = project.speech?.provider || 'fish'
  if (!project.speech?.provider) project.speech = { ...DEFAULT_VIDEO_SPEECH }
  const speechChanged = JSON.stringify(project.speech) !== JSON.stringify(input.speech)
  const identities = new Map<string, VideoRoleId>(), notes: string[] = []
  for (const speaker of input.speakers) {
    const role = resolveVideoRole(speaker.name, speaker.id)
    identities.set(speaker.id, role || 'teacher')
    if (!role) notes.push('旧角色“' + speaker.name + '”无法自动判断身份，暂归方大招；台词未改，请审核角色归属。')
  }
  project.speakers = canonicalVideoSpeakers(provider)
  project.utterances = project.utterances.map(line => {
    const role = identities.get(line.speakerId) || resolveVideoRole(line.speakerId) || 'teacher'
    if (!identities.has(line.speakerId)) notes.push('台词 ' + line.id + ' 的角色引用“' + line.speakerId + '”不存在，暂归' + VIDEO_ROLE_NAMES[role] + '，请审核。')
    return { ...line, speakerId: role }
  })
  const identityChanged = JSON.stringify(project.speakers) !== JSON.stringify(input.speakers) || project.utterances.some((line, i) => line.speakerId !== input.utterances[i].speakerId)
  const issues = inspectVideoProjectRoles(project).issues
  // Regenerate this automatic audit, including projects saved by older versions
  // that mistook structural labels for speakers. Keep an unchanged note in place
  // so repeat migrations preserve ordering; other review notes stay intact.
  const sourceIssue = issues.find(issue => issue.code === 'legacy-source-roles')
  const sourceNote = sourceIssue && '角色/IP审核：' + sourceIssue.message
  for (const [index, shot] of project.shots.entries()) {
    let retained = false
    shot.reviewNotes = shot.reviewNotes.filter(note => {
      if (!note.startsWith(sourceRoleAuditPrefix)) return true
      if (!retained && index === 0 && note === sourceNote) { retained = true; return true }
      return false
    })
  }
  for (const issue of issues) {
    const shot = project.shots.find(s => issue.utteranceId ? s.utteranceIds.includes(issue.utteranceId) : true)
    if (shot) shot.reviewNotes = [...new Set([...shot.reviewNotes, '角色/IP审核：' + issue.message])]
  }
  if (notes.length && project.shots[0]) project.shots[0].reviewNotes = [...new Set([...project.shots[0].reviewNotes, ...notes.map(note => '角色/IP审核：' + note)])]
  if (identityChanged || speechChanged) project.approvedRevision = undefined
  if (identityChanged && project.problem) project.problem.reviewed = false
  const changed = identityChanged || speechChanged || JSON.stringify(project.shots.map(s => s.reviewNotes)) !== JSON.stringify(input.shots.map(s => s.reviewNotes))
  return { project, changed, reviewNotes: [...new Set([...notes, ...issues.map(issue => issue.message)])] }
}
export function normalizeVideoProjectRoles(project: VideoProject): VideoProject { return migrateVideoProjectRoles(project).project }
/** Structural errors only; source wording and heuristic style checks remain review notes. */
export function validateVideoProjectRoles(project: VideoProject): string[] {
  const errors: string[] = [], expected = canonicalVideoSpeakers(project.speech?.provider || 'fish')
  if (project.speakers.length !== 2 || expected.some(role => !project.speakers.some(s => s.id === role.id && s.name === role.name))) errors.push('工程角色必须统一为方大招（teacher）和金天练（student）。')
  for (const role of expected) if (project.speakers.find(s => s.id === role.id)?.voice !== role.voice) errors.push(role.name + '的声线应使用当前配音服务的固定IP音色。')
  if (project.utterances.some(u => u.speakerId !== 'teacher' && u.speakerId !== 'student')) errors.push('台词引用了固定IP以外的角色。')
  return errors
}
/** Apply only to newly AI-authored narration, never use it to reject a user's existing script. */
export function validateGeneratedVideoNarration(project: VideoProject): string[] {
  const errors: string[] = []
  if (sourceRoleNames(project.sourceScript).some(name => name !== '方大招' && name !== '金天练') || project.sourceScript.split(/\r?\n/).some(line => line.trim() && !/^(?:方大招|金天练)[：:]/.test(line.trim()))) errors.push('新讲稿每句只能以方大招：或金天练：开头，不使用老师、学生、Narrator等角色。')
  const used = new Set(project.utterances.map(line => line.speakerId))
  if (!used.has('teacher') || !used.has('student')) errors.push('新题目讲稿需包含方大招的讲解与金天练的简短提问。')
  for (const issue of inspectVideoProjectRoles(project).issues) if (['addressing', 'student-knowledge-share', 'unit-proof', 'power-ratio-wording', 'power-formula-condition'].includes(issue.code)) errors.push(issue.message)
  return errors
}
