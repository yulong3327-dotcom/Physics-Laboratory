import { useEffect, useRef, useState } from 'react'
import { Download, LoaderCircle, X } from 'lucide-react'
import { useCircuitStore } from '../store/circuitStore'
import { IconButton } from './IconButton'
import { downloadBlob, exportCircuit, type ExportFormat } from '../lib/circuitExport'
import type { ExperimentSequence } from '../lib/circuitScene'
import { useExperimentRecording } from '../store/experimentRecording'

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const store = useCircuitStore()
  const recorded = useExperimentRecording()
  const dialog = useRef<HTMLDialogElement>(null)
  const abort = useRef<AbortController>()
  const [format, setFormat] = useState<ExportFormat>('png')
  const [sequence, setSequence] = useState<ExperimentSequence>(recorded.take?.moments.length && !recorded.recording ? 'recording' : 'snapshot')
  const [duration, setDuration] = useState(6)
  const [simulation, setSimulation] = useState(store.simulationEnabled)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const animated = ['manim', 'mp4', 'webm'].includes(format)
  useEffect(() => { dialog.current?.showModal(); return () => { abort.current?.abort() } }, [])
  const close = () => { abort.current?.abort(); onClose() }
  const run = async () => {
    const controller = new AbortController(); abort.current = controller
    setBusy(true); setError(''); setProgress(0)
    try {
      const state = useCircuitStore.getState()
      const result = await exportCircuit(structuredClone(state.graph), { format, mode: state.viewMode, sequence: animated ? sequence : 'snapshot', duration, simulation, recording: recorded.take, signal: controller.signal, onProgress: setProgress })
      controller.signal.throwIfAborted()
      downloadBlob(result.blob, `circuit-${format}-${new Date().toISOString().slice(0, 10)}.${result.extension}`)
      setBusy(false)
    } catch (reason) { if (!controller.signal.aborted) { setError(reason instanceof Error ? reason.message : '导出失败'); setBusy(false) } }
  }
  return <dialog ref={dialog} className="ai-dialog export-dialog" aria-label="导出电路" onCancel={event => { event.preventDefault(); close() }}>
    <div className="dialog-heading"><h2>导出电路</h2><IconButton label="关闭导出" onClick={close}><X size={18} /></IconButton></div>
    <label className="field-label" htmlFor="export-format">文件格式</label>
    <select id="export-format" className="field-input" value={format} disabled={busy} onChange={event => setFormat(event.target.value as ExportFormat)}>
      <option value="json">JSON 工程</option><option value="svg">SVG 矢量图</option><option value="png">PNG 图片</option><option value="manim">Manim 工程包 (.zip)</option><option value="mp4">MP4 视频</option><option value="webm">WebM 视频</option>
    </select>
    {['svg', 'png'].includes(format) && <label className="binary-field"><span>包含实验读数</span><input type="checkbox" checked={simulation} disabled={busy} onChange={event => setSimulation(event.target.checked)} /></label>}
    {animated && <>
      <label className="field-label" htmlFor="export-sequence">实验过程</label><select id="export-sequence" className="field-input" value={sequence} disabled={busy} onChange={event => setSequence(event.target.value as ExperimentSequence)}>
        <option value="recording" disabled={!recorded.take?.moments.length || recorded.recording}>已录制的实验过程</option><option value="snapshot">当前电路电流动画</option><option value="slider" disabled={!store.graph.components.some(c => ['rheostat', 'potentiometer'].includes(c.type))}>滑片从 A 端到 B 端</option><option value="switch" disabled={!store.graph.components.some(c => c.type === 'switch')}>开关由断开到闭合</option>
      </select>
      <label className="field-label" htmlFor="export-duration">时长 (秒)</label><input id="export-duration" type="number" className="field-input" min={sequence === 'recording' ? '0.25' : '2'} max={sequence === 'recording' ? '60' : '30'} value={sequence === 'recording' ? Number((recorded.take?.duration || 0).toFixed(2)) : duration} disabled={busy || sequence === 'recording'} onChange={event => { if (Number.isFinite(event.target.valueAsNumber)) setDuration(Math.max(2, Math.min(30, event.target.valueAsNumber))) }} />
    </>}
    {busy && <progress aria-label="导出进度" value={progress} max="1" />}
    {error && <p className="ai-error" role="alert">{error}</p>}
    <div className="dialog-actions"><button className="text-button" onClick={close}>{busy ? '取消导出' : '取消'}</button><button className="text-button ai-button" disabled={busy || (animated && sequence === 'recording' ? recorded.recording || !recorded.take?.moments.length : !store.graph.components.length)} onClick={() => void run()}>{busy ? <LoaderCircle className="spinning" size={16} /> : <Download size={16} />}{busy ? `${Math.round(progress * 100)}%` : '导出'}</button></div>
  </dialog>
}
