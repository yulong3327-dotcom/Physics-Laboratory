import type { VideoProject } from './videoTypes.js'
import { equalProjectValue } from './videoProjectMerge.js'

/** The same dependency sets are used to invalidate browser edits and server reviews. */
export function scriptReviewContent(project: VideoProject) {
  const { text, imageDataUrl, analysis, answer } = project.problem || {}
  return { sourceScript: project.sourceScript, draft: project.workflow?.scriptDraft,
    utterances: project.utterances, speakers: project.speakers.map(({ id, name }) => ({ id, name })),
    notes: project.scriptNotes, contentKinds: project.contentKinds, problem: project.problem ? { text, imageDataUrl, analysis, answer } : undefined }
}
export function storyboardReviewContent(project: VideoProject) {
  return { script: scriptReviewContent(project), title: project.title, shots: project.shots,
    circuits: project.circuits, speech: project.speech, speakers: project.speakers,
    pronunciations: project.pronunciations, settings: project.settings, storyScene: project.storyScene }
}
export function invalidateVideoWorkflow(previous: VideoProject, next: VideoProject): VideoProject {
  next = invalidateStoryAssets(previous, next)
  const workflow = { ...next.workflow }
  const scriptChanged = !equalProjectValue(scriptReviewContent(previous), scriptReviewContent(next))
  const storyboardChanged = scriptChanged || !equalProjectValue(storyboardReviewContent(previous), storyboardReviewContent(next))
  if (scriptChanged) delete workflow.scriptReview
  if (storyboardChanged) delete workflow.storyboardReview
  return { ...next, workflow, ...(storyboardChanged ? { approvedRevision: undefined } : {}) }
}

/** Story asset invalidation is a no-op now that story planning has been removed. */
export function invalidateStoryAssets(_previous: VideoProject, next: VideoProject): VideoProject {
  return next
}

/** Stable object ordering makes persisted fingerprints independent of JSON property order. */
export function canonicalVideoValue(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalVideoValue).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.entries(value).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => JSON.stringify(key) + ':' + canonicalVideoValue(v)).join(',') + '}'
  return JSON.stringify(value) ?? 'null'
}
