import { createHash, randomUUID } from 'node:crypto'
import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { VideoProject, VideoScenePreview } from './videoTypes.js'
import { runVideoProcess } from './videoProcess.js'
import { normalizeVideoSummaryLayouts } from './videoSummary.js'
import { replaceVideoFile } from './videoAtomicFile.js'
import { createSharedVideoTaskQueue } from './videoSharedTask.js'

export async function videoRendererVersion(renderer: string, cwd: string) {
  const hash=createHash('sha256')
  for(const name of (await readdir(renderer)).filter(n=>n.endsWith('.py')&&!n.startsWith('test_')).sort()) hash.update(name).update(await readFile(join(renderer,name)))
  for (const folder of ['fonts', 'templates']) {
    const directory = join(cwd, 'public/video', folder)
    for (const name of (await readdir(directory).catch(() => [] as string[])).sort()) hash.update(folder + '/' + name).update(await readFile(join(directory, name)))
  }
  return hash.digest('hex')
}
/** Persisted revision, other shots, speech voices and notes do not change this frame. */
export function scenePreviewPayload(project: VideoProject, shotId: string, stage?: string) {
  project = normalizeVideoSummaryLayouts(project)
  const selected = project.shots.find(s => s.id === shotId)
  if (!selected) throw new Error('镜头不存在')
  const { summary: _summary, reviewNotes: _notes, holdSeconds: _hold, ...shot } = selected
  const asset = project.circuits.find(c => c.id === shot.circuitAssetId)
  const circuit = asset ? { id: asset.id, name: asset.name, mode: asset.mode, viewMode: asset.viewMode, currentFlow: asset.currentFlow, geometry: asset.geometry, graph: asset.graph, quantities: asset.quantities } : undefined
  return { project: { title: project.title, settings: project.settings, shots: [shot],
    utterances: project.utterances.filter(u => shot.utteranceIds.includes(u.id)),
    speakers: project.speakers.map(({ id, name, color }) => ({ id, name, color })),
    circuits: circuit ? [circuit] : [], problem: project.problem?.imageDataUrl ? { imageDataUrl: project.problem.imageDataUrl } : undefined,
  }, shotId, stage }
}
function checkedPreview(value: unknown): VideoScenePreview {
  const preview = value as Partial<VideoScenePreview> | null
  if (!preview || preview.width !== 1920 || preview.height !== 1080 || typeof preview.template !== 'string'
    || typeof preview.stage !== 'string' || typeof preview.background !== 'string'
    || !Array.isArray(preview.elements) || !Array.isArray(preview.stages) || !Array.isArray(preview.warnings))
    throw new Error('预览未产生完整的画面数据，请重试。')
  return preview as VideoScenePreview
}
async function readPreview(path: string) { return checkedPreview(JSON.parse(await readFile(path, 'utf8'))) }

export function createScenePreviewService(options:{renderer:string;cwd:string;directory:string;python:string;env:NodeJS.ProcessEnv;runProcess?:typeof runVideoProcess}) {
  const request = createSharedVideoTaskQueue<VideoScenePreview>()
  const execute = options.runProcess || runVideoProcess
  return async(project:VideoProject,shotId:string,stage?:string,measured?:{timeline:Record<string,unknown>;time:number},signal?:AbortSignal):Promise<VideoScenePreview>=>{
    signal?.throwIfAborted()
    const shot=project.shots.find(s=>s.id===shotId)
    if(!shot)throw new Error('镜头不存在')
    const version=await videoRendererVersion(options.renderer,options.cwd)
    const payload={...scenePreviewPayload(project,shotId,stage),...measured}
    const key=createHash('sha256').update(version).update(JSON.stringify(payload)).digest('hex')
    const directory=join(options.directory,key),output=join(directory,'preview.json')
    let cached: VideoScenePreview | undefined
    try { cached = await readPreview(output) } catch { /* Missing or invalid caches are rebuilt. */ }
    signal?.throwIfAborted()
    if (cached) return cached
    return request(key, async workerSignal => {
      // Another worker may have committed this key while it waited for the media slot.
      try { return await readPreview(output) } catch { /* Generate exact vector objects. */ }
      workerSignal.throwIfAborted()
      await mkdir(directory,{recursive:true})
      const attempt = randomUUID()
      const input=join(directory,`request.${attempt}.json`),candidate=join(directory,`preview.${attempt}.json`)
      // Python also uses a sibling .pending.json file; every attempt owns unique paths.
      const partial=join(directory,`preview.${attempt}.pending.json`)
      try {
        await writeFile(input,JSON.stringify(payload),'utf8')
        workerSignal.throwIfAborted()
        await execute(options.python,['-X','utf8',join(options.renderer,'scene_preview.py'),'--input',input,'--output',candidate],
          {cwd:options.cwd,env:options.env,signal:workerSignal,timeoutMs:Number(options.env.VIDEO_PREVIEW_TIMEOUT_MS)||120000})
        const preview = await readPreview(candidate)
        workerSignal.throwIfAborted()
        await replaceVideoFile(candidate, output)
        return preview
      } finally {
        await Promise.all([input,candidate,partial].map(path => unlink(path).catch(() => undefined)))
      }
    }, signal)
  }
}
