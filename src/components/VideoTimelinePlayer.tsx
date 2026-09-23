import { useEffect, useMemo, useRef, useState } from 'react'
import type { GenerationTask, Shot, VideoProject, VideoScenePreview, VideoTimelinePreview } from '../../server/videoTypes'
import { videoClient } from '../lib/videoClient'
import './VideoWorkflow.css'

const labels: Record<string, string> = { board: '板书出现', formula: '公式变化', circuit: '电路动作', highlight: '强调开始', highlight_end: '强调结束', subtitle: '字幕', utterance: '旁白开始', subtitle_end: '字幕结束' }
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`
const encodeSvg = (svg: string) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)

/** Uses prepared speech and server event states. It does not simulate animation interpolation. */
export function VideoTimelinePlayer({ project, shot, task, dirty, disabled, onPrepare }: {
  project: VideoProject; shot: Shot; task?: GenerationTask; dirty: boolean; disabled: boolean; onPrepare: () => void;
}) {
  const [timeline, setTimeline] = useState<VideoTimelinePreview | null>(null)
  const [time, setTime] = useState(0), [error, setError] = useState(''), [frameError, setFrameError] = useState('')
  const [loading, setLoading] = useState(false), [frameLoading, setFrameLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [frame, setFrame] = useState<{ key: string; value: VideoScenePreview } | null>(null)
  const [retry, setRetry] = useState(0)
  const audio = useRef<HTMLAudioElement>(null), frames = useRef(new Map<string, VideoScenePreview>())
  const stale = !task || task.projectId !== project.id || task.expectedRevision !== project.revision || dirty
  const identity = `${task?.id || ''}:${shot.id}`
  useEffect(() => {
    audio.current?.pause(); setTime(0); setTimeline(null); setFrame(null); setError(''); setFrameError('')
    frames.current.clear()
    if (!expanded || stale || !task) { setLoading(false); return }
    let active = true
    setLoading(true)
    void videoClient.timeline(task.id, shot.id).then(value => {
      if (active) setTimeline(value)
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '时间轴暂时无法读取') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [identity, stale, retry, expanded])
  const events = useMemo(() => (timeline?.events || []).filter(event => Number.isFinite(event.time) && event.time >= 0).sort((a, b) => a.time - b.time), [timeline])
  // A state only changes at a real recorded event. Repeated playback reuses the same frame.
  const eventTimes = useMemo(() => [...new Set([0, ...events.map(event => event.time)])].sort((a, b) => a - b), [events])
  const frameTime = [...eventTimes].reverse().find(value => value <= time) ?? 0
  const frameKey = identity + ':' + frameTime
  useEffect(() => {
    if (!expanded || !timeline || stale || !task) return
    const cached = frames.current.get(frameKey)
    if (cached) { setFrame({ key: frameKey, value: cached }); setFrameLoading(false); setFrameError(''); return }
    const controller = new AbortController()
    let active = true
    setFrameLoading(true); setFrameError('')
    const url = `/api/video/tasks/${encodeURIComponent(task.id)}/timeline/${encodeURIComponent(shot.id)}/frame?time=${encodeURIComponent(String(frameTime))}`
    void fetch(url, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]) }).then(async response => {
      const value = await response.json()
      if (!response.ok) throw new Error(value.error || '事件画面暂时无法读取')
      if (value.width !== 1920 || value.height !== 1080 || !Array.isArray(value.elements) || typeof value.background !== 'string'
        || value.elements.some((element: any) => !element || typeof element.svg !== 'string' || typeof element.visible !== 'boolean'
          || !element.box || ![element.box.x, element.box.y, element.box.width, element.box.height].every(Number.isFinite))) throw new Error('事件画面格式无效，请重新准备时间轴')
      if (!active) return
      frames.current.set(frameKey, value); setFrame({ key: frameKey, value: value as VideoScenePreview })
    }).catch(reason => { if (active && !controller.signal.aborted) setFrameError(reason instanceof Error ? reason.message : '事件画面暂时无法读取') })
      .finally(() => { if (active) setFrameLoading(false) })
    return () => { active = false; controller.abort() }
  }, [frameKey, timeline, stale, retry, expanded])
  const seek = (value: number) => {
    const next = Math.max(0, Math.min(timeline?.duration || 0, value))
    if (audio.current) audio.current.currentTime = next
    setTime(next)
  }
  const currentFrame = frame?.key === frameKey ? frame.value : undefined
  return <details className="video-timeline-preview" aria-label="真实配音与事件预览" onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>真实配音与事件预览</summary>
    <p className="video-field-hint">按已合成配音定位板书、公式和强调的真实时刻。画面显示事件发生后的状态；完整动画可用镜头视频预览检查。</p>
    {stale ? <div className="video-workflow-checkpoint"><p className="video-timeline-warning">{task ? '讲稿、音色或分镜已有修改，这份时间轴已过期。请保存并确认分镜，再重新准备。' : '请先保存并确认分镜，准备当前镜头的配音与时间轴。'}</p><button className="video-button" disabled={disabled} onClick={onPrepare}>准备本镜头配音与时间轴</button></div> : <>
      {loading && <p role="status">正在读取已准备的配音与时间轴…</p>}
      {error && <p className="video-job-error" role="alert">{error}<button className="video-link-button" onClick={() => setRetry(value => value + 1)}>重新读取</button></p>}
      {timeline && <>
        <audio ref={audio} key={identity} controls preload="metadata" src={timeline.audioUrl} aria-label="本镜头真实配音"
          onTimeUpdate={event => setTime(event.currentTarget.currentTime)} onSeeked={event => setTime(event.currentTarget.currentTime)}
          onError={() => setError('已准备的配音暂时无法播放，请检查本机连接后重新读取。')} />
        <div className="video-timeline-time"><span>播放位置 {clock(time)}</span><span>本镜头 {clock(timeline.duration)}</span></div>
        <input type="range" aria-label="真实时间轴播放位置" min={0} max={timeline.duration} step={0.05} value={Math.min(time, timeline.duration)} onChange={event => seek(Number(event.target.value))} />
        <div className="video-event-frame" aria-label="时间轴事件画面" aria-busy={frameLoading} style={{ aspectRatio: '16 / 9', position: 'relative', overflow: 'hidden', background: currentFrame?.background || '#eef3f1' }}>
          {currentFrame?.backgroundImage && <img className="video-event-background" alt="" src={currentFrame.backgroundImage} />}
          {currentFrame?.elements.filter(element => element.visible).map(element => <img key={element.id} alt={element.label} src={encodeSvg(element.svg)}
            style={{ position: 'absolute', left: `${element.box.x / 19.2}%`, top: `${element.box.y / 10.8}%`, width: `${element.box.width / 19.2}%`, height: `${element.box.height / 10.8}%`, maxWidth: 'none' }} />)}
          {frameLoading && <span className="video-event-frame-status" role="status">正在读取 {clock(frameTime)} 的事件画面…</span>}
          {frameError && <span className="video-event-frame-status" role="alert">{frameError}<button className="video-link-button" onClick={() => setRetry(value => value + 1)}>重试</button></span>}
        </div>
        <p className="video-field-hint">当前事件状态：{clock(frameTime)}。点击下方事件可跳到对应配音位置。</p>
        <div className="video-timeline-events">{events.map((event, index) => <button className="video-button" key={index} aria-current={event.time === frameTime} onClick={() => seek(event.time)} title={event.text || event.data?.id || event.id}>
          {clock(event.time)} · {labels[event.type] || '画面更新'}{event.text ? ` · ${event.text.slice(0, 20)}` : ''}
        </button>)}</div>
      </>}
    </>}
  </details>
}
