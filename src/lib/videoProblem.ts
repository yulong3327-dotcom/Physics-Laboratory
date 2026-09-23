import { renderPrompt } from './promptCatalog'
import type { VideoProject } from '../../server/videoTypes'
import type { StoryboardGenerationOptions } from './videoStoryboardBatch'
import { createProjectFromScript } from './videoProject'
import { canonicalVideoSpeakers, normalizeVideoProjectRoles, validateGeneratedVideoNarration, VIDEO_ROLE_PROMPT } from './videoRoles'

/** The source problem stays separate from AI-authored narration and teacher review. */
export function createProjectFromProblem(text: string, title = '电学题目讲解', imageDataUrl?: string): VideoProject {
  if (!text.trim() && !imageDataUrl) throw new Error('请输入题干或选择题目图片')
  if (text.length > 12000) throw new Error('单题题干不能超过 12000 字')
  if (imageDataUrl && (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(imageDataUrl) || imageDataUrl.length > 6_500_000)) throw new Error('题目图片须为不超过约 4 MB 的 PNG、JPEG 或 WebP')
  const project = createProjectFromScript('方大招：' + (text.trim() || '请先解析题目图片并审核讲稿。'), title)
  project.problem = { text, imageDataUrl, reviewed: false, storyboardReady: false }
  project.settings.switchPolicy = 'preserve'
  project.shots[0].boardTexts = text.trim() ? [{ id: 'problem-statement', kind: 'problem', text }] : []
  project.shots[0].reviewNotes = ['请先生成题目解析讲稿；原题条件、图片和接法须保留，审核后再生成分镜。']
  return project
}

export async function generateProblemNarration(project: VideoProject, options: StoryboardGenerationOptions = {}): Promise<VideoProject> {
  const problem = project.problem
  if (!problem || (!problem.text.trim() && !problem.imageDataUrl)) throw new Error('请先录入题目')
  options.signal?.throwIfAborted()
  const prompt = renderPrompt('video/problem/system', { rolePrompt: VIDEO_ROLE_PROMPT })
  const content: unknown = problem.imageDataUrl ? [{ type: 'text', text: renderPrompt('video/problem/user', { problemText: problem.text }) }, { type: 'image_url', image_url: { url: problem.imageDataUrl, detail: 'high' } }] : renderPrompt('video/problem/user', { problemText: problem.text })
  let feedback = ''
  const attempts = options.attempts ?? 2
  for (let attempt = 0; attempt < attempts; attempt++) {
    options.signal?.throwIfAborted()
    options.onProgress?.(attempt ? '正在重新解析题目；原题与现有讲稿保留…' : '正在提取题设、核对公式并生成讲解稿…')
    try {
      const response = await (options.fetcher || fetch)('/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(105000)]) : AbortSignal.timeout(105000), body: JSON.stringify({ json: true, purpose: 'video_problem', messages: [{ role: 'system', content: prompt + feedback }, { role: 'user', content }] }) })
      const data = await response.json()
      if (!response.ok) throw Object.assign(new Error(typeof data.error === 'string' ? data.error : '题目解析失败'), { status: response.status })
      const raw = data.choices?.[0]?.message?.content
      let parsed: any
      try { parsed = JSON.parse(String(raw).replace(/^```(?:json)?\s*|\s*```$/g, '')) } catch { throw new Error('题目解析不是有效 JSON') }
      if (parsed.needsClarification === true || (Array.isArray(parsed.needsClarification) && parsed.needsClarification.length)) throw Object.assign(new Error('题目信息需要补充：' + (Array.isArray(parsed.needsClarification) ? parsed.needsClarification.join('；') : '请核对题干中的条件或图片')), { status: 422 })
      if (typeof parsed.needsClarification === 'string' && !/^(?:不需要|无需|无|没有)(?:[，。；].*)?$/.test(parsed.needsClarification.trim()) && parsed.needsClarification.trim()) throw Object.assign(new Error('题目信息需要补充：' + parsed.needsClarification), { status: 422 })
      if (parsed.analysis && typeof parsed.analysis === 'object') parsed.analysis = Object.entries(parsed.analysis).map(([key, value]) => key + '：' + (Array.isArray(value) ? value.filter(v => typeof v === 'string').join('；') : typeof value === 'string' ? value : '')).join('\n')
      if (Array.isArray(parsed.script) && parsed.script.every((line: unknown) => typeof line === 'string')) parsed.script = parsed.script.join('\n')
      if (typeof parsed.script === 'string') parsed.script = parsed.script.replace(/\\n/g, '\n').replace(/^\s*\/+(?=方大招|金天练)/gm, '').replace(/^(方大招|金天练)[：:]\s*(?:老师|学生)[：:]\s*/gm, '$1：')
      if (![parsed.script, parsed.analysis, parsed.answer].every(s => typeof s === 'string' && s.trim()) || parsed.script.length > 8000) throw new Error('题目解析结构不完整')
      const next = createProjectFromScript(parsed.script, typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.slice(0, 240) : project.title)
      next.id = project.id; next.revision = project.revision; next.createdAt = project.createdAt
      next.settings = { ...project.settings }; next.speech = project.speech || next.speech; next.pronunciations = project.pronunciations
      next.speakers = canonicalVideoSpeakers(project.speech?.provider || 'fish')
      const roleErrors = validateGeneratedVideoNarration(next)
      if (roleErrors.length) throw new Error('新讲稿IP与教学审核未通过：' + roleErrors.join('；'))
      next.problem = { ...problem, text: problem.text.trim() ? problem.text : typeof parsed.transcribedProblem === 'string' ? parsed.transcribedProblem : '', analysis: parsed.analysis, answer: parsed.answer, reviewed: false, storyboardReady: false }
      if (!next.problem.text.trim() && !next.problem.imageDataUrl) throw new Error('题目解析未保留题干')
      next.shots[0].boardTexts = next.problem.text.trim() ? [{ id: 'problem-statement', kind: 'problem', text: next.problem.text }] : []
      next.shots[0].reviewNotes.push('AI解析待教师审核：确认题干、接法、公式条件与答案后生成分镜。')
      options.onProgress?.('题目解析讲稿已生成，请审核原题条件、解法和答案。')
      return normalizeVideoProjectRoles(next)
    } catch (error) {
      options.signal?.throwIfAborted()
      const e = error as { status?: number; message?: string }
      if (attempt + 1 >= attempts || [400, 401, 403, 413, 422, 503].includes(e.status || 0)) throw error
      feedback = renderPrompt('video/problem/repair', { feedback: e.message || '' })
    }
  }
  throw new Error('题目解析未完成，请重试；原题与现有讲稿保留。')
}
