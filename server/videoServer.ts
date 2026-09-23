import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { mkdir, readFile, readdir, stat, writeFile, open, unlink, rm } from 'node:fs/promises'
import { resolve, join, basename, extname } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { zipSync, strToU8 } from 'fflate'
import { normalizeVideoProjectRoles } from './videoRoles.js'
import { normalizeVideoSummaryLayouts } from './videoSummary.js'
import { mergeProjectChanges, sameProjectContent, equalProjectValue } from './videoProjectMerge.js'
import { getVideoStoryboardReadiness } from './videoStoryboardReadiness.js'
import { normalizeVideoStoryboardActions, validateVideoShotActions, validVideoAnimationDuration } from './videoActionTargets.js'
import { createScenePreviewService, videoRendererVersion } from './videoPreview.js'
import { isAllowedOrigin, type AIEnvironment } from './aiProxy.js'
import { runVideoProcess } from './videoProcess.js'
import { createVideoFileLock } from './videoFileLock.js'
import { replaceVideoFile } from './videoAtomicFile.js'
import { VIDEO_BOARD_ENTRANCES, VIDEO_HIGHLIGHT_EFFECTS, validateVideoShotPresentation } from './videoPresentation.js'
import { videoSpeechConfiguration } from './videoSpeechSettings.js'
import { createVideoSharedLoader, videoAssetResolver } from './videoShared.js'
import { canonicalVideoValue, invalidateVideoWorkflow, invalidateStoryAssets, scriptReviewContent, storyboardReviewContent } from './videoWorkflow.js'
import { createGenerationTaskService, type GenerationTaskContext } from './videoTasks.js'
import { createVideoProjectCatalog } from './videoProjectCatalog.js'
import { createVideoMixedGenerationExecutor, recoverVideoGenerationPreview } from './videoMixedGeneration.js'
import { profileAIEnvironment, requestAIProfileId } from './aiSession.js'
import type { VideoProject, Shot, RenderJob, VideoSystemStatus, AnimationCue, SpeechBoundary, GenerationTask, GenerationTaskKind, StoryboardPatch } from './videoTypes.js'

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/
const MAX_BODY = 64 * 1024 * 1024
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_TEXT = 160000
const TERMINAL = new Set(['completed', 'failed', 'cancelled'])
class HttpError extends Error { constructor(public status: number, message: string) { super(message) } }
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new HttpError(400, message) }
function isRecord(value: unknown): value is Record<string, any> { return !!value && typeof value === 'object' && !Array.isArray(value) }
function textValue(value: unknown, max = MAX_TEXT): value is string { return typeof value === 'string' && value.length <= max }
function inlineImage(value: unknown): { extension: string; bytes: Buffer } {
  assert(textValue(value, Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 64), '内嵌图片不得超过 8 MB')
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
  assert(match && match[2].length % 4 === 0, '图片须为内嵌 PNG、JPEG 或 WebP，不支持外部地址')
  const bytes = Buffer.from(match[2], 'base64')
  assert(bytes.length > 0 && bytes.length <= MAX_IMAGE_BYTES && bytes.toString('base64') === match[2], '图片 Base64 编码无效')
  const valid = match[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : match[1] === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
  assert(valid, '图片内容与声明的格式不一致')
  return { extension: match[1] === 'jpeg' ? 'jpg' : match[1], bytes }
}
function validateSvg(svg: unknown) {
  assert(textValue(svg, 24 * 1024 * 1024) && svg.includes('<svg') && !/<(?:script|foreignObject|style)\b|\bon\w+\s*=|\bsrc\s*=|<!ENTITY|<!DOCTYPE|url\s*\(|@import/i.test(svg), '元件 SVG 含有不支持的外部资源或动态内容')
  const stripped = svg.replace(/(?:xlink:)?href\s*=\s*(["'])(.*?)\1/gi, (_attribute, _quote, value: string) => { inlineImage(value); return '' })
  assert(!/\bhref\s*=/i.test(stripped), 'SVG 图片地址必须为带引号的内嵌图片')
}
function validId(id: unknown): id is string { return typeof id === 'string' && ID.test(id) }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
function ids(items: { id: string }[], description: string) {
  assert(items.every(item => isRecord(item) && validId(item.id)), `${description} ID 无效`)
  assert(new Set(items.map(item => item.id)).size === items.length, `${description} ID 重复`)
}
function validateVideoGeometry(g: unknown) {
  assert(isRecord(g), '电路几何无效')
  assert(g.viewMode === undefined || ['schematic', 'real'].includes(g.viewMode), '电路几何视图模式无效')
  assert(g.currentFlow === undefined || typeof g.currentFlow === 'boolean', '电流动画几何设置无效')
  assert(isRecord(g.bounds) && [g.bounds.x, g.bounds.y, g.bounds.width, g.bounds.height].every(finite) && g.bounds.width > 0 && g.bounds.height > 0, '电路图边界无效')
  assert(Array.isArray(g.components) && Array.isArray(g.wires) && g.components.length <= 150 && g.wires.length <= 300, '电路几何数量无效')
  ids(g.components, '元件'); ids(g.wires, '导线')
  for (const component of g.components) {
    assert([component.x, component.y, component.width, component.height].every(finite) && component.width > 0 && component.height > 0 && textValue(component.label, 160), '元件几何无效')
    validateSvg(component.svg)
    if (component.image !== undefined) {
      assert(isRecord(component.image) && [component.image.width, component.image.height, component.image.rotation].every(finite) && component.image.width > 0 && component.image.height > 0, '实物图片尺寸或旋转无效')
      inlineImage(component.image.dataUrl)
    }
    assert(isRecord(component.terminals) && Object.values(component.terminals).every(v => isRecord(v) && finite(v.x) && finite(v.y)), '元件端口无效')
  }
  for (const wire of g.wires) {
    assert(textValue(wire.path, 50000) && /^[MmLlHhVvCcSsQqTtAaZz0-9eE+.,\s-]+$/.test(wire.path) && textValue(wire.from, 200) && textValue(wire.to, 200), '导线路径无效')
    assert(wire.current === undefined || finite(wire.current), '导线电流必须为有限数值；无解或不唯一时省略')
  }
}
export function validateVideoProject(input: unknown, options: { pendingFormulaReferences?: boolean } = {}): VideoProject {
  let location: { shotId?: string; objectId?: string } = {}
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw Object.assign(new HttpError(400, message), location)
  }
  assert(isRecord(input), '视频工程必须是对象')
  const p = input as unknown as VideoProject
  assert(p.schemaVersion === 1 && validId(p.id), '不支持的工程版本或工程 ID')
  assert(Number.isInteger(p.revision) && p.revision >= 1, '工程版本必须为正整数')
  assert(textValue(p.title, 240) && p.title.trim(), '请输入视频标题')
  assert(textValue(p.sourceScript) && textValue(p.cleanedScript), '文稿过长或格式无效')
  assert(p.physicsModel === 'ideal_textbook', '视频工程必须采用教材理想模式')
  if (p.problem !== undefined) {
    assert(isRecord(p.problem) && textValue(p.problem.text, 12000) && (!!p.problem.text.trim() || !!p.problem.imageDataUrl), '题干内容无效')
    if (p.problem.imageDataUrl !== undefined) inlineImage(p.problem.imageDataUrl)
    assert(p.problem.analysis === undefined || textValue(p.problem.analysis, 12000), '题目解析无效')
    assert(p.problem.answer === undefined || textValue(p.problem.answer, 4000), '题目答案无效')
    assert(p.problem.reviewed === undefined || typeof p.problem.reviewed === 'boolean', '题目审核状态无效')
    assert(p.problem.storyboardReady === undefined || typeof p.problem.storyboardReady === 'boolean', '题目分镜状态无效')
  }

  if (p.workflow !== undefined) {
    assert(isRecord(p.workflow), '制作流程状态无效')
    assert(p.workflow.scriptDraft === undefined || textValue(p.workflow.scriptDraft), '讲稿草稿过长')
    for (const review of [p.workflow.scriptReview, p.workflow.storyboardReview]) if (review !== undefined)
      assert(isRecord(review) && /^[a-f0-9]{64}$/.test(review.fingerprint) && textValue(review.reviewedAt, 80), '内容确认记录无效')
    assert(p.workflow.storyboardSourceHash === undefined || /^[a-f0-9]{64}$/.test(p.workflow.storyboardSourceHash), '分镜讲稿版本无效')
  }

  if (p.speech) {
    assert(isRecord(p.speech) && ['azure', 'fish', 'edge'].includes(p.speech.provider), '配音服务无效')
    assert(textValue(p.speech.model, 80) && Number.isInteger(p.speech.chunkLength) && p.speech.chunkLength >= 100 && p.speech.chunkLength <= 300, '配音模型或分块长度无效')
    assert(finite(p.speech.pauseSeconds) && p.speech.pauseSeconds >= 0 && p.speech.pauseSeconds <= 5, '台词段间停顿须在 0–5 秒')
    if (p.speech.provider === 'fish') assert(['s1', 's2-pro', 's2.1-pro', 's2.1-pro-free'].includes(p.speech.model), 'Fish 模型无效')
  }
  assert(Array.isArray(p.speakers) && p.speakers.length > 0 && p.speakers.length <= 12, '角色数量无效')
  assert(Array.isArray(p.utterances) && p.utterances.length > 0 && p.utterances.length <= 600, '台词数量无效')
  assert(Array.isArray(p.shots) && p.shots.length > 0 && p.shots.length <= 200, '镜头数量无效')
  assert(Array.isArray(p.circuits) && p.circuits.length <= 200, '电路素材数量无效')
  ids(p.speakers, '角色'); ids(p.utterances, '台词'); ids(p.shots, '镜头'); ids(p.circuits, '电路')
  const speakerIds = new Set(p.speakers.map(s => s.id)), utteranceIds = new Set(p.utterances.map(u => u.id))
  const circuitIds = new Set(p.circuits.map(c => c.id))
  if (p.scriptNotes !== undefined) {
    assert(Array.isArray(p.scriptNotes) && p.scriptNotes.length <= 1200, '文稿备注数量无效')
    ids(p.scriptNotes, '文稿备注')
    for (const note of p.scriptNotes) {
      assert(['chapter', 'summary', 'problem', 'visual', 'review'].includes(note.kind) && textValue(note.text, 12000) && !!note.text.trim(), '文稿备注内容无效')
      assert(Number.isInteger(note.sourceLine) && note.sourceLine > 0 && (note.placement === undefined || ['before', 'after'].includes(note.placement)), '文稿备注位置无效')
      assert(note.utteranceId === undefined || utteranceIds.has(note.utteranceId), '文稿备注引用的台词不存在')
      assert(note.chapter === undefined || Number.isInteger(note.chapter) && note.chapter > 0, '文稿备注章节无效')
      assert(note.symbolicValues === undefined || Array.isArray(note.symbolicValues) && note.symbolicValues.length <= 100 && note.symbolicValues.every(symbol => textValue(symbol, 100) && !!symbol.trim()), '文稿备注符号无效')
    }
  }
  for (const s of p.speakers) assert(textValue(s.name, 80) && /^[A-Za-z0-9-]{1,100}$/.test(s.voice) && /^#[0-9a-f]{6}$/i.test(s.color), '角色名称、音色或颜色无效')
  if (p.pronunciations !== undefined) assert(Array.isArray(p.pronunciations) && p.pronunciations.length <= 100 && p.pronunciations.every(entry => isRecord(entry) && textValue(entry.text, 100) && !!entry.text.trim() && textValue(entry.spoken, 200) && !!entry.spoken.trim()), '发音词典无效')
  if (p.speech?.provider === 'fish') assert(p.speakers.every(s => /^[A-Fa-f0-9]{24,64}$/.test(s.voice)), 'Fish 配音须使用角色的 reference_id')
  if (p.speech?.provider === 'edge') assert(p.speakers.every(s => /^[a-z]{2}-[A-Z]{2}-[A-Za-z]+Neural$/.test(s.voice)), 'Edge 配音须使用 zh-CN-YunyangNeural 等音色，不能使用 Fish 角色 ID')
  for (const u of p.utterances) assert(speakerIds.has(u.speakerId) && textValue(u.text, 8000) && u.text.trim(), '台词内容或角色引用无效')
  assert(isRecord(p.settings) && [24, 25, 30, 60].includes(p.settings.fps), '帧率无效')
  assert(p.settings.width === 1920 && p.settings.height === 1080, '成片尺寸必须为 1920×1080')
  assert(textValue(p.settings.font, 160) && p.settings.font.trim() && /^#[0-9a-f]{6}$/i.test(p.settings.background), '字体或背景颜色无效')
  if (p.settings.backgroundImage !== undefined && p.settings.backgroundImage !== '') inlineImage(p.settings.backgroundImage)
  if (p.settings.titlePinImage !== undefined && p.settings.titlePinImage !== '') inlineImage(p.settings.titlePinImage)
  assert(p.settings.defaultCircuitView === undefined || ['schematic', 'real'].includes(p.settings.defaultCircuitView), '默认电路视图无效')
  assert(p.settings.switchPolicy === undefined || ['contextual', 'preserve', 'include'].includes(p.settings.switchPolicy), '开关策略无效')
  assert(p.settings.showFormulaCaptions === undefined || typeof p.settings.showFormulaCaptions === 'boolean', '公式说明显示设置无效')

  for (const shot of p.shots) {
    location = { shotId: shot.id }
    if (shot.story !== undefined) {
      const story = shot.story
      assert(isRecord(story) && textValue(story.description, 12000) && ['still', 'zoom-in', 'pan-left', 'pan-right', 'fade-in'].includes(story.motion), '剧情画面说明或动效无效')
      assert(story.imageApproved === undefined || typeof story.imageApproved === 'boolean', '剧情插画审核状态无效')
      assert(story.imageReviewedAt === undefined || typeof story.imageReviewedAt === 'string' && Number.isFinite(Date.parse(story.imageReviewedAt)), '剧情插画确认时间无效')
      assert(story.sceneRevision === undefined || Number.isSafeInteger(story.sceneRevision) && story.sceneRevision > 0, '剧情插画场景版本无效')
      assert(story.promptVersion === undefined || textValue(story.promptVersion, 80), '剧情提示词版本无效')
      if (story.imageDataUrl !== undefined) inlineImage(story.imageDataUrl)
      assert(!story.imageApproved || !!story.imageDataUrl, '插画缺失，不能确认')
      assert(!shot.circuitAssetId && !shot.formulas?.length && !shot.actions?.length && !shot.boardTexts?.length && !shot.highlights?.length, '剧情插画镜头不混入知识点对象，请分镜承接知识讲解')
    }
    assert(shot.locked === undefined || typeof shot.locked === 'boolean', '镜头锁定状态无效')
    assert(shot.lockedElementIds === undefined || Array.isArray(shot.lockedElementIds) && shot.lockedElementIds.length <= 300 && shot.lockedElementIds.every(id => /^[A-Za-z0-9_:.-]{1,160}$/.test(id)), '对象锁定状态无效')
    if(shot.layout!==undefined) {
      assert(isRecord(shot.layout)&&['auto','question','explain','summary'].includes(shot.layout.template)&&isRecord(shot.layout.elements),'镜头板式无效')
      assert(shot.layout.hideProblemImage===undefined || typeof shot.layout.hideProblemImage==='boolean','题图显示设置无效')
      assert(Object.keys(shot.layout.elements).length<=300,'画面元素过多')
      for(const [key,value] of Object.entries(shot.layout.elements)) assert(/^[A-Za-z0-9_:.-]{1,160}$/.test(key)&&isRecord(value)&&finite(value.x)&&finite(value.y)&&finite(value.scale)&&value.x>=0&&value.x<=1920&&value.y>=0&&value.y<=1080&&value.scale>=.2&&value.scale<=4,'画面元素坐标或缩放无效')
    }
    for(const h of shot.highlights||[]) assert(h.durationSeconds===undefined || finite(h.durationSeconds)&&h.durationSeconds>=.5&&h.durationSeconds<=15,'强调时长须在0.5–15秒')
  }
  location = {}
  for (const c of p.circuits) {
    assert(c.mode === 'numeric' || c.mode === 'symbolic', '电路模式无效')
    assert(c.viewMode === undefined || ['schematic', 'real'].includes(c.viewMode), '电路视图模式无效')
    assert(c.currentFlow === undefined || typeof c.currentFlow === 'boolean', '电流动画设置无效')
    assert(textValue(c.name, 240) && Number.isInteger(c.revision) && c.revision > 0 && isRecord(c.graph), '电路工程快照无效')
    assert(Array.isArray(c.quantities) && c.quantities.length <= 300, '教学物理量无效'); ids(c.quantities, '物理量')
    for (const q of c.quantities) {
      assert(textValue(q.symbol, 100) && textValue(q.unit, 30) && ['given', 'derived', 'symbolic'].includes(q.provenance), '物理量字段无效')
      assert(q.value === undefined || finite(q.value), '物理量数值必须有限')
      if (q.componentId !== undefined) assert(validId(q.componentId) && Array.isArray((c.graph as any).components) && (c.graph as any).components.some((component: any) => component?.id === q.componentId), '物理量引用的元件不存在')
      assert(q.expression === undefined || textValue(q.expression, 500), '物理量表达式无效')
      if (q.revealStepId !== undefined) assert(validId(q.revealStepId), '物理量首次出现步骤无效')
    }
    if (c.geometry) validateVideoGeometry(c.geometry)
  }
  assert(p.shots.every(s => Array.isArray(s.formulas) && s.formulas.every(isRecord)), '公式步骤无效')
  const allFormulas = p.shots.flatMap(s => s.formulas)
  ids(allFormulas, '公式步骤')
  const formulaIds = new Map(allFormulas.map(f => [f.id, f] as const))
  for (const c of p.circuits) for (const q of c.quantities) if (q.revealStepId && !options.pendingFormulaReferences) assert(formulaIds.has(q.revealStepId), '物理量的首次出现步骤不存在')
  const usedUtterances: string[] = []
  for (const shot of p.shots) {
    location = { shotId: shot.id }
    assert(shot.sectionTitle === undefined || (textValue(shot.sectionTitle, 240) && !!shot.sectionTitle.trim()), '知识点总标题无效')
    assert(textValue(shot.title, 200) && textValue(shot.summary, 3000) && Number.isInteger(shot.chapter) && shot.chapter > 0, '镜头标题或章节无效')
    assert(Array.isArray(shot.utteranceIds) && shot.utteranceIds.length > 0 && shot.utteranceIds.every(id => utteranceIds.has(id)), '镜头台词引用无效')
    usedUtterances.push(...shot.utteranceIds)
    assert(!shot.circuitAssetId || circuitIds.has(shot.circuitAssetId), '镜头引用了不存在的电路')
    assert(Array.isArray(shot.reviewNotes) && shot.reviewNotes.every(n => textValue(n, 2000)), '审核提示无效')
    assert(finite(shot.holdSeconds) && shot.holdSeconds >= 0 && shot.holdSeconds <= 15, '镜头停顿须在 0–15 秒')
    assert(Array.isArray(shot.formulas) && shot.formulas.length <= 100 && Array.isArray(shot.actions) && shot.actions.length <= 100, '动画步骤无效')
    ids(shot.formulas, '公式步骤'); ids(shot.actions, '电路动作')
    const checkCue = (cue: AnimationCue) => {
      assert(isRecord(cue) && shot.utteranceIds.includes(cue.utteranceId), '动画提示须引用当前镜头台词')
      assert(cue.offset === undefined || (finite(cue.offset) && cue.offset >= 0 && cue.offset <= 120), '动画偏移无效')
      assert(cue.phrase === undefined || (textValue(cue.phrase, 240) && !!cue.phrase.trim()), '动画关键词无效')
      assert(cue.occurrence === undefined || Number.isInteger(cue.occurrence) && cue.occurrence >= 1 && cue.occurrence <= 100, '同步关键词出现次数无效')
      if (cue.phrase) assert(p.utterances.find(u => u.id === cue.utteranceId)!.text.split(cue.phrase).length - 1 >= (cue.occurrence ?? 1), `动画关键词“${cue.phrase}”第${cue.occurrence ?? 1}次未在对应台词中找到`)
    }
    for (const formula of shot.formulas) {
      location = { shotId: shot.id, objectId: formula.id }
      assert(textValue(formula.latex, 3000) && formula.latex.trim(), '公式内容无效')
      assert(!/\\(?:input|include|write|openout|read|catcode|usepackage|documentclass|directlua|special|csname|newcommand|def|loop|repeat|shipout|immediate)\b/i.test(formula.latex), '公式含不允许的 TeX 命令')
      const allowedTex = new Set(['frac', 'dfrac', 'tfrac', 'sqrt', 'times', 'cdot', 'div', 'Omega', 'mathrm', 'text', 'quad', 'qquad', 'Longrightarrow', 'longrightarrow', 'Rightarrow', 'rightarrow', 'stackrel', 'overline', 'underline', 'underbrace', 'overbrace', 'left', 'right', 'le', 'ge', 'neq', 'approx', 'infty', 'sum', 'prod', 'alpha', 'beta', 'theta', 'pi', 'mu', 'delta', 'Delta', 'uparrow', 'downarrow', 'propto', 'rho', 'eta', 'varepsilon', 'epsilon', 'pm', 'mp', 'circ', 'parallel', 'perp', 'vec', 'textstyle', 'displaystyle', 'sin', 'cos', 'tan', 'omega', 'lambda', 'sigma', 'Phi', 'phi', 'tau', 'nu', 'begin', 'end'])
      assert(!formula.latex.includes('^^') && [...formula.latex.matchAll(/\\(?:\\|([A-Za-z@]+))/g)].every(match => !match[1] || allowedTex.has(match[1])), '公式含不支持的 TeX 命令，请使用基本数学公式')
      assert([...formula.latex.matchAll(/\\(?:begin|end)\s*\{([^}]*)\}/g)].every(match => ['gathered', 'aligned', 'alignedat', 'matrix', 'pmatrix', 'bmatrix', 'cases'].includes(match[1])), '公式仅支持数学排版环境')
      assert(['write', 'substitute', 'transform', 'cancel', 'reciprocal', 'ratio', 'result'].includes(formula.action), '公式动作无效')
      assert(formula.display === undefined || ['replace', 'append'].includes(formula.display), '公式保留方式无效')
      assert(validVideoAnimationDuration(formula.durationSeconds), '公式动画时长须在 0.1–3 秒')
      assert(formula.caption === undefined || textValue(formula.caption, 500), '公式说明无效')
      assert(formula.role === undefined || ['normal', 'misconception'].includes(formula.role), '公式教学角色无效')
      checkCue(formula.cue)
      if (formula.parts) {
        assert(Array.isArray(formula.parts) && formula.parts.length <= 40, '公式项无效'); ids(formula.parts, '公式项')
        assert(formula.parts.every(part => textValue(part.latex, 1000) && formula.latex.includes(part.latex)), '公式项必须出现在完整公式中')
      }
      if (formula.role === 'misconception') assert(validId(formula.correctionStepId) && formulaIds.get(formula.correctionStepId!)?.role !== 'misconception'
        && (formulaIds.has(formula.correctionStepId!) || options.pendingFormulaReferences), '教学猜想必须关联有效的纠正步骤')
    }
    location = { shotId: shot.id }
    if (shot.boardTexts !== undefined) {
      assert(Array.isArray(shot.boardTexts) && shot.boardTexts.length <= 30, '板书数量无效'); ids(shot.boardTexts, '板书')
      for (const board of shot.boardTexts) {
        assert(textValue(board.text, 4000) && ['keyword', 'law', 'problem', 'given', 'derivation'].includes(board.kind), '板书内容或类型无效')
        assert(board.entrance === undefined || (VIDEO_BOARD_ENTRANCES as readonly string[]).includes(board.entrance), '板书入场方式无效')
        assert(validVideoAnimationDuration(board.durationSeconds), '板书动画时长须在 0.1–3 秒')
        if (board.cue) checkCue(board.cue)
      }
    }
    if (shot.highlights !== undefined) {
      assert(Array.isArray(shot.highlights) && shot.highlights.length <= 100, '高亮数量无效'); ids(shot.highlights, '高亮')
      for (const highlight of shot.highlights) {
        assert(['board', 'formula'].includes(highlight.targetType) && validId(highlight.targetId), '高亮目标无效')
        const target = highlight.targetType === 'board' ? shot.boardTexts?.find(b => b.id === highlight.targetId)?.text : shot.formulas.find(f => f.id === highlight.targetId)?.latex
        assert(target !== undefined && textValue(highlight.phrase, 1000) && !!highlight.phrase.trim(), '高亮须引用当前镜头真实板书或公式')
        const occurrences = target.split(highlight.phrase).length - 1
        assert(occurrences > 0 && (highlight.occurrence === undefined || Number.isInteger(highlight.occurrence) && highlight.occurrence >= 1 && highlight.occurrence <= occurrences), '高亮词或指定出现次数不在目标内容中')
        assert(highlight.color === undefined || /^#[0-9a-f]{6}$/i.test(highlight.color), '高亮颜色无效')
        assert((VIDEO_HIGHLIGHT_EFFECTS as readonly string[]).includes(highlight.effect), '高亮效果无效'); checkCue(highlight.cue)
        if (highlight.targetType === 'formula') {
          let depth = 0
          for (const char of highlight.phrase) { if (char === '{') depth++; if (char === '}') depth--; assert(depth >= 0, '公式高亮须为完整数学项') }
          assert(depth === 0, '公式高亮须为完整数学项')
        }
      }
    }
    const presentationErrors = validateVideoShotPresentation(shot)
    assert(!presentationErrors.length, presentationErrors.join('\n'))
    const actionErrors = validateVideoShotActions(shot, p.circuits)
    assert(!actionErrors.length, actionErrors.join('\n'))
    for (const action of shot.actions) {
      location = { shotId: shot.id, objectId: action.id }
      assert(action.text === undefined || textValue(action.text, 400), '电路标注过长'); checkCue(action.cue)
      if (action.geometry !== undefined) {
        assert(action.type === 'state', '只有元件状态动作可带预计算几何')
        validateVideoGeometry(action.geometry)
        const graph = p.circuits.find(c => c.id === shot.circuitAssetId)?.graph as { components: { id: string }[]; connections: { id: string; from: string; to: string }[] }
        assert(graph && Array.isArray(graph.components) && Array.isArray(graph.connections), '元件状态需要有效电路快照')
        assert(JSON.stringify(action.geometry.components.map(c => c.id).sort()) === JSON.stringify(graph.components.map(c => c.id).sort()), '状态动作不能添加或删除元件')
        const wires = (items: { id: string; from: string; to: string }[]) => items.map(({ id, from, to }) => [id, from, to]).sort((a, b) => a[0].localeCompare(b[0]))
        assert(JSON.stringify(wires(action.geometry.wires)) === JSON.stringify(wires(graph.connections)), '状态动作不能改变导线连接拓扑')
      }
    }
  }
  location = {}
  assert(usedUtterances.length === p.utterances.length && usedUtterances.every((id, i) => p.utterances[i].id === id), '镜头须完整且按原顺序覆盖所有台词')
  return p
}

/** Compatibility is deterministic and fully revalidated before use. */
export function validateCompatibleVideoProject(input: unknown, options: { pendingFormulaReferences?: boolean } = {}): VideoProject {
  let project: VideoProject
  try { project = normalizeVideoSummaryLayouts(normalizeVideoStoryboardActions(normalizeVideoProjectRoles(input as VideoProject))) }
  catch { throw new HttpError(400, '视频工程结构无效') }
  return validateVideoProject(project, options)
}

/** Word boundary offsets are seconds from the beginning of this utterance. Never guess a missing keyword. */
export function resolveSpeechCue(cue: AnimationCue, text: string, boundaries: SpeechBoundary[], duration: number): number {
  let time = 0
  if (cue.phrase) {
    let at = -1
    for (let n = 0; n < (cue.occurrence ?? 1); n++) { at = text.indexOf(cue.phrase, at + 1); if (at < 0) break }
    if (at < 0) throw new Error(`找不到同步关键词：${cue.phrase}`)
    const match = boundaries.find(b => b.textOffset <= at && b.textOffset + b.wordLength > at)
      || boundaries.find(b => b.textOffset >= at && b.textOffset < at + cue.phrase!.length)
    if (!match) throw new Error(`配音没有返回关键词“${cue.phrase}”的时间事件，请检查发音或同步点`)
    time = match.offset
  }
  time += cue.offset || 0
  if (!Number.isFinite(time) || time < 0 || time > duration) throw new Error('动画同步点超出对应台词音频')
  return time
}
export function shotContentHash(project: VideoProject, shot: Shot, kind: RenderJob['kind'], rendererVersion = '1'): string {
  shot = normalizeVideoSummaryLayouts(project).shots.find(item => item.id === shot.id) || shot
  const utterances = shot.utteranceIds.map(id => project.utterances.find(u => u.id === id))
  const speakerIds = new Set(utterances.map(u => u?.speakerId))
  const { reviewNotes: _notes, locked: _locked, lockedElementIds: _locks, ...content } = shot
  const circuit = project.circuits.find(c => c.id === shot.circuitAssetId)
  return createHash('sha256').update(JSON.stringify({ rendererVersion, title: project.title, problem: project.problem, speech: project.speech, pronunciations: project.pronunciations, shot: content, utterances,
    speakers: project.speakers.filter(s => speakerIds.has(s.id)), circuit, settings: project.settings, quality: kind === 'final' ? '1080' : '720' })).digest('hex')
}

function respond(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data))
}
async function readBody(req: IncomingMessage) {
  if (req.headers['content-type']?.split(';')[0].toLowerCase() !== 'application/json') throw new HttpError(415, '请求必须使用 JSON')
  const chunks: Buffer[] = []; let length = 0
  for await (const chunk of req) { length += chunk.length; if (length > MAX_BODY) throw new HttpError(413, '视频工程超过 64 MB'); chunks.push(Buffer.from(chunk)) }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown } catch { throw new HttpError(400, 'JSON 格式无效') }
}
async function readJson<T>(filePath: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(filePath, 'utf8')) as T } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw e }
}
async function atomicJson(filePath: string, input: unknown) {
  await mkdir(resolve(filePath, '..'), { recursive: true }); const temporary = `${filePath}.${randomUUID()}.tmp`
  try {
    const handle = await open(temporary, 'wx')
    try { await handle.writeFile(JSON.stringify(input, null, 2), 'utf8'); await handle.sync() } finally { await handle.close() }
    await replaceVideoFile(temporary, filePath)
  } finally { await unlink(temporary).catch(() => {}) }
}
function redact(value: string, env: AIEnvironment) {
  for (const raw of [env.AZURE_SPEECH_KEY, env.AI_API_KEY, env.FISH_API_KEY, env.FISH_AUDIO_API_KEY, env.FISH_TTS_TOKEN]) {
    const key = raw?.trim()
    if (key) value = value.replaceAll(key, '[redacted]')
  }
  return value.slice(-4000)
}
async function streamVideoFile(req: IncomingMessage, res: ServerResponse, filePath: string, contentType: string) {
  const info = await stat(filePath).catch(() => undefined)
  if (!info?.isFile() || !info.size) throw new HttpError(404, '输出文件不存在')
  let start = 0, end = info.size - 1, status = 200
  if (req.headers.range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range)
    if (!match || (start = Number(match[1])) >= info.size || (end = match[2] ? Math.min(Number(match[2]), end) : end) < start) {
      res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); res.end(); return
    }
    status = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${info.size}`)
  }
  res.writeHead(status, { 'Content-Type': contentType, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600' })
  if (req.method === 'HEAD') res.end()
  else { const stream = createReadStream(filePath, { start, end }); stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res) }
}
export interface VideoBackendOptions {
  cwd?: string
  storageDirectory?: string
  probe?: () => Promise<VideoSystemStatus>
  render?: (manifest: string, signal: AbortSignal, progress: (update: Partial<RenderJob>) => void) => Promise<void>
  generate?: (context: GenerationTaskContext) => Promise<unknown>
}
interface RenderBatchRequest {
  id: string; kind: 'preview' | 'final'; projects: { projectId: string; expectedRevision: number }[];
}
interface RenderBatchJournal extends RenderBatchRequest {
  createdAt: string; status: 'submitting' | 'completed';
  items: { projectId: string; expectedRevision: number; jobId?: string; error?: string }[];
  jobClaims: Record<string, string>;
}
export function createVideoMiddleware(env: AIEnvironment, options: VideoBackendOptions = {}) {
  const cwd = options.cwd || process.cwd()
  const shared = createVideoSharedLoader(cwd)
  const resolveImage = videoAssetResolver(cwd)
  const contentHash = (value: unknown) => createHash('sha256').update(canonicalVideoValue(value)).digest('hex')
  const scriptHash = (p: VideoProject) => contentHash(scriptReviewContent(p))
  const storyboardHash = (p: VideoProject) => contentHash(storyboardReviewContent(p))
  const scriptApproved = (p: VideoProject) => !!p.workflow?.scriptReview && p.workflow.scriptReview.fingerprint === scriptHash(p) && p.workflow.scriptDraft === undefined
  const storyboardApproved = (p: VideoProject) => scriptApproved(p) && p.workflow?.storyboardReview?.fingerprint === storyboardHash(p)
  const trustedWorkflow = (next: VideoProject, previous?: VideoProject) => {
    if (previous) next = invalidateStoryAssets(previous, next)
    const workflow = { ...next.workflow, scriptReview: previous?.workflow?.scriptReview, storyboardReview: previous?.workflow?.storyboardReview,
      storyboardSourceHash: previous?.workflow?.storyboardSourceHash, lastTaskId: previous?.workflow?.lastTaskId, lastAppliedTaskId: previous?.workflow?.lastAppliedTaskId }
    if (!workflow.scriptReview || workflow.scriptReview.fingerprint !== scriptHash(next)) delete workflow.scriptReview
    if (!workflow.scriptReview || workflow.storyboardReview?.fingerprint !== storyboardHash(next)) delete workflow.storyboardReview
    return { ...next, workflow }
  }
  const data = options.storageDirectory || resolve(cwd, env.VIDEO_DATA_DIR || '.video-data')
  const renderer = resolve(cwd, 'video-renderer')
  const python = env.VIDEO_PYTHON || (existsSync(resolve(cwd, '.video-runtime/Scripts/python.exe')) ? resolve(cwd, '.video-runtime/Scripts/python.exe') : process.platform === 'win32' ? 'python' : 'python3')
  const ffmpeg = env.VIDEO_FFMPEG || (existsSync(resolve(cwd, '.video-tools/ffmpeg.exe')) ? resolve(cwd, '.video-tools/ffmpeg.exe') : 'ffmpeg')
  const childEnv = { ...process.env, ...env, VIDEO_FFMPEG: ffmpeg, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', VIDEO_PARENT_PID: String(process.pid) }
  const scenePreview = createScenePreviewService({renderer,cwd,directory:join(data,'scene-previews'),python,env:childEnv})
  const projectsDir = join(data, 'projects'), jobsDir = join(data, 'jobs'), cacheDir = join(data, 'cache'), batchesDir = join(data, 'render-batches')
  const catalog = createVideoProjectCatalog(data)
  let mediaTail = Promise.resolve()
  async function withMediaSlot<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
    const previous = mediaTail
    let release!: () => void
    const gate = new Promise<void>(done => { release = done })
    mediaTail = previous.then(() => gate)
    let abort!: () => void
    try {
      await Promise.race([previous, new Promise<never>((_, reject) => {
        abort = () => reject(Object.assign(new Error('任务已取消'), { code: 'cancelled', retryable: false }))
        if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true })
      })])
      signal.throwIfAborted()
      return await run()
    } finally { signal.removeEventListener('abort', abort); release() }
  }
  const generationTasks = createGenerationTaskService({ dataDir: data, isProjectPurged: id => catalog.get(id)?.lifecycle === 'purged',
    recoverPartialResult: (task, input, checkpoint) => recoverVideoGenerationPreview(task, input, checkpoint, { shared, resolveImage, validate: validateVideoProject }),
    executor: async context => {
    try {
      if (options.generate) return await options.generate(context)
      if (context.task.kind === 'preflight') return await withMediaSlot(context.signal, () => preflight(context))
      const generation = createVideoMixedGenerationExecutor({ cwd, env: profileAIEnvironment(context.task.credentialProfileId, env), shared, resolveImage, validate: validateVideoProject })
      return await generation(context)
    } catch (error) {
      if (error instanceof Error) error.message = redact(error.message, env)
      if (Array.isArray((error as any)?.issues)) (error as any).issues = (error as any).issues.map((issue: any) => ({ ...issue, message: redact(String(issue.message || ''), env) }))
      throw error
    }
  } })
  const jobs = new Map<string, RenderJob>(), queue: string[] = []
  let running = false, closing = false, active: { id: string; controller: AbortController } | undefined
  let mutation = Promise.resolve()
  async function exclusive<T>(run: () => Promise<T>): Promise<T> { const task = mutation.then(run, run); mutation = task.then(() => {}, () => {}); return task }
  const jobWrites = new Map<string, Promise<void>>()
  const saveJob = (job: RenderJob) => {
    const previous = jobWrites.get(job.id) || Promise.resolve()
    const write = previous.then(() => atomicJson(join(jobsDir, job.id, 'job.json'), job))
    jobWrites.set(job.id, write)
    return write
  }
  async function readRenderOutput(job: RenderJob) {
    const directory = join(jobsDir, job.id)
    const [result, report, video, subtitle] = await Promise.all([
      readJson<{ duration: number; cachedShots: number; validation?: { status: string }; keyframes?: string[] }>(join(directory, 'result.json')),
      readJson<{ status: string; projectId: string; projectRevision: number }>(join(directory, 'validation.json')).catch(() => undefined),
      stat(join(directory, 'video.mp4')).catch(() => undefined),
      stat(join(directory, 'subtitles.srt')).catch(() => undefined),
    ])
    if (!result || !finite(result.duration) || result.duration <= 0 || !video?.isFile() || !video.size || !subtitle?.isFile() || !subtitle.size)
      throw new Error('渲染未产生完整的视频、字幕和时长信息')
    if (result.validation?.status !== 'passed' || report?.status !== 'passed'
      || report.projectId !== job.projectId || report.projectRevision !== job.projectRevision)
      throw new Error('成片质量检查尚未通过，保留已完成镜头，请检查验收报告。')
    return result
  }
  function completeRenderJob(job: RenderJob, result: Awaited<ReturnType<typeof readRenderOutput>>) {
    const id = job.id
    Object.assign(job, { status: 'completed', progress: 100, stage: '视频已完成', phase: 'completed', duration: result.duration, cachedShots: result.cachedShots,
      validationReportUrl: `/api/video/jobs/${id}/files/validation.json`,
      keyframeUrls: (result.keyframes || []).map(name => `/api/video/jobs/${id}/keyframes/${encodeURIComponent(basename(name))}`),
      videoUrl: `/api/video/jobs/${id}/files/video.mp4`, subtitleUrl: `/api/video/jobs/${id}/files/subtitles.srt`, archiveUrl: `/api/video/projects/${job.projectId}/archive?jobId=${id}` })
    delete job.error; delete job.errorCode; delete job.retryable; delete job.shotId
    job.updatedAt = new Date().toISOString()
  }
  async function prepareRenderManifest(job: RenderJob) {
    const path = join(jobsDir, job.id, 'manifest.json')
    const snapshot = await readJson<Record<string, any>>(path).catch(() => undefined)
    const invalidSnapshot = () => Object.assign(new Error('制作快照损坏或与任务不一致，请使用已确认版本重新制作。'), { code: 'render_snapshot_invalid', retryable: false })
    const project = snapshot?.project as VideoProject | undefined
    if (!snapshot || !project || project.id !== job.projectId || project.revision !== job.projectRevision || snapshot.kind !== job.kind
      || !Array.isArray(snapshot.shots) || !equalProjectValue(snapshot.shots.map(item => item?.id), job.shotIds)) throw invalidSnapshot()
    try { validateVideoProject(structuredClone(project)) } catch { throw invalidSnapshot() }
    const selected = job.shotIds.map(id => project.shots.find(shot => shot.id === id))
    if (selected.some(shot => !shot)) throw invalidSnapshot()
    // Keep the submitted lesson immutable, but bind its caches and paths to the
    // renderer that will actually execute after a restart, update or relocation.
    const rendererVersion = await videoRendererVersion(renderer, cwd)
    const manifest = { ...snapshot, rendererVersion,
      shots: selected.map(shot => ({ id: shot!.id, cacheKey: shotContentHash(project, shot!, job.kind, rendererVersion) })),
      cacheDir, outputDir: join(jobsDir, job.id), rendererDir: renderer,
      width: job.kind === 'final' ? 1920 : 1280, height: job.kind === 'final' ? 1080 : 720, fps: project.settings.fps }
    if (!equalProjectValue(snapshot, manifest)) await atomicJson(path, manifest)
    return path
  }
  let workerPromise = Promise.resolve()
  function startQueue() { if (!running && !closing) workerPromise = runQueue() }
  const ownerToken = randomUUID(), lockPath = join(data, 'service.lock')
  let ready: Promise<void> | undefined
  async function ensureReady() {
    if (ready) return ready
    ready = (async () => {
      await mkdir(data, { recursive: true })
      const takeLock = () => createVideoFileLock(lockPath, { pid: process.pid, token: ownerToken })
      try { await takeLock() } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        const owner = await readJson<{ pid: number; token: string }>(lockPath)
        let alive = false
        if (owner?.pid) { try { process.kill(owner.pid, 0); alive = true } catch (e) { alive = (e as NodeJS.ErrnoException).code === 'EPERM' } }
        if (alive) throw new HttpError(503, '视频数据目录正在被另一个本机服务使用，请关闭重复服务或指定不同的 VIDEO_DATA_DIR。')
        await unlink(lockPath)
        await takeLock()
      }
    await Promise.all([mkdir(projectsDir, { recursive: true }), mkdir(jobsDir, { recursive: true }), mkdir(cacheDir, { recursive: true }), mkdir(batchesDir, { recursive: true })])
    await catalog.initialize()
    // A previous initialization may have stopped on a temporary task-owner lock.
    // Rebuild from disk once; no renderer starts before all recovery has succeeded.
    jobs.clear(); queue.length = 0
    for (const name of await readdir(jobsDir)) {
      if (!validId(name)) continue
      const job = await readJson<RenderJob>(join(jobsDir, name, 'job.json')).catch(() => undefined)
      if (!job || job.id !== name || !validId(job.projectId) || !Number.isSafeInteger(job.projectRevision) || job.projectRevision < 1
        || !['preview', 'final', 'shot'].includes(job.kind) || !['queued', 'running', 'completed', 'failed', 'cancelled'].includes(job.status)
        || typeof job.createdAt !== 'string' || !Number.isFinite(Date.parse(job.createdAt))
        || !Array.isArray(job.shotIds) || !job.shotIds.length || !job.shotIds.every(validId) || new Set(job.shotIds).size !== job.shotIds.length) continue
      if (catalog.get(job.projectId)?.lifecycle === 'purged') { await removeOwnedDirectory(jobsDir, name); continue }
      if (job.status === 'running' || job.status === 'queued') {
        // A crash may occur after validated output commits but before job.json does.
        const output = await readRenderOutput(job).catch(() => undefined)
        if (output) completeRenderJob(job, output)
        else {
          job.status = 'queued'; delete job.error; job.stage = '从已保存快照恢复制作'; job.updatedAt = new Date().toISOString(); queue.push(job.id)
        }
        await saveJob(job)
      }
      jobs.set(job.id, job)
    }
    queue.sort((a, b) => (jobs.get(a)!.createdAt || '').localeCompare(jobs.get(b)!.createdAt || '') || a.localeCompare(b))
    await generationTasks.recover()
    for (const id of catalog.purgedIds()) await removeOwnedDirectory(projectsDir, id)
    await recoverRenderBatches()
    if (queue.length) queueMicrotask(startQueue)
    })().catch(async error => {
      const owner = await readJson<{ token: string }>(lockPath).catch(() => undefined)
      if (owner?.token === ownerToken) await unlink(lockPath).catch(() => {})
      ready = undefined; throw error
    })
    return ready
  }
  function execute(args: string[], signal?: AbortSignal, onLine?: (line: string) => void): Promise<string> {
    return runVideoProcess(python, args, { cwd, env: childEnv, signal,
      timeoutMs: Number(env.VIDEO_JOB_TIMEOUT_MS) || 7_200_000, onLine }).catch(error => {
        error.message = redact(error.message, env); throw error
      })
  }
  async function probe(): Promise<VideoSystemStatus> {
    if (options.probe) return options.probe()
    const runtime = { python: false, manim: false, ffmpeg: false, latex: false }; const messages: string[] = []
    let edgeInstalled = false, azureInstalled = false
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000)
    try {
      const raw = await execute([join(renderer, 'pipeline.py'), '--probe'], controller.signal)
      const result = JSON.parse(raw.trim().split('\n').filter(Boolean).at(-1) || '{}') as { python: boolean; manim: boolean; ffmpeg: boolean; latex: boolean; speech: boolean; edge?: boolean; messages?: string[] }
      Object.assign(runtime, { python: result.python, manim: result.manim, ffmpeg: result.ffmpeg, latex: result.latex })
      edgeInstalled = result.edge === true
      azureInstalled = result.speech === true
      messages.push(...(result.messages || []))
    } catch (error) { messages.push(redact((error as Error).message, env)) } finally { clearTimeout(timeout) }
    const speech = videoSpeechConfiguration(env, { azure: azureInstalled, edge: edgeInstalled })
    return { ...speech, runtime, messages: [...messages, ...speech.messages] }
  }
  async function loadProject(id: string) {
    if (!validId(id)) throw new HttpError(400, '工程 ID 无效')
    assertProjectAvailable(id)
    const p = await readJson<VideoProject>(join(projectsDir, id, 'project.json'))
    if (!p) throw new HttpError(404, '视频工程不存在'); return normalizeVideoProjectRoles(p)
  }
  async function commitProject(value: VideoProject, previous: VideoProject): Promise<VideoProject> {
    const directory = join(projectsDir, previous.id)
    await atomicJson(join(directory, 'revisions', `${previous.revision}.json`), previous)
    const next = { ...value, id: previous.id, revision: previous.revision + 1, createdAt: previous.createdAt, updatedAt: new Date().toISOString(), approvedRevision: undefined }
    validateVideoProject(next)
    await atomicJson(join(directory, 'revisions', `${next.revision}.json`), next)
    await atomicJson(join(directory, 'project.json'), next)
    await catalog.update(next)
    return next
  }
  function assertProjectAvailable(id: string, editable = false) {
    const lifecycle = catalog.get(id)?.lifecycle
    if (lifecycle === 'purged' || lifecycle === 'trashed') throw new HttpError(410, '项目已删除，请先在回收站恢复。')
    if (editable && lifecycle === 'archived') throw new HttpError(409, '项目已归档，请先移回项目中心再编辑。')
  }
  async function enqueueRenderJob(id: string, body: Record<string, any>, requestedId?: string, onChosen?: (id: string) => Promise<void>) {
    const current = await loadProject(id).catch(error => {
      if (error instanceof SyntaxError) throw new HttpError(409, '工程快照损坏，请检查并重新保存此项目。')
      throw error
    })
    assertProjectAvailable(id, true)
    if (body.expectedRevision === undefined) throw new HttpError(428, '请刷新工作台后提交带版本的制作请求。')
    if (body.expectedRevision !== current.revision) throw new HttpError(409, '工程版本已更新，未提交其他版本的视频，请核对后重试。')
    if (!storyboardApproved(current)) throw new HttpError(409, '请先确认当前讲稿及分镜版本。')
    if (current.approvedRevision !== current.revision) throw new HttpError(409, '请先确认当前版本的分镜')
    const p = await readJson<VideoProject>(join(projectsDir, id, `approved-${current.revision}.json`)).catch(error => {
      if (error instanceof SyntaxError) throw new HttpError(409, '确认版本损坏，请重新确认此项目分镜。')
      throw error
    })
    if (!p) throw new HttpError(409, '确认版本缺失，请重新确认分镜')
    const readiness = getVideoStoryboardReadiness(p)
    if (!readiness.ready) throw new HttpError(409, readiness.issues.join('\n'))
    if (p.problem && (p.problem.reviewed !== true || p.problem.storyboardReady !== true)) throw new HttpError(409, '请先审核题干、题图与解析并生成分镜，再渲染')
    let selected = p.shots
    if (body.kind === 'shot') { assert(Array.isArray(body.shotIds) && body.shotIds.length > 0 && body.shotIds.every((sid: unknown) => validId(sid) && p.shots.some(s => s.id === sid)), '请选择有效镜头'); selected = p.shots.filter(s => body.shotIds.includes(s.id)) }
    const duplicate = [...jobs.values()].find(j => j.projectId === id && j.projectRevision === p.revision && j.kind === body.kind && !TERMINAL.has(j.status) && JSON.stringify(j.shotIds) === JSON.stringify(selected.map(s => s.id)))
    if (duplicate) { await onChosen?.(duplicate.id); return duplicate }
    const now = new Date().toISOString(), jobId = requestedId || randomUUID()
    const j: RenderJob = { id: jobId, projectId: id, projectRevision: p.revision, kind: body.kind, shotIds: selected.map(s => s.id), status: 'queued', progress: 0, stage: '等待渲染', createdAt: now, updatedAt: now, cachedShots: 0 }
    const rendererVersion = await videoRendererVersion(renderer, cwd)
    await onChosen?.(jobId)
    await atomicJson(join(jobsDir, jobId, 'project.json'), p)
    await atomicJson(join(jobsDir, jobId, 'manifest.json'), { project: p, kind: body.kind, rendererVersion, shots: selected.map(s => ({ id: s.id, cacheKey: shotContentHash(p, s, body.kind, rendererVersion) })), cacheDir, outputDir: join(jobsDir, jobId), rendererDir: renderer, width: body.kind === 'final' ? 1920 : 1280, height: body.kind === 'final' ? 1080 : 720, fps: p.settings.fps })
    await saveJob(j); jobs.set(jobId, j); queue.push(jobId); return j
  }
  function batchRequest(value: unknown): RenderBatchRequest {
    assert(isRecord(value) && validId(value.id) && ['preview', 'final'].includes(value.kind), '批次 ID 或制作类型无效')
    assert(Array.isArray(value.projects) && value.projects.length > 0 && value.projects.length <= 50, '每批请选择 1 至 50 个项目')
    assert(value.projects.every(item => isRecord(item) && validId(item.projectId) && Number.isSafeInteger(item.expectedRevision) && item.expectedRevision >= 1)
      && new Set(value.projects.map(item => item.projectId)).size === value.projects.length, '批次项目必须唯一且带有有效版本')
    return { id: value.id, kind: value.kind, projects: value.projects.map(({ projectId, expectedRevision }) => ({ projectId, expectedRevision })) }
  }
  const batchPath = (id: string) => join(batchesDir, id + '.json')
  const batchReceipt = ({ id, kind, createdAt, status, items }: RenderBatchJournal) => ({ id, kind, createdAt, status, items })
  async function readRenderBatch(id: string) {
    let journal: RenderBatchJournal | undefined
    try {
      journal = await readJson<RenderBatchJournal>(batchPath(id))
      if (!journal) return undefined
      const request = batchRequest(journal)
      assert(journal.id === id && ['submitting', 'completed'].includes(journal.status) && typeof journal.createdAt === 'string'
        && Array.isArray(journal.items) && journal.items.length === request.projects.length && isRecord(journal.jobClaims), '批次记录损坏')
      assert(journal.items.every((item, index) => isRecord(item) && item.projectId === request.projects[index].projectId
        && item.expectedRevision === request.projects[index].expectedRevision && (item.jobId === undefined || validId(item.jobId))
        && (item.error === undefined || typeof item.error === 'string') && !(item.jobId && item.error))
        && Object.values(journal.jobClaims).every(validId), '批次记录损坏')
      if (journal.status === 'completed') assert(journal.items.every(item => item.jobId || item.error), '批次记录未完成')
      return journal
    } catch { throw new HttpError(409, '批次记录损坏，无法确认提交结果，请检查制作列表后重新提交。') }
  }
  async function continueRenderBatch(journal: RenderBatchJournal) {
    if (journal.status === 'completed') return batchReceipt(journal)
    for (let index = 0; index < journal.items.length; index++) {
      const item = journal.items[index]
      if (item.jobId || item.error) continue
      const deterministicId = 'batch-' + createHash('sha256').update(journal.id + ':' + index).digest('hex').slice(0, 48)
      const claimed = jobs.get(journal.jobClaims[index] || deterministicId)
      if (claimed && claimed.projectId === item.projectId && claimed.projectRevision === item.expectedRevision && claimed.kind === journal.kind) item.jobId = claimed.id
      else {
        try {
          const job = await enqueueRenderJob(item.projectId, { kind: journal.kind, expectedRevision: item.expectedRevision }, deterministicId, async jobId => {
            // Commit deduplicated job claims too: that job may finish before a crashed batch recovers.
            journal.jobClaims[index] = jobId; await atomicJson(batchPath(journal.id), journal)
          })
          item.jobId = job.id
        } catch (error) {
          if (!(error instanceof HttpError)) throw error // Leave infrastructure failures resumable in the journal.
          item.error = redact(error.message, env)
        }
      }
      await atomicJson(batchPath(journal.id), journal)
    }
    journal.status = 'completed'; await atomicJson(batchPath(journal.id), journal)
    return batchReceipt(journal)
  }
  async function recoverRenderBatches() {
    const journals: RenderBatchJournal[] = []
    for (const name of await readdir(batchesDir)) {
      if (!name.endsWith('.json') || !validId(name.slice(0, -5))) continue
      const journal = await readRenderBatch(name.slice(0, -5)).catch(() => undefined)
      if (journal?.status === 'submitting') journals.push(journal)
    }
    journals.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    for (const journal of journals) await continueRenderBatch(journal)
  }
  async function removeOwnedDirectory(parent: string, id: string) {
    assert(validId(id), '删除目录 ID 无效')
    const target = resolve(parent, id)
    assert(target.startsWith(resolve(parent) + (process.platform === 'win32' ? '\\' : '/')), '删除目录超出项目范围')
    await rm(target, { recursive: true, force: true })
  }
  async function activeProjectTasks(id: string) {
    const generation = (await generationTasks.list(id)).filter(t => ['queued', 'running', 'waiting_retry'].includes(t.status)).length
    const renders = [...jobs.values()].filter(j => j.projectId === id && !TERMINAL.has(j.status)).length
    const stoppingRender = active && jobs.get(active.id)?.projectId === id && TERMINAL.has(jobs.get(active.id)!.status) ? 1 : 0
    return generation + renders + stoppingRender + (!generation && generationTasks.isProjectActive(id) ? 1 : 0)
  }
  async function ensureProjectIdle(id: string) {
    if (await activeProjectTasks(id)) throw new HttpError(409, '项目仍有运行或等待中的任务，请取消任务并等待结束后再操作。')
  }
  async function preflight(context: GenerationTaskContext) {
    const input = context.input as VideoProject
    const p = validateVideoProject(input)
    const teaching = (await shared()).validateTeachingProject(p)
    if (teaching.length) throw Object.assign(new Error(teaching.join('\n')), { retryable: false, code: 'teaching_invalid',
      issues: teaching.map(message => {
        const shot = p.shots.find(shot => message.startsWith(shot.title + '：') || message.startsWith(shot.id + '：'))
        const object = shot && [...shot.formulas, ...shot.actions, ...(shot.boardTexts || []), ...(shot.highlights || [])]
          .find(object => message.includes('（' + object.id + '）'))
        return { code: 'teaching_invalid', stage: 'static_preflight', message, severity: 'error', retryable: false,
          ...(shot ? { shotId: shot.id } : {}), ...(object ? { objectId: object.id } : {}) }
      }) })
    const directory = join(data, 'tasks', context.task.id, 'preflight')
    const rendererVersion = await videoRendererVersion(renderer, cwd)
    const manifest = join(directory, 'manifest.json')
    await atomicJson(manifest, { project: p, kind: 'preview', rendererVersion,
      shots: p.shots.filter(shot => !context.task.scope?.length || context.task.scope.includes(shot.id)).map(shot => ({ id: shot.id, cacheKey: shotContentHash(p, shot, 'preview', rendererVersion) })),
      cacheDir, outputDir: directory, rendererDir: renderer, width: 1280, height: 720, fps: p.settings.fps })
    await context.onCheckpoint({ manifestReady: true })
    let detail: Record<string, unknown> | undefined, progressTail = Promise.resolve()
    try { await execute([join(renderer, 'pipeline.py'), '--manifest', manifest, '--preflight'], context.signal, line => {
      try {
        const event = JSON.parse(line)
        if (event.event === 'error') detail = event
        if (event.event === 'progress') progressTail = progressTail.then(() => context.onProgress({ progress: Math.min(99, Number(event.progress) || 0), stage: String(event.stage || '配音与时间轴预检') }))
        if (event.event === 'heartbeat') progressTail = progressTail.then(() => context.onProgress({}))
        if (event.event === 'speech_retry') progressTail = progressTail.then(() => context.onProgress({ stage: `${event.provider} 配音连接暂时中断，${event.retryAfterSeconds || 0} 秒后第 ${event.attempt}/3 次尝试` }))
      } catch { /* Renderer diagnostics are retained by the process runner. */ }
    }) } catch (error) {
      if (detail) throw Object.assign(new Error(String(detail.message || (error as Error).message)), detail)
      throw error
    } finally { await progressTail }
    const report = await readJson<Record<string, any>>(join(directory, 'preflight.json'))
    if (report?.status !== 'passed') throw Object.assign(new Error('配音与时间轴预检未通过'), { code: 'preflight_failed', retryable: false, issues: report?.errors })
    return { status: report.status, projectId: p.id, projectRevision: p.revision,
      shots: report.shots?.map((shot: any) => ({ id: shot.id, duration: shot.duration })), errors: report.errors, warnings: report.warnings, metrics: report.metrics }
  }
  function checkPatchScope(base: VideoProject, next: VideoProject, patch: StoryboardPatch, scope: string[], current = base) {
    assert(patch.expectedRevision === base.revision && equalProjectValue([...patch.shotIds].sort(), [...scope].sort()), '修改建议与请求范围不一致')
    for (const key of ['sourceScript','cleanedScript','utterances','speakers','speech','settings','problem','scriptNotes','pronunciations','title'] as const)
      assert(equalProjectValue(base[key], next[key]), '局部修改不得改变旁白、音色或全课内容')
    for (const shot of base.shots.filter(shot => !scope.includes(shot.id)))
      assert(equalProjectValue(shot, next.shots.find(item => item.id === shot.id)), `修改超出选定范围：${shot.id}`)
    const allowedUtterances = new Set(base.shots.filter(shot => scope.includes(shot.id)).flatMap(shot => shot.utteranceIds))
    for (const shot of next.shots.filter(shot => !base.shots.some(previous => !scope.includes(previous.id) && previous.id === shot.id)))
      assert(shot.utteranceIds.every(id => allowedUtterances.has(id)), '拆分镜头不得移动范围外的台词')
    for (const shot of current.shots) {
      const replacement = next.shots.find(item => item.id === shot.id)
      const original = base.shots.find(item => item.id === shot.id)
      if (!original || !scope.includes(shot.id)) continue
      if (shot.locked) assert(equalProjectValue(original, replacement), `镜头已锁定：${shot.id}`)
      for (const lock of shot.lockedElementIds || []) {
        const [kind, id] = lock.split(':')
        if (kind === 'circuit') assert(replacement?.circuitAssetId === original.circuitAssetId && equalProjectValue(replacement?.actions, original.actions), `电路对象已锁定：${shot.id}`)
        else {
          const field = kind === 'board' ? 'boardTexts' : kind === 'formula' ? 'formulas' : kind === 'highlight' ? 'highlights' : undefined
          assert(field, '对象锁定类型无效')
          assert(equalProjectValue(original[field]?.find(item => item.id === id), replacement?.[field]?.find(item => item.id === id)), `对象已锁定：${shot.id}/${lock}`)
          assert(equalProjectValue(original.layout?.elements[lock], replacement?.layout?.elements[lock]), `对象布局已锁定：${shot.id}/${lock}`)
        }
      }
    }
    for (const circuit of base.circuits) assert(equalProjectValue(circuit, next.circuits.find(item => item.id === circuit.id)), '局部修改共享电路必须复制为专用素材')
  }
  async function runQueue() {
    if (running) return; running = true
    try {
      while (queue.length && !closing) {
        const id = queue.shift()!, job = jobs.get(id)!
        if (job.status === 'cancelled') continue
        const controller = new AbortController(); active = { id, controller }
        job.status = 'running'; job.stage = '检查渲染环境'; job.updatedAt = new Date().toISOString(); await saveJob(job)
        let pendingProgress = Promise.resolve()
        const progress = (patch: Partial<RenderJob>) => {
          if (controller.signal.aborted) return
          Object.assign(job, patch, { updatedAt: new Date().toISOString() })
          pendingProgress = pendingProgress.then(() => saveJob(job)).catch(() => {})
        }
        try {
          await withMediaSlot(controller.signal, async () => {
          const manifest = await prepareRenderManifest(job)
          if (options.render) await options.render(manifest, controller.signal, progress)
          else {
            const status = await probe()
            const request = await readJson<{ project: VideoProject }>(manifest)
            if (request) {
              const issues = (await shared()).validateTeachingProject(request.project)
              if (issues.length) throw Object.assign(new Error(issues.join('\n')), { code: 'teaching_invalid', retryable: false })
            }
            const provider = request?.project.speech?.provider || 'fish'
            const availability = status.speechProviders?.[provider] || { configured: provider === 'azure' ? status.azureConfigured : provider === 'fish' ? !!status.fishConfigured : false,
              missingConfiguration: provider === 'azure' ? ['AZURE_SPEECH_KEY', 'AZURE_SPEECH_REGION'] : provider === 'fish' ? ['FISH_TTS_BASE_URL 或 FISH_API_KEY'] : ['edge-tts'] }
            if (!availability.configured) throw new Error(`请配置 ${provider} 配音：${availability.missingConfiguration.join('、')}`)
            const absent = Object.entries(status.runtime).filter(([, available]) => !available).map(([name]) => name)
            if (absent.length) throw new Error(`缺少渲染组件：${absent.join('、')}。${status.messages.join(' ')}`)
            let pipelineError: Record<string, unknown> | undefined
            try { await execute([join(renderer, 'pipeline.py'), '--manifest', manifest], controller.signal, line => {
              try {
                const update = JSON.parse(line) as Record<string, unknown>
                if (update.event === 'progress') progress({ progress: Number(update.progress) || 0, stage: String(update.stage || ''), cachedShots: Number(update.cachedShots) || 0,
                  phase: typeof update.phase === 'string' ? update.phase : undefined, shotId: typeof update.shotId === 'string' ? update.shotId : undefined })
                if (update.event === 'error') pipelineError = update
                if (update.event === 'heartbeat') progress({})
                if (update.event === 'speech_retry') progress({ stage: `${update.provider} 配音重试 ${update.attempt}/3，等待 ${update.retryAfterSeconds || 0} 秒` })
              } catch { /* Manim log lines are not events. */ }
            }) } catch (error) {
              if (pipelineError) throw Object.assign(new Error(String(pipelineError.message || (error as Error).message)), pipelineError)
              throw error
            }
          }
          })
          if (controller.signal.aborted) throw new Error('任务已取消')
          const result = await readRenderOutput(job)
          completeRenderJob(job, result)
        } catch (error) {
          job.status = closing ? 'queued' : controller.signal.aborted ? 'cancelled' : 'failed'; job.stage = closing ? '等待服务恢复后继续' : controller.signal.aborted ? '已取消' : '渲染失败'; job.error = closing ? undefined : redact((error as Error).message, env)
          const detail = error as { retryable?: boolean; code?: string; errorCode?: string; shotId?: string }
          job.retryable = detail.retryable === true; job.errorCode = detail.code || detail.errorCode; job.shotId = detail.shotId || job.shotId
          if (existsSync(join(jobsDir, id, 'validation.json'))) job.validationReportUrl = `/api/video/jobs/${id}/files/validation.json`
        } finally {
          await pendingProgress; job.updatedAt = new Date().toISOString(); await saveJob(job); active = undefined
        }
      }
    } finally { running = false }
  }
  async function archive(project: VideoProject, requestedJob?: string | null) {
    let selectedJob: RenderJob | undefined
    if (requestedJob) { selectedJob = jobs.get(requestedJob); if (!selectedJob || selectedJob.projectId !== project.id) throw new HttpError(404, '工程渲染任务不存在') }
    else selectedJob = [...jobs.values()].filter(j => j.projectId === project.id && j.projectRevision === project.revision && j.status === 'completed').at(-1)
    const entries: Record<string, Uint8Array> = {}
    if (selectedJob) project = (await readJson<VideoProject>(join(jobsDir, selectedJob.id, 'project.json'))) || project
    entries['project.json'] = strToU8(JSON.stringify(project, null, 2))
    entries['source-script.txt'] = strToU8(project.sourceScript)
    entries['storyboard.json'] = strToU8(JSON.stringify(project.shots, null, 2))
    if (project.problem) entries['problem.json'] = strToU8(JSON.stringify(project.problem, null, 2))
    for (const [name, dataUrl] of [['title-pin', project.settings.titlePinImage], ['problem-image', project.problem?.imageDataUrl]]) {
      if (dataUrl) { const image = inlineImage(dataUrl); entries['assets/' + name + '.' + image.extension] = image.bytes }
    }

    if (project.settings.backgroundImage) {
      const image = inlineImage(project.settings.backgroundImage)
      entries['assets/page-background.' + image.extension] = image.bytes
    }
    entries['README.txt'] = strToU8('教学视频工程包\n安装 Python 3.11+、LaTeX、dvisvgm、FFmpeg，然后 pip install -r video-renderer/requirements.txt。\n配音按 project.json 的 speech.provider 选择：edge 使用免费 Edge 音色且无需密钥；fish 配置 FISH_TTS_BASE_URL（可选 FISH_TTS_TOKEN）或 FISH_API_KEY；azure 配置 AZURE_SPEECH_KEY、AZURE_SPEECH_REGION。VIDEO_FFMPEG 可指定 FFmpeg。\n重新制作：python video-renderer/pipeline.py --project project.json --output output\n已生成的音频、时间轴和镜头缓存（若有）包含在 cache/ 与 render/ 中。音频不需要再次付费合成。\n工程保留原稿，字幕来自原台词；凭据不会写入此工程包。\n')
    for (const name of (await readdir(renderer)).filter(name => (name.endsWith('.py') && !name.startsWith('test_')) || name === 'requirements.txt')) entries[`video-renderer/${name}`] = await readFile(join(renderer, name))
    for (const folder of ['fonts','templates']) for (const name of await readdir(join(cwd,'public/video',folder)).catch(()=>[])) {
      const source=join(cwd,'public/video',folder,name)
      if((await stat(source)).isFile()) entries['assets/'+folder+'/'+name]=await readFile(source)
    }
    for (const circuit of project.circuits) {
      entries[`circuits/${circuit.id}.json`] = strToU8(JSON.stringify(circuit, null, 2))
      for (const component of circuit.geometry?.components || []) {
        entries['circuits/' + circuit.id + '/' + component.id + '.svg'] = strToU8(component.svg)
        if (component.image) {
          const image = inlineImage(component.image.dataUrl)
          entries['circuits/' + circuit.id + '/' + component.id + '.' + image.extension] = image.bytes
        }
      }
    }
    async function collect(directory: string, prefix: string) {
      for (const item of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
        if (item.isSymbolicLink() || item.name.startsWith('.')) continue
        if (item.isDirectory()) { if (item.name !== 'media' && item.name !== '__pycache__') await collect(join(directory, item.name), `${prefix}/${item.name}`) }
        else if (item.isFile() && !item.name.endsWith('.tmp') && item.name !== 'manifest.json') entries[`${prefix}/${item.name}`] = await readFile(join(directory, item.name))
      }
    }
    if (selectedJob) {
      await collect(join(jobsDir, selectedJob.id), 'render')
      const manifest = await readJson<{ shots: { id: string; cacheKey: string }[]; width: number; height: number; fps: number; kind: string; rendererVersion: string }>(join(jobsDir, selectedJob.id, 'manifest.json'))
      if (manifest) entries['render/recipe.json'] = strToU8(JSON.stringify({ shots: manifest.shots, width: manifest.width, height: manifest.height, fps: manifest.fps, kind: manifest.kind, rendererVersion: manifest.rendererVersion }, null, 2))
      for (const shot of manifest?.shots || []) if (/^[a-f0-9]{64}$/.test(shot.cacheKey)) {
        await collect(join(cacheDir, 'shots', shot.cacheKey), `cache/shots/${shot.cacheKey}`)
        const timeline = await readJson<{ utterances: { cacheKey?: string }[] }>(join(cacheDir, 'shots', shot.cacheKey, 'timeline.json'))
        for (const utterance of timeline?.utterances || []) if (utterance.cacheKey && /^[a-f0-9]{64}$/.test(utterance.cacheKey)) await collect(join(cacheDir, 'speech', utterance.cacheKey), `cache/speech/${utterance.cacheKey}`)
      }
    }
    return zipSync(entries, { level: 3 })
  }
  const middleware = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const rawPath = (req.url || '').split('?')[0]
    if (!rawPath.startsWith('/api/video/')) { next(); return }
    if (!isAllowedOrigin(req, env.PUBLIC_ORIGIN)) { respond(res, 403, { error: '不允许跨站请求' }); return }
    try {
      await ensureReady()
      let pathname: string
      try { pathname = decodeURIComponent(rawPath) } catch { throw new HttpError(400, '路径编码无效') }
      if (pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').some(s => s.startsWith('.'))) throw new HttpError(400, '路径无效')
      const parts = pathname.slice('/api/video/'.length).split('/'), method = req.method
      const query = new URL(req.url || '/', 'http://localhost').searchParams
      if(parts.length===1 && parts[0]==='scene-preview' && method==='POST') {
        const body=await readBody(req);assert(isRecord(body)&&validId(body.shotId),'请选择镜头')
        const project=validateCompatibleVideoProject(body.project, { pendingFormulaReferences: true })
        assert(body.stage===undefined || textValue(body.stage,240),'预览阶段无效')
        const controller=new AbortController();res.once('close',()=>controller.abort())
        const shot = project.shots.find(item => item.id === body.shotId)
        const asset = project.circuits.find(item => item.id === shot?.circuitAssetId)
        if (shot?.actions.some(action => action.type === 'state') && asset) await (await shared()).prepareCircuitStateGeometry(project, shot, asset, { signal: controller.signal, resolveImage })
        const preview=await scenePreview(project,body.shotId,body.stage,undefined,controller.signal)
        respond(res,200,preview);return
      }
      if (parts[0] === 'status' && parts.length === 1 && method === 'GET') { respond(res, 200, await probe()); return }
      if (parts[0] === 'render-batches') {
        if (parts.length === 1 && method === 'POST') {
          const request = batchRequest(await readBody(req))
          const receipt = await exclusive(async () => {
            let journal = await readRenderBatch(request.id)
            if (journal && !equalProjectValue(batchRequest(journal), request)) throw new HttpError(409, '批次 ID 已用于另一份制作请求，请使用新的批次 ID。')
            if (!journal) {
              journal = { ...request, createdAt: new Date().toISOString(), status: 'submitting', items: request.projects.map(item => ({ ...item })), jobClaims: {} }
              await atomicJson(batchPath(request.id), journal)
            }
            return continueRenderBatch(journal)
          }).finally(startQueue)
          respond(res, 202, receipt); return
        }
        if (parts.length === 2 && method === 'GET') {
          assert(validId(parts[1]), '批次 ID 无效')
          const receipt = await exclusive(async () => {
            const journal = await readRenderBatch(parts[1])
            if (!journal) throw new HttpError(404, '制作批次不存在')
            return continueRenderBatch(journal)
          }).finally(startQueue)
          respond(res, 200, receipt); return
        }
      }
      if (parts[0] === 'tasks') {
        const inspectable = async (task: GenerationTask) => {
          if (!task.resultAvailable && task.status === 'failed') {
            const checkpoint = await readJson<{ failedCandidate?: unknown }>(join(data, 'tasks', task.id, 'checkpoint.json')).catch(() => undefined)
            if (checkpoint?.failedCandidate) return { ...task, resultAvailable: true }
          }
          return task
        }
        if (parts.length === 1 && method === 'GET') { respond(res, 200, await Promise.all((await generationTasks.list(query.get('projectId') || undefined)).map(inspectable))); return }
        if (!validId(parts[1])) throw new HttpError(400, '任务 ID 无效')
        const task = await generationTasks.read(parts[1])
        if (parts.length === 2 && method === 'GET') { respond(res, 200, await inspectable(task)); return }
        if (parts.length === 3 && parts[2] === 'partial-result' && method === 'GET') {
          assertProjectAvailable(task.projectId)
          respond(res, 200, await generationTasks.partialResult(task.id)); return
        }
        if (parts.length === 3 && parts[2] === 'result' && method === 'GET') {
          if (!task.resultAvailable && task.status === 'failed') {
            const checkpoint = await readJson<{ failedCandidate?: unknown }>(join(data, 'tasks', task.id, 'checkpoint.json'))
              .catch(() => { throw new HttpError(409, '失败候选结果的断点文件损坏，无法读取；请重新生成此任务。') })
            if (checkpoint?.failedCandidate) { respond(res, 200, { project: checkpoint.failedCandidate, readOnly: true }); return }
          }
          respond(res, 200, await generationTasks.result(task.id)); return
        }
        if (parts.length === 3 && ['resume', 'cancel'].includes(parts[2]) && method === 'POST') {
          const result = await exclusive(async () => {
            if (parts[2] === 'resume') assertProjectAvailable(task.projectId, true)
            return parts[2] === 'resume' ? generationTasks.resume(task.id, requestAIProfileId()) : generationTasks.cancel(task.id)
          })
          respond(res, 200, result); return
        }
        if (parts[2] === 'timeline' && [4,5].includes(parts.length) && (method === 'GET' || method === 'HEAD')) {
          if (task.kind !== 'preflight' || task.status !== 'completed' || !validId(parts[3])) throw new HttpError(409, '请先完成全镜头配音与时间轴预检。')
          const manifest = await readJson<{ project: VideoProject; shots: { id: string; cacheKey: string }[] }>(join(data, 'tasks', task.id, 'preflight', 'manifest.json'))
          const selected = manifest?.shots.find(shot => shot.id === parts[3])
          if (!manifest || !selected || !/^[a-f0-9]{64}$/.test(selected.cacheKey)) throw new HttpError(404, '此任务没有对应镜头时间轴')
          const directory = join(cacheDir, 'shots', selected.cacheKey)
          const timeline = await readJson<Record<string, any>>(join(directory, 'timeline.json'))
          if (!timeline || !finite(timeline.duration) || !Array.isArray(timeline.events) || timeline.shot?.id !== selected.id) throw new HttpError(409, '时间轴缓存已失效，请重新准备配音与时间轴。')
          if (parts.length === 4) {
            respond(res, 200, { taskId: task.id, projectId: task.projectId, projectRevision: task.expectedRevision, shotId: selected.id,
              duration: timeline.duration, events: timeline.events,
              utterances: timeline.utterances.map((utterance: any) => ({ id: utterance.id, start: utterance.start, duration: utterance.duration })),
              audioUrl: `/api/video/tasks/${task.id}/timeline/${selected.id}/audio` }); return
          }
          if (parts[4] === 'audio') { await streamVideoFile(req, res, join(directory, 'narration.wav'), 'audio/wav'); return }
          if (parts[4] === 'frame') {
            const time = Number(query.get('time'))
            assert(query.has('time') && finite(time) && time >= 0 && time <= timeline.duration, '时间轴位置无效')
            const current = await loadProject(task.projectId)
            assertProjectAvailable(task.projectId, true)
            if (current.revision !== task.expectedRevision) throw new HttpError(409, '工程已有新版本，请重新准备时间轴。')
            const controller = new AbortController(); res.once('close', () => controller.abort())
            respond(res, 200, await scenePreview(manifest.project, selected.id, undefined, { timeline, time }, controller.signal)); return
          }
        }
        if (parts.length === 3 && parts[2] === 'apply' && method === 'POST') {
          const body = await readBody(req)
          assert(isRecord(body) && Number.isInteger(body.expectedRevision) && (body.acceptConflicts === undefined || typeof body.acceptConflicts === 'boolean'), '采用结果需要当前版本')
          const result = await exclusive(async () => {
            // A request may have waited behind another adoption. Reload its
            // receipt inside the same mutation queue before considering edits.
            const latestTask = await generationTasks.read(task.id)
            const current = await loadProject(task.projectId)
            assertProjectAvailable(task.projectId, true)
            let appliedRevision = latestTask.appliedRevision
            if (!appliedRevision) {
              // project.json and the task receipt are separate atomic files.
              // A committed revision proves adoption if the process died
              // between those writes, even after a later task was adopted.
              const directory = join(projectsDir, task.projectId, 'revisions')
              const revisions = (await readdir(directory).catch(() => []))
                .filter(name => /^\d+\.json$/.test(name)).map(name => Number(name.slice(0, -5)))
                .filter(revision => revision > task.expectedRevision && revision <= current.revision).sort((a, b) => a - b)
              for (const revision of revisions) {
                const snapshot = await readJson<VideoProject>(join(directory, `${revision}.json`))
                if (snapshot?.workflow?.lastAppliedTaskId === task.id) { appliedRevision = revision; break }
              }
              if (!appliedRevision && current.workflow?.lastAppliedTaskId === task.id) appliedRevision = current.revision
            }
            if (appliedRevision) {
              if (!latestTask.appliedRevision) await generationTasks.markApplied(task.id, appliedRevision)
              return current
            }
            if (current.revision !== body.expectedRevision) throw new HttpError(409, '工程版本已更新，请重新查看差异后采用。')
            if (latestTask.status !== 'completed' || task.kind === 'preflight') throw new HttpError(409, '此任务没有可采用的内容结果。')
            const baseline = validateVideoProject(await generationTasks.input(task.id))
            const output = await generationTasks.result(task.id) as { project: VideoProject; patch?: StoryboardPatch }
            let candidate = validateVideoProject(output.project)
            assert(candidate.id === baseline.id && baseline.revision === task.expectedRevision, '任务输出工程或基准版本不一致')
            if (task.kind !== 'problem_script') assert(scriptHash(candidate) === scriptHash(baseline) && equalProjectValue(candidate.speakers, baseline.speakers) && equalProjectValue(candidate.speech, baseline.speech), '分镜建议不得改变已确认讲稿或选定音色')
            if (task.kind === 'storyboard_patch') {
              assert(output.patch && task.scope?.length, '局部修改建议缺少范围信息')
              checkPatchScope(baseline, candidate, output.patch, task.scope, current)
            }
            // Keep review records server-owned. The result always carries its own
            // source fingerprint, including when independent newer edits merge.
            candidate = { ...candidate, workflow: { ...baseline.workflow,
              scriptDraft: task.kind === 'problem_script' ? undefined : baseline.workflow?.scriptDraft,
              storyboardSourceHash: task.kind === 'problem_script' ? undefined : scriptHash(baseline),
              storyboardReview: undefined } }
            if (task.kind === 'problem_script') delete candidate.workflow!.scriptReview
            const merged = mergeProjectChanges(baseline, candidate, current)
            if (merged.conflicts.length && body.acceptConflicts !== true) throw new HttpError(409, `修改与当前版本冲突，请查看差异后选择：${merged.conflicts.join('、')}`)
            let next = invalidateVideoWorkflow(current, merged.project)
            // A storyboard-only result must preserve the reviewed narration.
            if (task.kind !== 'problem_script' && scriptHash(next) === scriptHash(current)) next.workflow!.scriptReview = current.workflow?.scriptReview
            next.workflow = { ...next.workflow, storyboardReview: undefined, lastAppliedTaskId: task.id, lastTaskId: task.id }
            next = validateVideoProject(next)
            const applied = await commitProject(next, current)
            await generationTasks.markApplied(task.id, applied.revision)
            return applied
          })
          respond(res, 200, result); return
        }
      }
      if (parts[0] === 'projects') {
        if (parts.length === 1 && method === 'GET') {
          if (query.get('view') === 'summary') {
            const lifecycle = query.get('lifecycle') || 'active', search = (query.get('q') || '').trim().toLocaleLowerCase()
            assert(['active', 'archived', 'trashed', 'all'].includes(lifecycle), '项目筛选无效')
            const list = await Promise.all(catalog.list().filter(p => (lifecycle === 'all' || p.lifecycle === lifecycle) && (!search || p.title.toLocaleLowerCase().includes(search))).map(async p => {
              const latest = [...jobs.values()].filter(j => j.projectId === p.id && j.projectRevision === p.revision).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
              return { ...p, activeTaskCount: await activeProjectTasks(p.id), latestJobStatus: latest?.status }
            }))
            list.sort(query.get('sort') === 'title' ? (a, b) => a.title.localeCompare(b.title, 'zh-CN') : (a, b) => b.updatedAt.localeCompare(a.updatedAt))
            respond(res, 200, list); return
          }
          const list = await Promise.all((await readdir(projectsDir)).filter(validId).map(async name => {
            // A damaged or partially restored project must not prevent every other
            // project from opening. Keep its files in place for manual recovery.
            try {
              if (catalog.get(name)?.lifecycle !== 'active') return undefined
              const project = await readJson<VideoProject>(join(projectsDir, name, 'project.json'))
              return project ? normalizeVideoProjectRoles(project) : undefined
            } catch { return undefined }
          }))
          respond(res, 200, list.filter(Boolean)); return
        }
        if ((parts.length === 1 && method === 'POST') || (parts.length === 2 && method === 'PUT')) {
          const body = await readBody(req)
          const managed = isRecord(body) && body.saveMode === 'merge'
          const input = validateCompatibleVideoProject(managed ? body.project : body)
          const suppliedBase = managed && body.baseProject ? validateCompatibleVideoProject(body.baseProject) : undefined
          if (suppliedBase) assert(suppliedBase.id === input.id && suppliedBase.revision === input.revision, '保存基准与当前工程不一致')
          if (parts.length === 2) assert(parts[1] === input.id, '路径和工程 ID 不一致')
          const saved = await exclusive(async () => {
            assertProjectAvailable(input.id, true)
            const directory = join(projectsDir, input.id)
            const existing = await readJson<VideoProject>(join(directory, 'project.json'))
            if (!managed && existing && existing.revision !== input.revision) throw new HttpError(409, '工程已有新版本，请重新打开后再保存；当前修改仍在草稿中')
            const now = new Date().toISOString()
            const history = async (project: VideoProject) => {
              const path = join(projectsDir, project.id, 'revisions', `${project.revision}.json`)
              if (!await readJson(path)) await atomicJson(path, project)
            }
            const writeProject = async (project: VideoProject) => {
              // The revision snapshot is the recovery receipt. Always replace
              // the same-number snapshot so an interrupted prior commit cannot
              // masquerade as a later adopted result.
              await atomicJson(join(projectsDir, project.id, 'revisions', `${project.revision}.json`), project)
              await atomicJson(join(projectsDir, project.id, 'project.json'), project)
              await catalog.update(project)
            }
            const recoveryProject = async (source: VideoProject) => {
              const copy: VideoProject = { ...structuredClone(source), id: `video-recovery-${randomUUID()}`, title: `${source.title.slice(0, 218)}（恢复副本）`, revision: 1, createdAt: now, updatedAt: now }
              delete copy.approvedRevision
              await writeProject(copy)
              await catalog.update(copy, { sourceProjectId: source.id, recovery: true })
              return copy
            }
            if (existing) await history(existing)
            const meta: { notice?: string; merged?: boolean; forkedFrom?: string; recoveryProjectId?: string; conflicts?: string[] } = {}
            let candidate = input
            if (managed && existing && input.revision !== existing.revision) {
              const baseline = await readJson<VideoProject>(join(directory, 'revisions', `${input.revision}.json`))
                || await readJson<VideoProject>(join(directory, `approved-${input.revision}.json`)) || suppliedBase
              if (sameProjectContent(input, existing)) return { project: existing, save: meta }
              if (baseline) {
                const merged = mergeProjectChanges(normalizeVideoStoryboardActions(normalizeVideoProjectRoles(baseline)), input, normalizeVideoStoryboardActions(normalizeVideoProjectRoles(existing)))
                try { candidate = validateCompatibleVideoProject(merged.project) }
                catch { merged.conflicts.push('/references'); candidate = input }
                if (merged.conflicts.includes('/references')) {
                  const copy = await recoveryProject(input)
                  await atomicJson(join(directory, 'recoveries', `${copy.id}.json`), { savedAt: now, base: baseline, local: input, remote: existing, conflicts: merged.conflicts, recoveryProjectId: copy.id })
                  return { project: copy, save: { notice: '已保存为恢复副本，原项目保留在项目列表。', forkedFrom: input.id, recoveryProjectId: copy.id } }
                }
                meta.merged = true
                if (merged.conflicts.length) {
                  const copy = await recoveryProject(existing)
                  await atomicJson(join(directory, 'recoveries', `${copy.id}.json`), { savedAt: now, base: baseline, local: input, remote: existing, conflicts: merged.conflicts, recoveryProjectId: copy.id })
                  Object.assign(meta, { notice: '已保存当前修改，另一页面的版本保留为恢复副本，可在项目列表打开。', recoveryProjectId: copy.id, conflicts: merged.conflicts })
                } else meta.notice = '已保存，并合并了其他页面的修改。'
              } else {
                const copy = await recoveryProject(input)
                await atomicJson(join(directory, 'recoveries', `${copy.id}.json`), { savedAt: now, local: input, remote: existing, recoveryProjectId: copy.id })
                return { project: copy, save: { notice: '已保存为恢复副本，原项目保留在项目列表。', forkedFrom: input.id, recoveryProjectId: copy.id } }
              }
            }
            if (managed && existing && sameProjectContent(candidate, existing)) return { project: existing, save: meta }
            const project = { ...trustedWorkflow(candidate, existing), revision: existing ? existing.revision + 1 : 1, createdAt: existing?.createdAt || now, updatedAt: now }
            delete project.approvedRevision
            await writeProject(project)
            return managed ? { project, save: meta } : project
          })
          respond(res, 200, saved); return
        }
        const id = parts[1]
        if (!validId(id)) throw new HttpError(400, '工程 ID 无效')
        if ((parts.length === 2 && ['PATCH', 'DELETE'].includes(method || '')) || (parts.length === 3 && method === 'POST' && ['duplicate', 'trash', 'restore'].includes(parts[2]))) {
          const body = await readBody(req)
          const result = await exclusive(async () => {
            const meta = catalog.get(id)
            if (!meta) throw new HttpError(404, '项目不存在')
            if (meta.lifecycle === 'purged' && method !== 'DELETE') throw new HttpError(410, '项目已永久删除')
            const p = meta.lifecycle === 'purged' ? undefined : await readJson<VideoProject>(join(projectsDir, id, 'project.json'))
            if (method === 'DELETE') {
              if (!['trashed', 'purged'].includes(meta.lifecycle)) throw new HttpError(409, '请先把项目移入回收站')
              assert(isRecord(body) && body.confirmId === id, '永久删除需要确认项目 ID')
              await ensureProjectIdle(id)
              await catalog.purge(id)
              await generationTasks.purgeProject(id)
              for (const job of [...jobs.values()].filter(j => j.projectId === id)) {
                await jobWrites.get(job.id)
                await removeOwnedDirectory(jobsDir, job.id); jobs.delete(job.id); jobWrites.delete(job.id)
              }
              await removeOwnedDirectory(projectsDir, id)
              return { deleted: true, id }
            }
            if (!p) throw new HttpError(404, '项目文件不存在')
            if (parts[2] === 'duplicate') {
              if (meta.lifecycle === 'trashed') throw new HttpError(409, '请先恢复项目')
              const now = new Date().toISOString()
              const copy: VideoProject = { ...structuredClone(p), id: `video-${randomUUID()}`, title: `${p.title.slice(0, 220)}（副本）`, revision: 1, createdAt: now, updatedAt: now, approvedRevision: undefined,
                workflow: { ...p.workflow, scriptReview: undefined, storyboardReview: undefined, lastTaskId: undefined, lastAppliedTaskId: undefined, previousStoryboardRevision: undefined } }
              await atomicJson(join(projectsDir, copy.id, 'revisions', '1.json'), copy)
              await atomicJson(join(projectsDir, copy.id, 'project.json'), copy)
              await catalog.update(copy, { sourceProjectId: id }); return copy
            }
            await ensureProjectIdle(id)
            if (parts[2] === 'trash') return catalog.update(p, { lifecycle: 'trashed', deletedAt: meta.deletedAt || new Date().toISOString() })
            if (parts[2] === 'restore') return catalog.update(p, { lifecycle: 'active', archivedAt: undefined, deletedAt: undefined })
            assert(isRecord(body), '项目操作无效')
            if (body.title !== undefined) {
              assert(textValue(body.title, 240) && body.title.trim(), '项目名称不能为空且不能超过 240 字')
              assertProjectAvailable(id, true)
              if (body.expectedRevision !== p.revision) throw new HttpError(409, '项目已更新，请刷新后重命名')
              return commitProject({ ...p, title: body.title.trim() }, p)
            }
            assert(body.lifecycle === 'archived', '项目操作无效')
            assertProjectAvailable(id, true)
            return catalog.update(p, { lifecycle: 'archived', archivedAt: new Date().toISOString() })
          })
          respond(res, 200, result); return
        }
        if (parts.length === 2 && method === 'GET') { respond(res, 200, await loadProject(id)); return }
        if (parts.length === 3 && parts[2] === 'tasks' && method === 'POST') {
          const body = await readBody(req)
          assert(isRecord(body) && ['problem_script','storyboard','storyboard_patch','preflight'].includes(body.kind), '生成任务类型无效')
          const task = await exclusive(async () => {
            const p = await loadProject(id)
            assertProjectAvailable(id, true)
            if (body.expectedRevision === undefined) throw new HttpError(428, '任务请求需要当前工程版本。')
            if (body.expectedRevision !== p.revision) throw new HttpError(409, '工程版本已更新，请保存并核对后提交。')
            if (body.kind === 'problem_script') assert(p.problem, '请先导入题目')
            else if (!scriptApproved(p)) throw new HttpError(409, '请先确认当前讲稿。')
            if (body.kind === 'preflight' && !storyboardApproved(p)) throw new HttpError(409, '请先确认分镜再准备真实配音与时间轴。')
            if (body.kind === 'preflight' && body.scope !== undefined) assert(Array.isArray(body.scope) && body.scope.length > 0 && new Set(body.scope).size === body.scope.length && body.scope.every((sid: unknown) => validId(sid) && p.shots.some(shot => shot.id === sid)), '请选择有效的时间轴镜头')
            if (body.kind === 'storyboard_patch') {
              assert(Array.isArray(body.scope) && body.scope.length > 0 && new Set(body.scope).size === body.scope.length && body.scope.every((sid: unknown) => validId(sid) && p.shots.some(shot => shot.id === sid && !shot.locked)), '请选择未锁定的镜头')
              assert(textValue(body.instruction, 4000) && body.instruction.trim(), '请输入局部修改要求')
            }
            return generationTasks.create({ projectId: id, expectedRevision: p.revision, kind: body.kind as GenerationTaskKind,
              credentialProfileId: requestAIProfileId(),
              scope: ['storyboard_patch', 'preflight'].includes(body.kind) ? body.scope : undefined,
              instruction: textValue(body.instruction, 4000) ? body.instruction.trim() : undefined, force: body.force === true, input: p })
          })
          respond(res, 202, task); return
        }
        if (parts.length === 3 && parts[2] === 'approve-script' && method === 'POST') {
          const body = await readBody(req)
          const result = await exclusive(async () => {
            let p = await loadProject(id)
            assertProjectAvailable(id, true)
            if (!isRecord(body) || body.expectedRevision !== p.revision) throw new HttpError(409, '讲稿已更新，请核对当前版本再确认。')
            const before = structuredClone(p)
            const draft = p.workflow?.scriptDraft
            if (draft !== undefined && draft !== p.sourceScript) {
              const parsed = (await shared()).createProjectFromScript(draft, p.title)
              const unchanged = JSON.stringify(parsed.utterances) === JSON.stringify(p.utterances)
              p = { ...p, sourceScript: parsed.sourceScript, cleanedScript: parsed.cleanedScript, utterances: parsed.utterances,
                scriptNotes: parsed.scriptNotes, contentKinds: unchanged ? p.contentKinds : undefined, shots: unchanged ? p.shots : parsed.shots, circuits: unchanged ? p.circuits : [],
                workflow: { ...p.workflow, previousStoryboardRevision: before.revision, storyboardSourceHash: unchanged ? p.workflow?.storyboardSourceHash : undefined },
                problem: p.problem ? { ...p.problem, storyboardReady: unchanged && p.problem.storyboardReady === true } : undefined }
            }
            p.workflow = { ...p.workflow }; delete p.workflow.scriptDraft; delete p.workflow.storyboardReview
            if (p.problem) {
              if (!p.problem.analysis?.trim() || !p.problem.answer?.trim()) throw new HttpError(409, '请先完成题目解析，再审核讲稿。')
              p.problem = { ...p.problem, reviewed: true }
            }
            p.workflow.scriptReview = { fingerprint: scriptHash(p), reviewedAt: new Date().toISOString() }
            if (getVideoStoryboardReadiness(p).ready && !p.workflow.storyboardSourceHash) p.workflow.storyboardSourceHash = scriptHash(p)
            return commitProject(p, before)
          })
          respond(res, 200, result); return
        }
        if (parts.length === 4 && parts[2] === 'revisions' && method === 'GET') {
          assert(/^[1-9][0-9]{0,9}$/.test(parts[3]), '工程版本无效')
          const current = await loadProject(id), revision = Number(parts[3])
          const snapshot = current.revision === revision ? current : await readJson<VideoProject>(join(projectsDir, id, 'revisions', `${revision}.json`)) || await readJson<VideoProject>(join(projectsDir, id, `approved-${revision}.json`))
          if (!snapshot) throw new HttpError(404, '该草稿的保存基准不存在')
          respond(res, 200, normalizeVideoProjectRoles(snapshot)); return
        }
        if (parts.length === 3 && parts[2] === 'approve' && method === 'POST') {
          const body = await readBody(req)
          const approved = await exclusive(async () => {
            const p = await loadProject(id); assertProjectAvailable(id, true); if (!isRecord(body) || body.revision !== p.revision) throw new HttpError(409, '待确认分镜已发生变化，请刷新后确认')
            validateVideoProject(p)
            if (!scriptApproved(p)) throw new HttpError(409, '请先确认当前讲稿；旧工程也需要完成讲稿确认。')
            if (p.workflow?.storyboardSourceHash !== scriptHash(p)) throw new HttpError(409, '讲稿已有变化，请重新生成分镜。')
            const readiness = getVideoStoryboardReadiness(p)
            if (!readiness.ready) throw new HttpError(409, readiness.issues.join('\n'))
            if (p.problem && (p.problem.reviewed !== true || p.problem.storyboardReady !== true)) throw new HttpError(409, '请先审核题干、题图与解析并生成分镜，再确认分镜')
            p.approvedRevision = p.revision; p.updatedAt = new Date().toISOString()
            p.workflow = { ...p.workflow, storyboardReview: { fingerprint: storyboardHash(p), reviewedAt: p.updatedAt } }
            await atomicJson(join(projectsDir, id, `approved-${p.revision}.json`), p)
            await atomicJson(join(projectsDir, id, 'project.json'), p); await catalog.update(p); return p
          })
          respond(res, 200, approved); return
        }
        if (parts.length === 3 && parts[2] === 'render' && method === 'POST') {
          const body = await readBody(req)
          assert(isRecord(body) && ['preview', 'final', 'shot'].includes(body.kind), '渲染类型无效')
          const job = await exclusive(() => enqueueRenderJob(id, body))
          respond(res, 202, job); startQueue(); return
        }
        if (parts.length === 3 && parts[2] === 'archive' && method === 'GET') {
          const p = await loadProject(id), contents = await archive(p, query.get('jobId'))
          res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filePath="${id}.zip"`, 'Content-Length': contents.length, 'Cache-Control': 'no-store' }); res.end(contents); return
        }
      }
      if (parts[0] === 'jobs') {
        if (parts.length === 1 && method === 'GET') { respond(res, 200, [...jobs.values()].filter(j => !query.has('projectId') || j.projectId === query.get('projectId')).reverse()); return }
        if (!validId(parts[1])) throw new HttpError(400, '任务 ID 无效')
        const job = jobs.get(parts[1]); if (!job) throw new HttpError(404, '渲染任务不存在')
        if (parts.length === 2 && method === 'GET') { respond(res, 200, job); return }
        if (parts.length === 3 && parts[2] === 'nodes' && method === 'GET') {
          const report = await readJson<Record<string, any>>(join(jobsDir, job.id, 'production-nodes.json'))
          const nodes = Array.isArray(report?.nodes) ? report.nodes : []
          respond(res, 200, { projectRevision: job.projectRevision, status: report?.status || job.status, phase: report?.phase || job.phase,
            missingShotIds: report?.missingShotIds || [],
            nodes: nodes.map(({ shotId, status, phase, attempts, cached, duration, error }) => ({ shotId, status, phase, attempts, cached, duration,
              ...(error ? { error: { code: error.code, message: redact(String(error.message), env), retryable: error.retryable === true } } : {}) })) }); return
        }
        if (parts.length === 3 && parts[2] === 'resume' && method === 'POST') {
          const resumed = await exclusive(async () => {
            assertProjectAvailable(job.projectId, true)
            if (!['failed', 'cancelled'].includes(job.status)) throw new HttpError(409, '只有失败或取消的任务可以继续')
            if (await activeProjectTasks(job.projectId)) throw new HttpError(409, '此项目仍有任务运行，请等待结束后继续')
            if (!await readJson(join(jobsDir, job.id, 'manifest.json'))) throw new HttpError(409, '制作快照缺失，请使用当前版本重新制作')
            Object.assign(job, { status: 'queued', progress: 0, stage: '从原制作版本继续，复用已完成镜头', updatedAt: new Date().toISOString() })
            delete job.error; delete job.errorCode; delete job.retryable; delete job.videoUrl; delete job.subtitleUrl; delete job.shotId
            await saveJob(job); queue.push(job.id); return job
          })
          respond(res, 202, resumed); startQueue(); return
        }
        if (parts.length === 3 && parts[2] === 'cancel' && method === 'POST') {
          if (!TERMINAL.has(job.status)) { job.status = 'cancelled'; job.stage = '已取消'; job.updatedAt = new Date().toISOString(); active?.id === job.id && active.controller.abort(); await saveJob(job) }
          respond(res, 200, job); return
        }
        if (parts.length === 4 && parts[2] === 'files' && (method === 'GET' || method === 'HEAD')) {
          if (parts[3] === 'validation.json') { await streamVideoFile(req, res, join(jobsDir, job.id, 'validation.json'), 'application/json; charset=utf-8'); return }
          if (job.status !== 'completed' || !['video.mp4', 'subtitles.srt'].includes(parts[3]) || basename(parts[3]) !== parts[3]) throw new HttpError(404, '输出文件不存在')
          const filePath = join(jobsDir, job.id, parts[3]), info = await stat(filePath)
          let start = 0, end = info.size - 1, statusCode = 200
          if (req.headers.range) {
            const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range)
            if (!match) { res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); res.end(); return }
            start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), info.size - 1) : end
            if (start > end || start >= info.size) { res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); res.end(); return }
            statusCode = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${info.size}`)
          }
          res.writeHead(statusCode, { 'Content-Type': extname(filePath) === '.mp4' ? 'video/mp4' : 'application/x-subrip; charset=utf-8', 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600' })
          if (method === 'HEAD') res.end()
          else { const stream = createReadStream(filePath, { start, end }); stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res) }
          return
        }
        if (parts.length === 4 && parts[2] === 'keyframes' && (method === 'GET' || method === 'HEAD')) {
          if (job.status !== 'completed' || !/^[A-Za-z0-9_.-]+\.png$/.test(parts[3])) throw new HttpError(404, '关键帧不存在')
          const result = await readJson<{ keyframes?: string[] }>(join(jobsDir, job.id, 'result.json'))
          const relative = result?.keyframes?.find(name => basename(name) === parts[3] && !name.includes('..') && !name.startsWith('/') && !name.includes('\\'))
          if (!relative) throw new HttpError(404, '关键帧不存在')
          await streamVideoFile(req, res, join(jobsDir, job.id, relative), 'image/png'); return
        }
      }
      throw new HttpError(404, '视频接口不存在')
    } catch (error) {
      if (res.headersSent) res.destroy()
      else respond(res, error instanceof Error && Number.isInteger((error as any).status) ? (error as any).status : 500, { error: redact(error instanceof Error ? error.message : '视频服务发生错误', env) })
    }
  }
  let closePromise: Promise<void> | undefined
  return Object.assign(middleware, { start: ensureReady, close() { return closePromise ??= (async () => {
    if (!ready) return
    closing = true
    await ready.catch(() => {})
    await mutation
    active?.controller.abort()
    await generationTasks.close()
    await workerPromise
    await mediaTail
    await Promise.all(jobWrites.values())
    const owner = await readJson<{ token: string }>(lockPath).catch(() => undefined)
    if (owner?.token === ownerToken) await unlink(lockPath)
  })() } })
}
export function createVideoPlugin(env: AIEnvironment): Plugin {
  return {
    name: 'local-video-workbench',
    configureServer(server) {
      const middleware = createVideoMiddleware(env)
      server.middlewares.use((req, res, next) => { void middleware(req, res, next) })
      server.httpServer?.once('listening', () => { void middleware.start().catch(error => server.config.logger.error('视频任务恢复失败：' + error.message)) })
      server.httpServer?.once('close', () => { void middleware.close().catch(() => {}) })
    },
    configurePreviewServer(server) {
      const middleware = createVideoMiddleware(env)
      server.middlewares.use((req, res, next) => { void middleware(req, res, next) })
      server.httpServer?.once('listening', () => { void middleware.start().catch(error => server.config.logger.error('视频任务恢复失败：' + error.message)) })
      server.httpServer?.once('close', () => { void middleware.close().catch(() => {}) })
    },
  }
}






