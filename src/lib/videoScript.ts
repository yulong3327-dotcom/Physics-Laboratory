import type { Utterance, VideoScriptNote } from '../../server/videoTypes'
import { isVideoSummaryHeading } from './videoSummary'

/** Formatting only: the returned parser sourceScript always retains the original input. */
export function cleanVideoScriptFormatting(text: string): string {
  const character = (value: number, original: string) => value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : original
  return text.replace(/&#x([0-9a-f]+);/gi, (original, hex) => character(parseInt(hex, 16), original))
    .replace(/&#(\d+);/g, (original, decimal) => character(Number(decimal), original))
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\\([~*_])/g, '$1').replace(/\r\n?/g, '\n').trim()
}

const noteKinds: Record<string, VideoScriptNote['kind']> = {
  '题目': 'problem', '题干': 'problem', '例题': 'problem',
  '画面': 'visual', '板书': 'visual', '动画': 'visual', '分镜': 'visual',
  '章节': 'chapter', '章节标题': 'chapter', '标题': 'chapter',
  '总结': 'summary', '总结页': 'summary', '回顾页': 'summary', '小结': 'summary', '小结页': 'summary', '回顾': 'summary',
  '审核': 'review', '审核提示': 'review', '待确认': 'review', '审稿': 'review',
}
const proseLabels = new Set(['注意', '注意啦', '例如', '比如', '已知', '求', '解', '答', '所以', '结论', '公式', '提示', '计算', '答案', '解析', '说明', '回顾', '总结', '题目', '题干', '画面', '板书', '步骤', '首先', '然后', '接着'])
function roleLine(line: string): { name: string; text: string } | undefined {
  const value = line.replace(/^\*\*([^*]+)\*\*\s*/, '$1 ').trim()
  const bracket = value.match(/^【([^】]{1,16})】\s*[：:]?\s*(.*)$/)
  if (bracket && !noteKinds[bracket[1].trim()]) return { name: bracket[1].trim(), text: bracket[2].trim() }
  const colon = value.match(/^([^：:]{1,16})[：:]\s*(.*)$/)
  if (!colon) return undefined
  const name = colon[1].trim()
  if (proseLabels.has(name) || /[\d=+*/^_{}ΩΩ]|[，。！？；、]/.test(name) || /^[PUIR]$/i.test(name)) return undefined
  if (!/^[\p{L}][\p{L}\s·.-]*$/u.test(name)) return undefined
  return { name, text: colon[2].trim() }
}
function metadata(line: string): { kind: VideoScriptNote['kind']; text: string; chapter?: number; block?: boolean } | undefined {
  const explicit = line.match(/^【([^】]+)】\s*[：:]?\s*(.*)$/)
  if (explicit && noteKinds[explicit[1].trim()]) {
    const kind = noteKinds[explicit[1].trim()]
    return { kind, text: explicit[2].trim(), block: !explicit[2].trim() }
  }
  if (/^(?:总结|小结|回顾)(?:页)?$/.test(line)) return { kind: 'summary', text: line }
  const markdown = line.match(/^#{1,6}\s+(.+?)\s*#*$/)
  if (markdown) return { kind: isVideoSummaryHeading(markdown[1]) ? 'summary' : 'chapter', text: markdown[1] }
  const numbered = line.match(/^(\d+)[、.．）)]\s*(.{1,40})$/)
  if (numbered && !/[。？！!?；;]/.test(numbered[2]) && !/^(先|再|然后|接着|把|用|求|计算|代入|设|假设|记住|观察|检查)/.test(numbered[2])
    && /(电路|电功率|问题|公式|推导|定律|例题|练习|总结|小结|回顾|复盘|关系|比值|串联|并联)/.test(numbered[2])) {
    return { kind: 'chapter', text: numbered[2].trim(), chapter: Number(numbered[1]) }
  }
  return undefined
}
function symbolicResistances(text: string): string[] {
  const list = text.match(/(?:阻值|电阻值)[^。；\n]{0,20}?(?:为|是|=|：)\s*([A-Z](?:\s*[\\/、,，:：]\s*[A-Z]){1,})\b/)
  return list ? [...new Set(list[1].match(/[A-Z]/g) || [])] : []
}

/** Separate production notes from speech, retaining physical source lines and role continuity. */
export function parseVideoScript(script: string): {
  sourceScript: string; cleanedScript: string; speakers: { id: string; name: string }[];
  utterances: Utterance[]; scriptNotes: VideoScriptNote[];
} {
  const utterances: Utterance[] = [], scriptNotes: VideoScriptNote[] = []
  const speakers = new Map<string, string>()
  let currentName = '旁白', chapter = 0
  let block: VideoScriptNote | undefined
  const pending: VideoScriptNote[] = []
  const addNote = (kind: VideoScriptNote['kind'], text: string, sourceLine: number, immediate?: Utterance): VideoScriptNote => {
    const note: VideoScriptNote = { id: 'note-' + (scriptNotes.length + 1), kind, text, sourceLine }
    if (chapter) note.chapter = chapter
    if (immediate) { note.utteranceId = immediate.id; note.placement = 'after' }
    else pending.push(note)
    scriptNotes.push(note)
    return note
  }
  const warnSymbolic = (text: string, sourceLine: number, immediate?: Utterance) => {
    const values = symbolicResistances(text)
    if (values.length) {
      const note = addNote('review', '阻值 ' + values.join('、') + ' 仍为符号占位，应使用符号电路；不得根据后续比例或答案补写具体阻值，相关数值结论需审核。', sourceLine, immediate)
      note.symbolicValues = values
    }
  }
  for (const [index, raw] of script.split(/\r\n?|\n/).entries()) {
    const line = cleanVideoScriptFormatting(raw), sourceLine = index + 1
    // Standalone scene dividers are formatting, including escaped Markdown hyphens.
    // Keep the current speaker so unlabeled dialogue after the divider retains its role.
    if (!line || /^(?:\\?[-–—]\s*)+$/.test(line)) { block = undefined; continue }
    // Explicit metadata must precede bracket-role detection; explicit roles precede inferred headings.
    const explicitNote = /^【([^】]+)】/.exec(line)
    const role = explicitNote && noteKinds[explicitNote[1].trim()] ? undefined : roleLine(line)
    const structural = role ? undefined : metadata(line)
    if (structural) {
      block = undefined
      if (structural.kind === 'chapter') chapter = structural.chapter || chapter + 1
      const note = addNote(structural.kind, structural.text, sourceLine)
      if (structural.block) block = note
      warnSymbolic(structural.text, sourceLine)
      continue
    }
    if (!role && block) {
      block.text += (block.text ? '\n' : '') + line
      warnSymbolic(line, sourceLine)
      continue
    }
    const previous = utterances.at(-1)
    if (!role && /^如图所示/.test(line) && symbolicResistances(line).length && previous && /练一道|这道题|这个题|做一道|看一道|例题/.test(previous.text)) {
      addNote('problem', line, sourceLine)
      warnSymbolic(line, sourceLine)
      continue
    }
    if (role) { currentName = role.name; block = undefined }
    const content = role ? role.text : line
    const inlineReview = content.match(/【(?:审核提示|待确认|审稿)】\s*(.+)$/)
    const text = (inlineReview ? content.slice(0, inlineReview.index) : content).trim()
    if (!text) {
      if (inlineReview) addNote('review', inlineReview[1], sourceLine)
      continue
    }
    if (!speakers.has(currentName)) speakers.set(currentName, 'speaker-' + (speakers.size + 1))
    const utterance: Utterance = { id: 'u' + (utterances.length + 1), speakerId: speakers.get(currentName)!, text }
    utterances.push(utterance)
    for (const note of pending.splice(0)) { note.utteranceId = utterance.id; note.placement = 'before' }
    warnSymbolic(text, sourceLine, utterance)
    if (inlineReview) addNote('review', inlineReview[1], sourceLine, utterance)
  }
  for (const note of scriptNotes) if (!note.text) note.text = Object.keys(noteKinds).find(label => noteKinds[label] === note.kind) || note.kind
  const last = utterances.at(-1)
  if (last) for (const note of pending) { note.utteranceId = last.id; note.placement = 'after' }
  return { sourceScript: script, cleanedScript: cleanVideoScriptFormatting(script), speakers: [...speakers].map(([name, id]) => ({ id, name })), utterances, scriptNotes }
}
