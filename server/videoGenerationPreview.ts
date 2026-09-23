import type { CircuitAsset, Shot, VideoProject } from './videoTypes.js'
import type { GenerationTaskContext } from './videoTasks.js'
import type { VideoShared } from './videoShared.js'
import { canonicalVideoValue } from './videoWorkflow.js'

/** A preview contains only generated pages and their spoken lines. */
export function storyboardPreviewProject(original: VideoProject, shots: Shot[], circuits: CircuitAsset[]): VideoProject {
  const ids = new Set(shots.flatMap(shot => shot.utteranceIds))
  const assets = new Set(shots.map(shot => shot.circuitAssetId))
  return { ...structuredClone(original), shots: structuredClone(shots),
    circuits: structuredClone(circuits.filter(asset => assets.has(asset.id))),
    utterances: original.utterances.filter(line => ids.has(line.id)),
    scriptNotes: original.scriptNotes?.filter(note => !note.utteranceId || ids.has(note.utteranceId)),
    contentKinds: original.contentKinds && Object.fromEntries(Object.entries(original.contentKinds).filter(([id]) => ids.has(id))),
    approvedRevision: undefined }
}

export async function publishStoryboardPreview(context: GenerationTaskContext, original: VideoProject, project: VideoProject) {
  const completed = project.shots.filter(shot => !shot.story || !!shot.story.imageDataUrl)
  await context.onPartialResult?.({ project: { ...project, id: context.task.projectId, revision: context.task.expectedRevision },
    completedShotIds: completed.map(shot => shot.id),
    completedUtterances: new Set(completed.flatMap(shot => shot.utteranceIds)).size,
    totalUtterances: original.utterances.length })
}

/** Prepare changed IDs once and atomically merge them with independent completed pages. */
export function createStoryboardPreviewPublisher(original: VideoProject, context: GenerationTaskContext, shared: VideoShared,
  options: { signal: AbortSignal; resolveImage: (source: string) => Promise<string>; validate: (value: unknown, options?: { pendingFormulaReferences?: boolean }) => VideoProject }) {
  const fingerprints = new Map<string, string>(), preparedShots = new Map<string, Shot>(), preparedCircuits = new Map<string, CircuitAsset>()
  const assetFingerprints = new Map<string, string>()
  let order: string[] = [], lastPublished: string | undefined
  const snapshot = (shotCache = preparedShots, circuitCache = preparedCircuits) => {
    const shots = order.map(id => shotCache.get(id)).filter((shot): shot is Shot => !!shot)
    const circuits = [...new Set(shots.map(shot => shot.circuitAssetId).filter((id): id is string => !!id))]
      .map(id => circuitCache.get(id)).filter((asset): asset is CircuitAsset => !!asset)
    return storyboardPreviewProject(original, shots, circuits)
  }
  const publish = async (project: VideoProject) => {
    const fingerprint = canonicalVideoValue({ shots: project.shots, circuits: project.circuits })
    if (fingerprint === lastPublished) return
    options.signal.throwIfAborted()
    // An explicit empty preview retracts invalidated pages; project validation
    // requires narration and applies once any completed page is present.
    if (project.shots.length) options.validate(project, { pendingFormulaReferences: true })
    await publishStoryboardPreview(context, original, project)
    lastPublished = fingerprint
  }
  return async (shots: Shot[], circuits: CircuitAsset[]) => {
    if (!context.onPartialResult) return
    options.signal.throwIfAborted()
    const incoming = new Map(shots.map(shot => [shot.id, shot]))
    const incomingCircuits = new Map(circuits.map(asset => [asset.id, asset]))
    if (incoming.size !== shots.length || incomingCircuits.size !== circuits.length) throw new Error('分镜预览包含重复的镜头或电路标识')
    const nextFingerprints = new Map(shots.map(shot => [shot.id, canonicalVideoValue({ shot, circuit: incomingCircuits.get(shot.circuitAssetId || '') })]))
    const changed = shots.filter(shot => fingerprints.get(shot.id) !== nextFingerprints.get(shot.id))
    const invalidated = [...preparedShots.keys()].some(id => !incoming.has(id) || fingerprints.get(id) !== nextFingerprints.get(id))
    // A replacement or removal retracts only the affected IDs. Independent
    // completed shots remain visible while the replacement is prepared.
    for (const id of [...preparedShots.keys()]) if (!incoming.has(id)) { preparedShots.delete(id); fingerprints.delete(id) }
    for (const shot of changed) { preparedShots.delete(shot.id); fingerprints.delete(shot.id) }
    order = shots.map(shot => shot.id)
    if (invalidated || !changed.length) await publish(snapshot())
    if (!changed.length) return
    const changedCircuits = [...new Set(changed.map(shot => shot.circuitAssetId).filter((id): id is string => !!id))]
      .map(id => incomingCircuits.get(id)).filter((asset): asset is CircuitAsset => !!asset)
    const cachedAssets = circuits.filter(asset => assetFingerprints.get(asset.id) === canonicalVideoValue(asset) && preparedCircuits.has(asset.id))
      .map(asset => structuredClone(preparedCircuits.get(asset.id)!))
    const delta = storyboardPreviewProject(original, changed, changedCircuits)
    delta.circuits = delta.circuits.map(asset => cachedAssets.find(cached => cached.id === asset.id) || asset)
    const baseline = { ...snapshot(), circuits: cachedAssets }
    const candidate = await shared.prepareVideoProject(delta, { ...options, baseline, pendingFormulaReferences: true })
    options.validate(candidate, { pendingFormulaReferences: true })
    options.signal.throwIfAborted()
    const nextShots = new Map(preparedShots), nextCircuits = new Map(preparedCircuits)
    for (const shot of candidate.shots) nextShots.set(shot.id, structuredClone(shot))
    for (const asset of candidate.circuits) nextCircuits.set(asset.id, structuredClone(asset))
    // Validate references against all completed pages, including an earlier
    // misconception whose correction arrives in this batch, before publishing.
    await publish(snapshot(nextShots, nextCircuits))
    for (const shot of candidate.shots) {
      preparedShots.set(shot.id, nextShots.get(shot.id)!)
      fingerprints.set(shot.id, nextFingerprints.get(shot.id)!)
    }
    for (const asset of candidate.circuits) {
      preparedCircuits.set(asset.id, nextCircuits.get(asset.id)!)
      assetFingerprints.set(asset.id, canonicalVideoValue(incomingCircuits.get(asset.id)))
    }
  }
}
