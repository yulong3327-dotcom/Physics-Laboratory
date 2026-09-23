import { checkExpiredSession } from '../lib/apiSession'
import { useEffect, useRef, useState } from 'react'
import { ImagePlus, LoaderCircle, Sparkles, X } from 'lucide-react'
import { MultimodalAIProvider } from '../lib/aiProvider'
import { useCircuitStore } from '../store/circuitStore'
import type { CircuitGraph } from '../types/circuit'
import { IconButton } from './IconButton'
import { prepareCircuitImage } from '../lib/prepareCircuitImage'

export function AIImportDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<'text' | 'real' | 'schematic'>('text')
  const [text, setText] = useState('')
  const [image, setImage] = useState('')
  const [status, setStatus] = useState<{ configured: boolean; model?: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [progress, setProgress] = useState('识别中')
  const [error, setError] = useState('')
  const [result, setResult] = useState<CircuitGraph | null>(null)
  const alive = useRef(true)
  const recognitionController = useRef<AbortController | null>(null)

  useEffect(() => {
    alive.current = true
    const controller = new AbortController()
    dialogRef.current?.showModal()
    fetch('/api/ai/status', { signal: controller.signal }).then(response => {
      checkExpiredSession(response)
      if (!response.ok) throw new Error('AI 服务暂不可用')
      return response.json()
    }).then(setStatus).catch(reason => { if (!controller.signal.aborted) setError(reason.message) })
    return () => { alive.current = false; controller.abort(); recognitionController.current?.abort() }
  }, [])

  const close = () => { recognitionController.current?.abort(); onClose() }

  const recognize = async () => {
    recognitionController.current?.abort()
    const controller = new AbortController()
    recognitionController.current = controller
    setBusy(true); setError(''); setResult(null)
    try {
      const provider = new MultimodalAIProvider(message => {
        if (alive.current && !controller.signal.aborted) setProgress(message)
      }, { signal: controller.signal })
      const graph = mode === 'text' ? await provider.parseTextDescription(text) : await provider.recognizeImage(image, mode)
      if (alive.current && !controller.signal.aborted) setResult(graph)
    } catch (reason) { if (alive.current && !controller.signal.aborted) setError(reason instanceof Error ? reason.message : '识别失败') }
    finally { if (alive.current) setBusy(false) }
  }

  return <dialog ref={dialogRef} className="ai-dialog" aria-labelledby="ai-title" onCancel={close} onClose={close}>
    <div className="dialog-heading"><h2 id="ai-title">AI 导入</h2><IconButton label="关闭 AI 导入" onClick={close}><X size={18} /></IconButton></div>
    <div className="segmented">
      {(['text', 'real', 'schematic'] as const).map(value => <button key={value} disabled={busy} aria-pressed={mode === value} onClick={() => { setMode(value); setResult(null); setError('') }}>{{ text: '文字', real: '实物连接图', schematic: '电路图' }[value]}</button>)}
    </div>
    <p className="ai-status">{status ? status.configured ? `模型：${status.model}` : 'AI 服务未配置' : '正在连接 AI 服务'}</p>
    {mode === 'text' ? <textarea className="ai-text" aria-label="电路描述" placeholder="一个电池串联一个开关和两个灯泡" value={text} disabled={busy} maxLength={6000} onChange={event => { setText(event.target.value); setResult(null) }} />
      : <>
        {image && <img className="ai-image" src={image} alt="待识别的电路图片" />}
        <button className="ai-upload" disabled={busy || preparing} onClick={() => fileRef.current?.click()}><ImagePlus size={20} />{preparing ? '正在处理图片' : image ? '更换图片' : '选择图片'}</button>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={async event => {
          const file = event.target.files?.[0]; event.target.value = ''
          if (!file) return
          setPreparing(true); setResult(null); setImage(''); setError('')
          try { const prepared = await prepareCircuitImage(file); if (alive.current) setImage(prepared) }
          catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : '图片读取失败') }
          finally { if (alive.current) setPreparing(false) }
        }} />
      </>}
    {error && <p className="ai-error" role="alert">{error}</p>}
    {result && <p className="ai-result" role="status">已识别 {result.components.length} 个元件、{result.connections.length} 条连线</p>}
    {result && result.warnings.length > 0 && <ul className="ai-warnings" aria-label="识别待确认项">{result.warnings.map((warning, index) => <li key={index}>{warning.message}</li>)}</ul>}
    <div className="dialog-actions">
      <button className="text-button" onClick={close}>取消</button>
      {result ? <button className="text-button ai-button" onClick={() => {
        if (!useCircuitStore.getState().loadGraph(result)) { setError('识别结果包含无效电路数据'); return }
        window.dispatchEvent(new Event('circuit:fit')); close()
      }}>应用到画布</button> : <button className="text-button ai-button" disabled={busy || preparing || !status?.configured || (mode === 'text' ? !text.trim() : !image)} onClick={recognize}>
        {busy ? <LoaderCircle size={16} className="spinning" /> : <Sparkles size={16} />}{busy ? progress : '开始识别'}
      </button>}
    </div>
  </dialog>
}
