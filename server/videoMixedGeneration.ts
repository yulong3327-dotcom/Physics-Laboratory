// Mixed-storyboard generation has been removed. Story content was deleted to
// speed up storyboard production; knowledge-point generation now runs directly
// through createVideoGenerationExecutor. This module re-exports the executor
// and the preview-recovery helper so legacy call sites keep resolving.

import { createVideoGenerationExecutor, type VideoGenerationOptions } from './videoGeneration.js'
import { createHash } from 'node:crypto'
import { canonicalVideoValue } from './videoWorkflow.js'
import type { GenerationTaskContext } from './videoTasks.js'
import type { VideoProject } from './videoTypes.js'
import { storyboardPreviewProject } from './videoGenerationPreview.js'

const failure = (message: string, code = 'mixed_storyboard_invalid') => Object.assign(new Error(message), { code, retryable: false })

/** Read old durable checkpoints without restarting providers or adopting a project. */
export async function recoverVideoGenerationPreview(task: GenerationTaskContext['task'], input: unknown, checkpoint: unknown,
  options: Pick<VideoGenerationOptions, 'shared' | 'validate' | 'resolveImage'>) {
  const state = checkpoint as any
  if (!state || state.version !== 1) return undefined
  const original = structuredClone(options.validate(input)), shared = await options.shared()
  const project = structuredClone(original)
  if (state.kind === 'mixed-storyboard') {
    // Legacy mixed-storyboard checkpoints mixed story and knowledge segments.
    // Story planning is removed; only the knowledge project portion survives.
    const digest = createHash('sha256').update(canonicalVideoValue({ version: 1, project: original })).digest('hex')
    if (state.inputHash !== digest) return undefined
  } else if (state.inputHash !== createHash('sha256').update(canonicalVideoValue(original)).digest('hex')) return undefined
  // v3 stores only the complete project; v4 also stores validated partial batches.
  const candidate = state.project || state.batches?.project || state.batches
  if (!Array.isArray(candidate?.shots) || !candidate.shots.length || !Array.isArray(candidate.circuits)) return undefined
  const prefix = storyboardPreviewProject(project, candidate.shots, candidate.circuits)
  options.validate(prefix, { pendingFormulaReferences: true })
  const prepared = await shared.prepareVideoProject(prefix, { resolveImage: options.resolveImage, pendingFormulaReferences: true })
  options.validate(prepared, { pendingFormulaReferences: true })
  const completed = prepared.shots.filter(shot => !shot.story || shot.story.imageDataUrl)
  return { project: { ...prepared, id: task.projectId, revision: task.expectedRevision }, completedShotIds: completed.map(shot => shot.id),
    completedUtterances: new Set(completed.flatMap(shot => shot.utteranceIds)).size, totalUtterances: original.utterances.length }
}

/** Pass-through executor: knowledge generation only. Story paths are removed. */
export function createVideoMixedGenerationExecutor(options: VideoGenerationOptions) {
  const knowledge = createVideoGenerationExecutor(options)
  return async (context: GenerationTaskContext): Promise<unknown> => {
    if (context.task.kind === 'storyboard_patch') throw failure('局部分镜补丁功能已废弃，请重新生成分镜', 'generation_kind_invalid')
    return knowledge(context)
  }
}
