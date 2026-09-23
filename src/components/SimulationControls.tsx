import { useMemo } from 'react'
import { Activity, Play, Square, Circle } from 'lucide-react'
import { useExperimentRecording } from '../store/experimentRecording'
import { IconButton } from './IconButton'
import { useCircuitStore } from '../store/circuitStore'
import { getComponentParameters, simulateCircuit } from '../lib/circuitSimulation'
import type { CircuitComponent, ComponentParameters } from '../types/circuit'

export const simulationStatusNames = { no_source: '未接入电源', open: '开路', operating: '通电', overload: '过载', short_circuit: '短路', error: '无法求解' }
export function formatReading(value: number | null | undefined, unit = '') {
  if (value == null || !Number.isFinite(value)) return '未定义'
  if (unit === 'A' && value !== 0 && Math.abs(value) < 0.1) return `${Number((value * 1000).toPrecision(4))} mA`
  return `${Number(value.toPrecision(4))} ${unit}`.trim()
}

export function SimulationControls() {
  const { graph, simulationEnabled, setSimulationEnabled } = useCircuitStore()
  const recording = useExperimentRecording()
  const result = useMemo(() => simulationEnabled ? simulateCircuit(graph) : null, [graph, simulationEnabled])
  return <div className={`simulation-controls ${result?.status || ''}`}>
    <button className="simulation-toggle" aria-label={simulationEnabled ? '停止实验' : '开始实验'} onClick={() => setSimulationEnabled(!simulationEnabled)}>
      {simulationEnabled ? <Square size={14} /> : <Play size={14} />}<span>{simulationEnabled ? '停止' : '实验'}</span>
    </button>
    {result && <><Activity size={14} /><span role="status" data-testid="simulation-status">{simulationStatusNames[result.status]}</span><output title="单个电源组的端口电流；多个供电端口或电源短接环流请查看各支路电流">{result.totalCurrent === null ? '查看各支路电流' : `电源组 ${formatReading(result.totalCurrent, 'A')}`}</output></>}
    <IconButton label={recording.recording ? '结束录制' : '录制实验'} active={recording.recording} disabled={!recording.recording && !graph.components.length} onClick={recording.recording ? recording.stop : recording.start}>{recording.recording ? <Square size={14} /> : <Circle size={14} />}</IconButton>
    {(recording.recording || recording.take?.moments.length) ? <span className="recording-time" data-testid="recording-time">{recording.recording ? '录制 ' : '已录制 '}{recording.elapsed.toFixed(1)}s</span> : null}
  </div>
}

function ParameterNumber({ component, name, label, value, min = 0, max = 1e6, step = 'any' }: {
  component: CircuitComponent; name: keyof ComponentParameters; label: string; value: number; min?: number; max?: number; step?: number | 'any'
}) {
  const store = useCircuitStore()
  return <label className="parameter-field"><span>{label}</span><input type="number" aria-label={label} min={min} max={max} step={step} value={value}
    onFocus={store.beginHistoryTransaction} onBlur={store.endHistoryTransaction}
    onChange={event => { const value = event.target.valueAsNumber; if (Number.isFinite(value) && value >= min && value <= max) store.updateComponentParameters(component.id, { [name]: value }) }} /></label>
}

export function ComponentExperiment({ component }: { component: CircuitComponent }) {
  const store = useCircuitStore()
  const p = getComponentParameters(component)
  const result = useMemo(() => store.simulationEnabled ? simulateCircuit(store.graph) : null, [store.graph, store.simulationEnabled])
  const state = result?.components[component.id]
  const set = (patch: Partial<ComponentParameters>) => store.updateComponentParameters(component.id, patch)
  const meter = ['ammeter', 'voltmeter', 'galvanometer'].includes(component.type)
  const variable = component.type === 'rheostat' || component.type === 'potentiometer'
  const meterPositiveConnected = store.graph.connections.some(wire => [wire.from, wire.to].some(endpoint => endpoint === `${component.id}.high` || endpoint === `${component.id}.${component.type === 'voltmeter' ? 'left' : 'right'}`))
  const meterHighConnected = store.graph.connections.some(wire => [wire.from, wire.to].includes(`${component.id}.high`))
  const meterRanges = component.type === 'voltmeter' ? [3, 15] : [0.6, 3]
  const displayedRange = meterPositiveConnected ? meterHighConnected ? meterRanges[1] : meterRanges[0] : p.meterRange === meterRanges[1] ? meterRanges[1] : meterRanges[0]
  const number = (name: keyof ComponentParameters, label: string, min = 0, max = 1e6) => <ParameterNumber key={name} component={component} name={name} label={label} value={p[name] as number} min={min} max={max} />
  return <section className="experiment-properties" aria-label="实验参数">
    <div className="field-label">实验参数</div>
    {component.type === 'battery' && <>{number('voltage', '电源电压 (V)', 0, 1000)}{number('internalResistance', '电源内阻 (Ω)', 0, 1000)}</>}
    {['resistor', 'motor', 'bell', 'buzzer'].includes(component.type) && number('resistance', '电阻 (Ω)')}
    {component.type === 'lamp' && <>{number('ratedVoltage', '额定电压 (V)', 0.01, 1000)}{number('ratedPower', '额定功率 (W)', 0.001, 10000)}</>}
    {component.type === 'lamp' && <p className="experiment-note">按额定参数计算稳态电阻；亮度随功率变化。超过额定功率提示过载，尚未模拟热损坏过程。</p>}
    {component.type === 'switch' && <label className="binary-field"><span>开关闭合</span><input type="checkbox" checked={p.switchClosed} onChange={event => set({ switchClosed: event.target.checked })} /></label>}
    {component.type === 'switch_spdt' && <label className="parameter-field"><span>开关位置</span><select aria-label="开关位置" value={p.switchPosition} onChange={event => set({ switchPosition: event.target.value as ComponentParameters['switchPosition'] })}><option value="open">断开</option><option value="left">左支路</option><option value="right">右支路</option></select></label>}
    {variable && <>{number('maxResistance', '最大阻值 (Ω)')}<label className="parameter-slider"><span>滑片位置 <output>{Math.round(p.sliderPosition * 100)}%</output></span><input type="range" aria-label="滑片位置" min="0" max="100" value={p.sliderPosition * 100}
      onPointerDown={store.beginHistoryTransaction} onPointerUp={store.endHistoryTransaction} onKeyDown={store.beginHistoryTransaction} onKeyUp={store.endHistoryTransaction} onBlur={store.endHistoryTransaction}
      onChange={event => set({ sliderPosition: Number(event.target.value) / 100 })} /></label>
      <dl className="measurement-values"><div><dt>A 到滑片</dt><dd>{formatReading(p.maxResistance * p.sliderPosition, 'Ω')}</dd></div><div><dt>滑片到 B</dt><dd>{formatReading(p.maxResistance * (1 - p.sliderPosition), 'Ω')}</dd></div></dl></>}
    {meter && <>
      {store.viewMode === 'schematic' && component.type !== 'galvanometer' && <label className="parameter-field"><span>接线量程</span><select aria-label="接线量程" disabled={meterPositiveConnected} value={displayedRange} onChange={event => set({ meterRange: Number(event.target.value) })}>{meterRanges.map(range => <option key={range} value={range}>{range} {component.type === 'voltmeter' ? 'V' : 'A'}</option>)}</select></label>}
      <label className="parameter-field"><span>表针模式</span><select aria-label="表针模式" value={p.meterMode} onChange={event => set({ meterMode: event.target.value as 'auto' | 'manual' })}><option value="auto">自动测量</option><option value="manual">手动设针</option></select></label>
      {component.type === 'galvanometer' && number('meterRange', '满偏电流 (A)', 0.000001, 1)}
      {p.meterMode === 'manual' && number('manualReading', component.type === 'voltmeter' ? '手动读数 (V)' : '手动读数 (A)', -1000, 1000)}
      {state && <dl className="measurement-values"><div><dt>接入量程</dt><dd>{formatReading(state.range, state.unit)}</dd></div><div><dt>实际测量</dt><dd>{formatReading(state.reading, state.unit)}</dd></div><div><dt>测量状态</dt><dd>{{ ok: '正常', reverse: '反向', overload: '超量程', floating: '无有效测量', miswired: '接法有误' }[state.meterStatus || 'floating']}</dd></div></dl>}
    </>}
    {state && variable && <dl className="measurement-values">{state.branches?.map(branch => <div key={`${branch.from}-${branch.to}`} style={{ display: 'block' }}><dt>{branch.from.toUpperCase()} → {branch.to.toUpperCase()}</dt><dd>电压 {formatReading(branch.voltage, 'V')} · 电流 {formatReading(branch.current, 'A')} · 功率 {formatReading(branch.power, 'W')}</dd></div>)}<div><dt>总功率</dt><dd>{formatReading(state.power, 'W')}</dd></div></dl>}
    {state && !meter && !variable && <dl className="measurement-values"><div><dt>电流</dt><dd>{formatReading(state.current, 'A')}</dd></div><div><dt>端电压</dt><dd>{formatReading(state.voltage, 'V')}</dd></div><div><dt>实际功率</dt><dd>{formatReading(state.power, 'W')}</dd></div></dl>}
    {state && component.type === 'lamp' && <dl className="measurement-values" style={state.lampStatus === 'overload' ? { color: '#be4742' } : undefined}><div><dt>额定功率</dt><dd>{formatReading(state.ratedPower, 'W')}</dd></div><div><dt>灯泡状态</dt><dd>{state.lampStatus === 'overload' ? '过载：有烧毁风险' : state.lampStatus === 'normal' ? '正常' : '未点亮'}</dd></div></dl>}
  </section>
}
