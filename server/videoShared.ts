import { readFile, stat, readdir } from 'node:fs/promises'
import { resolve, relative, extname, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { VideoProject } from './videoTypes.js'

export interface VideoShared {
  createProjectFromScript(script: string, title?: string): VideoProject;
  parseVideoScript(script: string): Pick<VideoProject, 'sourceScript' | 'cleanedScript' | 'utterances' | 'scriptNotes'> & { speakers: { id: string; name: string }[] };
  prepareVideoProject(project: VideoProject, options?: { signal?: AbortSignal; resolveImage?: (source: string) => Promise<string>; baseline?: VideoProject; pendingFormulaReferences?: boolean }): Promise<VideoProject>;
  prepareCircuitStateGeometry(project: VideoProject, shot: VideoProject['shots'][number], asset: VideoProject['circuits'][number], options?: { signal?: AbortSignal; resolveImage?: (source: string) => Promise<string> }): Promise<void>;
  validateTeachingProject(project: VideoProject): string[];
  generateProblemNarration(project: VideoProject, options?: any): Promise<VideoProject>;
  generateVideoStoryboard(project: VideoProject, options?: any): Promise<VideoProject>;
  requestStoryboardBatch(project: VideoProject, options?: any, context?: string): Promise<VideoProject>;
  generateStoryboardInBatches(project: VideoProject, options: any, request: any, validate: any): Promise<VideoProject>;
  splitStoryboardUtterances(utterances: VideoProject['utterances']): string[][];
  refreshVideoScriptNotes(previous: VideoProject, next: any): VideoProject['scriptNotes'];
  collectScriptTeachingReviewNotes(project: VideoProject): any[];
  canonicalVideoSpeakers(provider: string): VideoProject['speakers'];
  normalizeVideoProjectRoles(project: VideoProject): VideoProject;
}
export function createVideoSharedLoader(cwd: string) {
  let loaded: Promise<VideoShared> | undefined
  return () => loaded ??= (async () => {
    const output = resolve(cwd, 'server-dist/videoShared.mjs')
    const entry = resolve(cwd, 'src/lib/videoServerBridge.ts')
    const source = await stat(entry).catch(() => undefined)
    const built = await stat(output).catch(() => undefined)
    // Development imports source; the portable production package only needs
    // the compiled bridge and regular runtime dependencies.
    if (source) {
      const newest = async (folder: string): Promise<number> => Math.max(0, ...await Promise.all((await readdir(folder, { withFileTypes: true })).map(async item => item.isDirectory() ? newest(resolve(folder, item.name)) : (await stat(resolve(folder, item.name))).mtimeMs)))
      if (!built || await newest(resolve(cwd, 'src')) > built.mtimeMs || await newest(resolve(cwd, 'server')) > built.mtimeMs) {
        const bundler = 'esbuild'
        const { build } = await import(bundler)
        await build({ entryPoints: [entry], outfile: output, bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external', logLevel: 'warning' })
      }
    }
    return import(pathToFileURL(output).href + '?v=' + (await stat(output)).mtimeMs) as Promise<VideoShared>
  })().catch(error => { loaded = undefined; throw error })
}
export function videoAssetResolver(cwd: string) {
  const publicRoot = resolve(cwd, 'public')
  return async (source: string): Promise<string> => {
    if (/^data:image\//.test(source)) return source
    if (!source.startsWith('/') || source.startsWith('//')) throw new Error('仅允许工程内嵌或本机素材')
    const filename = resolve(publicRoot, '.' + decodeURIComponent(source))
    const local = relative(publicRoot, filename)
    if (local === '..' || local.startsWith('..' + sep) || resolve(filename) === publicRoot) throw new Error('素材路径超出项目目录')
    const mime = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' } as Record<string, string>)[extname(filename).toLowerCase()]
    if (!mime) throw new Error('不支持的本地图片格式')
    return 'data:' + mime + ';base64,' + (await readFile(filename)).toString('base64')
  }
}
