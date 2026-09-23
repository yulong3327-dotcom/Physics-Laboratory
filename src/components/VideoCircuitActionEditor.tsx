import type { CircuitAction, CircuitAsset } from '../../server/videoTypes'
import type { ComponentParameters } from '../types/circuit'
import { changeCircuitActionType, defaultComponentState, editableStateComponents, editableStateParameters, stateParameterLabels } from '../lib/videoActionEditing'

const actionNames: Record<CircuitAction['type'], string> = { draw: '逐笔绘制', highlight: '强调元件与导线', label: '文字标注', show: '出现', hide: '隐藏', annotation: '电压 / 电流箭头', state: '改变元件状态' }

export function VideoTransitionDuration({ value, onChange, label }: { value?: number; onChange: (value?: number) => void; label: string }) {
  return <label className="video-field">动效时长 / 秒<input aria-label={`${label}动效秒数`} type="number" min="0.1" max="3" step="0.1" placeholder="自动" value={value ?? ''} onChange={event => onChange(event.target.value === '' ? undefined : Math.min(3, Math.max(.1, Number(event.target.value) || .1)))} /></label>
}

export function VideoCircuitActionEditor({ action, index, asset, onChange }: { action: CircuitAction; index: number; asset?: CircuitAsset; onChange: (action: CircuitAction) => void }) {
  const label = `动画 ${index + 1}`
  const components = editableStateComponents(asset), component = components.find(item => item.id === action.state?.componentId)
  const annotation = action.annotation || { kind: 'voltage' as const, label: 'U' }
  const updateAnnotation = (update: Partial<NonNullable<CircuitAction['annotation']>>) => onChange({ ...action, annotation: { ...annotation, ...update } })
  const updateParameter = (key: keyof ComponentParameters, value: ComponentParameters[keyof ComponentParameters] | undefined) => {
    if (!action.state) return
    const parameters = { ...action.state.parameters }
    if (value === undefined) delete parameters[key]
    else Object.assign(parameters, { [key]: value })
    onChange({ ...action, state: { ...action.state, parameters }, geometry: undefined })
  }
  return <>
    <label className="video-field">动作类型<select aria-label={`${label}类型`} value={action.type} onChange={event => onChange(changeCircuitActionType(action, event.target.value as CircuitAction['type'], asset))}>{Object.entries(actionNames).map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select></label>
    {action.type === 'state' ? <>
      <label className="video-field">改变的元件<select aria-label={`${label}状态元件`} value={action.state?.componentId || ''} onChange={event => { const selected = components.find(item => item.id === event.target.value); if (selected) onChange({ ...action, targetIds: [selected.id], state: defaultComponentState(selected), geometry: undefined }) }}><option value="" disabled>选择元件</option>{components.map(item => <option key={item.id} value={item.id}>{item.label || item.id} · {item.id}</option>)}</select></label>
      {!components.length && <p className="video-inline-warning">请先为镜头选择含有可调元件的电路素材。</p>}
      {component && <><p className="video-field-hint">填写改变后的参数；留空的参数沿用前一状态。状态随旁白发生，并持续到本镜头下一次改变。</p>{editableStateParameters(component).map(key => {
        const value = action.state?.parameters[key], fieldLabel = `${label}${stateParameterLabels[key]}`
        const choices = key === 'switchClosed' ? [['true', '闭合'], ['false', '断开']] : key === 'switchPosition' ? [['left', '接左侧'], ['right', '接右侧'], ['open', '断开']] : key === 'meterMode' ? [['auto', '自动计算'], ['manual', '手动指定']] : undefined
        return <label className="video-field" key={key}>{stateParameterLabels[key]}{choices
          ? <select aria-label={fieldLabel} value={value === undefined ? '' : String(value)} onChange={event => updateParameter(key, event.target.value === '' ? undefined : key === 'switchClosed' ? event.target.value === 'true' : event.target.value as ComponentParameters['switchPosition'] | ComponentParameters['meterMode'])}><option value="">沿用前一状态</option>{choices.map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select>
          : <input aria-label={fieldLabel} type="number" min={key === 'manualReading' ? undefined : 0} max={key === 'sliderPosition' ? 1 : undefined} step={key === 'sliderPosition' ? '.05' : 'any'} placeholder={component.parameters?.[key] === undefined ? '沿用前一状态' : `初始值 ${component.parameters[key]}`} value={typeof value === 'number' ? value : ''} onChange={event => updateParameter(key, event.target.value === '' ? undefined : Number(event.target.value))} />}</label>
      })}</>}
    </> : <>
      <label className="video-field">{action.type === 'annotation' ? '标注范围 · 元件或导线 ID' : '目标 ID'}<input aria-label={`${label}目标`} value={action.targetIds.join(', ')} list={`${action.id}-targets`} onChange={event => onChange({ ...action, targetIds: event.target.value.split(/[,，]/).map(value => value.trim()).filter(Boolean) })} /></label>
      <datalist id={`${action.id}-targets`}>{action.type !== 'annotation' && <option value="circuit">整个电路</option>}{(asset?.geometry?.components || components).map(item => <option key={item.id} value={item.id}>{item.label || item.id}</option>)}{asset?.geometry?.wires.map(item => <option key={item.id} value={item.id}>导线 {item.from} → {item.to}</option>)}</datalist>
    </>}
    {action.type === 'label' && <label className="video-field">标注内容<input aria-label={`${label}标注`} value={action.text || ''} onChange={event => onChange({ ...action, text: event.target.value })} /></label>}
    {action.type === 'annotation' && <>
      <div className="video-field-pair"><label>物理量<select aria-label={`${label}物理量`} value={annotation.kind} onChange={event => { const kind = event.target.value as 'voltage' | 'current'; updateAnnotation({ kind, label: annotation.label === 'U' || annotation.label === 'I' ? kind === 'voltage' ? 'U' : 'I' : annotation.label }) }}><option value="voltage">电压 · 双向尺寸线</option><option value="current">电流 · 方向箭头</option></select></label><label>标注文字<input aria-label={`${label}箭头文字`} value={annotation.label} onChange={event => updateAnnotation({ label: event.target.value })} /></label></div>
      <div className="video-field-pair"><label>放置位置<select aria-label={`${label}箭头位置`} value={annotation.side || 'below'} onChange={event => updateAnnotation({ side: event.target.value as 'above' | 'below' })}><option value="above">目标上方</option><option value="below">目标下方</option></select></label><label>离目标距离 / 像素<input aria-label={`${label}箭头距离`} type="number" min="0" max="240" step="4" value={annotation.offset ?? 40} onChange={event => updateAnnotation({ offset: Math.max(0, Math.min(240, Number(event.target.value) || 0)) })} /></label></div>
      {annotation.kind === 'current' && <label className="video-field">箭头方向<select aria-label={`${label}箭头方向`} value={annotation.direction || 'forward'} onChange={event => updateAnnotation({ direction: event.target.value as 'forward' | 'reverse' })}><option value="forward">向右 / 向上</option><option value="reverse">向左 / 向下</option></select></label>}
      <label className="video-field">箭头颜色<input aria-label={`${label}箭头颜色`} type="color" value={annotation.color || '#FF6600'} onChange={event => updateAnnotation({ color: event.target.value })} /></label>
      <p className="video-field-hint">电压可选择多个元件表示整体分压范围；电流箭头在目标上方或下方水平显示。标注会避开元件名称，请核对方向与位置。</p>
    </>}
    {action.type !== 'state' && <VideoTransitionDuration label={label} value={action.durationSeconds} onChange={durationSeconds => onChange({ ...action, durationSeconds })} />}
  </>
}
