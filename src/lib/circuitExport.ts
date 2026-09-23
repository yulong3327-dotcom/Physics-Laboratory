import { strToU8 } from 'fflate'
import type { CircuitGraph, ViewMode } from '../types/circuit'
import { recordingFrame, type ExperimentRecording } from '../store/experimentRecording'
import { canvasPng, drawScene, experimentFrame, prepareCircuitScene, type ExperimentSequence } from './circuitScene'

export type ExportFormat = 'json' | 'svg' | 'png' | 'manim' | 'mp4' | 'webm'
export interface ExportOptions { format: ExportFormat; mode: ViewMode; sequence: ExperimentSequence; duration: number; simulation: boolean; recording?: ExperimentRecording | null; signal?: AbortSignal; onProgress?: (value: number) => void }

export function projectJson(graph: CircuitGraph, viewMode: ViewMode) {
  return JSON.stringify({ ...graph, schemaVersion: 2, viewMode }, null, 2)
}

export function downloadBlob(blob: Blob, filePath: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filePath; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function exportCircuit(graph: CircuitGraph, options: ExportOptions): Promise<{ blob: Blob; extension: string }> {
  const { format, signal } = options
  const take = options.sequence === 'recording' ? options.recording : null
  if (options.sequence === 'recording' && !take?.moments.length) throw new Error('请先录制实验过程')
  const mode = take?.mode || options.mode
  graph = take?.moments[0].graph || graph
  const check = () => signal?.throwIfAborted()
  check()
  if (format === 'json') return { blob: new Blob([projectJson(graph, mode)], { type: 'application/json' }), extension: 'json' }
  if (!graph.components.length) throw new Error('画布为空')
  const scene = await prepareCircuitScene(graph, mode, signal, take?.moments.map(moment => moment.graph))
  check()
  const initial = scene.render(graph, options.simulation)
  if (format === 'svg') return { blob: new Blob([initial], { type: 'image/svg+xml' }), extension: 'svg' }
  const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720
  await drawScene(canvas, initial)
  if (format === 'png') return { blob: await canvasPng(canvas), extension: 'png' }
  const duration = take?.duration || Math.max(2, Math.min(30, options.duration))
  const at = (time: number) => {
    const moment = take && recordingFrame(take, time)
    return scene.render(moment ? moment.graph : experimentFrame(graph, options.sequence, time / duration), moment ? moment.enabled : true, time)
  }
  if (format === 'manim') {
    const files: Record<string, Uint8Array> = { 'project.json': strToU8(projectJson(graph, mode)), 'circuit.svg': strToU8(initial) }
    const count = Math.max(1, Math.round(duration * 24))
    files['timeline.json'] = strToU8(JSON.stringify(take || { version: 1, mode, duration, sequence: options.sequence }, null, 2))
    for (let i = 0; i < count; i++) {
      check()
      await drawScene(canvas, at(i / 24))
      files[`frames/${String(i).padStart(3, '0')}.png`] = new Uint8Array(await (await canvasPng(canvas)).arrayBuffer())
      options.onProgress?.((i + 1) / count)
    }
    files['scene.py'] = strToU8(`from pathlib import Path\nfrom manim import Scene, ImageMobject, config\n\nROOT = Path(__file__).resolve().parent\nconfig.background_color = "#ffffff"\nconfig.frame_rate = 24\n\nclass CircuitExperiment(Scene):\n    def construct(self):\n        frames = sorted((ROOT / "frames").glob("*.png"), key=lambda frame: int(frame.stem))\n        previous = None\n        for frame in frames:\n            picture = ImageMobject(str(frame))\n            picture.width = config.frame_width\n            if picture.height > config.frame_height:\n                picture.height = config.frame_height\n            if previous is not None:\n                self.remove(previous)\n            self.add(picture)\n            self.wait(1 / 24)\n            previous = picture\n`)
    files['README.md'] = strToU8('# Circuit Experiment\n\nRequires Python 3.10+, Manim Community and FFmpeg.\n\n```sh\npip install manim\nmanim -qm --fps 24 scene.py CircuitExperiment\n```\n\nproject.json retains electrical endpoints and all experiment parameters and can be imported into the editor. circuit.svg is a self-contained snapshot. timeline.json retains recorded parameter and simulation events with their original timestamps (or the chosen preset). Frames replay those events at 24 fps using the editor linear DC model, including switch state, lamp brightness, meter needles and moving current dots. The dots show conventional current direction; their speed is illustrative. Modify scene.py to combine this experiment with other Manim scenes. Circuit objects are rendered into frames, not individual editable Manim objects.\n')
    check()
    const packed = await new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
      const worker = new Worker(new URL('./manimArchive.worker.ts', import.meta.url), { type: 'module' })
      const cleanup = () => {
        signal?.removeEventListener('abort', abort)
        worker.terminate()
      }
      const abort = () => { cleanup(); reject(signal?.reason || new DOMException('Export aborted', 'AbortError')) }
      worker.onmessage = (event: MessageEvent<Uint8Array<ArrayBuffer>>) => { cleanup(); resolve(event.data) }
      worker.onerror = event => { cleanup(); reject(new Error(event.message || 'Manim 打包失败')) }
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
      else worker.postMessage(files, Object.values(files).map(file => file.buffer as ArrayBuffer))
    })
    check()
    return { blob: new Blob([packed], { type: 'application/zip' }), extension: 'zip' }
  }
  const { Output, BufferTarget, CanvasSource, Mp4OutputFormat, WebMOutputFormat, canEncodeVideo } = await import('mediabunny')
  const codec = format === 'mp4' ? 'avc' : 'vp9'
  if (!await canEncodeVideo(codec, { width: 1280, height: 720, bitrate: 2_000_000 })) {
    const { recordCanvasVideo } = await import('./canvasRecording')
    const blob = await recordCanvasVideo(canvas, { format, duration, drawFrame: time => drawScene(canvas, at(time)), signal, onProgress: options.onProgress })
    check()
    return { blob, extension: format }
  }
  const target = new BufferTarget()
  const output = new Output({ format: format === 'mp4' ? new Mp4OutputFormat() : new WebMOutputFormat(), target })
  const source = new CanvasSource(canvas, { codec, bitrate: 2_000_000 })
  output.addVideoTrack(source, { frameRate: 24 })
  try {
    await output.start()
    const count = Math.round(duration * 24)
    for (let i = 0; i < count; i++) {
      check()
      await drawScene(canvas, at(i / 24))
      await source.add(i / 24, 1 / 24)
      options.onProgress?.((i + 1) / count)
    }
    check(); await output.finalize()
    if (!target.buffer) throw new Error('视频编码失败')
    return { blob: new Blob([target.buffer], { type: format === 'mp4' ? 'video/mp4' : 'video/webm' }), extension: format }
  } catch (error) { if (output.state !== 'finalized' && output.state !== 'canceled') await output.cancel(); throw error }
}
