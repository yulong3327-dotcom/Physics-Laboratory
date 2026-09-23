import type { EncodedPacket } from 'mediabunny'

type RecordingOptions = {
  format: 'mp4' | 'webm'
  duration: number
  drawFrame: (time: number) => Promise<void>
  signal?: AbortSignal
  onProgress?: (progress: number) => void
}

function delay(milliseconds: number, signal: AbortSignal) {
  signal.throwIfAborted()
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, milliseconds)
    signal.addEventListener('abort', abort, { once: true })
  })
}

async function finalizeRecording(blob: Blob, options: RecordingOptions, signal: AbortSignal) {
  const { Input, BlobSource, ALL_FORMATS, EncodedPacketSink, EncodedVideoPacketSource, Output, BufferTarget, Mp4OutputFormat, WebMOutputFormat } = await import('mediabunny')
  signal.throwIfAborted()
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS })
  let output: InstanceType<typeof Output> | undefined
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw new Error('视频录制未生成画面，请重试')
    const codec = await track.getCodec()
    if (!codec || (options.format === 'mp4' ? codec !== 'avc' : codec !== 'vp8' && codec !== 'vp9')) {
      throw new Error('浏览器没有生成所选格式的编码，请选择其他视频格式')
    }
    const config = await track.getDecoderConfig()
    if (!config) throw new Error('无法读取视频编码信息')
    const packets: EncodedPacket[] = []
    for await (const packet of new EncodedPacketSink(track).packets()) {
      signal.throwIfAborted()
      packets.push(packet)
    }
    if (!packets.length) throw new Error('视频录制未生成画面，请重试')

    // MediaRecorder output may omit seek/duration metadata. Remux compressed packets without WebCodecs.
    const presentation = [...packets].sort((a, b) => a.timestamp - b.timestamp)
    const firstTime = presentation[0].timestamp
    const last = presentation[presentation.length - 1]
    const recordedDuration = last.timestamp - firstTime + (last.duration > 0 ? last.duration : 1 / 24)
    const scale = options.duration / recordedDuration
    const durations = new Map(presentation.map((packet, index) => [packet, index + 1 < presentation.length
      ? (presentation[index + 1].timestamp - packet.timestamp) * scale
      : options.duration - (packet.timestamp - firstTime) * scale]))
    const target = new BufferTarget()
    output = new Output({ format: options.format === 'mp4' ? new Mp4OutputFormat() : new WebMOutputFormat(), target })
    const source = new EncodedVideoPacketSource(codec)
    output.addVideoTrack(source)
    await output.start()
    for (const packet of packets) {
      signal.throwIfAborted()
      await source.add(packet.clone({ timestamp: (packet.timestamp - firstTime) * scale, duration: durations.get(packet)! }), { decoderConfig: config })
    }
    source.close()
    signal.throwIfAborted()
    await output.finalize()
    signal.throwIfAborted()
    if (!target.buffer) throw new Error('视频封装失败，请重试')
    return new Blob([target.buffer], { type: `video/${options.format}` })
  } finally {
    input.dispose()
    if (output && output.state !== 'finalized' && output.state !== 'canceled') await output.cancel()
  }
}

export async function recordCanvasVideo(canvas: HTMLCanvasElement, options: RecordingOptions): Promise<Blob> {
  const { format, duration, drawFrame, signal, onProgress } = options
  signal?.throwIfAborted()
  const unavailable = format === 'mp4'
    ? '当前浏览器不支持 MP4 录制，请选择 WebM，或使用新版 Chrome/Edge'
    : '当前浏览器不支持 WebM 录制，请选择 MP4 或 Manim 工程'
  if (typeof MediaRecorder === 'undefined' || typeof canvas.captureStream !== 'function') throw new Error(unavailable)
  const mimeType = (format === 'mp4'
    ? ['video/mp4;codecs=avc1.42E01F', 'video/mp4;codecs=avc1', 'video/mp4']
    : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'])
    .find(type => MediaRecorder.isTypeSupported(type))
  if (!mimeType) throw new Error(unavailable)

  const controller = new AbortController()
  const forwardAbort = () => controller.abort(signal?.reason)
  const visibilityChanged = () => {
    if (document.hidden) controller.abort(new Error('视频导出已中断，请保持页面在前台后重试'))
  }
  signal?.addEventListener('abort', forwardAbort, { once: true })
  document.addEventListener('visibilitychange', visibilityChanged)
  let stream: MediaStream | undefined
  let recorder: MediaRecorder | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    visibilityChanged()
    controller.signal.throwIfAborted()
    await drawFrame(0)
    controller.signal.throwIfAborted()
    stream = canvas.captureStream(24)
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_000_000 })
    const recording = recorder
    const chunks: Blob[] = []
    recording.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
    recording.onerror = () => controller.abort(new Error('浏览器视频录制失败，请重试或选择其他格式'))
    let didStop!: () => void
    const stopped = new Promise<void>(resolve => { didStop = resolve })
    recording.onstop = didStop
    const interrupted = new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true })
    })
    // A rejection can arrive during a frame render, before the next awaited race.
    void interrupted.catch(() => {})
    timeout = setTimeout(() => controller.abort(new Error('视频录制超时，请重试')), duration * 1000 + 30000)
    recording.start(1000)
    await drawFrame(0)
    controller.signal.throwIfAborted()
    const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack
    track.requestFrame?.()
    const start = performance.now()
    let frame = 0
    while (true) {
      controller.signal.throwIfAborted()
      const elapsed = (performance.now() - start) / 1000
      if (elapsed >= duration) break
      await drawFrame(Math.min(duration, elapsed))
      controller.signal.throwIfAborted()
      onProgress?.(Math.min(0.95, elapsed / duration * 0.95))
      frame = Math.max(frame + 1, Math.floor((performance.now() - start) * 24 / 1000) + 1)
      await delay(Math.max(0, Math.min(duration * 1000, frame * 1000 / 24) - (performance.now() - start)), controller.signal)
    }
    recording.stop()
    await Promise.race([stopped, interrupted])
    controller.signal.throwIfAborted()
    stream.getTracks().forEach(track => track.stop())
    const result = await finalizeRecording(new Blob(chunks, { type: recording.mimeType }), options, controller.signal)
    controller.signal.throwIfAborted()
    onProgress?.(1)
    return result
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', forwardAbort)
    document.removeEventListener('visibilitychange', visibilityChanged)
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    stream?.getTracks().forEach(track => track.stop())
  }
}
