import type { CircuitAsset, Shot, VideoProject } from './videoTypes.js'

// Titles, subtitles and production notes alone do not supply a teaching canvas.
const boardKinds = new Set(['keyword', 'law', 'problem', 'given', 'derivation'])
const placeholder = /^(?:待(?:生成|规划|补充|完善).*|(?:请)?(?:生成分镜|补充画面).*|(?:画面|镜头|场景)?(?:占位|过渡|结束|开场|总结提示)|(?:我)?学会(?:了|啦)[！!。]*|(?:赶紧)?收藏(?:笔记)?[！!。]*|练起来吧[～~！!。]*|谢谢观看[！!。]*)$/

export function hasTeachingVisual(shot: Shot, circuits?: readonly CircuitAsset[]): boolean {
  if (shot.story) return !!shot.story.imageDataUrl
  if ((shot.boardTexts || []).some(board => boardKinds.has(board.kind) && typeof board.text === 'string' && !!board.text.trim() && !placeholder.test(board.text.trim()))) return true
  if ((shot.formulas || []).some(formula => typeof formula.latex === 'string' && !!formula.latex.trim())) return true
  if (!shot.circuitAssetId) return false
  if (!circuits) return true
  const graph = circuits.find(asset => asset.id === shot.circuitAssetId)?.graph as { components?: unknown[] } | undefined
  return Array.isArray(graph?.components) && graph.components.length > 0
}

export function getVideoStoryboardReadiness(project: Pick<VideoProject, 'shots' | 'circuits' | 'storyScene' | 'contentKinds'>): { ready: boolean; emptyShotIds: string[]; issues: string[] } {
  const emptyShots = project.shots.filter(shot => !hasTeachingVisual(shot, project.circuits))
  const issues = emptyShots.map(shot => shot.story ? `${shot.title || shot.id}：请导入并审核本镜头插画。` : `${shot.title || shot.id}：缺少教学主体画面，请由台词规划板书、公式或电路；过渡与结束应承接知识画面，不能只显示口头台词。`)
  for (const shot of project.shots) {
    if (shot.utteranceIds.some(id => project.contentKinds?.[id] === 'story') !== !!shot.story && project.contentKinds)
      issues.push(`${shot.title || shot.id}：文稿类型与镜头类型不同，请重新生成分镜。`)
    if (!shot.story) continue
    if (project.storyScene?.status !== 'confirmed' || !project.storyScene.backgroundImage) issues.push(`${shot.title || shot.id}：请先确认统一场景及背景。`)
    else if (shot.story.sceneRevision !== project.storyScene.version) issues.push(`${shot.title || shot.id}：背景版本已更新，请重新核对并确认插画。`)
    if (shot.story.imageDataUrl && !shot.story.imageApproved) issues.push(`${shot.title || shot.id}：插画尚未确认。`)
  }
  if (!project.shots.length) issues.push('尚未生成教学分镜，请先根据文稿规划各页画面。')
  return { ready: issues.length === 0, emptyShotIds: emptyShots.map(shot => shot.id), issues }
}

export function needsStoryboardPlanning(project: Pick<VideoProject, 'shots' | 'circuits'>): boolean {
  return !getVideoStoryboardReadiness(project).ready
}
